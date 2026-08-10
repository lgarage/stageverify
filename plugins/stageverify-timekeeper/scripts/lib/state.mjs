import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Elapsed + stall thresholds (ms). Healthy progress suppresses stall10 only. */
export const THRESHOLDS_MS = {
  stallNoProgress: 10 * 60 * 1000,
  status10: 10 * 60 * 1000,
  focus15: 15 * 60 * 1000,
  focus20: 20 * 60 * 1000,
  focus25: 25 * 60 * 1000,
  completion30: 30 * 60 * 1000,
  force35: 35 * 60 * 1000,
  // Back-compat aliases used by older tests/docs
  status: 15 * 60 * 1000,
  focus: 25 * 60 * 1000,
  force: 35 * 60 * 1000,
};

/** Elapsed ladder order (lowest → highest). Supersession emits the highest pending only. */
export const ELAPSED_CHECKPOINT_ORDER = [
  "status10",
  "focus15",
  "focus20",
  "focus25",
  "completion30",
  "force35",
];

/** Max identical-signature failures before thrash intervention (2 fails → stop repeating). */
export const THRASH_FAIL_LIMIT = 2;

/** Soft cap on wait-poll nudges per wait kind. */
export const WAIT_POLL_SOFT_LIMIT = 3;

/**
 * After force35 is delivered, re-emit a short D-66 sticky nudge on reliable hooks
 * at this cooldown (advise-only). First sticky is cooldown after force35 delivery.
 */
export const STICKY_FORCE_COOLDOWN_MS = 5 * 60 * 1000;

/** Kind string for sticky post-35m nudges (not part of elapsed Policy B ladder). */
export const STICKY_FORCE_KIND = "force35_sticky";

/**
 * Cursor may fire both afterShellExecution and postToolUse(Failure) for one Shell call.
 * Ignore duplicate signature counts inside this window.
 */
export const SHELL_HOOK_DEDUPE_MS = 3000;

/**
 * Hooks that can carry agent-visible advice (repo-documented inject fields).
 * Approximation: we mark delivered only when the response includes one of these fields.
 * Platform does not ack receipt — this is the strongest deterministic guarantee available.
 */
export const RELIABLE_DELIVERY_HOOKS = new Set([
  "preToolUse", // agent_message + permission allow
  "postToolUse", // additional_context
  "beforeShellExecution", // agent_message + permission allow
  "stop", // followup_message
]);

/** Best-effort / no official inject — may queue pending but must not consume. */
export const BEST_EFFORT_HOOKS = new Set([
  "afterShellExecution",
  "postToolUseFailure",
  "afterFileEdit",
  "subagentStart",
  "subagentStop",
]);

/**
 * @param {string} hook
 */
export function isReliableDeliveryHook(hook) {
  return RELIABLE_DELIVERY_HOOKS.has(String(hook || ""));
}

/**
 * @param {string[]} workspaceRoots
 * @returns {string}
 */
export function resolveStateDir(workspaceRoots = []) {
  const root =
    (Array.isArray(workspaceRoots) && workspaceRoots[0]) || process.cwd();
  return join(root, ".cursor", "hooks", "state", "timekeeper");
}

/**
 * @param {string} conversationId
 * @param {string[]} workspaceRoots
 */
export function statePath(conversationId, workspaceRoots) {
  const id = sanitizeId(conversationId || "unknown");
  return join(resolveStateDir(workspaceRoots), `${id}.json`);
}

/**
 * Optional local debug trace (gitignored via `.cursor/hooks/state/`).
 * @param {string[]} workspaceRoots
 */
export function tracePath(workspaceRoots) {
  return join(resolveStateDir(workspaceRoots), "trace.jsonl");
}

function sanitizeId(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function emptyDeliverySlot() {
  return { status: "not_due", queuedAt: null, deliveredAt: null, family: null, payload: null };
}

/**
 * @returns {object}
 */
export function emptyState(conversationId, now) {
  return {
    conversationId: conversationId || "unknown",
    startedAt: now,
    lastProgressAt: now,
    lastInterventionAt: null,
    interventions: [],
    /** @deprecated migrated into delivery — kept for load compat */
    firedCheckpoints: {},
    /**
     * kind → { status: not_due|pending|delivered|superseded, queuedAt, deliveredAt, family, payload }
     */
    delivery: {},
    signatures: {},
    greenEvidence: {
      build: false,
      d38: false,
      d60: false,
      visual: false,
      verifies: {},
    },
    waitPolls: {},
    mainMoves: { count: 0, lastAt: null, conflict: false, lastClean: true },
    lastMaterialEvidence: null,
    mode: "normal",
    thrashWarned: {},
    /**
     * Post-35m sticky D-66 campaign (advise-only).
     * active while force_choice and no terminalOutcome detected.
     */
    forceCampaign: {
      active: false,
      lastStickyAt: null,
      stickyCount: 0,
      lastDeliveryHook: null,
      /** @type {null|"DONE"|"BLOCKED"|"FAILED"|"PARTIAL"} */
      terminalOutcome: null,
    },
  };
}

/**
 * Ensure forceCampaign exists (load compat for pre-sticky state files).
 * @param {object} state
 */
export function normalizeForceCampaign(state) {
  const base = emptyState(state.conversationId || "unknown", state.startedAt || Date.now())
    .forceCampaign;
  if (!state.forceCampaign || typeof state.forceCampaign !== "object") {
    state.forceCampaign = { ...base };
  } else {
    state.forceCampaign = { ...base, ...state.forceCampaign };
  }
  return state;
}

/**
 * Migrate legacy firedCheckpoints booleans → delivery map.
 * @param {object} state
 */
export function normalizeDeliveryState(state) {
  if (!state.delivery || typeof state.delivery !== "object") state.delivery = {};
  const fired = state.firedCheckpoints || {};
  // Old elapsed names → new
  const legacyMap = {
    status15: "focus15",
    focus25: "focus25",
    force35: "force35",
    stall10: "stall10",
    main_clean: "main_clean",
    merge_conflict: "merge_conflict",
  };
  for (const [oldKey, newKey] of Object.entries(legacyMap)) {
    if (fired[oldKey] && !state.delivery[newKey]) {
      state.delivery[newKey] = {
        ...emptyDeliverySlot(),
        status: "delivered",
        deliveredAt: state.lastInterventionAt || state.startedAt || null,
        family: ELAPSED_CHECKPOINT_ORDER.includes(newKey)
          ? "elapsed"
          : newKey === "stall10"
            ? "stall"
            : "event",
      };
    }
  }
  return state;
}

/**
 * @param {object} state
 * @param {string} kind
 */
export function getDeliveryStatus(state, kind) {
  const slot = state.delivery?.[kind];
  return slot?.status || "not_due";
}

/**
 * @param {object} state
 * @param {string} kind
 * @param {object} patch
 */
export function setDelivery(state, kind, patch) {
  if (!state.delivery) state.delivery = {};
  const prev = state.delivery[kind] || emptyDeliverySlot();
  state.delivery[kind] = { ...prev, ...patch };
}

/**
 * @param {string} conversationId
 * @param {string[]} workspaceRoots
 * @param {number} now
 */
export function loadState(conversationId, workspaceRoots, now = Date.now()) {
  const path = statePath(conversationId, workspaceRoots);
  if (!existsSync(path)) {
    return emptyState(conversationId, now);
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const fresh = emptyState(conversationId, now);
    const state = {
      ...fresh,
      ...raw,
      firedCheckpoints: {
        ...(raw.firedCheckpoints || {}),
      },
      delivery: {
        ...(raw.delivery || {}),
      },
      greenEvidence: {
        ...fresh.greenEvidence,
        ...(raw.greenEvidence || {}),
        verifies: {
          ...(raw.greenEvidence?.verifies || {}),
        },
      },
      mainMoves: {
        ...fresh.mainMoves,
        ...(raw.mainMoves || {}),
      },
      forceCampaign: {
        ...fresh.forceCampaign,
        ...(raw.forceCampaign || {}),
      },
      signatures: raw.signatures || {},
      waitPolls: raw.waitPolls || {},
      thrashWarned: raw.thrashWarned || {},
      interventions: Array.isArray(raw.interventions) ? raw.interventions : [],
    };
    normalizeForceCampaign(state);
    return normalizeDeliveryState(state);
  } catch {
    return emptyState(conversationId, now);
  }
}

/**
 * @param {object} state
 * @param {string[]} workspaceRoots
 */
export function saveState(state, workspaceRoots) {
  const path = statePath(state.conversationId, workspaceRoots);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
}

/**
 * Append one debug trace line (best-effort; never throws to caller).
 * @param {string[]} workspaceRoots
 * @param {object} row
 */
export function appendTrace(workspaceRoots, row) {
  try {
    const path = tracePath(workspaceRoots);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(row) + "\n", "utf8");
  } catch {
    /* ignore — correctness does not depend on trace */
  }
}

/**
 * @param {number} startedAt
 * @param {number} now
 */
export function elapsedMs(startedAt, now) {
  return Math.max(0, now - startedAt);
}

/**
 * @param {number} ms
 */
export function formatElapsed(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return `~${Math.max(1, Math.round(ms / 1000))}s`;
  return `~${m}m`;
}

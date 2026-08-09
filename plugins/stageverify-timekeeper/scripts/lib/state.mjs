import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

export const THRESHOLDS_MS = {
  stallNoProgress: 10 * 60 * 1000,
  status: 15 * 60 * 1000,
  focus: 25 * 60 * 1000,
  force: 35 * 60 * 1000,
};

/** Max identical-signature failures before thrash intervention (2 fails → stop repeating). */
export const THRASH_FAIL_LIMIT = 2;

/** Soft cap on wait-poll nudges per wait kind. */
export const WAIT_POLL_SOFT_LIMIT = 3;

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

function sanitizeId(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
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
    firedCheckpoints: {
      stall10: false,
      status15: false,
      focus25: false,
      force35: false,
    },
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
  };
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
    return {
      ...emptyState(conversationId, now),
      ...raw,
      firedCheckpoints: {
        ...emptyState(conversationId, now).firedCheckpoints,
        ...(raw.firedCheckpoints || {}),
      },
      greenEvidence: {
        ...emptyState(conversationId, now).greenEvidence,
        ...(raw.greenEvidence || {}),
        verifies: {
          ...(raw.greenEvidence?.verifies || {}),
        },
      },
      mainMoves: {
        ...emptyState(conversationId, now).mainMoves,
        ...(raw.mainMoves || {}),
      },
      signatures: raw.signatures || {},
      waitPolls: raw.waitPolls || {},
      thrashWarned: raw.thrashWarned || {},
      interventions: Array.isArray(raw.interventions) ? raw.interventions : [],
    };
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

import {
  THRESHOLDS_MS,
  THRASH_FAIL_LIMIT,
  WAIT_POLL_SOFT_LIMIT,
  SHELL_HOOK_DEDUPE_MS,
  STICKY_FORCE_COOLDOWN_MS,
  STICKY_FORCE_KIND,
  ELAPSED_CHECKPOINT_ORDER,
  elapsedMs,
  formatElapsed,
  isReliableDeliveryHook,
  getDeliveryStatus,
  setDelivery,
  normalizeDeliveryState,
  normalizeForceCampaign,
} from "./state.mjs";
import {
  classifyFailure,
  classifyWaitCommand,
  classifyMainDrift,
  failureClassAdvice,
} from "./classify.mjs";
import {
  normalizeCommandSignature,
  extractNpmScript,
  classifyOutputOutcome,
} from "./signatures.mjs";

/**
 * @typedef {{ kind: string, reason: string, decision: string, stateLabel: string, failureClass?: string, message: string, family?: string }} Intervention
 */

/** Short elapsed checkpoint copy (action-oriented; avoid spam). */
export const ELAPSED_CHECKPOINT_COPY = {
  status10: {
    stateLabel: "checkpoint",
    reason: "~10m elapsed",
    decision:
      "TIMEKEEPER 10m — state current objective, last material progress, and shortest safe path to DONE.",
  },
  focus15: {
    stateLabel: "checkpoint",
    reason: "~15m elapsed",
    decision:
      "TIMEKEEPER 15m — confirm current objective and shortest safe path. Do not expand scope.",
  },
  focus20: {
    stateLabel: "checkpoint",
    reason: "~20m elapsed",
    decision:
      "TIMEKEEPER 20m — still progressing? Continue the shortest safe path and do not redo green work.",
  },
  focus25: {
    stateLabel: "completion_focus",
    reason: "~25m elapsed",
    decision:
      "TIMEKEEPER 25m — completion focus. Finish the current path; avoid reopening solved work.",
  },
  completion30: {
    stateLabel: "completion_push",
    reason: "~30m elapsed",
    decision:
      "TIMEKEEPER 30m — completion push. Finish, identify a true blocker, or move to PARTIAL/BLOCKED. Do not expand scope.",
  },
  force35: {
    stateLabel: "force_choice",
    reason: "~35m elapsed",
    decision:
      "TIMEKEEPER 35m — terminal checkpoint. Produce the required D-66 outcome: DONE / BLOCKED / FAILED / PARTIAL.",
  },
};

/** Sticky post-35m D-66 nudge (cooldown; advise-only). */
export const STICKY_FORCE_COPY = {
  stateLabel: "force_choice",
  reason: "past ~35m — sticky terminal nudge",
  decision: [
    "TIMEKEEPER sticky (≥35m) — stop expanding scope. Finish the current safe bounded unit of work, then return exactly one D-66 outcome: DONE / BLOCKED / FAILED / PARTIAL.",
    "Hand remaining work to a continuation/new job if needed.",
    "Waiting on Dan approval → BLOCKED and return. Deploy/CI propagation wait → BLOCKED or PARTIAL with exact state (do not burn another 20–30m). Unrelated issue → record it; do not chase it here. Required D-60/D-38/verify still running → finish that bounded gate safely, then terminate.",
  ].join(" "),
};

/** Compact stop followup while force_choice (re-issuable; loop_limit caps auto-loops). */
export const FORCE35_STOP_FOLLOWUP =
  "TIMEKEEPER 35m — stop expanding scope. Finish the current safe unit, then produce D-66: DONE / BLOCKED / FAILED / PARTIAL. Waiting on Dan → BLOCKED. External wait → BLOCKED/PARTIAL with state. Do not skip required D-38/D-60/verify gates.";

const HARD_CONTRACT =
  "HARD CONTRACT: Never skip required D-38/D-60/D-42/D-51/verify:* / D-50 ladders. Timekeeper complements; it does not weaken safety.";

/** D-66 terminal first lines (done-signal.mdc). */
const TERMINAL_PATTERNS = [
  { re: /\bDONE\s*[—-]\s*finished\b/i, outcome: "DONE" },
  { re: /\bBLOCKED\s*[—-]\s*needs input\b/i, outcome: "BLOCKED" },
  { re: /\bFAILED\s*[—-]\s*stopped\b/i, outcome: "FAILED" },
  { re: /\bPARTIAL\s*[—-]\s*some work completed\b/i, outcome: "PARTIAL" },
];

/**
 * Detect D-66 terminal outcome from hook event / prior state.
 * @param {object} event
 * @param {object} state
 * @returns {null|"DONE"|"BLOCKED"|"FAILED"|"PARTIAL"}
 */
export function detectTerminalOutcome(event = {}, state = {}) {
  normalizeForceCampaign(state);
  if (state.forceCampaign.terminalOutcome) return state.forceCampaign.terminalOutcome;

  const explicit = event.terminal_outcome || event.terminalOutcome || event.d66_outcome;
  if (explicit) {
    const u = String(explicit).toUpperCase();
    if (u === "DONE" || u === "BLOCKED" || u === "FAILED" || u === "PARTIAL") return u;
  }

  const blobs = [
    event.last_assistant_message,
    event.assistant_message,
    event.final_response,
    event.completion_message,
    event.message,
    event.text,
    event.output,
    event.tool_output,
  ];
  for (const blob of blobs) {
    if (blob == null) continue;
    const text = typeof blob === "string" ? blob : JSON.stringify(blob);
    for (const { re, outcome } of TERMINAL_PATTERNS) {
      if (re.test(text)) return outcome;
    }
  }
  return null;
}

/**
 * Arm / update force campaign bookkeeping when force35 is first delivered.
 * @param {object} state
 * @param {number} now
 * @param {string} hook
 */
export function armForceCampaign(state, now, hook = "") {
  normalizeForceCampaign(state);
  state.mode = "force_choice";
  state.forceCampaign.active = true;
  // Start cooldown clock so sticky is ~5m after force35, not on the next tool.
  if (state.forceCampaign.lastStickyAt == null) {
    state.forceCampaign.lastStickyAt = now;
  }
  if (hook) state.forceCampaign.lastDeliveryHook = hook;
}

/**
 * Build a sticky intervention when due (reliable hook, past cooldown, non-terminal).
 * @returns {Intervention|null}
 */
export function maybeStickyForceIntervention(state, hook, now) {
  normalizeForceCampaign(state);
  if (!isReliableDeliveryHook(hook)) return null;
  if (state.forceCampaign.terminalOutcome) return null;
  if (state.mode !== "force_choice") return null;
  if (getDeliveryStatus(state, "force35") !== "delivered") return null;

  const last = state.forceCampaign.lastStickyAt;
  if (typeof last === "number" && now - last < STICKY_FORCE_COOLDOWN_MS) {
    return null;
  }

  return {
    kind: STICKY_FORCE_KIND,
    family: "sticky",
    stateLabel: STICKY_FORCE_COPY.stateLabel,
    reason: STICKY_FORCE_COPY.reason,
    decision: STICKY_FORCE_COPY.decision,
  };
}

/**
 * Record sticky emission (cooldown + observability).
 * @param {object} state
 * @param {number} now
 * @param {string} hook
 */
export function recordStickyEmission(state, now, hook) {
  normalizeForceCampaign(state);
  state.forceCampaign.active = true;
  state.forceCampaign.lastStickyAt = now;
  state.forceCampaign.stickyCount = (state.forceCampaign.stickyCount || 0) + 1;
  state.forceCampaign.lastDeliveryHook = hook || state.forceCampaign.lastDeliveryHook;
  state.lastInterventionAt = now;
  state.interventions.push({
    at: now,
    kind: STICKY_FORCE_KIND,
    reason: STICKY_FORCE_COPY.reason,
    decision: STICKY_FORCE_COPY.decision,
  });
}

/**
 * Format TIMEKEEPER block (compact for elapsed; slightly richer for thrash/stall).
 * @param {object} state
 * @param {number} now
 * @param {Intervention} intervention
 */
export function formatTimekeeperBlock(state, now, intervention) {
  if (
    intervention.family === "elapsed" ||
    intervention.family === "sticky" ||
    intervention.kind === STICKY_FORCE_KIND ||
    ELAPSED_CHECKPOINT_ORDER.includes(intervention.kind)
  ) {
    return [intervention.decision, HARD_CONTRACT].join("\n");
  }
  const elapsed = formatElapsed(elapsedMs(state.startedAt, now));
  const sinceProgress = formatElapsed(now - state.lastProgressAt);
  const lines = [
    "TIMEKEEPER",
    `elapsed: ${elapsed}`,
    `state: ${intervention.stateLabel}`,
    `reason: ${intervention.reason}`,
    `new evidence last ${sinceProgress}: ${state.lastMaterialEvidence || "none"}`,
    `decision: ${intervention.decision}`,
  ];
  if (intervention.failureClass) {
    lines.push(`failure_class: ${intervention.failureClass}`);
  }
  lines.push(failureClassAdvice(intervention.failureClass || "unknown"));
  lines.push(HARD_CONTRACT);
  return lines.join("\n");
}

/**
 * Queue an intervention as pending — never mark delivered here.
 * @returns {boolean} true if newly queued
 */
export function queuePending(state, now, kind, payload, family) {
  normalizeDeliveryState(state);
  const status = getDeliveryStatus(state, kind);
  if (status === "pending" || status === "delivered" || status === "superseded") {
    return false;
  }
  setDelivery(state, kind, {
    status: "pending",
    queuedAt: now,
    deliveredAt: null,
    family,
    payload: { kind, family, ...payload },
  });
  return true;
}

/**
 * Select pending interventions for a reliable hook.
 * Policy B for elapsed ladder: emit highest pending only; supersede lower.
 * Event/stall families emit alongside (distinct signals).
 *
 * @returns {Intervention[]}
 */
export function selectPendingForDelivery(state, hook, now = Date.now()) {
  normalizeDeliveryState(state);
  if (!isReliableDeliveryHook(hook)) return [];

  /** @type {Intervention[]} */
  const out = [];
  const pendingKinds = Object.keys(state.delivery || {}).filter(
    (k) => state.delivery[k]?.status === "pending"
  );

  const elapsedPending = ELAPSED_CHECKPOINT_ORDER.filter((k) =>
    pendingKinds.includes(k)
  );
  if (elapsedPending.length) {
    const highest = elapsedPending[elapsedPending.length - 1];
    for (const k of elapsedPending) {
      if (k === highest) continue;
      setDelivery(state, k, {
        status: "superseded",
        deliveredAt: now,
      });
    }
    const slot = state.delivery[highest];
    const payload = slot.payload || { kind: highest, ...(ELAPSED_CHECKPOINT_COPY[highest] || {}) };
    out.push({ ...payload, kind: highest, family: "elapsed" });
  }

  for (const k of pendingKinds) {
    if (ELAPSED_CHECKPOINT_ORDER.includes(k)) continue;
    const slot = state.delivery[k];
    if (!slot?.payload) continue;
    out.push({ ...slot.payload, kind: k, family: slot.family || "event" });
  }

  return out;
}

/**
 * Mark selected interventions delivered (call only after response carries advice).
 * @param {object} state
 * @param {Intervention[]} interventions
 * @param {number} now
 */
export function markDelivered(state, interventions, now = Date.now(), hook = "") {
  for (const i of interventions) {
    // Sticky nudges are cooldown-replayable — do not consume via delivery map.
    if (i.kind === STICKY_FORCE_KIND || i.family === "sticky") {
      recordStickyEmission(state, now, hook);
      continue;
    }
    setDelivery(state, i.kind, {
      status: "delivered",
      deliveredAt: now,
    });
    state.lastInterventionAt = now;
    state.interventions.push({
      at: now,
      kind: i.kind,
      reason: i.reason,
      decision: i.decision,
    });
    if (i.kind === "force35") {
      armForceCampaign(state, now, hook);
    }
    // Back-compat thrashWarned for signatures
    if (i.kind.startsWith("thrash:") || i.kind === "thrash" || i.kind === "thrash_pre") {
      const sig = i.kind.startsWith("thrash:") ? i.kind.slice("thrash:".length) : null;
      if (sig) state.thrashWarned[sig] = true;
    }
  }
}

/**
 * True when hook response includes an agent-visible advice field.
 * @param {Record<string, unknown>} response
 */
export function responseCarriesAdvice(response) {
  if (!response || typeof response !== "object") return false;
  return Boolean(
    response.additional_context || response.agent_message || response.followup_message
  );
}

/**
 * Mark material progress.
 */
export function markProgress(state, now, evidence) {
  state.lastProgressAt = now;
  state.lastMaterialEvidence = evidence;
}

/**
 * Stamp green evidence from command/output (same-cycle reuse only — never skip required gates).
 */
export function stampGreenEvidence(state, command, output) {
  const c = String(command || "");
  const o = String(output || "");
  const outcome = classifyOutputOutcome(o);
  if (outcome !== "pass") return;

  if (/\bnpm run build\b/.test(c) || /\bvite build\b/.test(c)) {
    state.greenEvidence.build = true;
  }
  if (/security-gate-id|sonnet-instruct|sonnet-verify/i.test(o)) {
    if (/security-gate-id/i.test(o)) state.greenEvidence.d38 = true;
    if (/sonnet-instruct|sonnet-verify/i.test(o)) state.greenEvidence.d60 = true;
  }
  if (/ui-before-after|ui-readability:\s*PASS|ui-playwright-verifier:\s*PASS/i.test(o)) {
    state.greenEvidence.visual = true;
  }
  const script = extractNpmScript(c);
  if (script && /^verify:/.test(script)) {
    state.greenEvidence.verifies[script] = true;
  }
}

/**
 * Update signature bookkeeping.
 * @returns {{ sig: string, entry: object }}
 */
export function touchSignature(state, command, outcome, now, hook = "") {
  const sig = normalizeCommandSignature(command);
  if (!sig) return { sig: "", entry: null };
  const entry = state.signatures[sig] || {
    count: 0,
    failCount: 0,
    lastAt: 0,
    lastOutcome: "unknown",
    lastHook: "",
  };
  entry.count += 1;
  entry.lastAt = now;
  entry.lastOutcome = outcome;
  entry.lastHook = hook || entry.lastHook || "";
  if (outcome === "fail") entry.failCount += 1;
  state.signatures[sig] = entry;
  return { sig, entry };
}

/** True when Cursor double-fires shell hooks for one underlying command. */
function isDuplicateShellHookObservation(prev, hook, now) {
  if (!prev || typeof prev.lastAt !== "number" || !prev.lastHook) return false;
  if (now - prev.lastAt >= SHELL_HOOK_DEDUPE_MS) return false;
  if (prev.lastHook === hook) return false;
  const pair = new Set(["afterShellExecution", "postToolUseFailure", "postToolUse"]);
  return pair.has(prev.lastHook) && pair.has(hook);
}

/**
 * Observe tools/shell and queue due interventions (pending only).
 */
function observeAndQueue(state, event, now) {
  normalizeDeliveryState(state);
  const hook = event.hook_event_name || event.hook || "";
  let progress = false;

  if (hook === "afterFileEdit") {
    const fp = event.file_path || "";
    if (!/\.cursor\/hooks\/state\/timekeeper\//.test(fp)) {
      markProgress(state, now, `file edit: ${fp.split(/[/\\]/).pop() || fp}`);
      progress = true;
    }
  }

  const command =
    event.command ||
    event.tool_input?.command ||
    (typeof event.tool_input === "object" && event.tool_input?.command) ||
    "";
  const output = event.output || event.tool_output || event.error_message || "";
  const failureType = event.failure_type || "";

  if (
    hook === "afterShellExecution" ||
    hook === "postToolUse" ||
    hook === "postToolUseFailure"
  ) {
    const isShellTool =
      hook === "afterShellExecution" ||
      event.tool_name === "Shell" ||
      (hook === "postToolUseFailure" && Boolean(command));

    if (hook === "postToolUse" && event.tool_name === "Shell") {
      // fall through to timed checkpoints only
    } else {
      let outcome = "unknown";
      if (hook === "postToolUseFailure") {
        outcome = "fail";
      } else if (isShellTool || hook === "afterShellExecution") {
        outcome = classifyOutputOutcome(output);
        if (failureType) outcome = "fail";
      } else if (event.tool_name === "Write" || event.tool_name === "StrReplace") {
        markProgress(state, now, `tool: ${event.tool_name}`);
        progress = true;
      }

      if (command) {
        const sigPreview = normalizeCommandSignature(command);
        const prev = sigPreview ? state.signatures[sigPreview] : null;
        const duplicateShellHook =
          isShellTool && isDuplicateShellHookObservation(prev, hook, now);
        if (!duplicateShellHook) {
          const { sig, entry } = touchSignature(state, command, outcome, now, hook);
          stampGreenEvidence(state, command, output);

          const waitKind = classifyWaitCommand(command);
          if (waitKind) {
            const wp = state.waitPolls[waitKind] || { count: 0, firstAt: now, lastAt: now };
            wp.count += 1;
            wp.lastAt = now;
            state.waitPolls[waitKind] = wp;
            if (wp.count === WAIT_POLL_SOFT_LIMIT) {
              queuePending(
                state,
                now,
                `wait_poll:${waitKind}`,
                {
                  stateLabel: "waiting",
                  reason: `${waitKind} polled ${wp.count}×`,
                  decision:
                    "TIMEKEEPER wait — bounded polling. Do not restart successful deploys/CI.",
                  failureClass:
                    waitKind === "ci"
                      ? "ci_wait"
                      : waitKind === "sleep" ||
                          waitKind === "gh_pages" ||
                          waitKind === "firebase"
                        ? "deploy_propagation_wait"
                        : "unknown",
                },
                "event"
              );
            }
          }

          const drift = classifyMainDrift(command, output);
          if (drift.kind) {
            state.mainMoves.count += 1;
            state.mainMoves.lastAt = now;
            state.mainMoves.lastClean = drift.clean;
            state.mainMoves.conflict = drift.kind === "merge_conflict";
            if (drift.kind === "merge_conflict") {
              queuePending(
                state,
                now,
                "merge_conflict",
                {
                  stateLabel: "main_drift",
                  reason: "merge conflict with main detected",
                  decision:
                    "TIMEKEEPER main — resolve only actual conflict hunks. Do not redo unrelated completed work.",
                  failureClass: "repo_main_drift",
                },
                "event"
              );
            } else if (drift.kind === "main_move" && drift.clean) {
              queuePending(
                state,
                now,
                "main_clean",
                {
                  stateLabel: "main_moved",
                  reason: "main moved but integration looks clean",
                  decision:
                    "TIMEKEEPER main — check material impact. If PR remains clean, do not automatically redo completed work.",
                  failureClass: "repo_main_drift",
                },
                "event"
              );
            }
          }

          if (outcome === "fail" && entry && entry.failCount >= THRASH_FAIL_LIMIT) {
            const cls = classifyFailure({
              command,
              output,
              errorMessage: event.error_message,
              failureType,
            });
            const thrashKey = `thrash:${sig}`;
            const thrashPreKey = `thrash_pre:${sig}`;
            // Supersede weaker pre-warn if present
            if (getDeliveryStatus(state, thrashPreKey) === "pending") {
              setDelivery(state, thrashPreKey, { status: "superseded", deliveredAt: now });
            }
            queuePending(
              state,
              now,
              thrashKey,
              {
                stateLabel: "stalled",
                reason: `same operation failed ${entry.failCount}× (${sig.slice(0, 80)})`,
                decision:
                  "TIMEKEEPER thrash — STOP repeating this signature. Classify, change method, escalate D-19/D-50, or return PARTIAL/BLOCKED.",
                failureClass: cls,
              },
              "event"
            );
          }

          if (outcome === "pass" && !waitKind) {
            markProgress(state, now, `pass: ${extractNpmScript(command) || sig.slice(0, 60)}`);
            progress = true;
          }
        }
      }
    }
  }

  if (hook === "beforeShellExecution" && command) {
    const sig = normalizeCommandSignature(command);
    const entry = state.signatures[sig];
    if (entry && entry.failCount >= THRASH_FAIL_LIMIT) {
      const thrashKey = `thrash:${sig}`;
      const thrashPreKey = `thrash_pre:${sig}`;
      // Prefer thrash over thrash_pre if both due; queue pre only if thrash not already queued/delivered
      const thrashStatus = getDeliveryStatus(state, thrashKey);
      if (thrashStatus === "not_due") {
        const cls = classifyFailure({ command, failureType: "error" });
        queuePending(
          state,
          now,
          thrashPreKey,
          {
            stateLabel: "stalled",
            reason: `about to repeat a signature that already failed ${entry.failCount}×`,
            decision:
              "TIMEKEEPER thrash — do not run the same failing command again. Change method or escalate D-19/D-50.",
            failureClass: cls,
          },
          "event"
        );
      }
    }
  }

  if (hook === "subagentStop") {
    if (event.status === "completed" && (event.modified_files || []).length > 0) {
      markProgress(state, now, `subagent completed with ${event.modified_files.length} files`);
      progress = true;
    }
  }

  // --- Timed checkpoints (queue pending; progress does NOT suppress elapsed) ---
  const elapsed = elapsedMs(state.startedAt, now);
  const sinceProgress = now - state.lastProgressAt;

  if (sinceProgress >= THRESHOLDS_MS.stallNoProgress) {
    queuePending(
      state,
      now,
      "stall10",
      {
        stateLabel: "stalled",
        reason: "no material progress for ~10m",
        decision:
          "TIMEKEEPER stall — no material progress ~10m. Change strategy; do not blind-retry.",
      },
      "stall"
    );
  }

  for (const kind of ELAPSED_CHECKPOINT_ORDER) {
    const ms = THRESHOLDS_MS[kind];
    if (typeof ms !== "number") continue;
    if (elapsed < ms) continue;
    const copy = ELAPSED_CHECKPOINT_COPY[kind];
    if (!copy) continue;
    const queued = queuePending(state, now, kind, { ...copy }, "elapsed");
    if (queued) {
      if (kind === "focus25" || kind === "completion30") state.mode = "completion_focus";
      if (kind === "force35") state.mode = "force_choice";
    } else if (kind === "force35" && getDeliveryStatus(state, kind) !== "not_due") {
      state.mode = "force_choice";
    } else if (
      (kind === "focus25" || kind === "completion30") &&
      getDeliveryStatus(state, kind) !== "not_due" &&
      state.mode === "normal"
    ) {
      state.mode = "completion_focus";
    }
  }

  return { progress };
}

/**
 * Evaluate thrash / wait / checkpoint interventions.
 * Advise-only — never deny.
 * Queues pending on any hook; returns interventions only on reliable delivery hooks.
 *
 * @param {object} state
 * @param {object} event
 * @param {number} now
 * @returns {{ interventions: Intervention[], progress: boolean, pendingOnly: boolean }}
 */
export function evaluate(state, event, now = Date.now()) {
  const hook = event.hook_event_name || event.hook || "";
  normalizeForceCampaign(state);

  // Terminal outcome suppresses sticky campaign (even before observe).
  const terminal = detectTerminalOutcome(event, state);
  if (terminal) {
    state.forceCampaign.terminalOutcome = terminal;
    state.forceCampaign.active = false;
  }

  const { progress } = observeAndQueue(state, event, now);

  /** @type {Intervention[]} */
  const interventions = selectPendingForDelivery(state, hook, now);

  // Sticky post-35m re-nudge on reliable hooks after cooldown (not Policy B elapsed).
  const sticky = maybeStickyForceIntervention(state, hook, now);
  if (sticky) interventions.push(sticky);

  for (const i of interventions) {
    i.message = formatTimekeeperBlock(state, now, i);
  }

  // Mark delivered only for reliable hooks that will carry advice fields.
  // buildHookResponse always attaches a field when interventions.length > 0 on those hooks.
  if (interventions.length && isReliableDeliveryHook(hook)) {
    markDelivered(state, interventions, now, hook);
  }

  return {
    interventions,
    progress,
    pendingOnly: !isReliableDeliveryHook(hook),
  };
}

/**
 * Build hook response object (advise-only).
 * @param {string} hook
 * @param {Intervention[]} interventions
 * @param {object} state
 * @param {object} event
 */
export function buildHookResponse(hook, interventions, state, event) {
  /** @type {Record<string, unknown>} */
  const out = {};
  normalizeForceCampaign(state);

  // Never deny for thrash. Explicit allow on permission hooks.
  if (
    hook === "beforeShellExecution" ||
    hook === "preToolUse" ||
    hook === "subagentStart" ||
    hook === "beforeMCPExecution" ||
    hook === "beforeReadFile"
  ) {
    out.permission = "allow";
  }

  if (!interventions.length) {
    // While force_choice and non-terminal: re-issue D-66 followup on stop.
    // Respect Cursor loop_limit (hooks.json = 2) to prevent infinite stop loops.
    if (
      hook === "stop" &&
      state.mode === "force_choice" &&
      !state.forceCampaign.terminalOutcome
    ) {
      const loopCount = Number(event.loop_count || 0);
      const loopLimit = Number(
        event.loop_limit != null ? event.loop_limit : 2
      );
      if (loopCount < loopLimit) {
        const now = Date.now();
        state.interventions.push({
          at: now,
          kind: "force35_followup",
          reason: "stop at force_choice",
          decision: "require D-66 terminal",
        });
        state.forceCampaign.lastDeliveryHook = "stop";
        state.forceCampaign.active = true;
        out.followup_message = FORCE35_STOP_FOLLOWUP;
      }
    }
    return out;
  }

  const combined = interventions.map((i) => i.message).join("\n\n");

  if (hook === "postToolUse") {
    out.additional_context = combined;
  } else if (hook === "beforeShellExecution" || hook === "preToolUse") {
    out.agent_message = combined;
  } else if (hook === "stop") {
    out.followup_message = combined.slice(0, 1800);
  } else if (hook === "subagentStop" || hook === "subagentStart") {
    // No agent-visible inject — callers must keep these pending (evaluate already does).
  } else {
    // Best-effort only — evaluate should not mark delivered for these hooks.
    out.agent_message = combined;
  }

  return out;
}

/**
 * Scenario helper for tests — pure evaluate with injectable now.
 */
export function runScenario(state, events, nowStart) {
  let now = nowStart;
  const fired = [];
  for (const step of events) {
    if (typeof step.advanceMs === "number") now += step.advanceMs;
    const { interventions } = evaluate(state, step.event, now);
    for (const i of interventions) fired.push({ now, ...i });
    if (step.saveGreen) stampGreenEvidence(state, step.saveGreen.command, step.saveGreen.output);
  }
  return { state, fired, now };
}

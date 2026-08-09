import {
  THRESHOLDS_MS,
  THRASH_FAIL_LIMIT,
  WAIT_POLL_SOFT_LIMIT,
  elapsedMs,
  formatElapsed,
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
 * @typedef {{ kind: string, reason: string, decision: string, stateLabel: string, failureClass?: string, message: string }} Intervention
 */

/**
 * Format TIMEKEEPER block (only when intervening).
 * @param {object} state
 * @param {number} now
 * @param {Intervention} intervention
 */
export function formatTimekeeperBlock(state, now, intervention) {
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
  lines.push(
    "HARD CONTRACT: Never skip required D-38/D-60/D-42/D-51/verify:* / D-50 ladders. Timekeeper complements; it does not weaken safety."
  );
  return lines.join("\n");
}

/**
 * Record an intervention once (dedupe by kind).
 * @returns {Intervention | null}
 */
function fireOnce(state, now, kind, payload) {
  if (state.firedCheckpoints[kind]) return null;
  state.firedCheckpoints[kind] = true;
  state.lastInterventionAt = now;
  const intervention = { kind, ...payload };
  state.interventions.push({
    at: now,
    kind,
    reason: payload.reason,
    decision: payload.decision,
  });
  return intervention;
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
export function touchSignature(state, command, outcome, now) {
  const sig = normalizeCommandSignature(command);
  if (!sig) return { sig: "", entry: null };
  const entry = state.signatures[sig] || {
    count: 0,
    failCount: 0,
    lastAt: 0,
    lastOutcome: "unknown",
  };
  entry.count += 1;
  entry.lastAt = now;
  entry.lastOutcome = outcome;
  if (outcome === "fail") entry.failCount += 1;
  state.signatures[sig] = entry;
  return { sig, entry };
}

/**
 * Evaluate thrash / wait / checkpoint interventions.
 * Advise-only — never deny.
 *
 * @param {object} state
 * @param {object} event
 * @param {number} now
 * @returns {{ interventions: Intervention[], progress: boolean }}
 */
export function evaluate(state, event, now = Date.now()) {
  const interventions = [];
  const hook = event.hook_event_name || event.hook || "";
  let progress = false;

  // --- Observe edits as progress ---
  if (hook === "afterFileEdit") {
    const fp = event.file_path || "";
    // Ignore timekeeper state writes
    if (!/\.cursor\/hooks\/state\/timekeeper\//.test(fp)) {
      markProgress(state, now, `file edit: ${fp.split(/[/\\]/).pop() || fp}`);
      progress = true;
    }
  }

  // --- Shell / tool observation ---
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
    let outcome = "unknown";
    if (hook === "postToolUseFailure") {
      outcome = "fail";
    } else if (event.tool_name === "Shell" || hook === "afterShellExecution") {
      outcome = classifyOutputOutcome(output);
      if (failureType) outcome = "fail";
    } else if (event.tool_name === "Write" || event.tool_name === "StrReplace") {
      markProgress(state, now, `tool: ${event.tool_name}`);
      progress = true;
    }

    if (command) {
      const { sig, entry } = touchSignature(state, command, outcome, now);
      stampGreenEvidence(state, command, output);

      const waitKind = classifyWaitCommand(command);
      if (waitKind) {
        const wp = state.waitPolls[waitKind] || { count: 0, firstAt: now, lastAt: now };
        wp.count += 1;
        wp.lastAt = now;
        state.waitPolls[waitKind] = wp;
        if (wp.count === WAIT_POLL_SOFT_LIMIT) {
          interventions.push({
            kind: "wait_poll",
            stateLabel: "waiting",
            reason: `${waitKind} polled ${wp.count}×`,
            decision:
              "Use bounded polling. Do not restart successful deploys/CI. If window exceeded, investigate once.",
            failureClass:
              waitKind === "ci"
                ? "ci_wait"
                : waitKind === "sleep"
                  ? "deploy_propagation_wait"
                  : waitKind === "gh_pages" || waitKind === "firebase"
                    ? "deploy_propagation_wait"
                    : "unknown",
            message: "",
          });
        }
      }

      const drift = classifyMainDrift(command, output);
      if (drift.kind) {
        state.mainMoves.count += 1;
        state.mainMoves.lastAt = now;
        state.mainMoves.lastClean = drift.clean;
        state.mainMoves.conflict = drift.kind === "merge_conflict";
        // Once per conversation (planning sync pulls main often — do not spam)
        if (drift.kind === "merge_conflict" && !state.firedCheckpoints.merge_conflict) {
          state.firedCheckpoints.merge_conflict = true;
          interventions.push({
            kind: "merge_conflict",
            stateLabel: "main_drift",
            reason: "merge conflict with main detected",
            decision: "Resolve only actual conflict hunks. Do not redo unrelated completed work.",
            failureClass: "repo_main_drift",
            message: "",
          });
        } else if (
          drift.kind === "main_move" &&
          drift.clean &&
          !state.firedCheckpoints.main_clean
        ) {
          state.firedCheckpoints.main_clean = true;
          interventions.push({
            kind: "main_clean",
            stateLabel: "main_moved",
            reason: "main moved but integration looks clean",
            decision:
              "Determine material impact. If PR remains clean/mergeable, do not automatically redo completed work.",
            failureClass: "repo_main_drift",
            message: "",
          });
        }
      }

      if (outcome === "fail" && entry && entry.failCount >= THRASH_FAIL_LIMIT) {
        const cls = classifyFailure({
          command,
          output,
          errorMessage: event.error_message,
          failureType,
        });
        if (!state.thrashWarned[sig]) {
          state.thrashWarned[sig] = true;
          interventions.push({
            kind: "thrash",
            stateLabel: "stalled",
            reason: `same operation failed ${entry.failCount}× (${sig.slice(0, 80)})`,
            decision:
              "STOP repeating this signature. Classify failure, change method, escalate per D-19/D-50, or return PARTIAL/BLOCKED. Do not blind-retry.",
            failureClass: cls,
            message: "",
          });
        }
      }

      if (outcome === "pass" && !waitKind) {
        markProgress(state, now, `pass: ${extractNpmScript(command) || sig.slice(0, 60)}`);
        progress = true;
      }
    }
  }

  // --- beforeShell: observe only (advise via later hooks / checkpoints); never deny ---
  if (hook === "beforeShellExecution" && command) {
    const sig = normalizeCommandSignature(command);
    const entry = state.signatures[sig];
    if (entry && entry.failCount >= THRASH_FAIL_LIMIT && !state.thrashWarned[sig]) {
      // Will warn on the failure path; pre-warn once if they are about to repeat
      const cls = classifyFailure({ command, failureType: "error" });
      state.thrashWarned[sig] = true;
      interventions.push({
        kind: "thrash_pre",
        stateLabel: "stalled",
        reason: `about to repeat a signature that already failed ${entry.failCount}×`,
        decision:
          "Do not run the same failing command again. Change measurement/method or escalate (D-19/D-50).",
        failureClass: cls,
        message: "",
      });
    }
  }

  // --- Subagent lifecycle ---
  if (hook === "subagentStop") {
    if (event.status === "completed" && (event.modified_files || []).length > 0) {
      markProgress(state, now, `subagent completed with ${event.modified_files.length} files`);
      progress = true;
    }
  }

  // --- Timed checkpoints (surface only when warranted) ---
  const elapsed = elapsedMs(state.startedAt, now);
  const sinceProgress = now - state.lastProgressAt;

  if (
    sinceProgress >= THRESHOLDS_MS.stallNoProgress &&
    !state.firedCheckpoints.stall10
  ) {
    const i = fireOnce(state, now, "stall10", {
      stateLabel: "stalled",
      reason: "no material progress for ~10m",
      decision:
        "Strategy checkpoint: What new evidence? Repeating same op? Product vs measurement failure? Cheaper alternate? Change strategy — do not blind-retry.",
    });
    if (i) interventions.push(i);
  }

  if (elapsed >= THRESHOLDS_MS.status && !state.firedCheckpoints.status15) {
    // Skip duplicate soft spam if stall just fired with same guidance unless useful
    const i = fireOnce(state, now, "status15", {
      stateLabel: "checkpoint",
      reason: "~15m elapsed",
      decision:
        "Status checkpoint: what is complete? what remains? what blocks DONE? shortest safe path — do not restart completed work.",
    });
    if (i) interventions.push(i);
  }

  if (elapsed >= THRESHOLDS_MS.focus && !state.firedCheckpoints.focus25) {
    state.mode = "completion_focus";
    const green = [];
    if (state.greenEvidence.build) green.push("build");
    if (state.greenEvidence.d38) green.push("D-38");
    if (state.greenEvidence.d60) green.push("D-60");
    if (state.greenEvidence.visual) green.push("visual");
    const i = fireOnce(state, now, "focus25", {
      stateLabel: "completion_focus",
      reason: "~25m elapsed",
      decision:
        `Completion-focused mode. Narrow to remaining acceptance criteria. Do not redo approved architecture/visual review. Skip only same-cycle redundant reruns under D-37/D-65 (${green.join(", ") || "none stamped"} — heuristic stamps, not a skip license). Required gates still apply. Do not broaden scope.`,
    });
    if (i) interventions.push(i);
  }

  if (elapsed >= THRESHOLDS_MS.force && !state.firedCheckpoints.force35) {
    state.mode = "force_choice";
    const i = fireOnce(state, now, "force35", {
      stateLabel: "force_choice",
      reason: "~35m elapsed",
      decision:
        "Explicit choice required: (A) finish now  (B) continue — name the specific operation still progressing  (C) return PARTIAL  (D) return BLOCKED. No indefinite low-value looping. Use D-66 terminal status.",
    });
    if (i) interventions.push(i);
  }

  // Attach formatted messages
  for (const i of interventions) {
    i.message = formatTimekeeperBlock(state, now, i);
  }

  return { interventions, progress };
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
    if (hook === "stop" && state.mode === "force_choice") {
      // One gentle follow-up if they stop without choosing — still advise-only
      const already = state.interventions.filter((x) => x.kind === "force35_followup");
      if (already.length === 0 && (event.loop_count || 0) < 1) {
        state.interventions.push({
          at: Date.now(),
          kind: "force35_followup",
          reason: "stop at force_choice",
          decision: "require A/B/C/D",
        });
        out.followup_message =
          "TIMEKEEPER: ~35m elapsed — before ending, choose A finish now / B continue (name active progress) / C PARTIAL / D BLOCKED, then emit the D-66 terminal status block.";
      }
    }
    return out;
  }

  // Prefer a single combined message
  const combined = interventions.map((i) => i.message).join("\n\n");

  if (hook === "postToolUse") {
    out.additional_context = combined;
  } else if (hook === "beforeShellExecution" || hook === "preToolUse") {
    // agent_message with allow — advisory; platform may surface to agent
    out.agent_message = combined;
  } else if (hook === "stop") {
    out.followup_message = combined.slice(0, 1800);
  } else if (hook === "subagentStop") {
    // Do not auto-loop subagents for timekeeper
  } else {
    // afterShellExecution / postToolUseFailure / afterFileEdit: no official inject field.
    // Best effort: still return agent_message for platforms that accept it; else state is recorded.
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

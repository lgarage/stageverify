/**
 * Failure / wait / drift classification for Timekeeper nudges.
 * Distinguishes recovery paths so agents do not treat all failures alike.
 */

/**
 * @typedef {'product_failure' | 'implementation_failure' | 'verification_failure' | 'measurement_tool_failure' | 'ci_wait' | 'deploy_propagation_wait' | 'repo_main_drift' | 'unknown'} FailureClass
 */

/**
 * @param {object} opts
 * @param {string} [opts.command]
 * @param {string} [opts.output]
 * @param {string} [opts.errorMessage]
 * @param {string} [opts.failureType] timeout|error|permission_denied
 * @returns {FailureClass}
 */
export function classifyFailure(opts = {}) {
  const command = String(opts.command || "");
  const output = String(opts.output || opts.errorMessage || "");
  const blob = `${command}\n${output}`.toLowerCase();
  const failureType = opts.failureType || "";

  if (
    /\bgit\s+(fetch|pull|merge|rebase)\b/.test(blob) &&
    /\b(conflict|conflit|merge conflict|could not apply)\b/.test(blob)
  ) {
    return "repo_main_drift";
  }
  if (
    /\b(gh-pages|github pages|pages build|propagation|firebase deploy|deploy --only)\b/.test(
      blob
    ) &&
    (/\b(pending|queued|building|propagat|not yet|retry after|cold start)\b/.test(blob) ||
      failureType === "timeout")
  ) {
    return "deploy_propagation_wait";
  }
  if (
    /\b(gh run|actions\/runs|ci status|workflow|check suite)\b/.test(blob) &&
    (/\b(pending|queued|in_progress|waiting)\b/.test(blob) || failureType === "timeout")
  ) {
    return "ci_wait";
  }
  if (
    /\b(benchmark|perf|performance|lighthouse|median|warm pin|cold start|sample\s*\d)\b/.test(
      blob
    ) ||
    (/\b(playwright|verify:)/.test(blob) &&
      (failureType === "timeout" || /\btimeout\b|\btimed?\s*out\b/.test(blob)) &&
      /\b(ms|median|sample|paint|tti|fcp)\b/.test(blob))
  ) {
    return "measurement_tool_failure";
  }
  // PIN autosubmit mistaken wait (4-digit needs Verify click)
  if (
    /\b(pin|verifyvendorpin|verifytechnicianpin|keypad)\b/.test(blob) &&
    (/\b(6[- ]?digit|autosubmit|auto-submit|wait(ing)? for submit)\b/.test(blob) ||
      failureType === "timeout")
  ) {
    return "measurement_tool_failure";
  }
  if (/\b(npm run verify:|npx playwright|verify-[a-z0-9-]+\.mjs)\b/.test(blob)) {
    return "verification_failure";
  }
  if (/\b(tsc|typescript|eslint|npm run build|syntaxerror|typeerror)\b/.test(blob)) {
    return "implementation_failure";
  }
  if (/\b(assert|expected|received|tobevisible|locator)\b/.test(blob)) {
    return "product_failure";
  }
  if (failureType === "timeout") return "measurement_tool_failure";
  return "unknown";
}

/**
 * @param {string} command
 * @returns {'ci' | 'gh_pages' | 'firebase' | 'sleep' | null}
 */
export function classifyWaitCommand(command) {
  const c = String(command || "").toLowerCase();
  if (/\b(gh run|gh pr checks|gh api.*actions)\b/.test(c)) return "ci";
  if (
    /\b(gh-pages|github\.io|pages\.github|lgarage\.github\.io)\b/.test(c) ||
    (/\b(curl|wget)\b/.test(c) && /\bpropagat/.test(c))
  ) {
    return "gh_pages";
  }
  if (/\bfirebase\s+deploy\b/.test(c) || /\bfirebase\s+functions:log\b/.test(c)) {
    return "firebase";
  }
  // Generic sleep counts as wait only when paired with deploy/ci intent in the command text
  if (
    (/\bsleep\s+\d+/.test(c) || /\btimeout\s+\/t\b/.test(c)) &&
    /\b(gh-pages|propagat|firebase|ci|actions|pages)\b/.test(c)
  ) {
    return "sleep";
  }
  return null;
}

/**
 * Detect main-move / merge-conflict signals in a command+output pair.
 * @param {string} command
 * @param {string} [output]
 * @returns {{ kind: 'main_move' | 'merge_conflict' | null, clean: boolean }}
 */
export function classifyMainDrift(command, output = "") {
  const c = String(command || "");
  const o = String(output || "");
  const blob = `${c}\n${o}`;
  const isMainFetch =
    /\bgit\s+(fetch|pull)\b/.test(c) && /\borigin\s+main\b/.test(c);
  const isMergeMain =
    /\bgit\s+merge\b/.test(c) && /\b(origin\/)?main\b/.test(c);
  if (!isMainFetch && !isMergeMain && !/\bgit\s+rebase\b.*\bmain\b/.test(c)) {
    return { kind: null, clean: true };
  }
  if (/\b(conflict|CONFLICT \(|Automatic merge failed)\b/.test(blob)) {
    return { kind: "merge_conflict", clean: false };
  }
  if (/\bAlready up to date\b|\bFast-forward\b|\bMerge made by/.test(o)) {
    return { kind: "main_move", clean: true };
  }
  return { kind: "main_move", clean: true };
}

/**
 * Human label for failure class (rule-facing).
 * @param {FailureClass} cls
 */
export function failureClassAdvice(cls) {
  switch (cls) {
    case "measurement_tool_failure":
      return "Classify as measurement-tool failure. Do not invalidate already-green D-38/D-60/build/visual review unless code/base changed. Fix the measurement method once; if still unreliable, report metric unavailable.";
    case "deploy_propagation_wait":
      return "Bounded deploy/propagation wait. Do not restart a successful deploy. Poll sparingly; if window exceeded, investigate once.";
    case "ci_wait":
      return "Bounded CI wait. Do not restart successful jobs. Poll sparingly.";
    case "repo_main_drift":
      return "Main moved or conflicted. If PR still clean/mergeable, do not redo completed work. Resolve only actual conflicts.";
    case "verification_failure":
      return "Verification failure. Follow D-19/D-50 ladder — do not blind-retry the same signature. Change method or escalate.";
    case "implementation_failure":
      return "Implementation failure. Fix once with a new hypothesis; 2nd same fingerprint → stall-advisor (D-19); 3rd → D-50.";
    case "product_failure":
      return "Likely product assertion failure. Debug product behavior; do not burn long measurement loops.";
    default:
      return "Classify the failure before retrying. Do not repeat the same operation blindly.";
  }
}

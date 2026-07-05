/**
 * Pure deploy poll / Pages build state machine — testable without gh CLI.
 */

export const DEFAULTS = {
  POLL_MS: 12_000,
  TIMEOUT_MS: 300_000,
  BUILDING_STUCK_MS: 120_000,
  BUILDING_WARN_MS: 90_000,
  LIVE_FETCH_MS: 15_000,
  LIVE_RECHECK_MS: 15_000,
  MAX_POST_BUILDS_PER_DEPLOY: 2,
};

/** @typedef {{
 *   deadlineMs: number,
 *   startedAt: number,
 *   lastStatus: string,
 *   erroredRebuildUsed: boolean,
 *   stuckRebuildUsed: boolean,
 *   buildingStartedAt: number | null,
 *   postCount: number,
 * }} PagesPollState */

/** @param {number} deadlineMs @param {number} [now] @returns {PagesPollState} */
export function createPagesPollState(deadlineMs, now = Date.now()) {
  return {
    deadlineMs,
    startedAt: now,
    lastStatus: "",
    erroredRebuildUsed: false,
    stuckRebuildUsed: false,
    buildingStartedAt: null,
    postCount: 0,
  };
}

/**
 * @param {string} stderr
 * @returns {boolean}
 */
export function isGhAuthError(stderr) {
  const s = stderr.toLowerCase();
  return (
    /http 401/.test(s) ||
    /you need to log in/.test(s) ||
    /not logged in/.test(s) ||
    /authentication/.test(s) ||
    /to authenticate, run/.test(s)
  );
}

/**
 * @param {string} msg
 * @returns {string}
 */
export function inferDeployFailureKind(msg) {
  const m = msg.toLowerCase();
  if (/auth failed|gh cli cannot call pages api/.test(m)) return "auth-failed";
  if (/timed out/.test(m)) return "timeout";
  if (/live bundle mismatch/.test(m)) return "stale-bundle";
  if (/build errored/.test(m)) return "build-errored";
  if (/push failed/.test(m)) return "push-failed";
  if (/live fetch/.test(m)) return "live-fetch-failed";
  return "unknown";
}

/**
 * @param {string} html
 * @returns {string | null}
 */
export function extractMainAssetFromIndex(html) {
  const match = html.match(/\/stageverify\/assets\/[^"'\s>]+\.js/);
  return match?.[0] ?? null;
}

/**
 * @param {{
 *   elapsedSec: number,
 *   remainingSec: number,
 *   status: string,
 *   commit7: string,
 *   expectedAsset: string | null,
 *   liveAsset: string | null,
 *   buildingForSec: number | null,
 *   postCount: number,
 *   maxPosts?: number,
 *   suffix?: string,
 * }} opts
 * @returns {string}
 */
export function formatPollLogLine({
  elapsedSec,
  remainingSec,
  status,
  commit7,
  expectedAsset,
  liveAsset,
  buildingForSec,
  postCount,
  maxPosts = DEFAULTS.MAX_POST_BUILDS_PER_DEPLOY,
  suffix = "",
}) {
  const buildingFor =
    buildingForSec !== null ? `${buildingForSec}s${suffix ? ` ${suffix}` : ""}` : "—";
  return (
    `poll | elapsed=${elapsedSec}s | timeout_in=${remainingSec}s | status=${status} | ` +
    `sha=${commit7 || "—"} | expected=${expectedAsset ?? "—"} | live=${liveAsset ?? "—"} | ` +
    `building_for=${buildingFor} | posts=${postCount}/${maxPosts}`
  );
}

/**
 * @param {PagesPollState} state
 * @param {string} status
 * @param {number} now
 * @returns {PagesPollState}
 */
export function trackBuildingDuration(state, status, now) {
  const next = { ...state };
  if (status === "building") {
    if (next.buildingStartedAt === null) {
      next.buildingStartedAt = now;
    }
  } else {
    next.buildingStartedAt = null;
  }
  return next;
}

/**
 * @param {string | null | undefined} buildingForSec
 * @returns {string}
 */
export function buildingPhaseSuffix(buildingForSec, buildingStuckMs = DEFAULTS.BUILDING_STUCK_MS, buildingWarnMs = DEFAULTS.BUILDING_WARN_MS) {
  if (buildingForSec === null || buildingForSec === undefined) return "";
  const sec = Number(buildingForSec);
  if (sec >= buildingStuckMs / 1000) return "(since rebuild)";
  if (sec >= buildingWarnMs / 1000) return "(approaching stuck)";
  if (sec >= 60) return "(normal, slow)";
  return "(normal)";
}

/**
 * @param {{
 *   state: PagesPollState,
 *   build: { status?: string, commit?: string, error?: { message?: string } },
 *   now: number,
 *   expectedAsset?: string | null,
 *   liveAsset?: string | null,
 *   buildingStuckMs?: number,
 *   buildingWarnMs?: number,
 *   maxPosts?: number,
 *   repo?: string,
 * }} params
 * @returns {{
 *   action: "continue" | "success" | "trigger-rebuild" | "fail",
 *   reason?: "errored" | "stuck-building",
 *   nextState: PagesPollState,
 *   logLines: string[],
 *   failMessage?: string,
 *   failKind?: string,
 * }}
 */
export function evaluatePagesPoll({
  state,
  build,
  now,
  expectedAsset = null,
  liveAsset = null,
  buildingStuckMs = DEFAULTS.BUILDING_STUCK_MS,
  buildingWarnMs = DEFAULTS.BUILDING_WARN_MS,
  maxPosts = DEFAULTS.MAX_POST_BUILDS_PER_DEPLOY,
  repo = "lgarage/stageverify",
}) {
  /** @type {string[]} */
  const logLines = [];
  let nextState = { ...state };

  if (now >= nextState.deadlineMs) {
    const lastStatus = build.status ?? nextState.lastStatus ?? "unknown";
    const stuckTriggered = nextState.stuckRebuildUsed;
    const failMessage = stuckTriggered
      ? `timed out after ${Math.round((nextState.deadlineMs - nextState.startedAt) / 1000)}s — Pages build still '${lastStatus}' (stuck rebuild was triggered at ${buildingStuckMs / 1000}s).\n\nPages may still be building on GitHub. Do NOT re-run npm run deploy.\n\nNext steps:\n  1. Check status:  gh api repos/${repo}/pages/builds\n  2. Force rebuild:  gh api -X POST repos/${repo}/pages/builds\n  3. Pages settings: https://github.com/${repo}/settings/pages\n  4. When status=built, confirm live index main JS matches dist/ before :prod verify`
      : `timed out after ${Math.round((nextState.deadlineMs - nextState.startedAt) / 1000)}s — Pages build still '${lastStatus}' (no rebuild was triggered).\n\nNext steps:\n  1. Check status:  gh api repos/${repo}/pages/builds\n  2. Force rebuild:  gh api -X POST repos/${repo}/pages/builds\n  3. Pages settings: https://github.com/${repo}/settings/pages\n  4. When status=built, confirm live index main JS matches dist/ before :prod verify`;
    return {
      action: "fail",
      nextState,
      logLines,
      failMessage,
      failKind: "timeout",
    };
  }

  const status = build.status ?? "unknown";
  const commit7 = String(build.commit ?? "").slice(0, 7);
  const errMsg = build.error?.message;
  const elapsedSec = Math.round((now - nextState.startedAt) / 1000);
  const remainingSec = Math.max(0, Math.round((nextState.deadlineMs - now) / 1000));

  nextState = trackBuildingDuration(nextState, status, now);

  const buildingForSec =
    status === "building" && nextState.buildingStartedAt !== null
      ? Math.round((now - nextState.buildingStartedAt) / 1000)
      : null;

  const phaseSuffix = buildingForSec !== null ? buildingPhaseSuffix(buildingForSec, buildingStuckMs, buildingWarnMs) : "";

  logLines.push(
    formatPollLogLine({
      elapsedSec,
      remainingSec,
      status,
      commit7,
      expectedAsset,
      liveAsset,
      buildingForSec,
      postCount: nextState.postCount,
      maxPosts,
      suffix: phaseSuffix,
    }),
  );

  if (status !== nextState.lastStatus) {
    logLines.push(
      `status change | ${nextState.lastStatus || "—"} → ${status}${errMsg ? ` (${errMsg})` : ""} | sha=${commit7} | total_elapsed=${elapsedSec}s`,
    );
    nextState.lastStatus = status;
  }

  if (status === "built") {
    logLines.push(`Pages build succeeded (commit ${commit7})`);
    return { action: "success", nextState, logLines };
  }

  if (status === "errored") {
    if (!nextState.erroredRebuildUsed && nextState.postCount < maxPosts) {
      nextState.erroredRebuildUsed = true;
      nextState.postCount += 1;
      logLines.push(
        `triggering Pages rebuild — reason=errored (one-shot ${nextState.postCount}/${maxPosts}, will not POST again for errored)`,
      );
      return { action: "trigger-rebuild", reason: "errored", nextState, logLines };
    }
    const failMessage = `Pages build errored after retry${errMsg ? `: ${errMsg}` : ""}. Live may still serve old bundle.\n\nManual rebuild: gh api -X POST repos/${repo}/pages/builds\nDo NOT re-run npm run deploy.`;
    return {
      action: "fail",
      nextState,
      logLines,
      failMessage,
      failKind: "build-errored",
    };
  }

  if (
    status === "building" &&
    nextState.buildingStartedAt !== null &&
    now - nextState.buildingStartedAt >= buildingStuckMs &&
    !nextState.stuckRebuildUsed &&
    nextState.postCount < maxPosts
  ) {
    nextState.stuckRebuildUsed = true;
    nextState.postCount += 1;
    nextState.buildingStartedAt = now;
    logLines.push(
      `triggering Pages rebuild — reason=stuck-building at ${buildingStuckMs / 1000}s elapsed (one-shot ${nextState.postCount}/${maxPosts}, will not POST again for stuck)`,
    );
    return { action: "trigger-rebuild", reason: "stuck-building", nextState, logLines };
  }

  return { action: "continue", nextState, logLines };
}

/**
 * @param {string} expectedAsset
 * @param {string} liveAsset
 * @param {string} [repo]
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function compareLiveBundle(expectedAsset, liveAsset, repo = "lgarage/stageverify") {
  if (liveAsset === expectedAsset) {
    return { ok: true };
  }
  return {
    ok: false,
    message:
      `live bundle mismatch — expected ${expectedAsset}, live has ${liveAsset}.\n\n` +
      `Pages reported built but live is stale. Do NOT re-run npm run deploy.\n\n` +
      `Next steps:\n` +
      `  1. Wait 15s and re-check live index.html\n` +
      `  2. Force rebuild: gh api -X POST repos/${repo}/pages/builds\n` +
      `  3. Poll until built: gh api repos/${repo}/pages/builds`,
  };
}

/**
 * @param {string} stderr
 * @param {string} [repo]
 * @returns {string}
 */
export function formatGhAuthFailureMessage(stderr, repo = "lgarage/stageverify") {
  const detail = stderr.trim();
  return (
    `GitHub API auth failed — gh CLI cannot call Pages API (requires repo scope).` +
    (detail ? `\n\ngh error: ${detail}` : "") +
    `\n\nFix:\n  gh auth login\n  gh auth refresh --scopes repo\n\n` +
    `Manual checks (after auth):\n` +
    `  gh api repos/${repo}/pages/builds\n` +
    `  gh api -X POST repos/${repo}/pages/builds\n\n` +
    `Do NOT re-run npm run deploy until gh auth works.`
  );
}

/**
 * Run poll loop against a scripted build sequence (for demos/tests).
 * @param {{
 *   builds: Array<{ status: string, commit?: string, error?: { message?: string } }>,
 *   pollMs: number,
 *   timeoutMs: number,
 *   buildingStuckMs?: number,
 *   expectedAsset?: string | null,
 *   onRebuild?: (reason: string) => void,
 *   startNow?: number,
 * }} opts
 */
export async function runMockPollSequence({
  builds,
  pollMs,
  timeoutMs,
  buildingStuckMs = DEFAULTS.BUILDING_STUCK_MS,
  expectedAsset = null,
  onRebuild = () => {},
  startNow = 0,
}) {
  /** @type {string[]} */
  const allLogs = [];
  let state = createPagesPollState(startNow + timeoutMs, startNow);
  let buildIndex = 0;
  let now = startNow;
  let rebuildTriggered = false;
  /** @type {string | null} */
  let failMessage = null;
  /** @type {string | null} */
  let failKind = null;
  let success = false;

  while (buildIndex < builds.length || now < state.deadlineMs) {
    const build = builds[Math.min(buildIndex, builds.length - 1)] ?? { status: "building" };
    if (buildIndex < builds.length - 1) buildIndex += 1;

    const result = evaluatePagesPoll({
      state,
      build,
      now,
      expectedAsset,
      buildingStuckMs,
    });
    state = result.nextState;
    allLogs.push(...result.logLines);

    if (result.action === "success") {
      success = true;
      break;
    }
    if (result.action === "fail") {
      failMessage = result.failMessage ?? "unknown failure";
      failKind = result.failKind ?? "unknown";
      break;
    }
    if (result.action === "trigger-rebuild") {
      rebuildTriggered = true;
      onRebuild(result.reason ?? "unknown");
    }

    now += pollMs;
    if (now >= state.deadlineMs && result.action === "continue") {
      const timeoutResult = evaluatePagesPoll({
        state,
        build,
        now: state.deadlineMs,
        expectedAsset,
        buildingStuckMs,
      });
      allLogs.push(...timeoutResult.logLines);
      if (timeoutResult.action === "fail") {
        failMessage = timeoutResult.failMessage ?? "timeout";
        failKind = timeoutResult.failKind ?? "timeout";
      }
      break;
    }
  }

  return {
    success,
    rebuildTriggered,
    postCount: state.postCount,
    stuckRebuildUsed: state.stuckRebuildUsed,
    erroredRebuildUsed: state.erroredRebuildUsed,
    failMessage,
    failKind,
    logs: allLogs,
  };
}

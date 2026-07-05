#!/usr/bin/env node
/**
 * Deploy dist/ to GitHub Pages (gh-pages branch) and wait until Pages build status = built.
 *
 * gh-pages "Published" only means the branch push succeeded — GitHub Pages legacy build
 * can still error or hang in "building". This script polls builds API, triggers ONE stuck
 * rebuild POST at 120s, and fails loud if live bundle does not match dist.
 *
 * Usage:
 *   node scripts/deploy-gh-pages.mjs              # build (via predeploy) + push + wait
 *   node scripts/deploy-gh-pages.mjs --skip-push  # poll/wait only (test poll logic)
 *   node scripts/deploy-gh-pages.mjs --skip-live-check
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  compareLiveBundle,
  DEFAULTS,
  extractMainAssetFromIndex,
  formatGhAuthFailureMessage,
  createPagesPollState,
  evaluatePagesPoll,
  inferDeployFailureKind,
  isGhAuthError,
} from "./lib/deploy-gh-pages-lib.mjs";
import {
  captureDeployFailure,
  clearPendingForScript,
} from "./lib/verify-learning-hook.mjs";

const REPO = "lgarage/stageverify";
const PAGES_URL = "https://lgarage.github.io/stageverify";
const {
  POLL_MS,
  TIMEOUT_MS,
  BUILDING_STUCK_MS,
  LIVE_FETCH_MS,
  LIVE_RECHECK_MS,
} = DEFAULTS;

const skipPush = process.argv.includes("--skip-push");
const skipLiveCheck = process.argv.includes("--skip-live-check");

/** @type {string[]} */
const deployLogLines = [];
/** @type {{ pushOk: boolean, rebuildTriggered: boolean, rebuildReasons: string[], pagesStatus: string, expectedAsset: string | null, liveAsset: string | null }} */
const deploySummary = {
  pushOk: false,
  rebuildTriggered: false,
  rebuildReasons: [],
  pagesStatus: "unknown",
  expectedAsset: null,
  liveAsset: null,
};

function learningDryRun() {
  return (
    process.env.DEPLOY_LEARNING_DRY_RUN === "true" ||
    process.env.VERIFY_LEARNING_DRY_RUN === "true"
  );
}

function log(msg) {
  const line = `deploy: ${msg}`;
  console.log(line);
  deployLogLines.push(line);
}

function fail(msg, opts = {}) {
  const line = `deploy: FAIL — ${msg}`;
  console.error(line);
  deployLogLines.push(line);

  const failureKind = opts.failureKind ?? inferDeployFailureKind(msg);
  captureDeployFailure({
    exitCode: 1,
    failureKind,
    message: msg,
    stderrTail: deployLogLines.join("\n"),
    stdoutTail: "",
    dryRun: learningDryRun(),
  });

  printFinalSummary({ failed: true });
  process.exit(1);
}

function ghApi(endpoint, { method = "GET" } = {}) {
  const cmd =
    method === "POST"
      ? `gh api -X POST ${endpoint}`
      : `gh api ${endpoint}`;
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  } catch (err) {
    const stderr = err.stderr?.toString?.() ?? String(err);
    if (isGhAuthError(stderr)) {
      fail(formatGhAuthFailureMessage(stderr, REPO), { failureKind: "auth-failed" });
    }
    fail(`gh api ${method} ${endpoint} failed: ${stderr.trim()}`);
  }
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch {
    fail(`invalid JSON from ${label}`);
  }
}

function ensureNoJekyll() {
  const path = join("dist", ".nojekyll");
  if (!existsSync(path)) {
    writeFileSync(path, "");
    log("wrote dist/.nojekyll");
  }
}

function pushGhPages() {
  log("pushing dist/ to gh-pages branch…");
  try {
    execSync("npx gh-pages -d dist", { stdio: "inherit" });
  } catch {
    fail("gh-pages push failed", { failureKind: "push-failed" });
  }
  deploySummary.pushOk = true;
  log("gh-pages branch push complete");
}

function latestBuild() {
  const raw = ghApi(`repos/${REPO}/pages/builds`);
  const builds = parseJson(raw, "pages/builds");
  if (!Array.isArray(builds) || builds.length === 0) {
    fail("no Pages builds returned from API");
  }
  return builds[0];
}

function triggerRebuild(reason) {
  deploySummary.rebuildTriggered = true;
  deploySummary.rebuildReasons.push(reason);
  ghApi(`repos/${REPO}/pages/builds`, { method: "POST" });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readDistMainAsset() {
  const indexPath = join("dist", "index.html");
  if (!existsSync(indexPath)) {
    fail("dist/index.html missing — run npm run build first");
  }
  const html = readFileSync(indexPath, "utf8");
  const asset = extractMainAssetFromIndex(html);
  if (!asset) {
    fail("could not find main JS asset path in dist/index.html");
  }
  return asset;
}

async function fetchLiveAsset() {
  const url = `${PAGES_URL}/index.html`;
  let res;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(LIVE_FETCH_MS),
      headers: { "Cache-Control": "no-cache" },
    });
  } catch (err) {
    return { error: `live fetch ${url} failed: ${err.message}` };
  }
  if (!res.ok) {
    return { error: `live fetch ${url} returned HTTP ${res.status}` };
  }
  const liveHtml = await res.text();
  const liveAsset = extractMainAssetFromIndex(liveHtml);
  if (!liveAsset) {
    return { error: "live index.html has no recognizable main JS asset path" };
  }
  return { liveAsset };
}

async function waitForBuilt(expectedAsset) {
  const now = Date.now();
  let state = createPagesPollState(now + TIMEOUT_MS, now);

  while (true) {
    const build = latestBuild();
    deploySummary.pagesStatus = build.status ?? "unknown";

    let liveAsset = null;
    if (build.status === "built" && expectedAsset) {
      const live = await fetchLiveAsset();
      if (!live.error) {
        liveAsset = live.liveAsset;
        deploySummary.liveAsset = liveAsset;
      }
    }

    const result = evaluatePagesPoll({
      state,
      build,
      now: Date.now(),
      expectedAsset,
      liveAsset,
      buildingStuckMs: BUILDING_STUCK_MS,
      repo: REPO,
    });
    state = result.nextState;

    for (const line of result.logLines) {
      log(line);
    }

    if (result.action === "success") {
      return build;
    }
    if (result.action === "fail") {
      fail(result.failMessage ?? "Pages poll failed", {
        failureKind: result.failKind ?? "unknown",
      });
    }
    if (result.action === "trigger-rebuild") {
      triggerRebuild(result.reason ?? "unknown");
    }

    await sleep(POLL_MS);
  }
}

async function verifyLiveBundle(expectedAsset, { allowRecheck = true } = {}) {
  log(`checking live index.html references ${expectedAsset}…`);
  const live = await fetchLiveAsset();
  if (live.error) {
    fail(live.error, { failureKind: "live-fetch-failed" });
  }

  deploySummary.liveAsset = live.liveAsset;
  const cmp = compareLiveBundle(expectedAsset, live.liveAsset, REPO);
  if (!cmp.ok) {
    if (allowRecheck) {
      log(`live bundle not yet matching — waiting ${LIVE_RECHECK_MS / 1000}s for propagation…`);
      await sleep(LIVE_RECHECK_MS);
      return verifyLiveBundle(expectedAsset, { allowRecheck: false });
    }
    fail(cmp.message, { failureKind: "stale-bundle" });
  }

  log(`live bundle verified (${live.liveAsset})`);
}

function printFinalSummary({ failed = false } = {}) {
  const lines = [
    "",
    "deploy: ——— summary ———",
    `deploy: push: ${deploySummary.pushOk ? "ok" : skipPush ? "skipped (--skip-push)" : "not run"}`,
    `deploy: Pages status: ${deploySummary.pagesStatus}`,
    `deploy: rebuild triggered: ${deploySummary.rebuildTriggered ? "yes" : "no"}${deploySummary.rebuildReasons.length ? ` (${deploySummary.rebuildReasons.join(", ")})` : ""}`,
    `deploy: expected bundle: ${deploySummary.expectedAsset ?? "—"}`,
    `deploy: live bundle: ${deploySummary.liveAsset ?? "—"}`,
  ];
  if (!failed) {
    lines.push(
      `deploy: prod verify: run relevant :prod scripts (e.g. verify:pickup:prod) after confirming live bundle`,
    );
    lines.push(`deploy: deploy complete — ${PAGES_URL}`);
  } else {
    lines.push(`deploy: prod verify: do NOT run :prod until live bundle matches dist/`);
  }
  for (const line of lines) {
    console.log(line);
    deployLogLines.push(line);
  }
}

async function main() {
  let expectedAsset = null;
  if (!skipLiveCheck && existsSync(join("dist", "index.html"))) {
    expectedAsset = readDistMainAsset();
    deploySummary.expectedAsset = expectedAsset;
  }

  if (!skipPush) {
    ensureNoJekyll();
    pushGhPages();
    if (!expectedAsset) {
      expectedAsset = readDistMainAsset();
      deploySummary.expectedAsset = expectedAsset;
    }
    log(`expected bundle | ${expectedAsset}`);
  } else {
    log("--skip-push: skipping gh-pages push (poll/wait only)");
    if (expectedAsset) {
      log(`expected bundle | ${expectedAsset}`);
    }
  }

  await waitForBuilt(expectedAsset);

  if (!skipLiveCheck && expectedAsset) {
    await verifyLiveBundle(expectedAsset);
  } else {
    log("--skip-live-check: skipping live bundle verification");
  }

  printFinalSummary();
  clearPendingForScript("deploy");
}

main().catch((err) => fail(err.message ?? String(err)));

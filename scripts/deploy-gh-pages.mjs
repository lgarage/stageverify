#!/usr/bin/env node
/**
 * Deploy dist/ to GitHub Pages (gh-pages branch) and wait until Pages build status = built.
 *
 * gh-pages "Published" only means the branch push succeeded — GitHub Pages legacy build
 * can still error silently. This script polls builds API and fails loud if not built.
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
  captureDeployFailure,
  clearPendingForScript,
} from "./lib/verify-learning-hook.mjs";

const REPO = "lgarage/stageverify";
const PAGES_URL = "https://lgarage.github.io/stageverify";
const POLL_MS = 12_000;
const TIMEOUT_MS = 5 * 60_000;
const LIVE_FETCH_MS = 15_000;

const skipPush = process.argv.includes("--skip-push");
const skipLiveCheck = process.argv.includes("--skip-live-check");

/** @type {string[]} */
const deployLogLines = [];

function inferFailureKind(msg) {
  const m = msg.toLowerCase();
  if (/timed out/.test(m)) return "timeout";
  if (/live bundle mismatch/.test(m)) return "stale-bundle";
  if (/build errored/.test(m)) return "build-errored";
  if (/push failed/.test(m)) return "push-failed";
  if (/live fetch/.test(m)) return "live-fetch-failed";
  return "unknown";
}

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

  const failureKind = opts.failureKind ?? inferFailureKind(msg);
  captureDeployFailure({
    exitCode: 1,
    failureKind,
    message: msg,
    stderrTail: deployLogLines.join("\n"),
    stdoutTail: "",
    dryRun: learningDryRun(),
  });

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
    fail("gh-pages push failed");
  }
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

function triggerRebuild() {
  log("triggering Pages rebuild via POST pages/builds…");
  ghApi(`repos/${REPO}/pages/builds`, { method: "POST" });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBuilt({ allowRetry = true } = {}) {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastStatus = "";

  while (Date.now() < deadline) {
    const build = latestBuild();
    const status = build.status ?? "unknown";
    const errMsg = build.error?.message;

    if (status !== lastStatus) {
      log(`Pages build status: ${status}${errMsg ? ` (${errMsg})` : ""}`);
      lastStatus = status;
    }

    if (status === "built") {
      log(`Pages build succeeded (commit ${String(build.commit ?? "").slice(0, 7)})`);
      return build;
    }

    if (status === "errored") {
      if (allowRetry) {
        log("Pages build errored — triggering one rebuild retry…");
        triggerRebuild();
        await sleep(POLL_MS);
        return waitForBuilt({ allowRetry: false });
      }
      fail(
        `Pages build errored after retry${errMsg ? `: ${errMsg}` : ""}. Live may still serve old bundle — run: gh api -X POST repos/${REPO}/pages/builds`,
        { failureKind: "build-errored" },
      );
    }

    await sleep(POLL_MS);
  }

  fail(`timed out after ${TIMEOUT_MS / 1000}s waiting for Pages build status=built (last: ${lastStatus || "unknown"})`, {
    failureKind: "timeout",
  });
}

function extractMainAssetFromIndex(html) {
  const match = html.match(/\/stageverify\/assets\/[^"'\s>]+\.js/);
  return match?.[0] ?? null;
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

async function verifyLiveBundle(expectedAsset) {
  const url = `${PAGES_URL}/index.html`;
  log(`checking live index.html references ${expectedAsset}…`);

  let res;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(LIVE_FETCH_MS),
      headers: { "Cache-Control": "no-cache" },
    });
  } catch (err) {
    fail(`live fetch ${url} failed: ${err.message}`, { failureKind: "live-fetch-failed" });
  }

  if (!res.ok) {
    fail(`live fetch ${url} returned HTTP ${res.status}`);
  }

  const liveHtml = await res.text();
  const liveAsset = extractMainAssetFromIndex(liveHtml);

  if (!liveAsset) {
    fail("live index.html has no recognizable main JS asset path");
  }

  if (liveAsset !== expectedAsset) {
    fail(
      `live bundle mismatch — expected ${expectedAsset}, live has ${liveAsset}. Pages may still be propagating or build failed silently.`,
      { failureKind: "stale-bundle" },
    );
  }

  log(`live bundle verified (${liveAsset})`);
}

async function main() {
  if (!skipPush) {
    ensureNoJekyll();
    pushGhPages();
  } else {
    log("--skip-push: skipping gh-pages push (poll/wait only)");
  }

  await waitForBuilt();

  if (!skipLiveCheck) {
    const expectedAsset = readDistMainAsset();
    await verifyLiveBundle(expectedAsset);
  } else {
    log("--skip-live-check: skipping live bundle verification");
  }

  log(`deploy complete — ${PAGES_URL}`);
  clearPendingForScript("deploy");
}

main().catch((err) => fail(err.message ?? String(err)));

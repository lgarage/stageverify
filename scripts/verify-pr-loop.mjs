#!/usr/bin/env node
/**
 * PR loop classifier — routes pull-request diffs to tier0 checks + verifier model.
 *
 * Mechanical only (Fable design #1). Does NOT run the repair loop — orchestrator
 * (Composer parent session) reads JSON and executes CLASSIFY → TIER0 → VERIFIER → fix cycles.
 *
 * Usage:
 *   npm run verify:pr-loop
 *   npm run verify:pr-loop -- --branch cursor/location-phase4-prod-verify-8202
 *   npm run verify:pr-loop -- --base origin/main --json
 *   npm run verify:pr-loop -- --assert
 *   npm run verify:pr-loop -- --files src/Foo.tsx,scripts/verify-x.mjs
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  CLASSIFIER_FIXTURES,
  assertFixture,
  classifyPrDiff,
} from "./lib/pr-loop-classifier-lib.mjs";

const REPO_ROOT = resolve(process.cwd());

function parseArgs(argv) {
  const out = {
    base: "origin/main",
    branch: null,
    files: null,
    json: false,
    assert: false,
    danApproved: false,
    awayId: null,
    scopeText: "",
    pr: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") out.json = true;
    else if (arg === "--assert") out.assert = true;
    else if (arg === "--dan-approved") out.danApproved = true;
    else if (arg.startsWith("--base=")) out.base = arg.slice("--base=".length);
    else if (arg === "--base" && argv[i + 1]) out.base = argv[++i];
    else if (arg.startsWith("--branch=")) out.branch = arg.slice("--branch=".length);
    else if (arg === "--branch" && argv[i + 1]) out.branch = argv[++i];
    else if (arg.startsWith("--files=")) {
      out.files = arg
        .slice("--files=".length)
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean);
    } else if (arg === "--files" && argv[i + 1]) {
      out.files = argv[++i]
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean);
    } else if (arg.startsWith("--away-id=")) out.awayId = arg.slice("--away-id=".length);
    else if (arg === "--away-id" && argv[i + 1]) out.awayId = argv[++i];
    else if (arg.startsWith("--pr=")) out.pr = Number(arg.slice("--pr=".length));
    else if (arg === "--pr" && argv[i + 1]) out.pr = Number(argv[++i]);
  }

  return out;
}

function gitCurrentBranch() {
  return execSync("git rev-parse --abbrev-ref HEAD", {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
}

/**
 * @param {string} base
 * @param {string} head
 * @returns {string[]}
 */
function gitDiffNameOnly(base, head) {
  const range = `${base}...${head}`;
  try {
    const out = execSync(`git diff --name-only ${range}`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
    if (!out) return [];
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch (err) {
    throw new Error(
      `git diff failed for ${range}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * @param {number} prNumber
 * @returns {{ branch: string; files: string[]; title?: string }}
 */
function loadPrViaGh(prNumber) {
  try {
    const json = execSync(
      `gh pr view ${prNumber} --json headRefName,title,files`,
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    const data = JSON.parse(json);
    const files = (data.files ?? []).map((f) => f.path).filter(Boolean);
    return { branch: data.headRefName, files, title: data.title };
  } catch (err) {
    throw new Error(
      `gh pr view ${prNumber} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * @param {string | null} awayId
 * @returns {{ danApproved: boolean; scopeText: string }}
 */
function loadAwayItem(awayId) {
  if (!awayId) return { danApproved: false, scopeText: "" };
  const path = resolve(REPO_ROOT, "PROJECT_STATUS/away-list.json");
  if (!existsSync(path)) return { danApproved: false, scopeText: "" };
  const list = JSON.parse(readFileSync(path, "utf8"));
  const item = (list.queue ?? []).find((q) => q.id === awayId);
  if (!item) return { danApproved: false, scopeText: "" };
  return {
    danApproved: item.danApproved === true,
    scopeText: [item.title, item.scope].filter(Boolean).join(" "),
  };
}

function runAssert() {
  let failed = 0;
  for (const fixture of CLASSIFIER_FIXTURES) {
    const { pass, errors } = assertFixture(fixture);
    if (pass) {
      console.log(`PASS: ${fixture.name}`);
    } else {
      failed++;
      console.error(`FAIL: ${fixture.name}`);
      for (const e of errors) console.error(`  - ${e}`);
    }
  }
  if (failed > 0) {
    console.error(`\nverify:pr-loop --assert: ${failed} fixture(s) failed`);
    process.exit(1);
  }
  console.log(`\nverify:pr-loop --assert: ${CLASSIFIER_FIXTURES.length} fixtures PASS`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.assert) {
    runAssert();
    return;
  }

  let branch = args.branch ?? gitCurrentBranch();
  let changedFiles = args.files;
  let prMeta = null;

  if (args.pr) {
    prMeta = loadPrViaGh(args.pr);
    branch = prMeta.branch;
    if (!changedFiles?.length) changedFiles = prMeta.files;
  }

  if (!changedFiles?.length) {
    changedFiles = gitDiffNameOnly(args.base, branch);
  }

  const awayMeta = loadAwayItem(args.awayId);
  const danApproved = args.danApproved || awayMeta.danApproved;
  const scopeText = [awayMeta.scopeText, prMeta?.title ?? ""].filter(Boolean).join(" ");

  const classification = classifyPrDiff(changedFiles, { danApproved, scopeText });

  const payload = {
    mode: "pr-loop-classifier",
    generatedAt: new Date().toISOString(),
    branch,
    base: args.base,
    pr: args.pr ?? null,
    awayId: args.awayId,
    changedFileCount: changedFiles.length,
    ...classification,
  };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("verify:pr-loop — PR loop classifier\n");
    console.log(`Branch: ${branch} vs ${args.base} (${changedFiles.length} files)`);
    console.log(`Tier: ${classification.summary.tier}`);
    console.log(`Verifier route: ${classification.verifierRoute}`);
    console.log(`Blocked: ${classification.summary.blocked}${classification.summary.blockReason ? ` — ${classification.summary.blockReason}` : ""}`);
    if (classification.summary.highRiskPaths.length) {
      console.log("\nHigh-risk / security paths:");
      for (const h of classification.summary.highRiskPaths) {
        console.log(`  - ${h.path}: ${h.reason}`);
      }
    }
    console.log("\nTier 0 checks:");
    for (const c of classification.tier0.checks) console.log(`  - ${c}`);
    if (classification.tier0.emulatorTests.length) {
      console.log("\nEmulator tests (if functions touched):");
      for (const t of classification.tier0.emulatorTests) console.log(`  - ${t}`);
    }
    if (classification.prodVerifyDeferred.length) {
      console.log("\nProd verify deferred to PC drain:");
      for (const p of classification.prodVerifyDeferred) console.log(`  - ${p}`);
    }
    console.log("\nAutonomy:");
    console.log(`  loopAllowed: ${classification.autonomy.loopAllowed}`);
    console.log(`  merge/deploy: false / false`);
    console.log(`  orchestrator: ${classification.loop.orchestrator}`);
    console.log("\n(JSON: npm run verify:pr-loop -- --json)");
  }

  if (classification.summary.blocked) {
    process.exit(2);
  }
}

main();

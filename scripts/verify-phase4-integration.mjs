/**
 * Phase 4 integration smoke — pickup issue scenario + dispatcher resolve path.
 *
 * Chains reset fixture → seed readiness → pickup portal (Scenario B issue) →
 * material-issue-dashboard (Resolve modal + CF resolve).
 *
 * Usage:
 *   npm run dev
 *   node scripts/playwright-auth-setup.mjs   (if token expired)
 *   npm run verify:phase4-integration
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const baseUrlArgIndex = process.argv.indexOf("--base-url");
const baseUrlOverride =
  baseUrlArgIndex >= 0 ? process.argv[baseUrlArgIndex + 1] : undefined;

function runStep(label, command, args) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: baseUrlOverride
      ? { ...process.env, STAGEVERIFY_BASE_URL: baseUrlOverride }
      : process.env,
  });
  if (result.status !== 0) {
    console.error(`FAIL: ${label} (exit ${result.status ?? "unknown"})`);
    process.exit(result.status ?? 1);
  }
  console.log(`${label} OK`);
}

console.log("verify:phase4-integration — Phase 4 pickup issue + resolve smoke");

runStep("reset pickup fixture", "node", ["scripts/reset-pickup-verify-fixture.mjs"]);
runStep("seed pickup readiness", "npx", [
  "tsx",
  "scripts/seed-pickup-verify-readiness.mjs",
]);
runStep("pickup issue report", "node", [
  "scripts/verify-pickup-issue-report.mjs",
]);
runStep("material issue dashboard resolve", "node", [
  "scripts/verify-material-issue-dashboard.mjs",
]);
runStep("pickup resolution readback", "node", [
  "scripts/verify-pickup-issue-resolution-readback.mjs",
]);

console.log("\nverify:phase4-integration PASS");

/**
 * Phase 3 integration smoke — chained pickup verification.
 *
 * Chains reset fixture → seed readiness → pickup portal flow (same as verify:pickup
 * but explicit integration entry point for Phase 3 gate tracking).
 *
 * Usage:
 *   npm run dev
 *   node scripts/playwright-auth-setup.mjs   (if token expired)
 *   npm run verify:phase3-integration
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(process.cwd());

function runStep(label, command, args) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`FAIL: ${label} (exit ${result.status ?? "unknown"})`);
    process.exit(result.status ?? 1);
  }
  console.log(`${label} OK`);
}

console.log("verify:phase3-integration — chained Phase 3 pickup smoke");

runStep("reset pickup fixture", "node", ["scripts/reset-pickup-verify-fixture.mjs"]);
runStep("seed pickup readiness", "npx", [
  "tsx",
  "scripts/seed-pickup-verify-readiness.mjs",
]);
runStep("pickup portal flow", "node", ["scripts/verify-pickup-portal.mjs"]);

console.log("\nverify:phase3-integration PASS");

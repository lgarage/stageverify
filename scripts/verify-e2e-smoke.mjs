/**
 * §14 smoke — chained vendor receive → dispatcher → pickup (demo fixtures).
 *
 * Usage:
 *   npm run dev
 *   node scripts/playwright-auth-setup.mjs   (if token expired)
 *   npm run verify:e2e-smoke
 *
 * Prod:
 *   STAGEVERIFY_BASE_URL=https://lgarage.github.io/stageverify npm run verify:e2e-smoke
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(process.cwd());

function runStep(label, command, args, extraEnv = {}) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    console.error(`FAIL: ${label} (exit ${result.status ?? "unknown"})`);
    process.exit(result.status ?? 1);
  }
  console.log(`${label} OK`);
}

console.log("verify:e2e-smoke — vendor receive → dispatcher → pickup demo chain");

runStep("reset vendor demo fixture", "node", [
  "scripts/reset-vendor-demo-fixture.mjs",
]);
runStep("vendor exception_only hub", "node", [
  "scripts/set-vendor-delivery-mode.mjs",
  "exception_only",
]);
runStep("seed vendor PINs", "node", ["scripts/seed-vendor-pin-data.mjs"]);
runStep("vendor receive hub", "node", ["scripts/verify-vendor-delivered.mjs"]);
runStep("dispatcher nav smoke", "node", ["scripts/verify-dispatcher-nav.mjs"]);
runStep("patch dispatcher demos", "node", [
  "scripts/patch-dispatcher-demo-deliveries.mjs",
]);
runStep("pickup portal smoke", "npm", ["run", "verify:pickup"]);

console.log("\nverify:e2e-smoke PASS");

/**
 * §14 prod smoke — gh-pages + live Firebase (no demo fixture seed/mutate).
 *
 * Skips: seed-vendor-demo, reset-vendor-demo, patch-dispatcher-demos.
 * Vendor legs 3–7: full verify-vendor-delivered when STAGEVERIFY_RECEIVE_DELIVERY
 * (+ order/PIN/job/PO) are set; otherwise dispatcher delivered-row proxy (4046362).
 *
 * Usage:
 *   STAGEVERIFY_BASE_URL=https://lgarage.github.io/stageverify node scripts/verify-e2e-smoke-prod.mjs
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const baseUrlFlagArg = process.argv.find((a) => a.startsWith("--base-url="));
const baseUrlPairIndex = process.argv.indexOf("--base-url");
const baseUrlOverride =
  (baseUrlFlagArg ? baseUrlFlagArg.split("=")[1] : null) ??
  (baseUrlPairIndex >= 0 ? process.argv[baseUrlPairIndex + 1] : undefined);
const baseUrlArgs = baseUrlOverride ? [`--base-url=${baseUrlOverride}`] : [];
const stepEnv = baseUrlOverride
  ? { ...process.env, STAGEVERIFY_BASE_URL: baseUrlOverride }
  : process.env;

function hasProdVendorEnv() {
  return [
    "STAGEVERIFY_RECEIVE_DELIVERY",
    "STAGEVERIFY_VENDOR_ORDER",
    "STAGEVERIFY_VENDOR_PIN",
    "STAGEVERIFY_VENDOR_JOB",
    "STAGEVERIFY_VENDOR_PO",
  ].every((key) => Boolean(process.env[key]?.trim()));
}

function runStep(label, command, args, extraEnv = {}) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, [...args, ...baseUrlArgs], {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: { ...stepEnv, ...extraEnv },
  });
  if (result.status !== 0) {
    console.error(`FAIL: ${label} (exit ${result.status ?? "unknown"})`);
    process.exit(result.status ?? 1);
  }
  console.log(`${label} OK`);
}

console.log("verify:e2e-smoke-prod — §14 prod chain (gh-pages + live Firebase)");

runStep("vendor exception_only hub", "node", [
  "scripts/set-vendor-delivery-mode.mjs",
  "exception_only",
]);

if (hasProdVendorEnv()) {
  console.log(
    "Prod vendor env present — running full verify-vendor-delivered (steps 3–7).",
  );
  runStep("vendor receive hub (prod ingest delivery)", "node", [
    "scripts/verify-vendor-delivered.mjs",
  ]);
} else {
  console.log(
    "Prod vendor env missing — proxy steps 3–7 via dispatcher delivered row (4046362).",
  );
  console.log(
    "Set STAGEVERIFY_RECEIVE_DELIVERY, STAGEVERIFY_VENDOR_ORDER, STAGEVERIFY_VENDOR_PIN, STAGEVERIFY_VENDOR_JOB, STAGEVERIFY_VENDOR_PO for full vendor receive coverage.",
  );
  runStep("vendor proxy (dispatcher delivered row)", "node", [
    "scripts/verify-phase14-prod-vendor-proxy.mjs",
  ]);
}

runStep("dispatcher nav smoke", "npx", [
  "tsx",
  "scripts/verify-dispatcher-nav.mjs",
]);

runStep("reset pickup fixture", "node", [
  "scripts/reset-pickup-verify-fixture.mjs",
]);
runStep("seed pickup readiness", "npx", [
  "tsx",
  "scripts/seed-pickup-verify-readiness.mjs",
  "--require-deployed-cf",
]);
runStep("pickup portal smoke", "node", [
  "scripts/verify-e2e-pickup-leg.mjs",
]);

console.log("\nverify:e2e-smoke-prod PASS");

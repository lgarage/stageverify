/**
 * §14 MVP E2E gate — vendor receive → dispatcher readiness → pickup (+ offline email path).
 *
 * Maps to `PROJECT_STATUS/svscope_simple.md` §14 (27-step daily shop loop).
 * SSOT: `PROJECT_STATUS/MVP_PATH.md` exit criterion "§14 E2E gate PASS".
 *
 * Usage (local):
 *   npm run dev
 *   node scripts/playwright-auth-setup.mjs   (if token expired)
 *   npm run verify:phase14-e2e
 *
 * Prod:
 *   npm run verify:phase14-e2e:prod
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const baseUrlFlagArg = process.argv.find((a) => a.startsWith("--base-url="));
const baseUrlPairIndex = process.argv.indexOf("--base-url");
const baseUrlOverride =
  (baseUrlFlagArg ? baseUrlFlagArg.split("=")[1] : null) ??
  (baseUrlPairIndex >= 0 ? process.argv[baseUrlPairIndex + 1] : undefined);

const isProd = Boolean(
  baseUrlOverride && /lgarage\.github\.io\/stageverify/i.test(baseUrlOverride),
);

/** Local §14 gate uses demo fixtures (steps 1–2); prod requires real ingest env. */
const DEMO_E2E_ENV = {
  STAGEVERIFY_RECEIVE_DELIVERY: "delivery-demo-vendor-1",
  STAGEVERIFY_VENDOR_ORDER: "ORD-005",
  STAGEVERIFY_VENDOR_PIN: "1234",
  STAGEVERIFY_VENDOR_JOB: "Riverside Medical Center",
  STAGEVERIFY_VENDOR_PO: "PO-88390",
};

/** §14 step coverage manifest (printed in summary). */
const SECTION14_COVERAGE = [
  { steps: "1–2", topic: "Dispatcher creates job + staging", status: "fixture", note: "Demo seed / patch scripts" },
  { steps: "3–7", topic: "Vendor arrival → QR → PIN → DELIVERED", status: "verify", note: "verify-e2e-smoke vendor leg" },
  { steps: "8–9", topic: "Vendor email evidence (Condition 1)", status: "verify", note: "test:email-parser offline gate (live ingest = Dan GCP)" },
  { steps: "10", topic: "Two-source readiness gate", status: "implicit", note: "Covered by vendor + pickup seed CF path" },
  { steps: "11", topic: "Dispatcher sees Ready for Pickup", status: "verify", note: "verify-e2e-smoke dispatcher leg" },
  { steps: "12", topic: "BuildOps technician schedule", status: "skip", note: "External system — not scripted" },
  { steps: "13–16", topic: "Pickup Scheduled + Copy Pickup Information", status: "verify", note: "dispatcher-nav in e2e-smoke chain" },
  { steps: "17–22", topic: "Technician pickup link → checklist → complete", status: "verify", note: "verify-e2e-pickup-leg" },
  { steps: "23–24", topic: "Dispatcher pickup update + job complete", status: "verify", note: "delivery-list-drawer-consistency" },
  { steps: "25", topic: "Temporary staging release after pickup", status: "implicit", note: "recordPickupEvent CF in pickup leg" },
  { steps: "26", topic: "E-tag clears to Available", status: "skip", note: "Out of MVP scope (D-26) — not gated for MVP done" },
  { steps: "27", topic: "Permanent shop-stock reserved", status: "partial", note: "Shop stock labels in pickup; no inventory balances" },
];

function printCoverageManifest() {
  console.log("\n--- §14 step coverage manifest ---");
  for (const row of SECTION14_COVERAGE) {
    console.log(
      `  [${row.status.padEnd(8)}] steps ${row.steps}: ${row.topic} — ${row.note}`,
    );
  }
  console.log("--- end manifest ---\n");
}

function childEnv() {
  const base = baseUrlOverride
    ? { ...process.env, STAGEVERIFY_BASE_URL: baseUrlOverride }
    : process.env;
  if (isProd) return base;
  return { ...base, ...DEMO_E2E_ENV };
}

function runStep(label, command, args, extraArgs = []) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, [...args, ...extraArgs], {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: childEnv(),
  });
  if (result.status !== 0) {
    console.error(`FAIL: ${label} (exit ${result.status ?? "unknown"})`);
    process.exit(result.status ?? 1);
  }
  console.log(`${label} OK`);
}

console.log(
  `verify:phase14-e2e — §14 MVP E2E gate${isProd ? " (PROD)" : " (local)"}`,
);
printCoverageManifest();

const baseUrlArgs = baseUrlOverride ? [`--base-url=${baseUrlOverride}`] : [];

if (!isProd) {
  runStep("§14 fixture seed (demo deliveries)", "node", [
    "scripts/seed-vendor-demo-deliveries.mjs",
  ]);
}

runStep("§14 legs 3–22 core loop", "node", ["scripts/verify-e2e-smoke.mjs"], baseUrlArgs);

runStep("§14 legs 8–9 email parser (offline gate)", "npm", [
  "run",
  "test:email-parser",
]);

runStep("§14 legs 23–24 dispatcher pickup readback", "npx", [
  "tsx",
  "scripts/verify-delivery-list-drawer-consistency.mjs",
]);

console.log("\nverify:phase14-e2e PASS");
console.log(
  isProd
    ? "§14 E2E gate: prod run complete — update MVP_PATH SSOT per partial credit table."
    : "§14 E2E gate: local run complete — run verify:phase14-e2e:prod for prod gate.",
);

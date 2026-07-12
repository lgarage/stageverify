/**
 * §14 MVP E2E gate — vendor receive → dispatcher readiness → pickup (+ offline email path).
 *
 * Maps to `PROJECT_STATUS/svscope_simple.md` §14 (27-step daily shop loop).
 * SSOT: `PROJECT_STATUS/MVP_PATH.md` exit criterion "§14 E2E gate PASS".
 *
 * On failure, self-captures to learning-pending (same hook as run-verify-with-learning)
 * because package.json does not wrap this script (avoids high-risk scripts-section edit).
 *
 * Usage (local):
 *   npm run dev
 *   node scripts/playwright-auth-setup.mjs   (if token expired)
 *   npm run verify:phase14-e2e
 *
 * Prod:
 *   npm run verify:phase14-e2e:prod
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  captureVerifyFailure,
  clearPendingForScript,
  tailLines,
} from "./lib/verify-learning-hook.mjs";

const root = resolve(process.cwd());
const baseUrlFlagArg = process.argv.find((a) => a.startsWith("--base-url="));
const baseUrlPairIndex = process.argv.indexOf("--base-url");
const baseUrlOverride =
  (baseUrlFlagArg ? baseUrlFlagArg.split("=")[1] : null) ??
  (baseUrlPairIndex >= 0 ? process.argv[baseUrlPairIndex + 1] : undefined);

const isProd = Boolean(
  baseUrlOverride && /lgarage\.github\.io\/stageverify/i.test(baseUrlOverride),
);

const scriptName = isProd ? "verify:phase14-e2e:prod" : "verify:phase14-e2e";
const forwardArgs = baseUrlOverride ? [`--base-url=${baseUrlOverride}`] : [];

/** Local §14 gate uses demo fixtures (steps 1–2); prod uses gh-pages + live Firebase. */
const DEMO_E2E_ENV = {
  STAGEVERIFY_RECEIVE_DELIVERY: "delivery-demo-vendor-1",
  STAGEVERIFY_VENDOR_ORDER: "ORD-005",
  STAGEVERIFY_VENDOR_PIN: "1234",
  STAGEVERIFY_VENDOR_JOB: "Riverside Medical Center",
  STAGEVERIFY_VENDOR_PO: "PO-88390",
};

const SECTION14_COVERAGE_LOCAL = [
  { steps: "1–2", topic: "Dispatcher creates job + staging", status: "fixture", note: "Demo seed / patch scripts" },
  { steps: "3–7", topic: "Vendor arrival → QR → PIN → DELIVERED", status: "verify", note: "verify-e2e-smoke vendor leg" },
  { steps: "8–9", topic: "Vendor email evidence (Condition 1)", status: "verify", note: "test:email-parser offline gate (live ingest = Dan GCP)" },
  { steps: "10", topic: "Two-source readiness gate", status: "implicit", note: "Covered by vendor + pickup seed CF path" },
  { steps: "11", topic: "Dispatcher sees Ready for Pickup", status: "verify", note: "verify-e2e-smoke dispatcher leg" },
  { steps: "12", topic: "BuildOps technician schedule", status: "skip", note: "External system — not scripted" },
  { steps: "13–16", topic: "Pickup Scheduled + Copy Pickup Information", status: "verify", note: "dispatcher-nav in e2e-smoke chain" },
  { steps: "17–22", topic: "Technician pickup link → checklist → complete", status: "verify", note: "verify-e2e-pickup-leg" },
  { steps: "23–24", topic: "Dispatcher pickup update + job complete", status: "verify", note: "verify-phase14-pickup-readback (ORD-004 Picked Up)" },
  { steps: "25", topic: "Temporary staging release after pickup", status: "implicit", note: "recordPickupEvent CF in pickup leg" },
  { steps: "26", topic: "E-tag clears to Available", status: "skip", note: "Out of MVP scope (D-26) — not gated for MVP done" },
  { steps: "27", topic: "Permanent shop-stock reserved", status: "partial", note: "Shop stock labels in pickup; no inventory balances" },
];

const SECTION14_COVERAGE_PROD = [
  { steps: "1–2", topic: "Dispatcher creates job + staging", status: "skip", note: "Prod uses live ingest rows — no demo seed" },
  { steps: "3–7", topic: "Vendor arrival → QR → PIN → DELIVERED", status: "verify", note: "verify-vendor-delivered when STAGEVERIFY_* set; else 4046362 proxy" },
  { steps: "8–9", topic: "Vendor email evidence (Condition 1)", status: "verify", note: "test:email-parser offline; live ingest = Dan GCP (PC prep)" },
  { steps: "10", topic: "Two-source readiness gate", status: "implicit", note: "pickup seed CF on delivery-3" },
  { steps: "11", topic: "Dispatcher sees Ready for Pickup", status: "verify", note: "verify-dispatcher-nav prod" },
  { steps: "12", topic: "BuildOps technician schedule", status: "skip", note: "External system — not scripted" },
  { steps: "13–16", topic: "Pickup Scheduled + Copy Pickup Information", status: "verify", note: "dispatcher-nav prod" },
  { steps: "17–22", topic: "Technician pickup link → checklist → complete", status: "verify", note: "verify-e2e-pickup-leg on gh-pages" },
  { steps: "23–24", topic: "Dispatcher pickup update + job complete", status: "verify", note: "deep-link readback delivery-3 (demos hidden)" },
  { steps: "25", topic: "Temporary staging release after pickup", status: "implicit", note: "recordPickupEvent CF in pickup leg" },
  { steps: "26", topic: "E-tag clears to Available", status: "skip", note: "Out of MVP scope (D-26)" },
  { steps: "27", topic: "Permanent shop-stock reserved", status: "partial", note: "Shop stock labels in pickup; no inventory balances" },
];

/** Accumulated child output for learning capture (stdio pipe + tee). */
let captureStdout = "";
let captureStderr = "";

function printCoverageManifest() {
  const rows = isProd ? SECTION14_COVERAGE_PROD : SECTION14_COVERAGE_LOCAL;
  console.log("\n--- §14 step coverage manifest ---");
  for (const row of rows) {
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
  return new Promise((resolveStep, rejectStep) => {
    console.log(`\n=== ${label} ===`);
    const child = spawn(command, [...args, ...extraArgs], {
      cwd: root,
      stdio: ["inherit", "pipe", "pipe"],
      // Windows: npm/npx are .cmd — spawn without shell → ENOENT
      shell: true,
      env: childEnv(),
    });
    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      captureStdout += text;
      process.stdout.write(text);
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      captureStderr += text;
      process.stderr.write(text);
    });
    child.on("error", (err) => {
      console.error(`FAIL: ${label} — ${err.message}`);
      rejectStep(err);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        console.error(`FAIL: ${label} (exit ${code ?? "unknown"})`);
        rejectStep(new Error(`${label} failed with exit ${code}`));
        return;
      }
      console.log(`${label} OK`);
      resolveStep();
    });
  });
}

function recordFailure(exitCode) {
  const result = captureVerifyFailure({
    scriptName,
    exitCode,
    stdoutTail: tailLines(captureStdout, 60),
    stderrTail: tailLines(captureStderr, 40),
    forwardArgs,
    domain: "dispatcher",
    triggers: ["phase14", "hideSeedDemoRows", "openDelivery"],
  });
  if (result.action === "pending-capture" && result.entry) {
    console.error(
      `learning: captured pending ${result.entry.id} (${result.entry.category}) — ${result.entry.summary}`,
    );
  } else if (result.action?.startsWith("dedup")) {
    console.error(`learning: dedup ${result.action} fingerprint=${result.fingerprint}`);
  }
}

async function main() {
  console.log(
    `verify:phase14-e2e — §14 MVP E2E gate${isProd ? " (PROD)" : " (local)"}`,
  );
  printCoverageManifest();

  const baseUrlArgs = baseUrlOverride ? [`--base-url=${baseUrlOverride}`] : [];
  const smokeScript = isProd
    ? "scripts/verify-e2e-smoke-prod.mjs"
    : "scripts/verify-e2e-smoke.mjs";

  if (!isProd) {
    await runStep("§14 fixture seed (demo deliveries)", "node", [
      "scripts/seed-vendor-demo-deliveries.mjs",
    ]);
  }

  await runStep(
    isProd ? "§14 legs 3–22 prod core loop" : "§14 legs 3–22 core loop",
    "node",
    [smokeScript],
    baseUrlArgs,
  );

  await runStep("§14 legs 8–9 email parser (offline gate)", "npm", [
    "run",
    "test:email-parser",
  ]);

  await runStep("§14 legs 23–24 dispatcher pickup readback", "node", [
    "scripts/verify-phase14-pickup-readback.mjs",
  ], baseUrlArgs);

  clearPendingForScript(scriptName);
  console.log("\nverify:phase14-e2e PASS");
  console.log(
    isProd
      ? "§14 E2E gate: prod run complete — update MVP_PATH SSOT per partial credit table (+3.42%)."
      : "§14 E2E gate: local run complete — run verify:phase14-e2e:prod after Dan merge (no deploy until approved).",
  );
}

main().catch(() => {
  recordFailure(1);
  process.exit(1);
});

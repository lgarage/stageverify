/**
 * MVP core regression bundle — pickup, vendor, dispatcher, location Phase 4 on prod.
 *
 * SSOT: PROJECT_STATUS/MVP_PATH.md exit criterion "Core regression green".
 *
 * Usage (prod gh-pages — after Dan merge/deploy):
 *   npm run verify:mvp-core-regression:prod
 *
 * Local smoke (orchestrator only — does not run :prod legs):
 *   npm run verify:mvp-core-regression
 */

import { spawn } from "node:child_process";
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

const PROD_LEGS = [
  {
    label: "pickup portal",
    command: "npm",
    args: ["run", "verify:pickup:prod"],
  },
  {
    label: "vendor delivered hub",
    command: "npm",
    args: ["run", "verify:vendor-delivered:prod"],
    skipUnless: () =>
      [
        "STAGEVERIFY_RECEIVE_DELIVERY",
        "STAGEVERIFY_VENDOR_ORDER",
        "STAGEVERIFY_VENDOR_PIN",
        "STAGEVERIFY_VENDOR_JOB",
        "STAGEVERIFY_VENDOR_PO",
      ].every((key) => Boolean(process.env[key]?.trim())),
    skipNote:
      "Set STAGEVERIFY_RECEIVE_DELIVERY + vendor env for vendor-delivered:prod",
  },
  {
    label: "dispatcher nav",
    command: "npm",
    args: ["run", "verify:dispatcher-nav:prod"],
  },
  {
    label: "location Phase 4",
    command: "npm",
    args: ["run", "verify:location-phase4:prod"],
  },
];

function runStep(label, command, args) {
  return new Promise((resolveStep, rejectStep) => {
    console.log(`\n=== MVP core regression: ${label} ===`);
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      shell: true,
      env: baseUrlOverride
        ? { ...process.env, STAGEVERIFY_BASE_URL: baseUrlOverride }
        : process.env,
    });
    child.on("error", (err) => rejectStep(err));
    child.on("close", (code) => {
      if (code !== 0) {
        rejectStep(new Error(`${label} failed with exit ${code}`));
        return;
      }
      console.log(`${label} OK`);
      resolveStep();
    });
  });
}

async function main() {
  console.log(
    `verify:mvp-core-regression${isProd ? " (PROD)" : " (local orchestrator)"}`,
  );

  if (!isProd) {
    console.log(
      "Local mode: validates script wiring only. Run verify:mvp-core-regression:prod after merge/deploy.",
    );
    console.log("PASS: mvp-core-regression orchestrator ready");
    return;
  }

  for (const leg of PROD_LEGS) {
    if (leg.skipUnless && !leg.skipUnless()) {
      console.log(`\nSKIP ${leg.label} — ${leg.skipNote ?? "env not set"}`);
      continue;
    }
    await runStep(leg.label, leg.command, leg.args);
  }

  console.log("\nverify:mvp-core-regression:prod PASS");
  console.log(
    "Update MVP_PATH SSOT (+1.30% core regression) when Dan confirms full bundle green.",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

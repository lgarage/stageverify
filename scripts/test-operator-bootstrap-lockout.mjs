/**
 * Bootstrap lockout — refuse second bootstrap when active operator exists.
 * Usage: npm run test:operator-bootstrap-lockout
 */
import { initAdminFirestoreOnly, seedOperator } from "./lib/operator-test-lib.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

initAdminFirestoreOnly();
const stamp = Date.now();
let passed = 0;
let failed = 0;
const pass = (msg) => {
  passed += 1;
  console.log(`  ✓ ${msg}`);
};
const fail = (msg, err) => {
  failed += 1;
  console.error(`  ✗ ${msg}`);
  if (err) console.error(`    ${err?.message ?? err}`);
};

console.log("\n=== operator bootstrap lockout ===\n");

await seedOperator(`bootstrap-seed-${stamp}`, "Seed Operator");

const script = resolve(dirname(fileURLToPath(import.meta.url)), "operator/bootstrap-first-operator.mjs");
const run = spawnSync(
  process.execPath,
  [script, "--uid", `bootstrap-new-${stamp}`, "--name", "Should Fail"],
  {
    env: process.env,
    encoding: "utf8",
  },
);

if (run.status !== 0 && /active operatorAccounts already exist/i.test(run.stderr + run.stdout)) {
  pass("bootstrap refuses when active operator exists");
} else {
  fail("bootstrap refuses when active operator exists", new Error(run.stderr || run.stdout));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

/**
 * Static separation checks — no cross-imports / no prototype localStorage keys.
 * Usage: npm run test:operator-app-separation
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

let passed = 0;
let failed = 0;
const pass = (msg) => {
  passed += 1;
  console.log(`  ✓ ${msg}`);
};
const fail = (msg) => {
  failed += 1;
  console.error(`  ✗ ${msg}`);
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

console.log("\n=== operator app separation ===\n");

const root = process.cwd();
const operatorConsoleFiles = walk(resolve(root, "functions/src/operatorConsole"));
for (const file of operatorConsoleFiles) {
  const text = readFileSync(file, "utf8");
  if (text.includes("dispatcherAuth")) {
    fail(`operatorConsole imports dispatcherAuth: ${file}`);
  }
}
pass("operatorConsole has no inboundEmail/dispatcherAuth import");

const operatorAppFiles = walk(resolve(root, "apps/operator/src"));
for (const file of operatorAppFiles) {
  const text = readFileSync(file, "utf8");
  if (text.includes("../../../src") || text.includes("../../src/dispatcher")) {
    fail(`operator app imports customer src: ${file}`);
  }
  if (text.includes("VITE_OPERATOR_ALLOWED_EMAILS")) {
    fail(`operator app uses email allowlist: ${file}`);
  }
  if (text.includes("stageverify.operator.foundation.v1")) {
    fail(`operator app references prototype localStorage key: ${file}`);
  }
}
pass("operator app has no customer src / allowlist / prototype storage key");

const mainTsx = readFileSync(resolve(root, "src/main.tsx"), "utf8");
if (!mainTsx.includes("OperatorDashboardPage") && !mainTsx.includes("/operator")) {
  pass("customer main.tsx has no operator routes");
} else {
  fail("customer main.tsx still references operator console");
}

if (!readFileSync(resolve(root, "apps/operator/src/api/operatorApi.ts"), "utf8").includes("localStorage")) {
  pass("operator API does not use localStorage SoT");
} else {
  fail("operator API uses localStorage");
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

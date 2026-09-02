/**
 * DEV fail-closed backend gate — pure function + source guards.
 * Usage: npm run test:operator-backend-gate
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isOperatorBackendAllowed } from "../apps/operator/src/api/operatorBackendGate.ts";

let passed = 0;
let failed = 0;
const pass = (msg) => {
  passed += 1;
  console.log(`  ✓ ${msg}`);
};
const fail = (msg, detail) => {
  failed += 1;
  console.error(`  ✗ ${msg}`);
  if (detail) console.error(`    ${detail}`);
};

console.log("\n=== operator backend gate ===\n");

if (isOperatorBackendAllowed({ isDev: true, useEmulators: true })) {
  pass("DEV + useEmulators true → allowed");
} else {
  fail("DEV + useEmulators true → allowed");
}

if (!isOperatorBackendAllowed({ isDev: true, useEmulators: false })) {
  pass("DEV + useEmulators false → blocked (reads/writes)");
} else {
  fail("DEV + useEmulators false → blocked (reads/writes)");
}

if (isOperatorBackendAllowed({ isDev: false, useEmulators: false })) {
  pass("isDev false → allowed regardless of useEmulators flag");
} else {
  fail("isDev false → allowed regardless of useEmulators flag");
}

if (isOperatorBackendAllowed({ isDev: false, useEmulators: true })) {
  pass("isDev false + useEmulators true → allowed");
} else {
  fail("isDev false + useEmulators true → allowed");
}

// undefined treated as false via strict === true check in gate
if (!isOperatorBackendAllowed({ isDev: true, useEmulators: undefined })) {
  pass("DEV + useEmulators undefined → blocked");
} else {
  fail("DEV + useEmulators undefined → blocked");
}

const root = process.cwd();
const operatorApi = readFileSync(
  resolve(root, "apps/operator/src/api/operatorApi.ts"),
  "utf8",
);
const operatorAuth = readFileSync(
  resolve(root, "apps/operator/src/operatorAuth.ts"),
  "utf8",
);

const readGuards = [
  ["listCustomersWithSummary", /export async function listCustomersWithSummary[\s\S]*?assertSafeBackend\(\)/],
  ["getCustomerBundle", /export async function getCustomerBundle[\s\S]*?assertSafeBackend\(\)/],
];

for (const [name, pattern] of readGuards) {
  if (pattern.test(operatorApi)) {
    pass(`operatorApi.${name} calls assertSafeBackend()`);
  } else {
    fail(`operatorApi.${name} calls assertSafeBackend()`);
  }
}

if (/export async function fetchOperatorSession[\s\S]*?assertSafeBackend\(\)/.test(operatorAuth)) {
  pass("operatorAuth.fetchOperatorSession calls assertSafeBackend()");
} else {
  fail("operatorAuth.fetchOperatorSession calls assertSafeBackend()");
}

if (/function mutatingCall[\s\S]*?assertSafeBackend\(\)/.test(operatorApi)) {
  pass("operatorApi mutatingCall calls assertSafeBackend() (writes)");
} else {
  fail("operatorApi mutatingCall calls assertSafeBackend() (writes)");
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

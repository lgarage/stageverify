/**
 * Cloud VM readiness check — no secrets printed.
 *
 * Usage: npm run verify:cloud-env
 * Exit 1 if any required check fails.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const root = resolve(process.cwd());
const require = createRequire(import.meta.url);

const requiredFails = [];

function pass(label, detail = "") {
  console.log(`PASS: ${label}${detail ? ` — ${detail}` : ""}`);
}

function fail(label, detail = "") {
  console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
  requiredFails.push(label);
}

function warn(label, detail = "") {
  console.log(`WARN: ${label}${detail ? ` — ${detail}` : ""}`);
}

// node_modules or package-lock + suggest npm ci
const hasNodeModules = existsSync(resolve(root, "node_modules"));
const hasPackageLock = existsSync(resolve(root, "package-lock.json"));
if (hasNodeModules) {
  pass("node_modules", "present");
} else if (hasPackageLock) {
  fail("node_modules", "missing — run: npm ci");
} else {
  fail("node_modules", "missing — no package-lock.json found");
}

// playwright package resolvable
try {
  require.resolve("playwright", { paths: [root] });
  pass("playwright package", "resolvable");
} catch {
  fail("playwright package", "not installed — run: npm ci");
}

// Required env secrets (boolean only)
const hasTestEmail = Boolean(process.env.STAGEVERIFY_TEST_EMAIL?.trim());
const hasTestPassword = Boolean(process.env.STAGEVERIFY_TEST_PASSWORD?.trim());
if (hasTestEmail) {
  pass("STAGEVERIFY_TEST_EMAIL", "set");
} else {
  fail("STAGEVERIFY_TEST_EMAIL", "not set — add in Cursor Environments secrets");
}
if (hasTestPassword) {
  pass("STAGEVERIFY_TEST_PASSWORD", "set");
} else {
  fail("STAGEVERIFY_TEST_PASSWORD", "not set — add in Cursor Environments secrets");
}

// .cursor/environment.json
const envJsonPath = resolve(root, ".cursor/environment.json");
if (!existsSync(envJsonPath)) {
  fail(".cursor/environment.json", "missing");
} else {
  try {
    const parsed = JSON.parse(readFileSync(envJsonPath, "utf8"));
    if (typeof parsed.install === "string" && parsed.install.trim()) {
      pass(".cursor/environment.json", "valid install command");
    } else {
      fail(".cursor/environment.json", 'missing or empty "install" field');
    }
  } catch (err) {
    fail(".cursor/environment.json", `parse error: ${err.message}`);
  }
}

// AGENTS.md section
const agentsPath = resolve(root, "AGENTS.md");
if (!existsSync(agentsPath)) {
  fail("AGENTS.md", "missing");
} else {
  const agentsText = readFileSync(agentsPath, "utf8");
  if (agentsText.includes("## Cursor Cloud specific instructions")) {
    pass("AGENTS.md", 'contains "Cursor Cloud specific instructions"');
  } else {
    fail("AGENTS.md", 'missing "## Cursor Cloud specific instructions" section');
  }
}

// Optional: FIREBASE_TOKEN
if (process.env.FIREBASE_TOKEN?.trim()) {
  pass("FIREBASE_TOKEN", "set (optional)");
} else {
  warn("FIREBASE_TOKEN", "not set — optional; needed only for firebase deploy from cloud");
}

// Optional: firebase CLI
const firebaseWhich = spawnSync("npx", ["firebase", "--version"], {
  cwd: root,
  encoding: "utf8",
  shell: false,
});
if (firebaseWhich.status === 0) {
  pass("firebase CLI", "available via npx firebase");
} else {
  warn("firebase CLI", "npx firebase not available — use npx firebase-tools when deploying");
}

console.log("");
if (requiredFails.length === 0) {
  console.log("verify:cloud-env PASS");
  process.exit(0);
}

console.log(`verify:cloud-env FAIL (${requiredFails.length} required check(s))`);
process.exit(1);

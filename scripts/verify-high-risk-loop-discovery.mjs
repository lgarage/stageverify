/**
 * Discovery checks for D-94 lean HIGH review (one Sonnet final-diff review).
 *
 * Usage: node scripts/verify-high-risk-loop-discovery.mjs
 * Exit 0 on PASS, 1 on FAIL. No network.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const fails = [];

function record(ok, label, detail = "") {
  const line = `${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`;
  console.log(line);
  if (!ok) fails.push(label);
}

function read(rel) {
  const p = resolve(root, rel);
  if (!existsSync(p)) {
    record(false, `missing:${rel}`, p);
    return "";
  }
  return readFileSync(p, "utf8");
}

const lean = read(".cursor/rules/lean-agent-process.mdc");
record(/^alwaysApply:\s*true\s*$/m.test(lean), "lean-alwaysApply");
record(/security-gate-id:/i.test(lean) && /HIGH/i.test(lean), "high-one-sonnet");
record(/sonnet-instruct/i.test(lean) && /replaces/i.test(lean), "d60-replaced");
record(/No gate bypass/i.test(lean) || /No \*\*gate bypass/i.test(lean), "no-bypass");
record(/Dan approves every merge/i.test(lean), "dan-approves-merge");
record(/rollback/i.test(lean) && /smoke/i.test(lean), "rollback-and-smoke");

const stub = read(".cursor/rules/high-risk-sonnet-loop.mdc");
record(/^alwaysApply:\s*false\s*$/m.test(stub), "d60-file-not-alwaysApply");
record(/SUPERSEDED by D-94/i.test(stub) || /supersedes D-60/i.test(stub), "d60-superseded");

const decisions = read("PROJECT_STATUS/DECISIONS.md");
record(/D-94 \(2026-10-10\)/i.test(decisions), "d94-recorded");
record(/supersedes D-60/i.test(decisions) || /Supersedes D-60/i.test(decisions), "d94-supersedes-d60");

const gate = read("scripts/gate-check.mjs");
record(/HIGH_CORE_LOOP_CF_RE/.test(gate), "gate-core-loop-not-all-functions");

if (fails.length) {
  console.log(`\nverify-high-risk-loop-discovery: FAIL (${fails.length})`);
  process.exit(1);
}
console.log("\nverify-high-risk-loop-discovery: PASS");
process.exit(0);

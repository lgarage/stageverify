/**
 * Fresh-agent style discovery checks for the universal 97 rule (D-47/D-69).
 *
 * Proves the canonical alwaysApply rule is discoverable and encodes the
 * operational bars (edit + DONE + honesty + subagent + protected gates).
 *
 * Usage: node scripts/verify-97-rule-discovery.mjs
 * Exit 0 on PASS, 1 on FAIL. No network. No package.json script entry (avoid high-risk).
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const fails = [];
const checks = [];

function record(ok, label, detail = "") {
  const line = `${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`;
  console.log(line);
  checks.push({ ok, label });
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

const gatePath = ".cursor/rules/confidence-gate.mdc";
const gate = read(gatePath);

record(
  /^alwaysApply:\s*true\s*$/m.test(gate),
  "alwaysApply",
  "confidence-gate.mdc",
);

record(
  /# 97 rule/i.test(gate) && /Alias:.*97 rule/i.test(gate),
  "alias",
  "explicit “97 rule” alias in SSOT",
);

record(
  /investigate\s*\/\s*implement\s*\/\s*verify\s*\/\s*ship/i.test(gate),
  "task-classes",
  "investigate/implement/verify/ship",
);

const protectedNeedles = ["D-38", "D-60", "D-50", "D-65", "D-66"];
const missingProtected = protectedNeedles.filter((n) => !gate.includes(n));
record(
  missingProtected.length === 0 && /does not waive/i.test(gate),
  "protected-gates",
  "97% does not waive D-38/D-60/D-50/D-65/D-66",
);

record(
  /Subagents?:/i.test(gate) &&
    /subagent PASS/i.test(gate) &&
    /child PASS\s*≠\s*parent/i.test(gate),
  "subagent-inheritance",
  "child PASS ≠ parent ≥97%",
);

record(
  /Task prompts?:/i.test(gate) && /implementer Task prompts must include/i.test(gate),
  "task-prompt-inheritance",
  "implementer Task prompts must paste 97-rule line",
);

record(
  /confAfter\s*<\s*97%/i.test(gate) &&
    /DONE/i.test(gate) &&
    /never manufacture|never inflate|inflate/i.test(gate) &&
    /prefer\s+\*\*BLOCKED\*\*|prefer BLOCKED/i.test(gate),
  "no-fake-done",
  "confAfter <97% blocks DONE; honesty + BLOCKED/PARTIAL map",
);

record(
  /Raise conf only with evidence/i.test(gate) && /Classify first/i.test(gate),
  "evidence-path",
  "classify + evidence raise path",
);

const agents = read("AGENTS.md");
const done = read(".cursor/rules/done-signal.mdc");
const memory = read("PROJECT_STATUS/MEMORY.md");
const orchestrator = read(".cursor/rules/composer-orchestrator.mdc");
const modelGates = read(".cursor/rules/model-gates.mdc");

record(
  /97 rule \(D-47/i.test(agents) && /confidence-gate\.mdc/.test(agents),
  "agents-md",
  "cloud session start points at 97 rule",
);

record(
  /97 rule \(D-47/i.test(done) && /confAfter\s*<\s*97%/i.test(done),
  "done-signal",
  "terminal DONE gated by confAfter ≥97%",
);

record(
  /D-47 \(97 rule/i.test(memory) && /confidence-gate\.mdc/.test(memory),
  "memory-router",
  "MEMORY.md hot tier mentions universal 97 rule",
);

record(
  /D-47\/D-69 97 rule \(universal\)/i.test(orchestrator) && /before DONE/i.test(orchestrator),
  "orchestrator-pointer",
  "composer-orchestrator teaches edit + DONE",
);

record(
  /D-46\/D-47\/D-69\s+\*\*97 rule\*\*/i.test(modelGates) && /before DONE/i.test(modelGates),
  "model-gates-pointer",
  "model-gates teaches edit + DONE",
);

const decisions = read("PROJECT_STATUS/DECISIONS.md");
record(
  /D-69 \(2026-08-09\)/.test(decisions) && /Universal 97-rule/.test(decisions),
  "decision-d69",
  "D-69 recorded",
);

record(
  !existsSync(resolve(root, ".cursor/rules/97-rule.mdc")),
  "no-duplicate-ssot",
  "single SSOT confidence-gate.mdc",
);

// Scenario mapping — only PASS when the backing check(s) passed
console.log("");
console.log("Scenario checks (mapped to mechanical bars — not theater):");
const byLabel = Object.fromEntries(checks.map((c) => [c.label, c.ok]));
const scenarios = [
  ["scenario:new-composer", ["alwaysApply", "agents-md", "memory-router"]],
  ["scenario:investigation", ["task-classes"]],
  ["scenario:high-risk", ["protected-gates"]],
  ["scenario:subagent", ["subagent-inheritance", "task-prompt-inheritance"]],
  ["scenario:94-percent", ["no-fake-done"]],
  ["scenario:97-after-evidence", ["evidence-path"]],
  ["scenario:gates-not-bypassed", ["protected-gates"]],
];
for (const [name, deps] of scenarios) {
  const ok = deps.every((d) => byLabel[d]);
  record(ok, name, `depends: ${deps.join(", ")}`);
}

console.log("");
if (fails.length) {
  console.log(`RESULT: FAIL (${fails.length}) — ${fails.join("; ")}`);
  process.exit(1);
}
console.log("RESULT: PASS — universal 97-rule discovery bars satisfied");
process.exit(0);

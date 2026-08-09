/**
 * Discovery + classification checks for D-60 high-risk iterative review
 * (Sonnet pre → builder → Grok adversarial → Sonnet final → D-38).
 *
 * Proves the alwaysApply SSOT encodes the mandatory sequence, fail-closed
 * behavior, deploy approval boundary, and representative A–G routing.
 *
 * Usage: node scripts/verify-high-risk-loop-discovery.mjs
 * Exit 0 on PASS, 1 on FAIL. No network. No package.json script entry
 * (avoid high-risk root scripts wiring).
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

const ssotPath = ".cursor/rules/high-risk-sonnet-loop.mdc";
const ssot = read(ssotPath);

record(/^alwaysApply:\s*true\s*$/m.test(ssot), "alwaysApply", ssotPath);

record(
  /Sonnet 5 pre-implementation review/i.test(ssot) &&
    /Grok adversarial critical review/i.test(ssot) &&
    /Sonnet 5 final verification/i.test(ssot) &&
    /D-38/i.test(ssot),
  "sequence",
  "Sonnet pre → Grok adversarial → Sonnet final → D-38",
);

record(
  /high-risk-adversarial:/i.test(ssot) &&
    /sonnet-instruct:/i.test(ssot) &&
    /sonnet-verify:/i.test(ssot) &&
    /security-gate-id/i.test(ssot),
  "evidence-tokens",
  "sonnet-instruct + high-risk-adversarial + sonnet-verify + security-gate-id",
);

record(
  /fail-closed/i.test(ssot) &&
    /do \*\*not\*\* silently skip/i.test(ssot) &&
    /do \*\*not\*\* downgrade/i.test(ssot),
  "fail-closed",
  "no silent skip / no cheap-path downgrade",
);

record(
  /NEVER\*\* deploy Cloud Functions/i.test(ssot) &&
    /NEVER\*\* deploy Firestore rules/i.test(ssot),
  "deploy-boundary",
  "CF/rules still need explicit Dan approval",
);

record(
  /must not\*\* weaken, replace, or bypass D-38/i.test(ssot) ||
    /must NOT weaken, replace, or bypass D-38/i.test(ssot) ||
    /must \*\*not\*\* weaken, replace, or bypass D-38/i.test(ssot),
  "d38-compose",
  "D-38 not weakened",
);

record(
  /D-65 must not N\/A/i.test(ssot) || /D-65 must \*\*not\*\* N\/A/i.test(ssot) ||
    /does \*\*not\*\* N\/A this path/i.test(ssot),
  "d65-compose",
  "D-65 must not N/A D-60",
);

const decisions = read("PROJECT_STATUS/DECISIONS.md");
record(
  /D-60 \(2026-08-05.*amended 2026-08-09/i.test(decisions) &&
    /high-risk-adversarial/i.test(decisions),
  "decisions-d60",
  "D-60 amended 2026-08-09 with adversarial token",
);

const gates = read(".cursor/rules/model-gates.mdc");
record(
  /Grok adversarial/i.test(gates) && /high-risk-adversarial/i.test(gates),
  "model-gates-echo",
  "T3 / ladder mentions Grok adversarial",
);

const preflight = read("scripts/ship-evidence-preflight.mjs");
record(
  /"high-risk-adversarial:"/.test(preflight) &&
    /high-risk-adversarial:\s*\\s\*\\S\+/i.test(
      preflight.match(/"high-risk-adversarial:"\s*:\s*\/(.+)\//)?.[1]
        ? `/${preflight.match(/"high-risk-adversarial:"\s*:\s*(\/.+\/)i?/)?.[1] || ""}/`
        : "",
    ) ||
    /high-risk-adversarial:\\s\*\\S\+/i.test(preflight),
  "preflight-token",
  "ship-evidence-preflight requires high-risk-adversarial",
);

/** Representative routing matrix (A–G) — policy text must classify correctly. */
const examples = [
  {
    id: "A",
    label: "CSS-only badge color",
    expectLoop: false,
    needles: [/CSS-only/i, /FE-only layout/i, /Does NOT fire/i],
  },
  {
    id: "B",
    label: "FE-only layout change",
    expectLoop: false,
    needles: [/FE-only layout/i, /Does NOT fire/i],
  },
  {
    id: "C",
    label: "Cloud Function parser logic",
    expectLoop: true,
    needles: [/Cloud Functions/i, /functions\/\*\*/i, /parser\/reparse/i],
  },
  {
    id: "D",
    label: "PIN/auth/session persistence",
    expectLoop: true,
    needles: [/PIN/i, /session/i, /Auth \/ session/i],
  },
  {
    id: "E",
    label: "Firestore rules change",
    expectLoop: true,
    needles: [/Firestore rules/i, /firestore\.rules/i],
  },
  {
    id: "F",
    label: "C3 reusable lesson activation/write",
    expectLoop: true,
    needles: [/Reusable learning/i, /C3/i],
  },
  {
    id: "G",
    label: "docs-only architecture",
    expectLoop: false,
    needles: [/docs-only/i, /Does NOT fire/i],
  },
  {
    id: "H",
    label: "FE login copy-only",
    expectLoop: false,
    needles: [/copy-only/i, /Does NOT fire/i],
  },
  {
    id: "I",
    label: "src route-guard/session logic",
    expectLoop: true,
    needles: [/route guards/i, /Does fire when FE touches access control/i],
  },
];

for (const ex of examples) {
  const textHit = ex.needles.every((re) => re.test(ssot));
  // Routing intent: loop required iff expectLoop — enforced by presence of
  // trigger vs "Does NOT fire" buckets in SSOT (same file).
  const inNotFire = /Does NOT fire[\s\S]*?CSS-only[\s\S]*?docs-only/i.test(ssot);
  const inTrigger =
    /Trigger \(T3[\s\S]*?Reusable learning[\s\S]*?Ambiguous tier/i.test(ssot) ||
    (/Cloud Functions/i.test(ssot) &&
      /Firestore rules/i.test(ssot) &&
      /Reusable learning/i.test(ssot) &&
      /Auth \/ session/i.test(ssot));
  const ok = textHit && (ex.expectLoop ? inTrigger : inNotFire);
  record(
    ok,
    `route-${ex.id}`,
    `${ex.label} → ${ex.expectLoop ? "high-risk loop REQUIRED" : "NOT high-risk loop"}`,
  );
}

const dossier = read("PROJECT_STATUS/MODEL_DOSSIER.md");
record(
  /high-risk-adversarial/i.test(dossier) && /backend-critical/i.test(dossier),
  "dossier-discoverable",
  "MODEL_DOSSIER backend-critical/billing point at D-60 sequence",
);

if (fails.length) {
  console.error(`\nverify-high-risk-loop-discovery: FAIL (${fails.length})`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("\nverify-high-risk-loop-discovery: PASS");
process.exit(0);

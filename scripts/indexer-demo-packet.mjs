#!/usr/bin/env node
/**
 * Demo away:next --packet injection — positive (stale gh-pages) + negative (backend rules).
 * Run: npm run indexer:demo-packet [--format markdown] [--case positive|negative|indexer|all]
 */
import {
  buildAwayNextPacket,
  renderAwayNextPacketMarkdown,
} from "./lib/context-packet-lib.mjs";

const args = process.argv.slice(2);
const formatIdx = args.indexOf("--format");
const format = formatIdx >= 0 ? args[formatIdx + 1] : "json";
const caseIdx = args.indexOf("--case");
const caseFilter = caseIdx >= 0 ? args[caseIdx + 1] : "all";
const assertMode = args.includes("--assert");

/** @typedef {{ id: string, title: string, scope: string, type: string, subtype: string, tier?: string, status?: string, dependsOn?: null, acceptance?: string }} MockItem */

/** @type {Record<string, MockItem>} */
const CASES = {
  positive: {
    id: "away-demo-stale-gh-pages",
    title: "Invoice Review UI prod verify gh-pages",
    scope:
      "Ship Invoice Review UI fix; npm run deploy then verify:invoice-review:prod — local pass but prod may fail if bundle stale",
    type: "ui-component",
    subtype: "layout-style",
    tier: "T0",
    status: "queued",
    dependsOn: null,
    acceptance: "Packet injects prod-verify-redeploy gate warning before prod verify",
  },
  negative: {
    id: "away-demo-backend-rules",
    title: "Backend firestore rules hardening",
    scope: "Tighten vendorInvoiceImports read paths in firestore.rules — rules-only change, no frontend bundle",
    type: "backend-write-critical",
    subtype: "firestore-read",
    tier: "T3",
    status: "queued",
    dependsOn: null,
    acceptance: "Packet must NOT inject stale gh-pages prod-verify gate warning",
  },
  indexer: {
    id: "away-demo-indexer",
    title: "Mini-librarian indexer retrieval test",
    scope:
      "Extend context packet with indexer-memory deterministic retrieval for service-logic/indexer tasks",
    type: "service-logic",
    subtype: "indexer",
    tier: "T1",
    status: "queued",
    dependsOn: null,
    acceptance: "away:next --packet includes indexerMemory entries",
  },
  "gmail-cf": {
    id: "away-demo-gmail-cf-ship",
    title: "Stage 1 tracked vendor email Gmail CF + UI ship",
    scope:
      "firebase deploy functions + npm run deploy gh-pages for tracked vendor email layer; dark-ship emailReplyIngestEnabled until Pub/Sub + CF revision + gh-pages v0.0.15 verified before claiming live",
    type: "backend-write-critical",
    subtype: "cf-ingest",
    tier: "T3",
    status: "queued",
    dependsOn: null,
    acceptance:
      "Packet injects deploy-state-verification + firebase-deploy + gh-pages gate warnings before claiming live",
  },
};

/**
 * @param {MockItem} mockItem
 * @param {string[]} [tags]
 */
function runPacket(mockItem, tags = []) {
  return buildAwayNextPacket({
    tags,
    list: { queue: [mockItem], executionProtocol: { sequence: [mockItem.id] } },
    archive: { items: [] },
  });
}

/**
 * @param {string} name
 * @param {ReturnType<typeof runPacket>} merged
 */
function assertCase(name, merged) {
  /** @type {Record<string, unknown>} */
  const packet = merged.packet ?? {};
  /** @type {Record<string, unknown>} */
  const gotcha = /** @type {Record<string, unknown>} */ (packet.gotcha ?? {});
  const matched = /** @type {string[]} */ (gotcha.matchedTriggers ?? []);
  const gateWarnings = /** @type {string[]} */ (gotcha.gateWarnings ?? []);
  /** @type {Record<string, unknown>} */
  const indexerMemory = /** @type {Record<string, unknown>} */ (packet.indexerMemory ?? {});
  const indexerIds = /** @type {string[]} */ (indexerMemory.matchedIds ?? []);

  /** @type {string[]} */
  const failures = [];

  if (name === "positive") {
    if (!matched.includes("prod-verify-redeploy")) {
      failures.push(`expected matchedTriggers to include prod-verify-redeploy; got ${matched.join(", ") || "none"}`);
    }
    if (!matched.includes("gh-pages-deploy-freshness")) {
      failures.push(
        `expected matchedTriggers to include gh-pages-deploy-freshness; got ${matched.join(", ") || "none"}`,
      );
    }
    if (gateWarnings.length === 0) {
      failures.push("expected gateWarnings (stale gh-pages) to be non-empty");
    }
    const warningText = gateWarnings.join(" ").toLowerCase();
    if (!warningText.includes("stale") && !warningText.includes("bundle") && !warningText.includes("live")) {
      failures.push("expected gate warning to mention stale/bundle/live mismatch");
    }
  }

  if (name === "negative") {
    if (matched.includes("prod-verify-redeploy")) {
      failures.push("prod-verify-redeploy should NOT match backend firestore rules task");
    }
    if (matched.includes("gh-pages-deploy-freshness")) {
      failures.push("gh-pages-deploy-freshness should NOT match backend firestore rules task");
    }
    if (matched.includes("deploy-state-verification")) {
      failures.push("deploy-state-verification should NOT match rules-only backend task");
    }
    if (gateWarnings.length > 0) {
      failures.push(`expected no gateWarnings; got ${gateWarnings.length}`);
    }
  }

  if (name === "indexer") {
    if (!indexerIds.includes("idx-001")) {
      failures.push(`expected indexer idx-001 match; got ${indexerIds.join(", ") || "none"}`);
    }
  }

  if (name === "gmail-cf") {
    if (!matched.includes("deploy-state-verification")) {
      failures.push(
        `expected matchedTriggers to include deploy-state-verification; got ${matched.join(", ") || "none"}`,
      );
    }
    if (!matched.includes("firebase-deploy")) {
      failures.push(`expected matchedTriggers to include firebase-deploy; got ${matched.join(", ") || "none"}`);
    }
    if (!matched.includes("gh-pages-deploy-freshness")) {
      failures.push(
        `expected matchedTriggers to include gh-pages-deploy-freshness; got ${matched.join(", ") || "none"}`,
      );
    }
    if (gateWarnings.length === 0) {
      failures.push("expected gateWarnings for combined Gmail/CF ship to be non-empty");
    }
    const warningText = gateWarnings.join(" ").toLowerCase();
    if (!warningText.includes("functions") && !warningText.includes("revision")) {
      failures.push("expected gate warning to mention Cloud Functions revision verification");
    }
    if (
      !warningText.includes("gh-pages") &&
      !warningText.includes("bundle") &&
      !warningText.includes("sidebar")
    ) {
      failures.push("expected gate warning to mention gh-pages/bundle/sidebar freshness");
    }
    if (!warningText.includes("reply ingest") && !warningText.includes("emailreplyingest")) {
      failures.push("expected gate warning to mention reply ingest enable gate");
    }
  }

  return failures;
}

/** @type {Record<string, ReturnType<typeof runPacket>>} */
const results = {};
/** @type {Record<string, string[]>} */
const assertionFailures = {};

const selectedCases =
  caseFilter === "all"
    ? Object.keys(CASES)
    : caseFilter in CASES
      ? [caseFilter]
      : null;

if (!selectedCases) {
  console.error(`Unknown --case ${caseFilter}. Use: positive|negative|indexer|gmail-cf|all`);
  process.exit(1);
}

for (const name of selectedCases) {
  const tags = name === "indexer" ? ["agent-lessons"] : [];
  const merged = runPacket(CASES[name], tags);
  results[name] = merged;
  if (assertMode || caseFilter === "all" || selectedCases.length === 1) {
    assertionFailures[name] = assertCase(name, merged);
  }
}

const allFailures = Object.entries(assertionFailures).flatMap(([name, fs]) =>
  fs.map((f) => `[${name}] ${f}`),
);

if (format === "markdown") {
  for (const name of selectedCases) {
    process.stdout.write(`\n---\n# Demo case: ${name}\n\n`);
    process.stdout.write(renderAwayNextPacketMarkdown({ ...results[name], _demo: true, _case: name }));
  }
  if (allFailures.length) {
    process.stderr.write(`\nASSERT FAILURES:\n${allFailures.map((f) => `  ✗ ${f}`).join("\n")}\n`);
    process.exit(1);
  }
  process.exit(0);
}

const payload = {
  _demo: true,
  _note: "Mock queue items — run npm run away:next -- --packet when a real queued head exists",
  cases: results,
  assertions: assertionFailures,
  ok: allFailures.length === 0,
};

console.log(JSON.stringify(payload, null, 2));

if (allFailures.length) {
  console.error(`\nindexer:demo-packet ASSERT FAILED (${allFailures.length}):\n`);
  for (const f of allFailures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

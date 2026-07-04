#!/usr/bin/env node
/**
 * Demo away:next --packet with mock queue item (queue may be empty post-batch).
 * Run: npm run indexer:demo-packet [--format markdown]
 */
import {
  buildAwayNextPacket,
  renderAwayNextPacketMarkdown,
} from "./lib/context-packet-lib.mjs";

const args = process.argv.slice(2);
const formatIdx = args.indexOf("--format");
const format = formatIdx >= 0 ? args[formatIdx + 1] : "json";

/** Mock item — matches idx-001 trigger terms + type/subtype */
const mockItem = {
  id: "away-demo-indexer",
  title: "Mini-librarian indexer retrieval test",
  scope: "Extend context packet with indexer-memory deterministic retrieval for service-logic/indexer tasks",
  type: "service-logic",
  subtype: "indexer",
  tier: "T1",
  status: "queued",
  dependsOn: null,
  acceptance: "away:validate OK; away:next --packet includes indexerMemory entries",
};

const merged = buildAwayNextPacket({
  tags: ["agent-lessons"],
  list: { queue: [mockItem], executionProtocol: { sequence: [mockItem.id] } },
  archive: { items: [] },
});

const payload = {
  ...merged,
  _demo: true,
  _note: "Mock queue item — run npm run away:next -- --packet when a real queued head exists",
};

if (format === "markdown") {
  process.stdout.write(renderAwayNextPacketMarkdown(payload));
  process.exit(0);
}

console.log(JSON.stringify(payload, null, 2));

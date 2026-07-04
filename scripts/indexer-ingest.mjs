#!/usr/bin/env node
/**
 * Intelligent indexer ingestion — classifies into structured memory categories.
 * Run: npm run indexer:ingest -- --summary "..." --category decision --trigger "indexer,context packet" --type service-logic --subtype indexer
 *      npm run indexer:ingest -- --json path/to/input.json [--dry-run] [--apply-gotcha]
 */
import fs from "node:fs";
import {
  INDEXER_CATEGORIES,
  ingestIndexerEntry,
  loadIndexerMemory,
  normalizeIngestInput,
} from "./lib/indexer-ingest-lib.mjs";

const args = process.argv.slice(2);

function usage() {
  console.error(`Usage:
  npm run indexer:ingest -- --summary "text" [--category ${INDEXER_CATEGORIES.slice(0, 3).join("|")}|…]
    [--trigger "term1,term2"] [--type <type>] [--subtype <subtype>]
    [--source-task away-NNN] [--source-commit <hash>] [--tag t1,t2]
    [--slice-file path --slice-start N --slice-end N] [--no-inject] [--promotion]
    [--dry-run] [--apply-gotcha]

  npm run indexer:ingest -- --json path/to/input.json [--dry-run] [--apply-gotcha]
  npm run indexer:ingest -- --list`);
  process.exit(1);
}

function parseFlags() {
  /** @type {Record<string, unknown>} */
  const input = {};

  const summaryIdx = args.indexOf("--summary");
  if (summaryIdx >= 0) input.summary = args[summaryIdx + 1];

  const categoryIdx = args.indexOf("--category");
  if (categoryIdx >= 0) input.category = args[categoryIdx + 1];

  const triggerIdx = args.indexOf("--trigger");
  if (triggerIdx >= 0) input.trigger = args[triggerIdx + 1];

  const typeIdx = args.indexOf("--type");
  if (typeIdx >= 0) input.type = args[typeIdx + 1];

  const subtypeIdx = args.indexOf("--subtype");
  if (subtypeIdx >= 0) input.subtype = args[subtypeIdx + 1];

  const sourceTaskIdx = args.indexOf("--source-task");
  if (sourceTaskIdx >= 0) input.sourceTask = args[sourceTaskIdx + 1];

  const sourceCommitIdx = args.indexOf("--source-commit");
  if (sourceCommitIdx >= 0) input.sourceCommit = args[sourceCommitIdx + 1];

  const tagIdx = args.indexOf("--tag");
  if (tagIdx >= 0) {
    input.tags = String(args[tagIdx + 1] ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }

  const sliceFileIdx = args.indexOf("--slice-file");
  const sliceStartIdx = args.indexOf("--slice-start");
  const sliceEndIdx = args.indexOf("--slice-end");
  if (sliceFileIdx >= 0 && sliceStartIdx >= 0 && sliceEndIdx >= 0) {
    input.slice = {
      file: args[sliceFileIdx + 1],
      startLine: Number.parseInt(args[sliceStartIdx + 1], 10),
      endLine: Number.parseInt(args[sliceEndIdx + 1], 10),
    };
  }

  if (args.includes("--no-inject")) input.injectBeforeWork = false;
  if (args.includes("--promotion")) input.promotionCandidate = true;

  return input;
}

function main() {
  if (args.includes("--list")) {
    const store = loadIndexerMemory();
    console.log(`Indexer memory (${store.entries.length} entries):\n`);
    for (const entry of store.entries) {
      const inject = entry.injectBeforeWork !== false ? "inject" : "lookup-only";
      const terms = (entry.triggerTerms ?? []).slice(0, 3).join(", ");
      console.log(
        `  ${entry.id.padEnd(8)} ${entry.category.padEnd(22)} ${inject.padEnd(12)} ${terms}`,
      );
    }
    console.log(`\nCategories: ${INDEXER_CATEGORIES.join(", ")}`);
    process.exit(0);
  }

  const dryRun = args.includes("--dry-run");
  const applyGotcha = args.includes("--apply-gotcha");

  /** @type {Record<string, unknown>} */
  let input = parseFlags();

  const jsonIdx = args.indexOf("--json");
  if (jsonIdx >= 0) {
    const jsonPath = args[jsonIdx + 1];
    if (!jsonPath || !fs.existsSync(jsonPath)) {
      console.error(`Missing or invalid --json path: ${jsonPath ?? ""}`);
      usage();
    }
    input = { ...input, ...JSON.parse(fs.readFileSync(jsonPath, "utf8")) };
  }

  if (!input.summary) usage();

  const normalized = normalizeIngestInput(input);
  const typeKey =
    normalized.type && normalized.subtype
      ? `${normalized.type}/${normalized.subtype}`
      : normalized.type ?? undefined;

  const result = ingestIndexerEntry(normalized, {
    dryRun,
    applyGotcha,
    typeKey,
    bullet: typeof input.bullet === "string" ? input.bullet : undefined,
  });

  console.log(JSON.stringify({ normalized, result }, null, 2));
  if (!dryRun && result.action !== "gotcha-proposal") {
    console.error("\nRun: npm run away:validate");
  }
}

main();

#!/usr/bin/env node
/**
 * Generic concern → index slice lookup (mini Librarian Indexer v1).
 * Run: npm run context:lookup -- --concern "vendor receive"
 *      npm run context:lookup -- --list
 */
import fs from "node:fs";
import {
  CONTEXT_INDEX_PATH,
  findByTag,
  loadDossierIndex,
  sliceEntry,
} from "./lib/dossier-index-lib.mjs";
import { readJson, readText, REPO_ROOT } from "./lib/away-memory-lib.mjs";
import path from "node:path";

const args = process.argv.slice(2);

/** @param {string} query @param {{ concern: string, aliases?: string[] }} row */
function matchesConcern(query, row) {
  const q = query.toLowerCase();
  if (row.concern.toLowerCase().includes(q) || q.includes(row.concern.toLowerCase())) return true;
  for (const alias of row.aliases ?? []) {
    if (alias.toLowerCase().includes(q) || q.includes(alias.toLowerCase())) return true;
  }
  return false;
}

function printList(contextIndex) {
  console.log("Context index — concerns:\n");
  for (const row of contextIndex.concerns) {
    const tags = (row.dossierTags ?? []).join(", ") || "(files only)";
    console.log(`  ${row.concern.padEnd(22)} tags: ${tags}`);
  }
  console.log('\nUsage: npm run context:lookup -- --concern "vendor receive"');
}

function main() {
  if (!fs.existsSync(CONTEXT_INDEX_PATH)) {
    console.error("context-index.json not found");
    process.exit(1);
  }
  const contextIndex = readJson(CONTEXT_INDEX_PATH);

  if (args.includes("--list") || args.length === 0) {
    printList(contextIndex);
    process.exit(0);
  }

  const concernIdx = args.indexOf("--concern");
  if (concernIdx < 0) {
    console.error('Use --concern "…" or --list');
    process.exit(1);
  }
  const query = args[concernIdx + 1];
  if (!query) {
    console.error("Missing value for --concern");
    process.exit(1);
  }

  const row = contextIndex.concerns.find((c) => matchesConcern(query, c));
  if (!row) {
    console.error(`No concern match for: ${query}\n`);
    printList(contextIndex);
    process.exit(1);
  }

  console.log(`# Concern: ${row.concern}`);
  if (row.command) console.log(`Command: ${row.command}`);
  if (row.files?.length) {
    console.log("Files:");
    for (const f of row.files) console.log(`  ${f}`);
  }
  console.log("");

  const dossierIndex = loadDossierIndex();
  const printed = new Set();
  for (const tag of row.dossierTags ?? []) {
    const entry = findByTag(dossierIndex, tag);
    if (!entry) {
      console.warn(`WARN: dossier tag not in index: ${tag}`);
      continue;
    }
    if (printed.has(entry.id)) continue;
    printed.add(entry.id);
    console.log(`--- ${entry.file}:${entry.startLine}-${entry.endLine} (${entry.id}) ---`);
    console.log(sliceEntry(entry));
    console.log("");
  }

  for (const rel of row.files ?? []) {
    const filePath = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(filePath)) continue;
    const text = readText(filePath);
    const lines = text.split("\n");
    const maxLines = 30;
    if (lines.length <= maxLines) continue;
    console.log(`--- ${rel} (first ${maxLines} lines; use Read tool for full file) ---`);
    console.log(lines.slice(0, maxLines).join("\n"));
    console.log("");
  }
}

main();

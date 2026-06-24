#!/usr/bin/env node
/**
 * Print one MODEL_DOSSIER § slice by tag or id (index-first retrieval).
 * Run: npm run dossier:slice -- --tag agent-lessons
 *      npm run dossier:slice -- --id qr-routing
 *      npm run dossier:slice -- --list
 */
import {
  allTags,
  findById,
  findByTag,
  loadDossierIndex,
  sliceEntry,
} from "./lib/dossier-index-lib.mjs";

const args = process.argv.slice(2);

function printList(index) {
  const tagMap = allTags(index);
  const tags = [...tagMap.keys()].sort();
  console.log("Dossier index — available tags:\n");
  for (const tag of tags) {
    const entry = tagMap.get(tag);
    console.log(`  ${tag.padEnd(28)} → ${entry.id} (${entry.file}:${entry.startLine}-${entry.endLine})`);
  }
  console.log(`\nEntries: ${index.entries.length} | Tags: ${tags.length}`);
  console.log("\nUsage: npm run dossier:slice -- --tag <tag>");
  console.log("       npm run dossier:slice -- --id <id>");
}

function main() {
  const index = loadDossierIndex();

  if (args.includes("--list") || args.length === 0) {
    printList(index);
    process.exit(0);
  }

  const tagIdx = args.indexOf("--tag");
  const idIdx = args.indexOf("--id");

  /** @type {import('./lib/dossier-index-lib.mjs').DossierEntry | null} */
  let entry = null;

  if (tagIdx >= 0) {
    const tag = args[tagIdx + 1];
    if (!tag) {
      console.error("Missing value for --tag");
      process.exit(1);
    }
    entry = findByTag(index, tag);
    if (!entry) {
      console.error(`Tag not found: ${tag}\n`);
      printList(index);
      process.exit(1);
    }
  } else if (idIdx >= 0) {
    const id = args[idIdx + 1];
    if (!id) {
      console.error("Missing value for --id");
      process.exit(1);
    }
    entry = findById(index, id);
    if (!entry) {
      console.error(`Id not found: ${id}\n`);
      printList(index);
      process.exit(1);
    }
  } else {
    console.error("Use --tag <tag>, --id <id>, or --list");
    process.exit(1);
  }

  try {
    process.stdout.write(sliceEntry(entry));
    if (!process.stdout.write("\n")) {
      // ensure trailing newline
    }
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  }
}

main();

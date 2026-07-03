#!/usr/bin/env node
/**
 * Context Packet Builder lite — hot tier pointers + dossier § slices + optional queue head.
 * Run: npm run context:packet -- --tags agent-lessons,qr-routing
 *      npm run context:packet -- --tags agent-lessons --format markdown
 *      npm run context:packet -- --tags agent-lessons --queue
 */
import {
  buildContextPacket,
  renderPacketMarkdown,
} from "./lib/context-packet-lib.mjs";

const args = process.argv.slice(2);

function usage() {
  console.error(`Usage: npm run context:packet -- --tags <tag1,tag2> [--format json|markdown] [--queue]`);
  process.exit(1);
}

function parseTags(argv) {
  const idx = argv.indexOf("--tags");
  if (idx < 0 || !argv[idx + 1]) return null;
  return argv[idx + 1]
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function main() {
  const tags = parseTags(args);
  if (!tags || tags.length === 0) {
    console.error("Missing --tags (comma-separated dossier or context-index tags)\n");
    usage();
  }

  const formatIdx = args.indexOf("--format");
  const format = formatIdx >= 0 ? args[formatIdx + 1] : "json";
  if (format !== "json" && format !== "markdown") {
    console.error('Use --format json or --format markdown');
    process.exit(1);
  }

  const includeQueue = args.includes("--queue");
  const packet = buildContextPacket({ tags, includeQueue });

  if (format === "markdown") {
    process.stdout.write(renderPacketMarkdown(packet));
    return;
  }

  console.log(JSON.stringify(packet, null, 2));
}

main();

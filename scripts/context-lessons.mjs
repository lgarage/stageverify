#!/usr/bin/env node
/**
 * Slice LIBRARIAN_LESSONS § by estimate-log type/subtype.
 * Run: npm run context:lessons -- --type ui-component/drawer-copy
 *      npm run context:lessons -- --section dispatcher-ui
 *      npm run context:lessons -- --list
 */
import {
  buildLessonsSliceResult,
  findSectionById,
  loadLessonsIndex,
  renderLessonsSliceMarkdown,
  resolveSectionForTypeKey,
  sliceSectionRaw,
} from "./lib/librarian-lessons-lib.mjs";

const args = process.argv.slice(2);

function usage() {
  console.error(`Usage: npm run context:lessons -- --type <type>/<subtype> [--format json|markdown|text]
       npm run context:lessons -- --section <sectionId> [--format json|markdown|text]
       npm run context:lessons -- --list`);
  process.exit(1);
}

function printList(index) {
  console.log("Librarian lessons index — type/subtype → section:\n");
  for (const entry of index.entries ?? []) {
    console.log(
      `  ${`${entry.type}/${entry.subtype}`.padEnd(36)} → ${entry.sectionId}`,
    );
  }
  console.log("\nSections:");
  for (const section of index.sections ?? []) {
    console.log(
      `  ${section.id.padEnd(18)} ${section.title} (${index.file ?? "PROJECT_STATUS/LIBRARIAN_LESSONS.md"}:${section.startLine}-${section.endLine})`,
    );
  }
  console.log(`\nEntries: ${index.entries?.length ?? 0} | Sections: ${index.sections?.length ?? 0}`);
  console.log("\nUsage: npm run context:lessons -- --type ui-component/drawer-copy");
}

function parseFormat(argv) {
  const formatIdx = argv.indexOf("--format");
  const format = formatIdx >= 0 ? argv[formatIdx + 1] : "text";
  if (!["json", "markdown", "text"].includes(format)) {
    console.error("Use --format json, markdown, or text");
    process.exit(1);
  }
  return format;
}

function main() {
  const index = loadLessonsIndex();

  if (args.includes("--list") || args.length === 0) {
    printList(index);
    process.exit(0);
  }

  const typeIdx = args.indexOf("--type");
  const sectionIdx = args.indexOf("--section");
  const format = parseFormat(args);

  /** @type {string | null} */
  let typeKey = null;
  /** @type {import('./lib/librarian-lessons-lib.mjs').LessonsSection | null} */
  let section = null;

  if (typeIdx >= 0) {
    typeKey = args[typeIdx + 1];
    if (!typeKey) usage();
    section = resolveSectionForTypeKey(index, typeKey);
    if (!section) {
      console.error(`Type key not found: ${typeKey}\n`);
      printList(index);
      process.exit(1);
    }
  } else if (sectionIdx >= 0) {
    const sectionId = args[sectionIdx + 1];
    if (!sectionId) usage();
    section = findSectionById(index, sectionId);
    typeKey = sectionId;
    if (!section) {
      console.error(`Section not found: ${sectionId}\n`);
      printList(index);
      process.exit(1);
    }
  } else {
    usage();
  }

  const file = index.file ?? "PROJECT_STATUS/LIBRARIAN_LESSONS.md";
  const result = typeIdx >= 0
    ? buildLessonsSliceResult(index, typeKey)
    : {
        typeKey,
        found: true,
        sectionId: section.id,
        title: section.title,
        file,
        startLine: section.startLine,
        endLine: section.endLine,
        sliceCommand: `npm run context:lessons -- --section ${section.id}`,
        excerpt: sliceSectionRaw(section, file),
      };

  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (format === "markdown") {
    process.stdout.write(renderLessonsSliceMarkdown(result));
    return;
  }

  process.stdout.write(result.excerpt ?? "");
  if (!String(result.excerpt ?? "").endsWith("\n")) {
    process.stdout.write("\n");
  }
}

main();

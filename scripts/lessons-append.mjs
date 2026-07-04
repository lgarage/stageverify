#!/usr/bin/env node
/**
 * Append one lesson bullet to LIBRARIAN_LESSONS.md and refresh index line ranges.
 * Run: npm run lessons:append -- --type ui-component/drawer-copy --bullet "Short lesson text"
 */
import { appendLessonBullet } from "./lib/librarian-lessons-lib.mjs";

const args = process.argv.slice(2);

function usage() {
  console.error(`Usage: npm run lessons:append -- --type <type>/<subtype> --bullet "one line lesson" [--dry-run]`);
  process.exit(1);
}

function main() {
  const typeIdx = args.indexOf("--type");
  const bulletIdx = args.indexOf("--bullet");
  if (typeIdx < 0 || bulletIdx < 0) usage();

  const typeKey = args[typeIdx + 1];
  const bullet = args[bulletIdx + 1];
  if (!typeKey || !bullet) usage();

  const dryRun = args.includes("--dry-run");
  const result = appendLessonBullet({ typeKey, bullet, dryRun });

  console.log(
    dryRun
      ? `lessons-append (dry-run): would insert at line ${result.insertAt} in ${result.section}`
      : `lessons-append: added to ${result.section} at line ${result.insertAt}`,
  );
  console.log(`  ${result.bulletLine}`);
  console.log("Run: npm run away:validate");
}

main();

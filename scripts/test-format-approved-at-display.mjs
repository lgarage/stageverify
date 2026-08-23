/**
 * Unit tests — Approved invoices date + 24-hour time formatter.
 * Usage: npx tsx scripts/test-format-approved-at-display.mjs
 */
import { formatApprovedAtDisplay } from "../src/dispatcher/invoice/invoiceReviewHeaderHelpers.ts";

let failed = 0;

function assert(cond, message) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${message}`);
    return;
  }
  console.log(`PASS: ${message}`);
}

function localStamp(year, monthIndex, day, hour, minute) {
  return new Date(year, monthIndex, day, hour, minute, 0, 0).toISOString();
}

function expectedDatePart(d) {
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const DATE_TIME_RE = /^[A-Z][a-z]{2} \d{1,2}, \d{4} \d{2}:\d{2}$/;
const DATE_ONLY_RE = /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/;

{
  const iso = localStamp(2026, 7, 22, 21, 42);
  const d = new Date(iso);
  const got = formatApprovedAtDisplay(iso);
  assert(got === `${expectedDatePart(d)} 21:42`, `evening 21:42 → ${got}`);
  assert(DATE_TIME_RE.test(got), `evening matches MMM D, YYYY HH:mm (${got})`);
  assert(!/\b(?:AM|PM)\b/i.test(got), "evening has no AM/PM");
}

{
  const iso = localStamp(2026, 7, 22, 13, 5);
  const got = formatApprovedAtDisplay(iso);
  assert(got.endsWith(" 13:05"), `afternoon 13:05 zero-padded minutes → ${got}`);
  assert(!/\b(?:AM|PM)\b/i.test(got), "afternoon has no AM/PM");
}

{
  const iso = localStamp(2026, 7, 22, 0, 7);
  const got = formatApprovedAtDisplay(iso);
  assert(got.endsWith(" 00:07"), `midnight 00:07 → ${got}`);
}

{
  const iso = localStamp(2026, 7, 22, 9, 4);
  const got = formatApprovedAtDisplay(iso);
  assert(got.endsWith(" 09:04"), `minutes/hours below 10 are zero-padded → ${got}`);
}

{
  const morning = localStamp(2026, 7, 22, 8, 15);
  const evening = localStamp(2026, 7, 22, 21, 42);
  const a = formatApprovedAtDisplay(morning);
  const b = formatApprovedAtDisplay(evening);
  assert(a !== b, `same-day times differ (${a} vs ${b})`);
  assert(a.endsWith(" 08:15") && b.endsWith(" 21:42"), "same-day 08:15 vs 21:42");
}

{
  const fallback = localStamp(2026, 7, 10, 16, 30);
  const fallbackDate = expectedDatePart(new Date(fallback));
  const got = formatApprovedAtDisplay(undefined, fallback);
  assert(got === fallbackDate, `missing approvedAt is date-only fallback → ${got}`);
  assert(DATE_ONLY_RE.test(got), "legacy/missing timestamp has no fabricated time");
  assert(!/\d{2}:\d{2}/.test(got), "legacy fallback omits HH:mm");
}

{
  const fallback = localStamp(2026, 7, 10, 16, 30);
  const got = formatApprovedAtDisplay("not-a-timestamp", fallback);
  assert(
    got === expectedDatePart(new Date(fallback)),
    `invalid approvedAt is date-only fallback → ${got}`,
  );
}

{
  assert(formatApprovedAtDisplay(undefined) === "—", "no approvedAt and no fallback → em dash");
}

{
  const iso = "2026-08-22T21:42:00.000Z";
  const got = formatApprovedAtDisplay(iso);
  assert(DATE_TIME_RE.test(got), `ISO string formats locally (${got})`);
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  assert(got === `${expectedDatePart(d)} ${hh}:${mm}`, `UTC ISO uses local clock ${got}`);
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll formatApprovedAtDisplay tests passed");

/**
 * Offline tests for Gmail inbound catch-up helpers.
 * Run: npx tsx scripts/test-gmail-inbound-catchup.mjs
 */
import {
  applyCatchUpCap,
  buildInboxCatchUpQuery,
  DEFAULT_LOOKBACK_SECONDS,
  isGmailListingComplete,
  LIST_CAP,
  oldestFirstInboxIds,
  OVERLAP_SECONDS,
  PROCESS_CAP,
  shouldAdvanceInboundSyncCursor,
} from "../functions/src/inboundEmail/gmailInboundCatchUp.ts";

let passed = 0;
let failed = 0;

function pass(label) {
  passed += 1;
  console.log(`PASS: ${label}`);
}

function fail(label, detail) {
  failed += 1;
  console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
}

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    pass(label);
  } else {
    fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(haystack, needle, label) {
  if (haystack.includes(needle)) {
    pass(label);
  } else {
    fail(label, `expected to include ${JSON.stringify(needle)} in ${JSON.stringify(haystack)}`);
  }
}

const FIXED_NOW = Date.parse("2026-04-10T12:00:00.000Z");
const LAST_SYNC = "2026-04-10T10:00:00.000Z";

{
  const q = buildInboxCatchUpQuery({
    lastSyncAt: LAST_SYNC,
    replyEnabled: false,
    nowMs: FIXED_NOW,
  });
  const expectedAfter = Math.floor(
    (Date.parse(LAST_SYNC) - OVERLAP_SECONDS * 1000) / 1000,
  );
  assertIncludes(q, `after:${expectedAfter}`, "after: from lastSyncAt minus 2h overlap");
  assertIncludes(q, "has:attachment filename:pdf in:inbox", "pdf inbox clause when reply disabled");
  if (!q.includes("-has:attachment")) {
    pass("no reply-only clause when reply disabled");
  } else {
    fail("no reply-only clause when reply disabled");
  }
}

{
  const q = buildInboxCatchUpQuery({
    lastSyncAt: undefined,
    replyEnabled: false,
    nowMs: FIXED_NOW,
  });
  const expectedAfter = Math.floor((FIXED_NOW - DEFAULT_LOOKBACK_SECONDS * 1000) / 1000);
  assertIncludes(q, `after:${expectedAfter}`, "missing lastSyncAt uses 7d lookback");
}

{
  const q = buildInboxCatchUpQuery({
    lastSyncAt: LAST_SYNC,
    replyEnabled: true,
    nowMs: FIXED_NOW,
  });
  assertIncludes(
    q,
    "in:inbox (has:attachment filename:pdf OR -has:attachment)",
    "replyEnabled widens inbox query",
  );
}

{
  const ids = Array.from({ length: 50 }, (_, i) => `msg-${i}`);
  const { processNow, remainderCount } = applyCatchUpCap({ listedIds: ids, cap: PROCESS_CAP });
  assertEqual(processNow.length, PROCESS_CAP, "applyCatchUpCap processes first 40");
  assertEqual(remainderCount, 10, "applyCatchUpCap remainder 10 when 50 listed");
}

{
  const listed = ["a", "b", "a", "c", "b", "d"];
  const { processNow, remainderCount } = applyCatchUpCap({
    listedIds: listed,
    cap: 3,
  });
  assertEqual(processNow.join(","), "a,b,c", "unique-preserve order in cap");
  assertEqual(remainderCount, 1, "remainder after unique cap");
}

{
  assertEqual(
    oldestFirstInboxIds(["newest", "middle", "oldest"]).join(","),
    "oldest,middle,newest",
    "oldestFirstInboxIds reverses newest-first to oldest-first",
  );
}

{
  const newestFirst = Array.from({ length: 50 }, (_, i) => `msg-${49 - i}`);
  const oldestFirst = oldestFirstInboxIds(newestFirst);
  const { processNow, remainderCount } = applyCatchUpCap({
    listedIds: oldestFirst,
    cap: PROCESS_CAP,
  });
  assertEqual(processNow[0], "msg-0", "cap after oldest-first: processNow starts with oldest");
  assertEqual(processNow[processNow.length - 1], "msg-39", "cap after oldest-first: 40th is msg-39");
  assertEqual(remainderCount, 10, "cap after oldest-first: remainder is newest 10 not old tail");
}

{
  assertEqual(
    isGmailListingComplete({
      listedCount: LIST_CAP,
      listCap: LIST_CAP,
      nextPageToken: undefined,
      emptyPage: false,
    }),
    false,
    "isGmailListingComplete: cap hit false without nextPageToken",
  );
  assertEqual(
    isGmailListingComplete({
      listedCount: LIST_CAP,
      listCap: LIST_CAP,
      nextPageToken: "tok",
      emptyPage: false,
    }),
    false,
    "isGmailListingComplete: cap hit false with nextPageToken",
  );
  assertEqual(
    isGmailListingComplete({
      listedCount: 10,
      listCap: LIST_CAP,
      nextPageToken: null,
      emptyPage: true,
    }),
    true,
    "isGmailListingComplete: empty page + no token => true",
  );
  assertEqual(
    isGmailListingComplete({
      listedCount: 10,
      listCap: LIST_CAP,
      nextPageToken: "tok",
      emptyPage: true,
    }),
    false,
    "isGmailListingComplete: empty page + token => false",
  );
  assertEqual(
    isGmailListingComplete({
      listedCount: 10,
      listCap: LIST_CAP,
      nextPageToken: null,
      emptyPage: false,
    }),
    true,
    "isGmailListingComplete: under cap + no token => true",
  );
}

{
  assertEqual(
    shouldAdvanceInboundSyncCursor({ listingComplete: true, remainderCount: 0 }),
    true,
    "shouldAdvance true when complete and no remainder",
  );
  assertEqual(
    shouldAdvanceInboundSyncCursor({ listingComplete: true, remainderCount: 5 }),
    false,
    "shouldAdvance false when remainder>0",
  );
  assertEqual(
    shouldAdvanceInboundSyncCursor({ listingComplete: false, remainderCount: 0 }),
    false,
    "shouldAdvance false when listing incomplete",
  );
  assertEqual(
    shouldAdvanceInboundSyncCursor({ listingComplete: false, remainderCount: 3 }),
    false,
    "shouldAdvance false when both incomplete and remainder",
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}

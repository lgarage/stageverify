/**
 * Offline unit checks for teach-chat intent + consent helpers.
 * Run: npx tsx scripts/test-teach-ignore-chat.mjs
 */
import assert from "node:assert/strict";
import {
  interpretTeachNote,
  isTeachConsentNo,
  isTeachConsentYes,
} from "../src/dispatcher/invoice/teachIgnoreChat.ts";

assert.equal(isTeachConsentYes("yes"), true);
assert.equal(isTeachConsentYes("YES."), true);
assert.equal(isTeachConsentYes("ignore credits"), false);
assert.equal(isTeachConsentNo("no"), true);

const ignore = interpretTeachNote(
  "Ignore CREDIT/return memos from this vendor from now on",
  "Johnstone",
);
assert.equal(ignore.kind, "ignore_credit_returns");
assert.match(ignore.echo, /Reply yes to confirm/i);

const lesson = interpretTeachNote(
  "When Ship Via is WILL CALL, set fulfillment to will_call_pickup",
  "Johnstone",
);
assert.equal(lesson.kind, "playbook_lesson");

console.log("test-teach-ignore-chat: PASS");

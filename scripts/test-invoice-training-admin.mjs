/**
 * Unit checks for invoice training Admin helpers (no live Firebase).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "functions", "package.json"));

// Compiled JS from functions build
const {
  redactLessonNote,
  isSafeLessonNote,
} = require(path.join(root, "functions/lib/invoice/aiShadow/redactLessonNote.js"));
const {
  sanitizeVendorKey,
} = require(path.join(root, "functions/lib/invoice/aiShadow/vendorTrainingMd.js"));
const { hashPinForStorage } = require(path.join(root, "functions/lib/pinHashing.js"));
const { pinMatches } = require(path.join(root, "functions/lib/pinMatching.js"));

const safe = redactLessonNote(
  "When Ship Via is WILL CALL, set fulfillment to will_call_pickup",
);
assert.equal(isSafeLessonNote(safe), true);

assert.equal(isSafeLessonNote(""), false);
assert.equal(isSafeLessonNote("keep 1234567 digits"), false);

assert.equal(sanitizeVendorKey("Johnstone Supply"), "johnstone-supply");
assert.ok(!sanitizeVendorKey("Johnstone Supply").includes("/"));
assert.ok(!sanitizeVendorKey("a/b\\c").includes("/"));
assert.ok(!sanitizeVendorKey("a/b\\c").includes("\\"));

const password = "test-admin-pass";
const stored = hashPinForStorage(password);
assert.equal(pinMatches({ pinHash: stored }, password), true);
assert.equal(pinMatches({ pinHash: stored }, "wrong-password"), false);

const {
  isArmableVendorKey,
  ignoreRuleDocId,
  fingerprintFromImport,
} = require(path.join(
  root,
  "functions/lib/invoice/aiShadow/vendorIgnoreRules.js",
));
assert.equal(isArmableVendorKey("johnstone"), true);
assert.equal(isArmableVendorKey("unknown-vendor"), false);
assert.equal(isArmableVendorKey(""), false);

const fp = fingerprintFromImport({
  vendorKey: "Johnstone Supply",
  parserFormatId: "johnstone",
  importRow: {
    parsedHeader: { vendorInvoiceNumber: "123" },
    parsedLines: [],
    orderNotes: [],
    pageId: "page-1",
  },
});
assert.equal(fp.documentType, "invoice");
assert.equal(
  ignoreRuleDocId(fp),
  "johnstone-supply__johnstone__invoice",
);

const creditFp = fingerprintFromImport({
  vendorKey: "johnstone",
  parserFormatId: "johnstone",
  importRow: {
    parsedHeader: { vendorBranchName: "CREDIT" },
    parsedLines: [],
    orderNotes: [],
    pageId: "page-2",
  },
});
assert.equal(creditFp.documentType, "credit_memo");

console.log("test-invoice-training-admin: PASS");

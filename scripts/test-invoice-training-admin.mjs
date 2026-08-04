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
  isArmableFingerprint,
  ignoreRuleDocId,
  fingerprintFromImport,
} = require(path.join(
  root,
  "functions/lib/invoice/aiShadow/vendorIgnoreRules.js",
));
const {
  armableFingerprintError,
  computeEchoToken,
  extractSenderDomain,
} = require(path.join(root, "functions/lib/invoice/vendorIgnoreEcho.js"));
const {
  shouldApplyNowDismissCreditImport,
} = require(path.join(root, "functions/lib/invoice/creditReturnSkip.js"));
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

assert.equal(isArmableFingerprint(fp), false);
assert.equal(isArmableFingerprint(creditFp), true);
assert.match(
  armableFingerprintError(fp),
  /look like invoices/i,
);
assert.equal(
  armableFingerprintError({
    vendorKey: "johnstone",
    parserFormatId: "unknown",
    documentType: "credit_memo",
  }),
  "Cannot ignore documents with an unknown parser format — resolve the format first.",
);
assert.equal(
  armableFingerprintError({
    vendorKey: "johnstone",
    parserFormatId: "johnstone",
    documentType: "unknown",
  }),
  "Cannot ignore documents with an unknown type — the document must be classifiable first.",
);

assert.equal(extractSenderDomain("Vendor <orders@johnstonesupply.com>"), "johnstonesupply.com");
assert.equal(extractSenderDomain(""), null);

const tokenA = computeEchoToken({
  importId: "imp-1",
  vendorKey: "johnstone",
  parserFormatId: "johnstone",
  documentType: "credit_memo",
  senderDomains: ["johnstonesupply.com"],
  importUpdatedAt: "2026-08-03T12:00:00.000Z",
});
const tokenB = computeEchoToken({
  importId: "imp-1",
  vendorKey: "johnstone",
  parserFormatId: "johnstone",
  documentType: "credit_memo",
  senderDomains: ["johnstonesupply.com"],
  importUpdatedAt: "2026-08-03T12:00:01.000Z",
});
assert.notEqual(tokenA, tokenB);
assert.equal(tokenA.length, 64);

assert.equal(
  shouldApplyNowDismissCreditImport("ignore CREDIT from now on", {
    parsedHeader: { vendorBranchName: "Main" },
    parsedLines: [],
    orderNotes: [],
  }),
  false,
);

console.log("test-invoice-training-admin: PASS");

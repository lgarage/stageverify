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
  vendorIgnoresFingerprint,
  upsertVendorIgnoreRule,
  activateVendorIgnoreRuleDoc,
  isDomainGraceActive,
  isDomainGraceExpired,
  DOMAIN_GRACE_MS,
} = require(path.join(
  root,
  "functions/lib/invoice/aiShadow/vendorIgnoreRules.js",
));
const {
  armableFingerprintError,
  computeEchoToken,
  extractSenderDomain,
  normalizeSenderDomains,
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

assert.deepEqual(
  normalizeSenderDomains(["orders@johnstonesupply.com", "vendor.com"]),
  ["johnstonesupply.com", "vendor.com"],
);
assert.deepEqual(normalizeSenderDomains(["  BAD HOST ", ""]), []);
assert.deepEqual(
  normalizeSenderDomains(["user@evil.com\nX-Header: injected"]),
  [],
  "newline/injection in email domain must not pass normalizeSenderDomains",
);

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

// D-59 P2: status enum + matching only when active
assert.equal(isArmableFingerprint(creditFp), true);
const creditId = ignoreRuleDocId(creditFp);

// Mock Firestore for vendorIgnoresFingerprint status + domain gate
class MockDoc {
  constructor(id, data) {
    this.id = id;
    this._data = data;
    this.exists = data != null;
  }
  data() {
    return this._data;
  }
}
class MockDocRef {
  constructor(id, store) {
    this.id = id;
    this._store = store;
  }
  async get() {
    const data = this._store[this.id];
    return new MockDoc(this.id, data ?? null);
  }
  async set(payload, opts) {
    const prev = this._store[this.id] ?? {};
    if (opts?.merge) {
      const next = { ...prev };
      for (const [k, v] of Object.entries(payload)) {
        if (v && typeof v === "object" && v._delete) {
          delete next[k];
        } else {
          next[k] = v;
        }
      }
      this._store[this.id] = next;
    } else {
      this._store[this.id] = payload;
    }
  }
}
class MockCollection {
  constructor(docs) {
    this._docs = docs;
  }
  doc(id) {
    return new MockDocRef(id, this._docs);
  }
}
class MockDb {
  constructor(docs) {
    this._docs = docs;
  }
  collection() {
    return new MockCollection(this._docs);
  }
}

const proposedDoc = {
  vendorKey: "johnstone",
  parserFormatId: "johnstone",
  documentType: "credit_memo",
  status: "proposed",
  enabled: false,
  taughtBy: "u1",
  taughtAt: "2026-01-01",
  updatedAt: "2026-01-01",
  updatedBy: "u1",
  label: "Credit memo · johnstone",
};
const activeDoc = {
  ...proposedDoc,
  status: "active",
  enabled: true,
  senderDomains: ["johnstonesupply.com"],
};

assert.equal(
  await vendorIgnoresFingerprint(new MockDb({ [creditId]: proposedDoc }), creditFp),
  false,
  "proposed never matches",
);
assert.equal(
  await vendorIgnoresFingerprint(
    new MockDb({ [creditId]: activeDoc }),
    creditFp,
    "Vendor <orders@johnstonesupply.com>",
  ),
  true,
  "active with matching domain matches",
);
assert.equal(
  await vendorIgnoresFingerprint(
    new MockDb({ [creditId]: activeDoc }),
    creditFp,
    "other@foreign-vendor.com",
  ),
  false,
  "foreign domain does not match",
);

const graceActiveDoc = {
  ...proposedDoc,
  status: "active",
  enabled: true,
  domainGraceStartedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
};
assert.equal(
  await vendorIgnoresFingerprint(new MockDb({ [creditId]: graceActiveDoc }), creditFp),
  true,
  "grace in-window matches without domains",
);

const expiredGraceDoc = {
  ...graceActiveDoc,
  domainGraceStartedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
};
assert.equal(
  await vendorIgnoresFingerprint(new MockDb({ [creditId]: expiredGraceDoc }), creditFp),
  false,
  "grace expired does not match",
);
assert.equal(isDomainGraceActive(expiredGraceDoc), false);
assert.equal(isDomainGraceExpired(expiredGraceDoc), true);
assert.equal(DOMAIN_GRACE_MS, 7 * 24 * 60 * 60 * 1000);

const legacyEnabledDoc = {
  vendorKey: "johnstone",
  parserFormatId: "johnstone",
  documentType: "credit_memo",
  enabled: true,
  taughtBy: "u1",
  taughtAt: "2026-01-01",
  updatedAt: "2026-01-01",
  updatedBy: "u1",
  label: "Credit memo · johnstone",
  senderDomains: ["johnstonesupply.com"],
};
assert.equal(
  await vendorIgnoresFingerprint(
    new MockDb({ [creditId]: legacyEnabledDoc }),
    creditFp,
    "orders@johnstonesupply.com",
  ),
  true,
  "grandfather enabled→active with domain matches",
);

// confirm persists senderDomains via upsert (proposed)
const upsertDbDocs = {};
const upsertDb = new MockDb(upsertDbDocs);
const upserted = await upsertVendorIgnoreRule(upsertDb, {
  fingerprint: creditFp,
  status: "proposed",
  uid: "u-propose",
  senderDomains: ["johnstonesupply.com"],
});
assert.deepEqual(upserted.senderDomains, ["johnstonesupply.com"]);

// activate zero domains fails
upsertDbDocs[creditId] = { ...proposedDoc };
try {
  await activateVendorIgnoreRuleDoc(upsertDb, {
    fingerprint: creditFp,
    uid: "mgr",
  });
  assert.fail("activate without domains should throw");
} catch (err) {
  assert.equal(err.message, "domains_required");
}

console.log("test-invoice-training-admin: PASS");

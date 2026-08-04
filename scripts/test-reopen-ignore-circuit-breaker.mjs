/**
 * D-59 P6 — circuit breaker on reopen of document-ignore-skipped imports (unit/mock).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "functions", "package.json"));
const { FieldValue } = require("firebase-admin/firestore");

const {
  qualifiesForCircuitBreakerReopen,
  reopenVendorInvoiceImportCore,
  bulkReopenImportsSkippedByRuleCore,
  CIRCUIT_BREAKER_REOPEN_THRESHOLD,
} = require(path.join(
  root,
  "functions/lib/invoice/aiShadow/reopenIgnoreSkippedImport.js",
));
const { VENDOR_IGNORE_RULES_COLLECTION } = require(path.join(
  root,
  "functions/lib/invoice/aiShadow/vendorIgnoreRules.js",
));

assert.equal(CIRCUIT_BREAKER_REOPEN_THRESHOLD, 2);

assert.equal(
  qualifiesForCircuitBreakerReopen({
    rejectedBy: "system:document_ignore_skip",
    matchedRuleId: "rule-a",
  }),
  true,
);
assert.equal(
  qualifiesForCircuitBreakerReopen({
    rejectedBy: "dispatcher-uid",
    matchedRuleId: "rule-a",
  }),
  false,
);
assert.equal(
  qualifiesForCircuitBreakerReopen({
    rejectedBy: "system:document_ignore_skip",
  }),
  false,
);

function isFieldDelete(value) {
  if (value == null || typeof value !== "object") return false;
  const name = value.constructor?.name;
  return name === "FieldValue" || name === "DeleteTransform";
}

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
  constructor(id, store, collection) {
    this.id = id;
    this._store = store;
    this._collection = collection;
  }
  get() {
    const row = this._store[this._collection]?.[this.id];
    return Promise.resolve(new MockDoc(this.id, row ?? null));
  }
  set(data, opts) {
    if (!this._store[this._collection]) this._store[this._collection] = {};
    const prev = this._store[this._collection][this.id] ?? {};
    this._store[this._collection][this.id] =
      opts?.merge === true ? { ...prev, ...data } : { ...data };
    return Promise.resolve();
  }
  update(data) {
    if (!this._store[this._collection]) this._store[this._collection] = {};
    const prev = this._store[this._collection][this.id] ?? {};
    const next = { ...prev };
    for (const [k, v] of Object.entries(data)) {
      if (isFieldDelete(v)) {
        delete next[k];
      } else {
        next[k] = v;
      }
    }
    this._store[this._collection][this.id] = next;
    return Promise.resolve();
  }
}

function makeMockDb(initial) {
  const store = structuredClone(initial);
  const db = {
    collection(name) {
      return {
        doc(id) {
          return new MockDocRef(id || "auto-id", store, name);
        },
        where(field, op, value) {
          const filters = [{ field, op, value }];
          const api = {
            where(f, o, v) {
              filters.push({ field: f, op: o, value: v });
              return api;
            },
            get() {
              const rows = store[name] ?? {};
              const docs = Object.entries(rows)
                .filter(([, data]) =>
                  filters.every(
                    (f) => f.op === "==" && data[f.field] === f.value,
                  ),
                )
                .map(([id, data]) => new MockDoc(id, data));
              return Promise.resolve({ docs, size: docs.length });
            },
          };
          return api;
        },
      };
    },
    runTransaction(fn) {
      const tx = {
        get(ref) {
          return ref.get();
        },
        update(ref, data) {
          return ref.update(data);
        },
        set(ref, data, opts) {
          return ref.set(data, opts);
        },
      };
      return fn(tx);
    },
    _store: store,
  };
  return db;
}

const ruleId = "johnstone__johnstone__credit_memo";
const importId = "imp-skip-1";
const uid = "manager-uid";

const db1 = makeMockDb({
  vendorInvoiceImports: {
    [importId]: {
      reviewStatus: "rejected",
      rejectedBy: "system:document_ignore_skip",
      skipReason: "document_ignore",
      matchedRuleId: ruleId,
      importStatus: "pending",
      parsedHeader: {},
      parsedLines: [],
      parsedLineCount: 0,
      pageId: "p1",
    },
  },
  [VENDOR_IGNORE_RULES_COLLECTION]: {
    [ruleId]: {
      vendorKey: "johnstone",
      parserFormatId: "johnstone",
      documentType: "credit_memo",
      status: "active",
      enabled: true,
      reopenCount: 0,
    },
  },
});

const result1 = await reopenVendorInvoiceImportCore(db1, {
  importId,
  actorUid: uid,
  now: "2026-08-04T08:00:00.000Z",
});
assert.equal(result1.reopened, true);
assert.equal(result1.reopenCount, 1);
assert.equal(result1.autoDisabled, false);
assert.equal(
  db1._store.vendorInvoiceImports[importId].reviewStatus,
  "pending_review",
);
assert.equal(db1._store.vendorInvoiceImports[importId].matchedRuleId, undefined);
assert.equal(db1._store[VENDOR_IGNORE_RULES_COLLECTION][ruleId].reopenCount, 1);
assert.equal(db1._store[VENDOR_IGNORE_RULES_COLLECTION][ruleId].status, "active");

db1._store.vendorInvoiceImports[importId] = {
  reviewStatus: "rejected",
  rejectedBy: "system:document_ignore_skip",
  skipReason: "document_ignore",
  matchedRuleId: ruleId,
  importStatus: "pending",
  parsedHeader: {},
  parsedLines: [],
  parsedLineCount: 0,
  pageId: "p1",
};

const result2 = await reopenVendorInvoiceImportCore(db1, {
  importId,
  actorUid: uid,
  now: "2026-08-04T08:01:00.000Z",
});
assert.equal(result2.reopenCount, 2);
assert.equal(result2.autoDisabled, true);
assert.equal(db1._store[VENDOR_IGNORE_RULES_COLLECTION][ruleId].status, "disabled");
assert.equal(
  db1._store[VENDOR_IGNORE_RULES_COLLECTION][ruleId].disabledReason,
  "auto_false_positive",
);

const manualId = "imp-manual";
const dbManual = makeMockDb({
  vendorInvoiceImports: {
    [manualId]: {
      reviewStatus: "rejected",
      rejectedBy: uid,
      importStatus: "pending",
      parsedHeader: {},
      parsedLines: [],
      parsedLineCount: 0,
      pageId: "p3",
    },
  },
  [VENDOR_IGNORE_RULES_COLLECTION]: {
    [ruleId]: { status: "active", enabled: true, reopenCount: 0 },
  },
});
const manualResult = await reopenVendorInvoiceImportCore(dbManual, {
  importId: manualId,
  actorUid: uid,
});
assert.equal(manualResult.reopened, true);
assert.equal(manualResult.reopenCount, undefined);
assert.equal(dbManual._store[VENDOR_IGNORE_RULES_COLLECTION][ruleId].reopenCount, 0);

const bulkDb = makeMockDb({
  vendorInvoiceImports: {
    "bulk-1": {
      reviewStatus: "rejected",
      rejectedBy: "system:document_ignore_skip",
      matchedRuleId: ruleId,
      importStatus: "pending",
      parsedHeader: {},
      parsedLines: [],
      parsedLineCount: 0,
      pageId: "b1",
    },
    "bulk-2": {
      reviewStatus: "rejected",
      rejectedBy: "system:document_ignore_skip",
      matchedRuleId: ruleId,
      importStatus: "pending",
      parsedHeader: {},
      parsedLines: [],
      parsedLineCount: 0,
      pageId: "b2",
    },
  },
  [VENDOR_IGNORE_RULES_COLLECTION]: {
    [ruleId]: {
      status: "active",
      enabled: true,
      reopenCount: 0,
      vendorKey: "johnstone",
    },
  },
});

const bulkResult = await bulkReopenImportsSkippedByRuleCore(bulkDb, {
  ruleId,
  actorUid: uid,
});
assert.equal(bulkResult.scanned, 2);
assert.equal(bulkResult.reopened, 2);
assert.equal(bulkResult.autoDisabled, true);
assert.equal(bulkDb._store[VENDOR_IGNORE_RULES_COLLECTION][ruleId].status, "disabled");

console.log("test-reopen-ignore-circuit-breaker: PASS");

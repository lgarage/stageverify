/**
 * Invoice Review Assign Location — fulfillment override + draft staging (in-memory Firestore).
 *
 * Usage: npm run test:invoice-fulfillment-override
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libRoot = path.join(__dirname, "..", "functions", "lib");

const overrideMod = await import(
  pathToFileURL(
    path.join(libRoot, "invoice", "fulfillmentOverride", "setFulfillmentOverrideCore.js"),
  ).href
);
const draftMod = await import(
  pathToFileURL(
    path.join(libRoot, "invoice", "fulfillmentOverride", "setDraftStagingLocationsCore.js"),
  ).href
);
const reconcileMod = await import(
  pathToFileURL(
    path.join(libRoot, "invoice", "reviewChat", "reconcileAfterFieldCorrection.js"),
  ).href
);
const sanitizeMod = await import(
  pathToFileURL(
    path.join(libRoot, "invoice", "fulfillmentOverride", "sharedStagingIdSanitize.js"),
  ).href
);

/** Minimal in-memory Firestore (same pattern as test-invoice-field-correction). */
function createMemoryDb(seed = {}) {
  const store = new Map();
  for (const [k, v] of Object.entries(seed)) {
    store.set(k, structuredClone(v));
  }

  function pathOf(...parts) {
    return parts.join("/");
  }

  function makeDocRef(fullPath) {
    return {
      id: fullPath.split("/").pop(),
      path: fullPath,
      async get() {
        const data = store.get(fullPath);
        return {
          exists: data !== undefined,
          id: this.id,
          data: () => (data === undefined ? undefined : structuredClone(data)),
          ref: this,
        };
      },
      async set(data, opts) {
        if (opts?.merge && store.has(fullPath)) {
          store.set(fullPath, { ...store.get(fullPath), ...structuredClone(data) });
        } else {
          store.set(fullPath, structuredClone(data));
        }
      },
      async update(data) {
        if (!store.has(fullPath)) throw new Error(`missing ${fullPath}`);
        const cur = store.get(fullPath);
        const next = { ...cur };
        for (const [k, v] of Object.entries(data)) {
          if (k.includes(".")) {
            const [a, b] = k.split(".");
            next[a] = { ...(next[a] ?? {}), [b]: v };
          } else {
            next[k] = v;
          }
        }
        store.set(fullPath, next);
      },
      collection(sub) {
        return makeCollection(`${fullPath}/${sub}`);
      },
    };
  }

  function makeCollection(basePath) {
    return {
      doc(id) {
        return makeDocRef(pathOf(basePath, id ?? `auto_${store.size}`));
      },
    };
  }

  return {
    _store: store,
    collection(name) {
      return makeCollection(name);
    },
  };
}

function willCallImportSeed(overrides = {}) {
  return {
    reviewStatus: "pending_review",
    importStatus: "pickup_at_vendor",
    confidenceScore: 88,
    humanReviewRequired: true,
    duplicate: false,
    parserFormatId: "johnstone",
    pageId: "p1",
    parsedHeader: {
      vendorInvoiceNumber: "6168733",
      vendorOrderNumber: "SO9",
      customerPoOrReference: "WILL CALL",
      orderDate: "2026-01-01",
      customerAccountNumber: "12345",
      fulfillmentMethod: "will_call_pickup",
    },
    parsedLines: [
      {
        lineType: "product",
        excludeFromExpectedItems: false,
        quantityOrdered: 2,
        quantityShipped: 2,
        quantityBackordered: 0,
      },
    ],
    parsedLineCount: 1,
    parseWarnings: [],
    autoImportEligible: false,
    importDecisionMode: "review_required",
    suggestedAction: "Review required",
    ...overrides,
  };
}

console.log("test:invoice-fulfillment-override — shared sanitize");
{
  const ids = sanitizeMod.sanitizePlannedStagingLocationIds([
    " z1 ",
    "z1",
    "z2",
    "",
    "x".repeat(200),
  ]);
  assert.equal(ids.length, 2);
  assert.equal(ids[0], "z1");
}

console.log("test:invoice-fulfillment-override — applyFulfillmentOverrideToHeader");
{
  const header = { fulfillmentMethod: "will_call_pickup", vendorInvoiceNumber: "1" };
  const restored = reconcileMod.applyFulfillmentOverrideToHeader(header, {
    active: true,
    fromMethod: "will_call_pickup",
    toMethod: "delivery",
    at: "t",
    by: "u",
  });
  assert.equal(restored.fulfillmentMethod, "delivery");
  const again = reconcileMod.applyFulfillmentOverrideToHeader(
    { fulfillmentMethod: "will_call_pickup" },
    {
      active: true,
      fromMethod: "will_call_pickup",
      toMethod: "delivery",
      at: "t",
      by: "u",
    },
  );
  assert.equal(again.fulfillmentMethod, "delivery");
}

console.log("test:invoice-fulfillment-override — override only from will_call");
{
  const db = createMemoryDb({
    "vendorInvoiceImports/imp-delivery": willCallImportSeed({
      parsedHeader: {
        vendorInvoiceNumber: "1",
        vendorOrderNumber: "2",
        customerPoOrReference: "PO",
        orderDate: "2026-01-01",
        fulfillmentMethod: "delivery",
      },
      importStatus: "pending",
    }),
  });
  await assert.rejects(
    () =>
      overrideMod.runSetInvoiceReviewFulfillmentOverrideCore({
        db,
        uid: "u1",
        vendorInvoiceImportId: "imp-delivery",
        toFulfillmentMethod: "delivery",
        idempotencyKey: "k1",
      }),
    (err) => err.code === "failed-precondition",
  );
}

console.log("test:invoice-fulfillment-override — pickup_at_vendor → pending");
{
  const db = createMemoryDb({
    "vendorInvoiceImports/imp-wc": willCallImportSeed(),
  });
  const result = await overrideMod.runSetInvoiceReviewFulfillmentOverrideCore({
    db,
    uid: "u1",
    vendorInvoiceImportId: "imp-wc",
    toFulfillmentMethod: "delivery",
    idempotencyKey: "k2",
  });
  assert.equal(result.applied, true);
  assert.equal(result.previousImportStatus, "pickup_at_vendor");
  assert.equal(result.importStatus, "pending");
  assert.equal(result.parsedHeader.fulfillmentMethod, "delivery");
  assert.equal(result.fulfillmentOverride.active, true);
  const stored = db._store.get("vendorInvoiceImports/imp-wc");
  assert.equal(stored.originalParsedHeader.fulfillmentMethod, "will_call_pickup");
}

console.log("test:invoice-fulfillment-override — partial/issue importStatus unchanged");
{
  for (const status of ["partial", "issue"]) {
    const db = createMemoryDb({
      [`vendorInvoiceImports/imp-${status}`]: willCallImportSeed({ importStatus: status }),
    });
    const result = await overrideMod.runSetInvoiceReviewFulfillmentOverrideCore({
      db,
      uid: "u1",
      vendorInvoiceImportId: `imp-${status}`,
      toFulfillmentMethod: "delivery",
      idempotencyKey: `k-${status}`,
    });
    assert.equal(result.importStatus, status);
  }
}

console.log("test:invoice-fulfillment-override — idempotent");
{
  const db = createMemoryDb({
    "vendorInvoiceImports/imp-idem": willCallImportSeed(),
  });
  const first = await overrideMod.runSetInvoiceReviewFulfillmentOverrideCore({
    db,
    uid: "u1",
    vendorInvoiceImportId: "imp-idem",
    toFulfillmentMethod: "delivery",
    idempotencyKey: "k-idem",
  });
  const second = await overrideMod.runSetInvoiceReviewFulfillmentOverrideCore({
    db,
    uid: "u1",
    vendorInvoiceImportId: "imp-idem",
    toFulfillmentMethod: "delivery",
    idempotencyKey: "k-idem-2",
  });
  assert.equal(first.applied, true);
  assert.equal(second.alreadyApplied, true);
  assert.equal(second.applied, false);
}

console.log("test:invoice-fulfillment-override — pending_review only");
{
  const db = createMemoryDb({
    "vendorInvoiceImports/imp-approved": willCallImportSeed({ reviewStatus: "approved" }),
  });
  await assert.rejects(
    () =>
      overrideMod.runSetInvoiceReviewFulfillmentOverrideCore({
        db,
        uid: "u1",
        vendorInvoiceImportId: "imp-approved",
        toFulfillmentMethod: "delivery",
        idempotencyKey: "k3",
      }),
    (err) => err.code === "failed-precondition",
  );
}

console.log("test:invoice-fulfillment-override — originalParsedHeader seeded once");
{
  const db = createMemoryDb({
    "vendorInvoiceImports/imp-orig": willCallImportSeed({
      originalParsedHeader: { fulfillmentMethod: "will_call_pickup", kept: true },
    }),
  });
  await overrideMod.runSetInvoiceReviewFulfillmentOverrideCore({
    db,
    uid: "u1",
    vendorInvoiceImportId: "imp-orig",
    toFulfillmentMethod: "delivery",
    idempotencyKey: "k4",
  });
  const stored = db._store.get("vendorInvoiceImports/imp-orig");
  assert.equal(stored.originalParsedHeader.kept, true);
}

console.log("test:invoice-fulfillment-override — draft validates staging docs");
{
  const db = createMemoryDb({
    "vendorInvoiceImports/imp-draft": willCallImportSeed({ importStatus: "pending" }),
    "stagingLocations/loc-a": { code: "A1", active: true },
  });
  const result = await draftMod.runSetInvoiceReviewDraftStagingLocationsCore({
    db,
    uid: "u1",
    vendorInvoiceImportId: "imp-draft",
    stagingLocationIds: ["loc-a"],
  });
  assert.deepEqual(result.draftPlannedStagingLocationIds, ["loc-a"]);
  await assert.rejects(
    () =>
      draftMod.runSetInvoiceReviewDraftStagingLocationsCore({
        db,
        uid: "u1",
        vendorInvoiceImportId: "imp-draft",
        stagingLocationIds: ["missing-loc"],
      }),
    (err) => err.code === "invalid-argument",
  );
}

console.log("test:invoice-fulfillment-override — draft clears on []");
{
  const db = createMemoryDb({
    "vendorInvoiceImports/imp-clear": willCallImportSeed({
      draftPlannedStagingLocationIds: ["loc-a"],
    }),
    "stagingLocations/loc-a": { code: "A1" },
  });
  const result = await draftMod.runSetInvoiceReviewDraftStagingLocationsCore({
    db,
    uid: "u1",
    vendorInvoiceImportId: "imp-clear",
    stagingLocationIds: [],
  });
  assert.deepEqual(result.draftPlannedStagingLocationIds, []);
}

console.log("test:invoice-fulfillment-override — draft never writes stagingLocations occupancy");
{
  const db = createMemoryDb({
    "vendorInvoiceImports/imp-no-occ": willCallImportSeed(),
    "stagingLocations/loc-b": { code: "B2", occupiedBy: null },
  });
  await draftMod.runSetInvoiceReviewDraftStagingLocationsCore({
    db,
    uid: "u1",
    vendorInvoiceImportId: "imp-no-occ",
    stagingLocationIds: ["loc-b"],
  });
  const loc = db._store.get("stagingLocations/loc-b");
  assert.equal(loc.occupiedBy, null);
  assert.equal(Object.keys(loc).length, 2);
}

console.log("\ntest:invoice-fulfillment-override: PASS");

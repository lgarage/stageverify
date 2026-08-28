/**
 * Business-invoice resend idempotency — pure helpers + mock-tx claim races.
 * Cases: identity refuse, fingerprint exact/revision, vendor isolation,
 * same-message multipage, concurrent claim winner, approve ownership redirect.
 *
 * Usage: npm run test:business-invoice-idempotency
 */
import assert from "node:assert/strict";
import {
  businessInvoiceContentFingerprint,
  businessInvoiceKeyDocId,
  claimOrLinkBusinessInvoiceWithSnap,
  isDeliveryOwnedForBusinessInvoiceApprove,
  normalizeBusinessInvoiceNumber,
  resolveVendorScopeForBusinessIdentity,
  tryBuildBusinessInvoiceIdentity,
} from "../functions/lib/invoice/businessInvoiceIdentity.js";
import {
  DUPLICATE_BUSINESS_INVOICE_SKIP_REASON,
  duplicateBusinessInvoiceSkipFields,
  isSystemAutoRejectedImport,
  isSystemIgnoreSkipReason,
} from "../functions/lib/invoice/creditReturnSkip.js";

let passed = 0;
let failed = 0;

function pass(name) {
  passed += 1;
  console.log(`PASS ${name}`);
}

function fail(name, detail) {
  failed += 1;
  console.error(`FAIL ${name}`, detail ?? "");
}

function sampleLines(overrides = {}) {
  return [
    {
      lineNumber: 1,
      quantityOrdered: 2,
      quantityShipped: 2,
      quantityBackordered: 0,
      vendorProductNumber: "SKU-A",
      description: "Widget",
      filteredNotes: [],
      lineType: "product",
      excludeFromExpectedItems: false,
      ...overrides,
    },
  ];
}

// --- 1. Normalization + refuse ---
{
  assert.equal(normalizeBusinessInvoiceNumber(" 6167419 "), "6167419");
  const ok = resolveVendorScopeForBusinessIdentity({
    detectedVendorName: "Johnstone Supply",
    parserFormatId: "johnstone",
  });
  assert.equal(ok.ok, true);
  const unknown = resolveVendorScopeForBusinessIdentity({
    detectedVendorName: "",
    parserFormatId: "unknown",
  });
  assert.equal(unknown.ok, false);
  const weak = tryBuildBusinessInvoiceIdentity({
    detectedVendorName: "Johnstone",
    parserFormatId: "johnstone",
    vendorInvoiceNumber: "NOPE",
    parsedLines: sampleLines(),
  });
  // "NOPE" has no digit → refuse
  assert.equal(weak, null);
  const unknownVendor = tryBuildBusinessInvoiceIdentity({
    parserFormatId: "unknown",
    vendorInvoiceNumber: "6167419",
    parsedLines: sampleLines(),
  });
  assert.equal(unknownVendor, null);
  pass("1 identity refuse weak invoice / unknown-vendor");
}

// --- 2. Distinct vendors do not collide ---
{
  const a = tryBuildBusinessInvoiceIdentity({
    detectedVendorName: "Johnstone Supply",
    parserFormatId: "johnstone",
    vendorInvoiceNumber: "6167419",
    parsedLines: sampleLines(),
  });
  const b = tryBuildBusinessInvoiceIdentity({
    detectedVendorName: "First Supply",
    parserFormatId: "first_supply",
    vendorInvoiceNumber: "6167419",
    parsedLines: sampleLines(),
  });
  assert.ok(a && b);
  assert.notEqual(a.keyDocId, b.keyDocId);
  pass("8 tenant/vendor isolation on same invoice number");
}

// --- 3. Fingerprint exact vs revision ---
{
  const inv = "6168008";
  const fp1 = businessInvoiceContentFingerprint({
    normalizedInvoiceNumber: inv,
    parsedLines: sampleLines(),
  });
  const fp2 = businessInvoiceContentFingerprint({
    normalizedInvoiceNumber: inv,
    parsedLines: sampleLines(),
  });
  const fp3 = businessInvoiceContentFingerprint({
    normalizedInvoiceNumber: inv,
    parsedLines: sampleLines({ quantityShipped: 1, quantityBackordered: 1 }),
  });
  const fp4 = businessInvoiceContentFingerprint({
    normalizedInvoiceNumber: inv,
    customerPoOrReference: "PO-OTHER",
    parsedLines: sampleLines(),
  });
  assert.equal(fp1, fp2);
  assert.notEqual(fp1, fp3);
  assert.notEqual(fp1, fp4);
  pass("6 content fingerprint exact vs material revision");
}

// --- 4. Skip reason allowlist ---
{
  const fields = duplicateBusinessInvoiceSkipFields("2026-08-28T00:00:00Z");
  assert.equal(fields.skipReason, DUPLICATE_BUSINESS_INVOICE_SKIP_REASON);
  assert.equal(isSystemIgnoreSkipReason(fields.skipReason), true);
  assert.equal(
    isSystemAutoRejectedImport({
      reviewStatus: "rejected",
      rejectedBy: fields.rejectedBy,
    }),
    true,
  );
  pass("duplicate_business_invoice system-skip allowlist");
}

// --- Mock transaction claim races ---
function makeMockTx(store) {
  return {
    get(ref) {
      const data = store.get(ref.path);
      return Promise.resolve({
        exists: data !== undefined,
        data: () => data,
        ref,
      });
    },
    create(ref, data) {
      if (store.has(ref.path)) {
        const err = new Error("ALREADY_EXISTS");
        err.code = 6;
        throw err;
      }
      store.set(ref.path, { ...data });
    },
    set(ref, data, opts) {
      const prior = store.get(ref.path) ?? {};
      if (opts?.merge) {
        const merged = { ...prior, ...data };
        // Simulate FieldValue.arrayUnion for linked arrays when array-like sentinel absent —
        // tests pass plain arrays when needed.
        store.set(ref.path, merged);
      } else {
        store.set(ref.path, { ...data });
      }
    },
  };
}

function makeDb(store) {
  return {
    collection(name) {
      return {
        doc(id) {
          const path = `${name}/${id}`;
          return {
            path,
            id,
            collection: null,
          };
        },
      };
    },
  };
}

{
  const store = new Map();
  const db = makeDb(store);
  const identity = tryBuildBusinessInvoiceIdentity({
    detectedVendorName: "Johnstone Supply",
    parserFormatId: "johnstone",
    vendorInvoiceNumber: "9990001",
    parsedLines: sampleLines(),
  });
  assert.ok(identity);
  const keyPath = `vendorBusinessInvoiceKeys/${identity.keyDocId}`;
  const keyRef = { path: keyPath, id: identity.keyDocId };

  // First claim wins
  {
    const tx = makeMockTx(store);
    const snap = {
      exists: false,
      data: () => undefined,
      ref: keyRef,
    };
    const outcome = claimOrLinkBusinessInvoiceWithSnap(tx, db, snap, {
      identity,
      reviewId: "vii-msgA-page-1",
      gmailMessageId: "msgA",
      inboundEmailProcessingId: "inbound-msgA",
      now: "2026-08-28T01:00:00Z",
    });
    assert.equal(outcome.kind, "canonical");
    assert.equal(store.get(keyPath).canonicalImportId, "vii-msgA-page-1");
  }

  // Same message multipage
  {
    const tx = makeMockTx(store);
    const snap = {
      exists: true,
      data: () => store.get(keyPath),
      ref: keyRef,
    };
    const outcome = claimOrLinkBusinessInvoiceWithSnap(tx, db, snap, {
      identity,
      reviewId: "vii-msgA-page-2",
      gmailMessageId: "msgA",
      inboundEmailProcessingId: "inbound-msgA",
      now: "2026-08-28T01:01:00Z",
    });
    assert.equal(outcome.kind, "same_message_multipage");
  }

  // New message exact resend
  {
    const tx = makeMockTx(store);
    const snap = {
      exists: true,
      data: () => store.get(keyPath),
      ref: keyRef,
    };
    const outcome = claimOrLinkBusinessInvoiceWithSnap(tx, db, snap, {
      identity,
      reviewId: "vii-msgB-page-1",
      gmailMessageId: "msgB",
      inboundEmailProcessingId: "inbound-msgB",
      now: "2026-08-28T01:02:00Z",
    });
    assert.equal(outcome.kind, "exact_duplicate");
    assert.equal(outcome.canonicalImportId, "vii-msgA-page-1");
  }

  // Material revision
  {
    const revIdentity = tryBuildBusinessInvoiceIdentity({
      detectedVendorName: "Johnstone Supply",
      parserFormatId: "johnstone",
      vendorInvoiceNumber: "9990001",
      parsedLines: sampleLines({ quantityShipped: 0, quantityBackordered: 2 }),
    });
    assert.ok(revIdentity);
    assert.notEqual(revIdentity.contentFingerprint, identity.contentFingerprint);
    const tx = makeMockTx(store);
    const snap = {
      exists: true,
      data: () => store.get(keyPath),
      ref: keyRef,
    };
    const outcome = claimOrLinkBusinessInvoiceWithSnap(tx, db, snap, {
      identity: revIdentity,
      reviewId: "vii-msgC-page-1",
      gmailMessageId: "msgC",
      inboundEmailProcessingId: "inbound-msgC",
      now: "2026-08-28T01:03:00Z",
    });
    assert.equal(outcome.kind, "possible_revision");
  }

  pass("2/5/9 claim: canonical + multipage + exact resend + revision");
}

// Concurrent race: two txs see empty key — only first create sticks in our store model
{
  const store = new Map();
  const db = makeDb(store);
  const identity = tryBuildBusinessInvoiceIdentity({
    detectedVendorName: "Johnstone Supply",
    parserFormatId: "johnstone",
    vendorInvoiceNumber: "race-42",
    parsedLines: sampleLines(),
  });
  assert.ok(identity);
  const keyPath = `vendorBusinessInvoiceKeys/${businessInvoiceKeyDocId(
    identity.vendorScope,
    identity.normalizedInvoiceNumber,
  )}`;
  const keyRef = { path: keyPath, id: identity.keyDocId };

  const tx1 = makeMockTx(store);
  const emptySnap = { exists: false, data: () => undefined, ref: keyRef };
  const o1 = claimOrLinkBusinessInvoiceWithSnap(tx1, db, emptySnap, {
    identity,
    reviewId: "vii-race1-page-1",
    gmailMessageId: "race1",
    inboundEmailProcessingId: "inbound-race1",
    now: "2026-08-28T02:00:00Z",
  });
  assert.equal(o1.kind, "canonical");

  let secondFailed = false;
  try {
    const tx2 = makeMockTx(store);
    // Stale empty snap (race) — create must fail
    claimOrLinkBusinessInvoiceWithSnap(tx2, db, emptySnap, {
      identity,
      reviewId: "vii-race2-page-1",
      gmailMessageId: "race2",
      inboundEmailProcessingId: "inbound-race2",
      now: "2026-08-28T02:00:01Z",
    });
  } catch {
    secondFailed = true;
  }
  assert.equal(secondFailed, true);
  assert.equal(store.get(keyPath).canonicalImportId, "vii-race1-page-1");

  // Retry with fresh snap → exact_duplicate
  const tx3 = makeMockTx(store);
  const freshSnap = {
    exists: true,
    data: () => store.get(keyPath),
    ref: keyRef,
  };
  const o3 = claimOrLinkBusinessInvoiceWithSnap(tx3, db, freshSnap, {
    identity,
    reviewId: "vii-race2-page-1",
    gmailMessageId: "race2",
    inboundEmailProcessingId: "inbound-race2",
    now: "2026-08-28T02:00:02Z",
  });
  assert.equal(o3.kind, "exact_duplicate");
  pass("5 concurrent same-invoice ingest → one canonical winner");
}

// Approve ownership redirect helper
{
  assert.equal(
    isDeliveryOwnedForBusinessInvoiceApprove(
      { vendorInvoiceImportId: "vii-canon-page-1" },
      "vii-dup-page-1",
      "vii-canon-page-1",
    ),
    true,
  );
  assert.equal(
    isDeliveryOwnedForBusinessInvoiceApprove(
      { vendorInvoiceImportId: "vii-other" },
      "vii-dup-page-1",
      "vii-canon-page-1",
    ),
    false,
  );
  assert.equal(
    isDeliveryOwnedForBusinessInvoiceApprove(
      { vendorInvoiceImportId: "" },
      "vii-dup-page-1",
      "vii-canon-page-1",
    ),
    true,
  );
  pass("10 approve ownership allows canonical sibling stamp");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

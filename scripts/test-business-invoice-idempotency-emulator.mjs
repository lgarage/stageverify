/**
 * Real Firestore emulator: legacy import (no key) + findLegacy + claim
 * must treat resend as exact_duplicate with key pointing at legacy.
 *
 * Invoked via: firebase emulators:exec --only firestore
 *   (from test-business-invoice-idempotency.mjs)
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT ?? "stageverify-db";

const require = createRequire(import.meta.url);
const admin = require("../functions/node_modules/firebase-admin");

const {
  claimOrLinkBusinessInvoiceWithSnap,
  findLegacyBusinessInvoiceCanonical,
  getBusinessInvoiceKeySnap,
  tryBuildBusinessInvoiceIdentity,
} = await import("../functions/lib/invoice/businessInvoiceIdentity.js");

if (!admin.apps.length) {
  admin.initializeApp({ projectId: "stageverify-db" });
}
const db = admin.firestore();

const lines = [
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
  },
];

const identity = tryBuildBusinessInvoiceIdentity({
  detectedVendorName: "Johnstone Supply",
  parserFormatId: "johnstone",
  vendorInvoiceNumber: "6169474",
  parsedLines: lines,
});
assert.ok(identity);

const legacyId = "vii-19fe2a7af7632590-page-2";
const resendId = "vii-resend-postdeploy-page-2";

await db.collection("vendorInvoiceImports").doc(legacyId).set({
  id: legacyId,
  inboundEmailProcessingId: "inbound-legacy",
  gmailMessageId: "19fe2a7af7632590",
  pageId: "page-2",
  reviewStatus: "approved",
  importStatus: "pickup_at_vendor",
  linkedDeliveryOrderId: "delivery-vii-vii-19fe2a7af7632590-page-2",
  detectedVendorName: "Johnstone Supply",
  parserFormatId: "johnstone",
  parsedHeader: { vendorInvoiceNumber: "6169474" },
  parsedLines: lines,
  createdAt: "2026-08-08T18:48:10.178Z",
  updatedAt: "2026-08-08T18:48:10.178Z",
});

// Ensure no key doc exists (the prod gap).
const keyRef = db.collection("vendorBusinessInvoiceKeys").doc(identity.keyDocId);
const priorKey = await keyRef.get();
if (priorKey.exists) await keyRef.delete();

let outcomeKind = "";
let keyCanonical = "";

await db.runTransaction(async (tx) => {
  const keySnap = await getBusinessInvoiceKeySnap(tx, db, identity.keyDocId);
  assert.equal(keySnap.exists, false);
  const legacyHint = await findLegacyBusinessInvoiceCanonical(tx, db, {
    identity,
    vendorInvoiceNumberRaw: "6169474",
    excludeReviewId: resendId,
  });
  assert.equal(legacyHint.kind, "found");
  assert.equal(legacyHint.hint.canonicalImportId, legacyId);
  const outcome = claimOrLinkBusinessInvoiceWithSnap(tx, db, keySnap, {
    identity,
    reviewId: resendId,
    gmailMessageId: "msg-resend-postdeploy",
    inboundEmailProcessingId: "inbound-resend-postdeploy",
    now: "2026-08-29T12:00:00Z",
    legacyCanonicalHint: legacyHint.hint,
  });
  outcomeKind = outcome.kind;
  keyCanonical = outcome.kind === "exact_duplicate" ? outcome.canonicalImportId : "";
});

assert.equal(outcomeKind, "exact_duplicate");
assert.equal(keyCanonical, legacyId);

const keyAfter = await keyRef.get();
assert.equal(keyAfter.exists, true);
assert.equal(keyAfter.data()?.canonicalImportId, legacyId);
assert.equal(keyAfter.data()?.canonicalGmailMessageId, "19fe2a7af7632590");

console.log("PASS emulator legacy no-key resend → exact_duplicate + key→legacy");

// Saturation: 25 same invoice# docs → lookup saturated → must NOT create self-canonical key
{
  const {
    BUSINESS_INVOICE_LEGACY_LOOKUP_SATURATED,
  } = await import("../functions/lib/invoice/businessInvoiceIdentity.js");
  const satInv = "SATURATE-99";
  const satIdentity = tryBuildBusinessInvoiceIdentity({
    detectedVendorName: "Johnstone Supply",
    parserFormatId: "johnstone",
    vendorInvoiceNumber: satInv,
    parsedLines: lines,
  });
  assert.ok(satIdentity);
  const satKeyRef = db
    .collection("vendorBusinessInvoiceKeys")
    .doc(satIdentity.keyDocId);
  if ((await satKeyRef.get()).exists) await satKeyRef.delete();

  const batch = db.batch();
  for (let i = 0; i < 25; i++) {
    const id = `vii-sat-filler-${i}`;
    batch.set(db.collection("vendorInvoiceImports").doc(id), {
      id,
      gmailMessageId: `msg-sat-${i}`,
      detectedVendorName: "First Supply",
      parserFormatId: "first_supply",
      parsedHeader: { vendorInvoiceNumber: satInv },
      parsedLines: lines,
      createdAt: `2026-08-01T00:${String(i).padStart(2, "0")}:00Z`,
    });
  }
  await batch.commit();

  let threw = false;
  try {
    await db.runTransaction(async (tx) => {
      await getBusinessInvoiceKeySnap(tx, db, satIdentity.keyDocId);
      const lookup = await findLegacyBusinessInvoiceCanonical(tx, db, {
        identity: satIdentity,
        vendorInvoiceNumberRaw: satInv,
        excludeReviewId: "vii-sat-resend",
      });
      assert.equal(lookup.kind, "saturated");
      throw new Error(BUSINESS_INVOICE_LEGACY_LOOKUP_SATURATED);
    });
  } catch (err) {
    threw =
      err instanceof Error &&
      err.message === BUSINESS_INVOICE_LEGACY_LOOKUP_SATURATED;
    if (!threw) throw err;
  }
  assert.equal(threw, true);
  assert.equal((await satKeyRef.get()).exists, false);
  console.log("PASS emulator saturation → no self-canonical key");
}

console.log("test-business-invoice-idempotency-emulator: PASS");

/**
 * Invoice delivery index — unit tests + approve emulator cases.
 * Usage: npm run test:invoice-delivery-index
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  businessInvoiceDeliveryIndexKeyDocId,
  invoiceNumberIsBossForParser,
  resolveDeliveryTargetFromIndexSnap,
  stampDeliveryOrderIdOnBusinessInvoiceKeyInTx,
  tryBuildBusinessInvoiceIndexContext,
} from "../functions/lib/invoice/invoiceDeliveryIndex.js";
import { tryBuildBusinessInvoiceIdentity } from "../functions/lib/invoice/businessInvoiceIdentity.js";
import {
  buildInvoiceShellResendMetadataPatch,
  isTerminalPickupShellDelivery,
} from "../functions/lib/invoice/createDeliveryShellFromImport.js";
import { planBusinessInvoiceDeliveryIndexBackfill } from "../functions/lib/invoice/backfillBusinessInvoiceDeliveryIndexPlan.js";

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

function sampleLines(poSku = "SKU-A") {
  return [
    {
      lineNumber: 1,
      quantityOrdered: 1,
      quantityShipped: 1,
      quantityBackordered: 0,
      vendorProductNumber: poSku,
      description: "x",
      filteredNotes: [],
      lineType: "product",
      excludeFromExpectedItems: false,
    },
  ];
}

// Johnstone vs First Supply index keys
{
  const identity = tryBuildBusinessInvoiceIdentity({
    detectedVendorName: "Johnstone Supply",
    parserFormatId: "johnstone",
    vendorInvoiceNumber: "6169474",
    parsedLines: sampleLines(),
  });
  assert.ok(identity);
  const jKey = businessInvoiceDeliveryIndexKeyDocId(identity, "johnstone", "SO-1");
  const jKey2 = businessInvoiceDeliveryIndexKeyDocId(identity, "johnstone", "SO-2");
  assert.equal(jKey, jKey2);
  assert.equal(invoiceNumberIsBossForParser("johnstone"), true);

  const fsIdentity = tryBuildBusinessInvoiceIdentity({
    detectedVendorName: "First Supply",
    parserFormatId: "first_supply",
    vendorInvoiceNumber: "15046467-00",
    parsedLines: sampleLines(),
  });
  assert.ok(fsIdentity);
  const fsA = businessInvoiceDeliveryIndexKeyDocId(
    fsIdentity,
    "first_supply",
    "3869488",
  );
  const fsB = businessInvoiceDeliveryIndexKeyDocId(
    fsIdentity,
    "first_supply",
    "9999999",
  );
  assert.notEqual(fsA, fsB);
  pass("index key johnstone invoice-boss vs first_supply S/O disambiguation");
}

// resolve index snap
{
  const snapEmpty = { exists: false, ref: { path: "x" }, data: () => undefined };
  const r1 = resolveDeliveryTargetFromIndexSnap(snapEmpty, "delivery-vii-a");
  assert.equal(r1.targetDeliveryOrderId, "delivery-vii-a");
  assert.equal(r1.indexedHit, false);
  const snapHit = {
    exists: true,
    ref: { path: "x" },
    data: () => ({ deliveryOrderId: "delivery-vii-canonical" }),
  };
  const r2 = resolveDeliveryTargetFromIndexSnap(snapHit, "delivery-vii-b");
  assert.equal(r2.targetDeliveryOrderId, "delivery-vii-canonical");
  assert.equal(r2.indexedHit, true);
  pass("resolveDeliveryTargetFromIndexSnap");
}

// resend metadata patch + terminal pickup preserve
{
  const patch = buildInvoiceShellResendMetadataPatch({
    orderNumber: "6169474",
    deliveryDate: "2026-08-08",
    vendorInvoiceNumber: "6169474",
    vendorOrderNumber: "6169474",
    customerPo: "PO-NEW",
  });
  assert.equal(patch.customerPoOrReference, "PO-NEW");
  assert.equal(isTerminalPickupShellDelivery({ status: "picked_up" }), true);
  pass("resend metadata + terminal pickup guard");
}

// backfill dry-run lists duplicates, flags ambiguous S/O
{
  const plan = planBusinessInvoiceDeliveryIndexBackfill({
    imports: [
      {
        id: "vii-a",
        parserFormatId: "johnstone",
        detectedVendorName: "Johnstone",
        reviewStatus: "approved",
        linkedDeliveryOrderId: "delivery-vii-vii-a",
        parsedHeader: {
          vendorInvoiceNumber: "6169474",
          vendorOrderNumber: "6169474",
          customerPoOrReference: "PO-1",
        },
        parsedLines: sampleLines(),
      },
      {
        id: "vii-b",
        parserFormatId: "johnstone",
        detectedVendorName: "Johnstone",
        reviewStatus: "approved",
        linkedDeliveryOrderId: "delivery-vii-vii-b",
        parsedHeader: {
          vendorInvoiceNumber: "6169474",
          vendorOrderNumber: "6169474",
          customerPoOrReference: "PO-1",
        },
        parsedLines: sampleLines(),
      },
      {
        id: "fs-1",
        parserFormatId: "first_supply",
        detectedVendorName: "First Supply",
        reviewStatus: "approved",
        linkedDeliveryOrderId: "delivery-vii-fs-1",
        parsedHeader: {
          vendorInvoiceNumber: "15046467-00",
          vendorOrderNumber: "3869488-00",
        },
        parsedLines: sampleLines(),
      },
      {
        id: "fs-2",
        parserFormatId: "first_supply",
        detectedVendorName: "First Supply",
        reviewStatus: "approved",
        linkedDeliveryOrderId: "delivery-vii-fs-2",
        parsedHeader: {
          vendorInvoiceNumber: "15046467-00",
          vendorOrderNumber: "OTHER-SO",
        },
        parsedLines: sampleLines(),
      },
    ],
    deliveries: [
      { id: "delivery-vii-vii-a", createdFromInvoiceImport: true },
      { id: "delivery-vii-vii-b", createdFromInvoiceImport: true },
      { id: "delivery-vii-fs-1", createdFromInvoiceImport: true },
      { id: "delivery-vii-fs-2", createdFromInvoiceImport: true },
    ],
  });
  assert.ok(plan.duplicates.some((d) => d.normalizedInvoiceNumber === "6169474"));
  assert.ok(
    plan.ambiguous.some((a) => a.normalizedInvoiceNumber === "15046467-00"),
  );
  assert.equal(plan.entries.length >= 2, true);
  pass("backfill plan duplicates + ambiguous S/O");
}

// mock tx stamp winner
{
  const writes = [];
  const tx = {
    create(ref, doc) {
      writes.push(["create", ref.path, doc.deliveryOrderId]);
    },
    set(ref, doc) {
      writes.push(["set", ref.path, doc.deliveryOrderId]);
    },
  };
  const identity = tryBuildBusinessInvoiceIdentity({
    detectedVendorName: "Johnstone",
    parserFormatId: "johnstone",
    vendorInvoiceNumber: "6169414",
    parsedLines: sampleLines(),
  });
  assert.ok(identity);
  const ctx = tryBuildBusinessInvoiceIndexContext({
    parserFormatId: "johnstone",
    detectedVendorName: "Johnstone",
    parsedHeader: { vendorInvoiceNumber: "6169414" },
    parsedLines: sampleLines(),
  });
  assert.ok(ctx);
  const snap = { exists: false, ref: { path: `vendorBusinessInvoiceKeys/${ctx.indexKeyDocId}` } };
  stampDeliveryOrderIdOnBusinessInvoiceKeyInTx(tx, snap, {
    identity: ctx.identity,
    indexKeyDocId: ctx.indexKeyDocId,
    deliveryOrderId: "delivery-vii-winner",
    canonicalImportId: "vii-winner",
    canonicalGmailMessageId: "g1",
    contentFingerprint: ctx.identity.contentFingerprint,
    now: "2026-01-01T00:00:00Z",
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][2], "delivery-vii-winner");
  pass("stampDeliveryOrderIdOnBusinessInvoiceKeyInTx create");
}

if (process.env.SKIP_APPROVE_SUBPROCESS !== "1") {
  console.log("\nSpawning approve-vendor-invoice-import suite (existing + index)...");
  const child = spawnSync("npm", ["run", "test:approve-vendor-invoice-import"], {
    stdio: "inherit",
    shell: true,
  });
  if (child.status !== 0) {
    fail("test:approve-vendor-invoice-import subprocess", child.status);
  } else {
    pass("test:approve-vendor-invoice-import subprocess");
  }
} else {
  pass("approve subprocess skipped (SKIP_APPROVE_SUBPROCESS=1)");
}

console.log(`\n--- Result: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);

/**
 * Invoice delivery index — unit tests + approve emulator cases.
 * Usage: npm run test:invoice-delivery-index
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  businessInvoiceDeliveryIndexKeyDocId,
  deliveryIndexActiveForParser,
  deliveryIndexModeForParser,
  invoiceNumberIsBossForParser,
  resolveDeliveryTargetFromIndexSnap,
  salesOrdersDisagreeForSeparateDeliveries,
  stampDeliveryOrderIdOnBusinessInvoiceKeyInTx,
  tryBuildBusinessInvoiceIndexContext,
} from "../functions/lib/invoice/invoiceDeliveryIndex.js";
import { tryBuildBusinessInvoiceIdentity } from "../functions/lib/invoice/businessInvoiceIdentity.js";
import {
  buildInvoiceShellResendMetadataPatch,
  isTerminalPickupShellDelivery,
  resolveInvoiceApproveDeliveryTarget,
  shellDeliveryIdForImport,
} from "../functions/lib/invoice/createDeliveryShellFromImport.js";
import { planBusinessInvoiceDeliveryIndexBackfill } from "../functions/lib/invoice/backfillBusinessInvoiceDeliveryIndexPlan.js";
import {
  isEligibleMatchedDeliveryTarget,
  matchInvoiceToRecords,
} from "../functions/lib/invoice/matchInvoiceToRecords.js";

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
  assert.equal(
    salesOrdersDisagreeForSeparateDeliveries("johnstone", "SO-1", "SO-2"),
    false,
  );
  assert.equal(
    salesOrdersDisagreeForSeparateDeliveries("first_supply", "3869488-00", "9999999-00"),
    true,
  );
  assert.equal(
    salesOrdersDisagreeForSeparateDeliveries("first_supply", "3869488-00", "3869488-00"),
    false,
  );

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

{
  assert.equal(deliveryIndexModeForParser("johnstone"), "invoice_only");
  assert.equal(deliveryIndexModeForParser("first_supply"), "invoice_and_sales_order");
  assert.equal(deliveryIndexModeForParser("unknown"), "off");
  assert.equal(deliveryIndexModeForParser("generic"), "off");
  assert.equal(deliveryIndexActiveForParser("johnstone"), true);
  assert.equal(deliveryIndexActiveForParser("unknown"), false);
  const unknownCtx = tryBuildBusinessInvoiceIndexContext({
    parserFormatId: "unknown",
    detectedVendorName: "Mystery Vendor",
    parsedHeader: {
      vendorInvoiceNumber: "UNK-1001",
      vendorOrderNumber: "SO-9",
    },
    parsedLines: sampleLines(),
  });
  assert.equal(unknownCtx, null);
  pass("per-vendor delivery index map + unknown disables index context");
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
        id: "vii-c",
        parserFormatId: "johnstone",
        detectedVendorName: "Johnstone",
        reviewStatus: "approved",
        linkedDeliveryOrderId: "delivery-vii-vii-c",
        parsedHeader: {
          vendorInvoiceNumber: "6169414",
          vendorOrderNumber: "6169414",
          customerPoOrReference: "PO-2",
        },
        parsedLines: sampleLines(),
      },
      {
        id: "vii-d",
        parserFormatId: "johnstone",
        detectedVendorName: "Johnstone",
        reviewStatus: "approved",
        linkedDeliveryOrderId: "delivery-vii-vii-d",
        parsedHeader: {
          vendorInvoiceNumber: "6169414",
          vendorOrderNumber: "6169414",
          customerPoOrReference: "PO-2",
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
      { id: "delivery-vii-vii-c", createdFromInvoiceImport: true },
      { id: "delivery-vii-vii-d", createdFromInvoiceImport: true },
      { id: "delivery-vii-fs-1", createdFromInvoiceImport: true },
      { id: "delivery-vii-fs-2", createdFromInvoiceImport: true },
    ],
  });
  assert.ok(plan.duplicates.some((d) => d.normalizedInvoiceNumber === "6169474"));
  assert.ok(plan.duplicates.some((d) => d.normalizedInvoiceNumber === "6169414"));
  assert.equal(
    plan.duplicates.some((d) => d.normalizedInvoiceNumber === "15046467-00"),
    false,
  );
  assert.ok(
    plan.ambiguous.some((a) => a.normalizedInvoiceNumber === "15046467-00"),
  );
  assert.equal(
    plan.entries.some((e) => e.normalizedInvoiceNumber === "6169474"),
    false,
  );
  assert.equal(
    plan.entries.some((e) => e.normalizedInvoiceNumber === "6169414"),
    false,
  );
  const fsEntries = plan.entries.filter(
    (e) => e.normalizedInvoiceNumber === "15046467-00",
  );
  assert.equal(fsEntries.length, 2);
  assert.notEqual(fsEntries[0].indexKeyDocId, fsEntries[1].indexKeyDocId);
  pass("backfill plan duplicates + ambiguous S/O");
}

// Same customer PO, different invoice numbers — not duplicates (invoice # is the boss)
{
  const sharedPo = "PF-Wausau";
  const plan = planBusinessInvoiceDeliveryIndexBackfill({
    imports: [
      {
        id: "po-split-spring",
        parserFormatId: "johnstone",
        detectedVendorName: "Johnstone Supply",
        reviewStatus: "approved",
        linkedDeliveryOrderId: "delivery-vii-po-split-spring",
        parsedHeader: {
          vendorInvoiceNumber: "PO-SPLIT-9901-SPRING",
          vendorOrderNumber: "PO-SPLIT-9901-SPRING",
          customerPoOrReference: sharedPo,
        },
        parsedLines: sampleLines("SPRING-SKU"),
      },
      {
        id: "po-split-fall",
        parserFormatId: "johnstone",
        detectedVendorName: "Johnstone Supply",
        reviewStatus: "approved",
        linkedDeliveryOrderId: "delivery-vii-po-split-fall",
        parsedHeader: {
          vendorInvoiceNumber: "PO-SPLIT-9901-FALL",
          vendorOrderNumber: "PO-SPLIT-9901-FALL",
          customerPoOrReference: sharedPo,
        },
        parsedLines: sampleLines("FALL-SKU"),
      },
    ],
    deliveries: [
      { id: "delivery-vii-po-split-spring", createdFromInvoiceImport: true },
      { id: "delivery-vii-po-split-fall", createdFromInvoiceImport: true },
    ],
  });
  assert.equal(plan.duplicates.length, 0);
  assert.equal(
    plan.entries.filter((e) => e.normalizedInvoiceNumber.startsWith("PO-SPLIT-9901")).length,
    2,
  );
  const keys = plan.entries.map((e) => e.indexKeyDocId);
  assert.notEqual(keys[0], keys[1]);
  pass("backfill plan: shared name PO + different invoice numbers are not duplicates");
}

{
  const numericPo = "48213";
  const plan = planBusinessInvoiceDeliveryIndexBackfill({
    imports: [
      {
        id: "num-po-spring",
        parserFormatId: "johnstone",
        detectedVendorName: "Johnstone Supply",
        reviewStatus: "approved",
        linkedDeliveryOrderId: "delivery-vii-num-po-spring",
        parsedHeader: {
          vendorInvoiceNumber: "48213-SPRING-01",
          vendorOrderNumber: "48213-SPRING-01",
          customerPoOrReference: numericPo,
        },
        parsedLines: sampleLines("NUM-SPRING"),
      },
      {
        id: "num-po-fall",
        parserFormatId: "johnstone",
        detectedVendorName: "Johnstone Supply",
        reviewStatus: "approved",
        linkedDeliveryOrderId: "delivery-vii-num-po-fall",
        parsedHeader: {
          vendorInvoiceNumber: "48213-FALL-01",
          vendorOrderNumber: "48213-FALL-01",
          customerPoOrReference: numericPo,
        },
        parsedLines: sampleLines("NUM-FALL"),
      },
    ],
    deliveries: [
      { id: "delivery-vii-num-po-spring", createdFromInvoiceImport: true },
      { id: "delivery-vii-num-po-fall", createdFromInvoiceImport: true },
    ],
  });
  assert.equal(plan.duplicates.length, 0);
  assert.equal(plan.entries.length, 2);
  assert.notEqual(plan.entries[0].indexKeyDocId, plan.entries[1].indexKeyDocId);
  pass("backfill plan: numeric PO + different invoice numbers are not duplicates");
}

{
  const mixedPo = "po-2533636";
  const plan = planBusinessInvoiceDeliveryIndexBackfill({
    imports: [
      {
        id: "mix-po-spring",
        parserFormatId: "johnstone",
        detectedVendorName: "Johnstone Supply",
        reviewStatus: "approved",
        linkedDeliveryOrderId: "delivery-vii-mix-po-spring",
        parsedHeader: {
          vendorInvoiceNumber: "PO2533636-SPRING-01",
          vendorOrderNumber: "PO2533636-SPRING-01",
          customerPoOrReference: mixedPo,
        },
        parsedLines: sampleLines("MIX-SPRING"),
      },
      {
        id: "mix-po-fall",
        parserFormatId: "johnstone",
        detectedVendorName: "Johnstone Supply",
        reviewStatus: "approved",
        linkedDeliveryOrderId: "delivery-vii-mix-po-fall",
        parsedHeader: {
          vendorInvoiceNumber: "PO2533636-FALL-01",
          vendorOrderNumber: "PO2533636-FALL-01",
          customerPoOrReference: mixedPo,
        },
        parsedLines: sampleLines("MIX-FALL"),
      },
    ],
    deliveries: [
      { id: "delivery-vii-mix-po-spring", createdFromInvoiceImport: true },
      { id: "delivery-vii-mix-po-fall", createdFromInvoiceImport: true },
    ],
  });
  assert.equal(plan.duplicates.length, 0);
  assert.equal(plan.entries.length, 2);
  pass("backfill plan: mixed PO + different invoice numbers are not duplicates");
}

// Approve target must not match a foreign-owned delivery on PO alone
{
  const sharedPo = "PF-Wausau";
  const poHeader = {
    customerAccountNumber: "0018114",
    vendorOrderNumber: "PO-SPLIT-9902-FALL",
    vendorInvoiceNumber: "PO-SPLIT-9902-FALL",
    customerPoOrReference: sharedPo,
    orderDate: "2026-06-23",
    invoiceDate: "2026-06-23",
    shipDate: "2026-06-23",
    vendorBranchName: "Johnstone Supply",
    soldToName: "SJS HEATING",
    shipToName: "SJS HEATING",
    fulfillmentMethod: "will_call_pickup",
    shipCompletePolicy: "unknown",
  };
  const ctx = {
    vendors: [{ id: "v-1", email: "a@b.com" }],
    jobs: [{ id: "job-1", jobNumber: "26-100" }],
    purchaseOrders: [
      { id: "po-wausau", poNumber: sharedPo, jobId: "job-1", vendorId: "v-1" },
    ],
    deliveries: [
      {
        id: "delivery-spring-shell",
        orderNumber: "PO-SPLIT-9902-SPRING",
        jobId: "job-1",
        vendorId: "v-1",
        purchaseOrderId: "po-wausau",
        vendorInvoiceImportId: "import-spring",
        createdFromInvoiceImport: true,
      },
      {
        id: "delivery-other-po-line",
        orderNumber: "ORD-MISC",
        jobId: "job-1",
        vendorId: "v-1",
        purchaseOrderId: "po-wausau",
      },
    ],
  };
  const match = matchInvoiceToRecords("import-fall", poHeader, ctx);
  assert.equal(isEligibleMatchedDeliveryTarget(match, "import-fall", ctx.deliveries), false);
  const resolved = resolveInvoiceApproveDeliveryTarget({
    importId: "import-fall",
    importDoc: {
      parsedHeader: poHeader,
      parsedLines: sampleLines(),
      reviewStatus: "pending_review",
      importStatus: "pending",
    },
    header: poHeader,
    ctx,
  });
  assert.equal(resolved.matchedExisting, false);
  assert.equal(resolved.targetDeliveryOrderId, shellDeliveryIdForImport("import-fall"));
  pass("approve target: shared PO does not auto-merge onto sibling invoice delivery");
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

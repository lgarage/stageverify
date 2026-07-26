/**
 * Unit tests for invoice AI shadow gates + lesson redaction (no Vertex calls).
 * Requires `npm run build:functions` first (loads functions/lib).
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libRoot = path.join(__dirname, "..", "functions", "lib", "invoice", "aiShadow");

const redact = await import(pathToFileURL(path.join(libRoot, "redactLessonNote.js")).href);
const validate = await import(pathToFileURL(path.join(libRoot, "validateAiParse.js")).href);

{
  const raw =
    "Ship-via WILL CALL means will_call_pickup. Invoice 6166261 and PO ABC-99 should not appear.";
  const out = redact.redactLessonNote(raw);
  assert.ok(!out.includes("6166261"), "redacts long numeric invoice id");
  assert.equal(redact.isSafeLessonNote(""), false);
  assert.equal(
    redact.isSafeLessonNote(
      "When B/O column has qty, set quantityBackordered from that column.",
    ),
    true,
  );
}

assert.equal(validate.isCorruptExtractedText(""), true);
assert.equal(validate.isCorruptExtractedText("INVOICE\n".repeat(20)), false);

{
  const bad = validate.validateAiShadowOutput(null, { hasVendorPlaybook: true });
  assert.equal(bad.ok, false);
  assert.ok(bad.failures.includes("json_schema_failure"));
}

{
  const good = validate.validateAiShadowOutput(
    {
      header: {
        vendorInvoiceNumber: "INV1",
        vendorOrderNumber: "SO1",
        customerPoOrReference: "PO1",
        fulfillmentMethod: "delivery",
      },
      lines: [
        {
          quantityOrdered: 4,
          quantityShipped: 2,
          quantityBackordered: 2,
          vendorProductNumber: "X",
          description: "part",
          lineType: "product",
        },
      ],
      evidenceNotes: ["INVOICE INV1", "Ship Via: OUR TRUCK"],
    },
    { hasVendorPlaybook: true, parserFormatId: "johnstone" },
  );
  assert.equal(good.ok, true, `expected ok, got ${good.failures.join(",")}`);
}

{
  const qtyFail = validate.validateAiShadowOutput(
    {
      header: {
        vendorInvoiceNumber: "INV1",
        vendorOrderNumber: "SO1",
        fulfillmentMethod: "delivery",
      },
      lines: [
        {
          quantityOrdered: 4,
          quantityShipped: 1,
          quantityBackordered: 1,
          lineType: "product",
        },
      ],
      evidenceNotes: ["INVOICE INV1"],
    },
    { hasVendorPlaybook: true, parserFormatId: "johnstone" },
  );
  assert.ok(qtyFail.failures.includes("qty_reconcile_failure"));
}

console.log("test-invoice-ai-shadow: PASS");

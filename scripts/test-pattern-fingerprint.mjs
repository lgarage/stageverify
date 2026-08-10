/**
 * Lane C C3-D.1 — patternFingerprint / Invoice # window rules (pure).
 * Usage: npm run test:pattern-fingerprint
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lib = path.join(
  __dirname,
  "..",
  "functions",
  "lib",
  "invoice",
  "reviewChat",
);
const pf = await import(
  pathToFileURL(path.join(lib, "patternFingerprint.js")).href
);
const la = await import(
  pathToFileURL(path.join(lib, "labelAnchorAllowlist.js")).href
);

let passed = 0;
function ok(label) {
  passed += 1;
  console.log(`  ✓ ${label}`);
}

// Case-fold of approved structure
{
  const text = "CUSTOMER P/O #\n2205 EARLY\n";
  const value = "2205 EARLY";
  const start = text.indexOf(value);
  const m = pf.deriveAnchorMatch({
    parserFormatId: "johnstone",
    field: "customerPoOrReference",
    combinedExtractedText: text,
    evidenceSpanStart: start,
    evidenceSpanEnd: start + value.length,
  });
  assert.equal(m.skipReason, undefined);
  assert.equal(m.captureShapeId, "anchor_above_line");
  assert.equal(m.literal, "Customer P/O #");
  assert.match(m.patternFingerprint, /johnstone_customer_po_v1__anchor_above_line/);
  ok("case-fold CUSTOMER P/O # → approved Customer P/O # (above-line)");
}

// # is significant — Customer P/O without # must NOT match
{
  const text = "Customer P/O\n2205 EARLY\n";
  const value = "2205 EARLY";
  const start = text.indexOf(value);
  const m = pf.deriveAnchorMatch({
    parserFormatId: "johnstone",
    field: "customerPoOrReference",
    combinedExtractedText: text,
    evidenceSpanStart: start,
    evidenceSpanEnd: start + value.length,
  });
  assert.equal(m.skipReason, "no_anchor");
  ok("Customer P/O without # does not match approved literal");
}

// Reject bare PO / Customer PO
{
  for (const bad of ["PO\n2205 EARLY\n", "Customer PO\n2205 EARLY\n", "P/O #\n2205 EARLY\n"]) {
    const value = "2205 EARLY";
    const start = bad.indexOf(value);
    const m = pf.deriveAnchorMatch({
      parserFormatId: "johnstone",
      field: "customerPoOrReference",
      combinedExtractedText: bad,
      evidenceSpanStart: start,
      evidenceSpanEnd: start + value.length,
    });
    assert.equal(m.skipReason, "no_anchor", bad);
  }
  ok("broad PO / Customer PO / P/O # rejected");
}

// Inline Sales Order #
{
  const text = "Sales Order #: 6164159 more\n";
  const value = "6164159";
  const start = text.indexOf(value);
  const m = pf.deriveAnchorMatch({
    parserFormatId: "johnstone",
    field: "vendorOrderNumber",
    combinedExtractedText: text,
    evidenceSpanStart: start,
    evidenceSpanEnd: start + value.length,
  });
  assert.equal(m.skipReason, undefined);
  assert.equal(m.captureShapeId, "anchor_left_inline");
  ok("Sales Order # inline capture");
}

// Invoice Date must not match Invoice #
{
  const text = "Invoice Date: 08/09/2026\n6169414 elsewhere\n";
  const value = "6169414";
  const start = text.indexOf(value);
  const m = pf.deriveAnchorMatch({
    parserFormatId: "johnstone",
    field: "vendorInvoiceNumber",
    combinedExtractedText: text,
    evidenceSpanStart: start,
    evidenceSpanEnd: start + value.length,
  });
  assert.equal(m.skipReason, "no_anchor");
  ok("Invoice Date does not satisfy Invoice #");
}

// Return from Invoice # rejected
{
  const text = "Return from Invoice # 6169414\n";
  const value = "6169414";
  const start = text.indexOf(value);
  const m = pf.deriveAnchorMatch({
    parserFormatId: "johnstone",
    field: "vendorInvoiceNumber",
    combinedExtractedText: text,
    evidenceSpanStart: start,
    evidenceSpanEnd: start + value.length,
  });
  assert.equal(m.skipReason, "invoice_window_rejected");
  ok("Return from Invoice # disqualified");
}

// Bare tabular header far away — value has real stacked Invoice #
{
  const text = [
    "PO #   Invoice #   Ship Via",
    "other noise",
    "Invoice #",
    "6169414",
    "",
  ].join("\n");
  const value = "6169414";
  const start = text.indexOf(value);
  const m = pf.deriveAnchorMatch({
    parserFormatId: "johnstone",
    field: "vendorInvoiceNumber",
    combinedExtractedText: text,
    evidenceSpanStart: start,
    evidenceSpanEnd: start + value.length,
  });
  assert.equal(m.skipReason, undefined);
  assert.equal(m.captureShapeId, "anchor_above_line");
  ok("stacked Invoice # wins over bare multi-column header");
}

// first_supply format not allowed
{
  const text = "Customer P/O #\n2205 EARLY\n";
  const value = "2205 EARLY";
  const start = text.indexOf(value);
  const m = pf.deriveAnchorMatch({
    parserFormatId: "first_supply",
    field: "customerPoOrReference",
    combinedExtractedText: text,
    evidenceSpanStart: start,
    evidenceSpanEnd: start + value.length,
  });
  assert.equal(m.skipReason, "format_not_allowed");
  ok("first_supply format fail-closed");
}

// normalize helpers do not strip #
{
  assert.ok(la.normalizeAnchorMatchText("Customer P/O #").includes("#"));
  assert.ok(la.normalizeAnchorMatchText("Customer P/O #").includes("/"));
  assert.notEqual(
    la.normalizeAnchorMatchText("Customer P/O #"),
    la.normalizeAnchorMatchText("Customer P/O"),
  );
  ok("normalization preserves # and /");
}

console.log(`\npattern-fingerprint: ${passed} passed`);

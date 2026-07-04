/**
 * Phase 1: dump full parser output for inv-so-4046362 fixtures + field checklist.
 * Usage: npx tsx scripts/inspect-fixture-4046362.mjs
 */
import { INVOICE_FIXTURES } from "../src/dispatcher/invoice/invoiceFixtures.ts";
import { processInvoicePage } from "../src/dispatcher/invoice/processInvoicePage.ts";
import { pageTextFingerprint } from "../src/dispatcher/invoice/parseJohnstoneInvoice.ts";

const TARGETS = ["inv-so-4046362", "inv-so-4046362-colon"];

const EXPECTED_FIELDS = [
  { key: "customerAccountNumber", patterns: [/Customer\s*#/i, /\b0018114\b/] },
  { key: "vendorBranchName", patterns: [/Johnstone Supply/i, /Sioux Falls/i] },
  { key: "vendorOrderNumber", patterns: [/Sales Order\s*#/i, /\b4046362\b/] },
  { key: "vendorInvoiceNumber", patterns: [/Invoice\s*#/i] },
  { key: "customerPoOrReference", patterns: [/Customer P\/O/i, /blackduck hartford/i] },
  { key: "buyerName", patterns: [/Buyer/i, /CONNOR SMITH/i] },
  { key: "soldToName", patterns: [/Sold To/i, /TWIN PILLAR/i] },
  { key: "shipToName", patterns: [/Ship To/i] },
  { key: "orderDate", patterns: [/Order Date/i, /06\/23\/2026/] },
  { key: "invoiceDate", patterns: [/Invoice Date/i] },
  { key: "shipViaRaw", patterns: [/Ship Via/i, /TRUCK DELIVE/i] },
  { key: "shipCompletePolicy", patterns: [/SHIP COMPLETE/i] },
  { key: "lineItems", patterns: [/LN QNTY ORD/i, /L46-668/i] },
  { key: "documentType", patterns: [/SALES ORDER CONFIRMATION/i] },
];

function fieldInText(text, patterns) {
  return patterns.some((p) => p.test(text));
}

function headerValue(header, key) {
  const v = header?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const existing = { byPageId: new Map(), byFingerprint: new Map() };

for (const pageId of TARGETS) {
  const fixture = INVOICE_FIXTURES.find((f) => f.pageId === pageId);
  if (!fixture) {
    console.log(`Missing fixture ${pageId}`);
    continue;
  }

  const text = fixture.extractedText;
  console.log(`\n========== ${pageId} ==========`);
  console.log("--- extracted text ---");
  console.log(text.trim());

  console.log("\n--- expected-field presence in extracted text ---");
  for (const f of EXPECTED_FIELDS) {
    console.log(`  ${f.key}: ${fieldInText(text, f.patterns) ? "present" : "absent"}`);
  }

  const result = processInvoicePage(fixture, existing);
  existing.byPageId.set(fixture.pageId, fixture.pageId);
  existing.byFingerprint.set(pageTextFingerprint(fixture), fixture.pageId);

  const h = result.parsed.header;
  console.log("\n--- parsedHeader ---");
  console.log(JSON.stringify(h, null, 2));
  console.log("\n--- parsed lines ---");
  console.log(JSON.stringify(result.parsed.lines, null, 2));
  console.log("\n--- parseWarnings ---");
  console.log(result.parsed.parseWarnings);
  console.log("\n--- importStatus / review ---");
  console.log({
    importStatus: result.importStatus,
    reviewStatus: result.reviewStatus,
    error: result.error,
    humanReviewRequired: result.humanReviewRequired,
  });

  console.log("\n--- captured vs text (header fields) ---");
  for (const f of EXPECTED_FIELDS.filter((x) => x.key !== "lineItems" && x.key !== "documentType")) {
    const inText = fieldInText(text, f.patterns);
    const captured = headerValue(h, f.key);
    let verdict = "N/A";
    if (inText && captured) verdict = "Found";
    else if (inText && !captured) verdict = "MISSED BY PARSER";
    else if (!inText && !captured) verdict = "Missing from PDF";
    else if (!inText && captured) verdict = "Questionable";
    console.log(`  ${f.key}: text=${inText} parsed=${captured ?? "—"} → ${verdict}`);
  }

  const linesInText = /LN QNTY ORD/i.test(text);
  const lineCount = result.parsed.lines.length;
  console.log("\n--- lines verdict ---");
  console.log(
    `  lines in text: ${linesInText}, parsed: ${lineCount} → ${
      linesInText && lineCount === 0
        ? "PARSER MISS"
        : linesInText && lineCount > 0
          ? "OK"
          : "N/A"
    }`,
  );

  console.log("\n--- approve/reject eligibility ---");
  console.log(
    `  issue status correct: ${result.importStatus === "issue" ? "YES (missing Invoice #)" : "NO"}`,
  );
  console.log(`  approve blocked (UI+server): ${result.importStatus === "issue" ? "YES" : "NO"}`);
  console.log(`  reject allowed: YES (always for pending_review)`);
}

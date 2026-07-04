/**
 * Johnstone invoice batch processor tests (offline prototype — Slice 2).
 * Run: npm run test:invoice-batch
 *
 * Gate: batch adapter + processInvoiceBatch; ≥95% checks pass; failure isolation per spec §11.
 */

import { vendorInvoiceImportDisplayLabel } from "../src/dispatcher/invoice/invoiceDisplayHelpers.ts";
import {
  BATCH_WITH_CORRUPT_PAGE,
  buildAdaptedConcatenatedPages,
  buildConcatenatedBatchFixture,
  SAMPLE_BATCH_ID,
  SAMPLE_EIGHT_PAGE_BATCH,
} from "../src/dispatcher/invoice/invoiceBatchFixtures.ts";
import { INVOICE_FIXTURES } from "../src/dispatcher/invoice/invoiceFixtures.ts";
import {
  adaptConcatenatedPdfText,
  extractedPagesFromTexts,
  mergeMultiPageInvoiceText,
  splitExtractedTextIntoPages,
} from "../src/dispatcher/invoice/pdfTextAdapter.ts";
import {
  classifyBatchPageOutcome,
  processInvoiceBatch,
  processInvoiceBatchFromExtracted,
} from "../src/dispatcher/invoice/processInvoiceBatch.ts";
import { processInvoicePage } from "../src/dispatcher/invoice/processInvoicePage.ts";

const ACCURACY_GATE = 95;

/** @typedef {{ label: string, pass: boolean, detail?: string }} Check */

/** @type {Check[]} */
const checks = [];

function record(label, pass, detail) {
  checks.push({ label, pass, detail });
}

// --- PDF text adapter ---

const concatBlob = buildConcatenatedBatchFixture();
const splitPages = splitExtractedTextIntoPages(concatBlob);
record(
  "adapter: split concatenated batch",
  splitPages.length === SAMPLE_EIGHT_PAGE_BATCH.length,
  `${splitPages.length} pages`,
);

const adaptedPages = buildAdaptedConcatenatedPages();
record(
  "adapter: adapted page count",
  adaptedPages.length === SAMPLE_EIGHT_PAGE_BATCH.length,
  `${adaptedPages.length}`,
);
record(
  "adapter: shared importBatchId",
  adaptedPages.every((p) => p.importBatchId === SAMPLE_BATCH_ID),
  adaptedPages[0]?.importBatchId,
);

// Multi-page single invoice merge (description continuation across PDF pages)
const multiPagePartA = `
Johnstone Supply
Customer #: 0018114
Sales Order #: 6164999
Invoice #: 6164999
Customer P/O #: MULTI PAGE TEST
`.trim();
const multiPagePartB = `
LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 1 1 0 L46-668 TH8320R1003/U THERMOSTAT
please call 605-338-2652
`.trim();
const merged = mergeMultiPageInvoiceText([multiPagePartA, multiPagePartB]);
record(
  "adapter: multi-page merge includes line table",
  merged.includes("LN QNTY ORD") && merged.includes("6164999"),
  merged.slice(0, 80),
);

// --- Batch processor: eight-page sample ---

const eightPageBatch = processInvoiceBatch(SAMPLE_EIGHT_PAGE_BATCH, {
  importBatchId: SAMPLE_BATCH_ID,
});

record(
  "batch: single importBatchId",
  eightPageBatch.importBatchId === SAMPLE_BATCH_ID,
  eightPageBatch.importBatchId,
);
record(
  "batch: eight results",
  eightPageBatch.results.length === 8,
  `${eightPageBatch.results.length}`,
);
record(
  "batch: summary total matches",
  eightPageBatch.summary.total === eightPageBatch.results.length,
  `${eightPageBatch.summary.total}`,
);
record(
  "batch: outcomes sum to total",
  eightPageBatch.summary.processed +
    eightPageBatch.summary.needsReview +
    eightPageBatch.summary.failed ===
    eightPageBatch.summary.total,
  `p=${eightPageBatch.summary.processed} r=${eightPageBatch.summary.needsReview} f=${eightPageBatch.summary.failed}`,
);

const orderedIndices = eightPageBatch.results.map((r) => r.pageIndexInBatch);
record(
  "batch: pages processed in sequence",
  orderedIndices.every((v, i) => v === i),
  orderedIndices.join(","),
);

// Spec §11: auto-processed will-call pickup pages
const autoProcessed = eightPageBatch.results.filter((r) => r.outcome === "processed");
record(
  "batch: at least one auto-processed page",
  autoProcessed.length >= 1,
  `${autoProcessed.length} processed`,
);

const needsReview = eightPageBatch.results.filter((r) => r.outcome === "needs_review");
record(
  "batch: partial/backorder pages need review",
  needsReview.length >= 1,
  `${needsReview.length} needs_review`,
);

// --- Failure isolation: corrupt page ---

const corruptBatch = processInvoiceBatch(BATCH_WITH_CORRUPT_PAGE, {
  importBatchId: "batch-corrupt-test",
});

const corruptRow = corruptBatch.results.find((r) => r.pageId === "inv-corrupt-page");
record(
  "batch: corrupt page failed",
  corruptRow?.outcome === "failed",
  corruptRow?.outcome,
);
record(
  "batch: corrupt page does not block siblings",
  corruptBatch.results.filter((r) => r.outcome !== "failed").length >= 2,
  `${corruptBatch.summary.processed + corruptBatch.summary.needsReview} non-failed`,
);

// --- End-to-end from extracted PDF pages ---

const extractedBatch = processInvoiceBatchFromExtracted({
  importBatchId: "batch-from-extracted",
  pages: extractedPagesFromTexts(SAMPLE_EIGHT_PAGE_BATCH.slice(0, 3).map((p) => p.extractedText)),
  pageIds: SAMPLE_EIGHT_PAGE_BATCH.slice(0, 3).map((p) => p.pageId),
});
record(
  "batch: fromExtracted count",
  extractedBatch.results.length === 3,
  `${extractedBatch.results.length}`,
);
record(
  "batch: fromExtracted importBatchId",
  extractedBatch.importBatchId === "batch-from-extracted",
  extractedBatch.importBatchId,
);

// --- Duplicate within batch ---

const dupSource = INVOICE_FIXTURES[0];
const dupBatch = processInvoiceBatch(
  [
    { ...dupSource, pageIndexInBatch: 0 },
    { ...dupSource, pageId: "inv-dup-second", pageIndexInBatch: 1 },
  ],
  { importBatchId: "batch-dup-test" },
);
record(
  "batch: duplicate second page failed",
  dupBatch.results[1]?.outcome === "failed" && dupBatch.results[1]?.processing?.duplicate === true,
  dupBatch.results[1]?.outcome,
);

// --- classifyBatchPageOutcome alignment ---

const kalafat = INVOICE_FIXTURES.find((f) => f.pageId === "inv-6164102-kalafat");
if (kalafat) {
  const kalafatResult = processInvoicePage(kalafat, {
    byPageId: new Map(),
    byFingerprint: new Map(),
  });
  record(
    "classify: ambiguous PO needs review",
    classifyBatchPageOutcome(kalafatResult) === "needs_review",
    classifyBatchPageOutcome(kalafatResult),
  );
}

const pickupComplete = INVOICE_FIXTURES.find((f) => f.pageId === "inv-6164159");
if (pickupComplete) {
  const pickupResult = processInvoicePage(pickupComplete, {
    byPageId: new Map(),
    byFingerprint: new Map(),
  });
  record(
    "classify: fulfilled will-call processed",
    classifyBatchPageOutcome(pickupResult) === "processed",
    classifyBatchPageOutcome(pickupResult),
  );
}

const SO_ISSUE_TEXT = `
Johnstone Supply
Customer #: 0018114
Sales Order #: 4046362
Customer P/O #: TEST PO
Order Date: 06/23/2026
Buyer: TEST
Ship Via: TRUCK DELIVE
LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 1 1 0 L46-668 THERMOSTAT
`.trim();
const soIssueResult = processInvoicePage(
  {
    pageId: "inv-so-4046362",
    importBatchId: "batch-classify-so",
    pageIndexInBatch: 1,
    extractedText: SO_ISSUE_TEXT,
  },
  { byPageId: new Map(), byFingerprint: new Map() },
);
record(
  "classify: missing invoice # needs review",
  classifyBatchPageOutcome(soIssueResult) === "needs_review",
  classifyBatchPageOutcome(soIssueResult),
);
record(
  "classify: missing invoice # importStatus issue",
  soIssueResult.importStatus === "issue",
  soIssueResult.importStatus,
);

// --- Concatenated path matches direct batch ---

const fromConcat = processInvoiceBatch(
  adaptConcatenatedPdfText(
    concatBlob,
    SAMPLE_BATCH_ID,
    SAMPLE_EIGHT_PAGE_BATCH.map((p) => p.pageId),
  ),
  { importBatchId: SAMPLE_BATCH_ID },
);
record(
  "batch: concatenated path invoice numbers",
  fromConcat.results.every(
    (r, i) =>
      r.processing?.parsed.header.vendorInvoiceNumber ===
      eightPageBatch.results[i]?.processing?.parsed.header.vendorInvoiceNumber,
  ),
  "header match",
);

// --- Display labels still wired ---

for (const row of eightPageBatch.results) {
  if (row.processing) {
    const label = vendorInvoiceImportDisplayLabel(row.processing.importStatus);
    record(
      `display: ${row.pageId} label non-empty`,
      label.length > 0,
      label,
    );
  }
}

// --- Report ---

const passed = checks.filter((c) => c.pass).length;
const accuracyPct = checks.length > 0 ? Math.round((passed / checks.length) * 1000) / 10 : 0;

console.log("\n--- Johnstone invoice batch test report ---");
for (const c of checks) {
  console.log(`  ${c.pass ? "PASS" : "FAIL"} ${c.label}${c.detail ? ` — ${c.detail}` : ""}`);
}
console.log(`\nBatch summary (8-page sample):`, JSON.stringify(eightPageBatch.summary));
console.log(`Aggregate: ${passed}/${checks.length} = ${accuracyPct}%`);
console.log(`Gate ${accuracyPct >= ACCURACY_GATE ? "PASS" : "FAIL"} (threshold ${ACCURACY_GATE}%)`);

if (accuracyPct < ACCURACY_GATE) {
  console.error("\nFAIL invoice batch tests");
  process.exit(1);
}

console.log("\nPASS Johnstone invoice batch tests");

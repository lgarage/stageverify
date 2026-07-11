/**
 * Offline batch preview mapper tests (Slice 3).
 * Run: npm run test:invoice-offline-preview
 */

import { SAMPLE_EIGHT_PAGE_BATCH } from "../src/dispatcher/invoice/invoiceBatchFixtures.ts";
import {
  buildOfflineImportReviewFromPageResult,
  mapBatchResultToPreviewRows,
} from "../src/dispatcher/invoice/mapBatchResultToPreviewRows.ts";
import { processInvoiceBatch } from "../src/dispatcher/invoice/processInvoiceBatch.ts";

/** @typedef {{ label: string, pass: boolean, detail?: string }} Check */

/** @type {Check[]} */
const checks = [];

function record(label, pass, detail) {
  checks.push({ label, pass, detail });
}

const batch = processInvoiceBatch(SAMPLE_EIGHT_PAGE_BATCH);
const rows = mapBatchResultToPreviewRows(batch);

record("mapper: eight preview rows", rows.length === 8, `${rows.length}`);
record(
  "mapper: row pageIds match batch",
  rows.every((r, i) => r.pageId === batch.results[i]?.pageId),
  rows.map((r) => r.pageId).join(", "),
);
record(
  "mapper: summary total preserved",
  batch.summary.total === 8 && batch.summary.total === rows.length,
  `total=${batch.summary.total}`,
);
record(
  "mapper: outcomes sum to total",
  batch.summary.processed + batch.summary.needsReview + batch.summary.failed ===
    batch.summary.total,
  `p=${batch.summary.processed} r=${batch.summary.needsReview} f=${batch.summary.failed}`,
);

const withProcessing = rows.filter((r) => r.processing != null);
record(
  "mapper: invoice numbers on parsed rows",
  withProcessing.every((r) => r.vendorInvoiceNumber !== "—"),
  `${withProcessing.length} parsed`,
);

const firstParsed = batch.results.find((r) => r.processing);
if (firstParsed) {
  const synthetic = buildOfflineImportReviewFromPageResult(batch, firstParsed);
  record(
    "mapper: synthetic review id",
    synthetic?.id === `offline-preview-${firstParsed.pageId}`,
    synthetic?.id,
  );
  record(
    "mapper: synthetic review has parsed lines",
    (synthetic?.parsedLineCount ?? 0) > 0,
    `${synthetic?.parsedLineCount ?? 0} lines`,
  );
}

const passed = checks.filter((c) => c.pass).length;
const accuracyPct = checks.length > 0 ? Math.round((passed / checks.length) * 1000) / 10 : 0;

console.log("\n--- Invoice offline preview mapper test report ---");
for (const c of checks) {
  console.log(`  ${c.pass ? "PASS" : "FAIL"} ${c.label}${c.detail ? ` — ${c.detail}` : ""}`);
}
console.log(`\nAggregate: ${passed}/${checks.length} = ${accuracyPct}%`);

if (passed < checks.length) {
  console.error("\nFAIL invoice offline preview tests");
  process.exit(1);
}

console.log("\nPASS invoice offline preview tests");

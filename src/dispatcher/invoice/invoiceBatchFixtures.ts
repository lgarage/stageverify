import type { JohnstoneInvoicePageText } from "./types";
import { INVOICE_FIXTURES } from "./invoiceFixtures";
import {
  adaptConcatenatedPdfText,
  INVOICE_PAGE_BOUNDARY,
  joinPagesWithBoundaries,
} from "./pdfTextAdapter";

/** Sioux Falls sample batch id — matches Slice 1 fixtures. */
export const SAMPLE_BATCH_ID = "batch-sioux-falls-2026-06-24";

/** Eight-invoice batch mirroring spec §11 sample PDF (one invoice per page). */
export const SAMPLE_EIGHT_PAGE_BATCH: JohnstoneInvoicePageText[] = INVOICE_FIXTURES.filter(
  (f) => f.pageId !== "inv-6164159-dup",
)
  .slice(0, 8)
  .map((f, index) => ({
    ...f,
    importBatchId: SAMPLE_BATCH_ID,
    pageIndexInBatch: index,
  }));

/** Garbled page for failure-isolation tests — does not block sibling pages. */
export const CORRUPT_PAGE_TEXT = `
NOT A JOHNSTONE INVOICE
Random OCR noise @@##$$
`.trim();

/** Five-page batch with one corrupt page at index 2 (spec §11 failure isolation). */
export const BATCH_WITH_CORRUPT_PAGE: JohnstoneInvoicePageText[] = [
  { ...SAMPLE_EIGHT_PAGE_BATCH[0], pageIndexInBatch: 0 },
  { ...SAMPLE_EIGHT_PAGE_BATCH[1], pageIndexInBatch: 1 },
  {
    pageId: "inv-corrupt-page",
    importBatchId: SAMPLE_BATCH_ID,
    pageIndexInBatch: 2,
    extractedText: CORRUPT_PAGE_TEXT,
  },
  { ...SAMPLE_EIGHT_PAGE_BATCH[2], pageIndexInBatch: 3 },
  { ...SAMPLE_EIGHT_PAGE_BATCH[3], pageIndexInBatch: 4 },
];

/** Concatenated extraction blob for multi-page adapter tests. */
export function buildConcatenatedBatchFixture(): string {
  return joinPagesWithBoundaries(SAMPLE_EIGHT_PAGE_BATCH.map((p) => p.extractedText));
}

/** Pages produced by split adapter from concatenated fixture. */
export function buildAdaptedConcatenatedPages() {
  return adaptConcatenatedPdfText(
    buildConcatenatedBatchFixture(),
    SAMPLE_BATCH_ID,
    SAMPLE_EIGHT_PAGE_BATCH.map((p) => p.pageId),
  );
}

export { INVOICE_PAGE_BOUNDARY };

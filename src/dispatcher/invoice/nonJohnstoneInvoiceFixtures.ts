import type { JohnstoneInvoicePageText } from "./types";

const BATCH_ID = "batch-non-johnstone-2026-07-05";

/** Controlled non-Johnstone vendor text — expect issue/review, not Johnstone auto-parse. */
export const NON_JOHNSTONE_INVOICE_FIXTURES: JohnstoneInvoicePageText[] = [
  {
    pageId: "inv-ferguson-sample-001",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 1,
    extractedText: `
Ferguson Enterprises LLC
Invoice Number: FE-882145
Purchase Order: PO-88392
Ship To: Riverside Medical Center
Order Date: 06/01/2026

Line  Item Description                    Qty
1     COPPER ELBOW 3/4                   12
2     PVC ADAPTER 2 IN                   6

Thank you for your business.
`.trim(),
  },
  {
    pageId: "inv-firstsupply-sample-001",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 2,
    extractedText: `
First Supply LLC
Sales Order Confirmation
SO Number: FS-99102
Customer PO: PO-88394
Buyer: Warehouse Counter

Item SKU          Description              Ord  Ship
HVAC-991          DUCT BOOT 6 IN           4    0

Partial shipment — balance on backorder.
`.trim(),
  },
];

export const NON_JOHNSTONE_FIXTURE_EXPECTATIONS: Record<
  string,
  {
    importStatus: string;
    humanReviewRequired: boolean;
    minConfidenceScore?: number;
    maxConfidenceScore?: number;
    maxProductLines?: number;
  }
> = {
  "inv-ferguson-sample-001": {
    importStatus: "issue",
    humanReviewRequired: true,
    maxConfidenceScore: 60,
    maxProductLines: 0,
  },
  "inv-firstsupply-sample-001": {
    importStatus: "issue",
    humanReviewRequired: true,
    maxConfidenceScore: 60,
    maxProductLines: 0,
  },
};

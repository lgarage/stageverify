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
  {
    pageId: "inv-ferguson-willcall-002",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 3,
    extractedText: `
Ferguson Enterprises LLC
Will Call Pickup Notice
Invoice Number: FE-990011
Customer PO: PO-88390
Ship Via: WILL CALL / CUSTOMER PICKUP
Ship To: Riverside Medical Center

Line  Item Description                    Qty
1     COPPER ELBOW 3/4                   4

Pickup at counter — not a Johnstone invoice format.
`.trim(),
  },
  {
    pageId: "inv-firstsupply-pickup-002",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 4,
    extractedText: `
First Supply LLC
Pickup Ticket
Ticket: FS-PK-2201
PO Reference: PO-88393
Customer: Warehouse Counter Pickup

SKU FS-220   CONDENSATE PUMP KIT    Qty 1

This is a pickup ticket — not Johnstone tabular invoice layout.
`.trim(),
  },
  {
    pageId: "inv-ferguson-blank-po-003",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 5,
    extractedText: `
Ferguson HVAC Supply
Delivery Receipt
Receipt #: FR-77102
Order Date: 06/02/2026

Material delivered to dock — no purchase order line on page.
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
  "inv-ferguson-willcall-002": {
    importStatus: "issue",
    humanReviewRequired: true,
    maxConfidenceScore: 55,
    maxProductLines: 0,
  },
  "inv-firstsupply-pickup-002": {
    importStatus: "issue",
    humanReviewRequired: true,
    maxConfidenceScore: 55,
    maxProductLines: 0,
  },
  "inv-ferguson-blank-po-003": {
    importStatus: "issue",
    humanReviewRequired: true,
    maxConfidenceScore: 50,
    maxProductLines: 0,
  },
};

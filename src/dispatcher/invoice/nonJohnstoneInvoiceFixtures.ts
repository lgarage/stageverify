import type { JohnstoneInvoicePageText } from "./types";

const BATCH_ID = "batch-non-johnstone-2026-07-05";

/** Controlled non-Johnstone vendor text — generic extraction with review, not empty issue rows. */
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
    parserFormatId?: "generic" | "unknown";
    minProductLines?: number;
    maxProductLines?: number;
    minConfidenceScore?: number;
    maxConfidenceScore?: number;
    vendorInvoiceNumber?: string;
  }
> = {
  "inv-ferguson-sample-001": {
    importStatus: "pending",
    humanReviewRequired: true,
    parserFormatId: "generic",
    minProductLines: 2,
    vendorInvoiceNumber: "FE-882145",
  },
  "inv-firstsupply-sample-001": {
    importStatus: "partial",
    humanReviewRequired: true,
    parserFormatId: "generic",
    minProductLines: 1,
  },
  "inv-ferguson-willcall-002": {
    importStatus: "pickup_at_vendor",
    humanReviewRequired: true,
    parserFormatId: "generic",
    minProductLines: 1,
    vendorInvoiceNumber: "FE-990011",
  },
  "inv-firstsupply-pickup-002": {
    importStatus: "issue",
    humanReviewRequired: true,
    parserFormatId: "generic",
    minProductLines: 1,
  },
  "inv-ferguson-blank-po-003": {
    importStatus: "issue",
    humanReviewRequired: true,
    parserFormatId: "generic",
    maxProductLines: 0,
  },
};

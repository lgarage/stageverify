import type { JohnstoneInvoicePageText } from "./types";

const BATCH_ID = "batch-novel-vendor-2026-07-18";

/** Synthetic invoices from vendors with no dedicated parser — generic extraction must work. */
export const NOVEL_VENDOR_INVOICE_FIXTURES: JohnstoneInvoicePageText[] = [
  {
    pageId: "inv-monroe-equipment-001",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 1,
    extractedText: `
Monroe Equipment Company
Invoice Number: ME-44821
Purchase Order: 2026-0412
Customer Number: 552901
Ship To: Twin Pillars Heating & Cooling
Order Date: 07/10/2026
Invoice Date: 07/12/2026
Ship Via: DELIVERY TRUCK

Line  Description                         Qty
1     CONDENSER PAD 32x32                 2
2     LINE SET 25FT                       1
`.trim(),
  },
  {
    pageId: "inv-gustave-larson-001",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 2,
    extractedText: `
Gustave A. Larson Co.
Invoice # 7721903
Customer P/O: JOB SMITH RES 2026
Account # 118844
Sold To: Twin Pillars Heating & Cooling
Ship To: 123 Main St, Appleton WI

Item    Product Description              Ord   Ship
99102   GAS VALVE 24V                    1     1
99103   PILOT BURNER ASSEMBLY            2     0

Partial shipment — remainder on backorder.
`.trim(),
  },
];

export const NOVEL_VENDOR_FIXTURE_EXPECTATIONS: Record<
  string,
  {
    parserFormatId: "generic";
    vendorInvoiceNumber: string;
    customerPoOrReference: string;
    minProductLines: number;
    humanReviewRequired: boolean;
    importStatus: string;
  }
> = {
  "inv-monroe-equipment-001": {
    parserFormatId: "generic",
    vendorInvoiceNumber: "ME-44821",
    customerPoOrReference: "2026-0412",
    minProductLines: 2,
    humanReviewRequired: true,
    importStatus: "pending",
  },
  "inv-gustave-larson-001": {
    parserFormatId: "generic",
    vendorInvoiceNumber: "7721903",
    customerPoOrReference: "JOB SMITH RES 2026",
    minProductLines: 1,
    humanReviewRequired: true,
    importStatus: "partial",
  },
};

import type { JohnstoneInvoicePageText } from "./types";

const BATCH_ID = "batch-sioux-falls-2026-06-24";

const INV_6164159_TEXT = `
Johnstone Supply
Remit To: Johnstone Supply
335 N Weber Ave
Sioux Falls SD 57103

Customer #: 0018114
Sales Order #: 6164159
Invoice #: 6164159
Customer P/O #: PLANET FITNESS PICKUP
Order Date: 06/23/2026
Invoice Date: 06/23/2026
Ship Date: 06/23/2026
Buyer: CONNOR SMITH
Ship Via:
Job Number:

Sold To: TWIN PILLAR HEATING & COOLING
Ship To: TWIN PILLAR HEATING & COOLING
2944 HOLMGREN WAY, GREEN BAY WI 54304

LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 1 1 0 L46-668 TH8320R1003/U THERMOSTAT PROGRAMMABLE REDLINK
2 2 2 0 B86-380 4050-08 SEALANT REFRIGERATIO EASYSEAL

please call 605-338-2652
`.trim();

/** Controlled text fixtures mimicking PDF extraction — not production PDFs. */
export const INVOICE_FIXTURES: JohnstoneInvoicePageText[] = [
  {
    pageId: "inv-6164159",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 3,
    extractedText: INV_6164159_TEXT,
  },
  {
    pageId: "inv-6163986",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 1,
    extractedText: `
Johnstone Supply
Remit To: Johnstone Supply
335 N Weber Ave
Sioux Falls SD 57103

Customer #: 0018114
Sales Order #: 6163986
Invoice #: 6163986
Customer P/O #: La Crosse PF
Order Date: 06/22/2026
Invoice Date: 06/22/2026
Ship Date: 06/22/2026
Buyer: GAVIN PHILIPPON
Ship Via: TRUCK DELIVE
Job Number:

Invoice Message: Quote Number: Q618468

Sold To: TWIN PILLAR HEATING & COOLING
Ship To: TWIN PILLAR HEATING & COOLING
2944 HOLMGREN WAY, GREEN BAY WI 54304

LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 1 1 0 NS10762605 105105 GREENHECK FAN
2 DAY LEAD
NON STOCK, RESTOCK FEE APPLIES
2 1 0 1 NS99999999 999999 BACKORDERED PART

CUSTOMER PAYS FREIGHT
Floor-Loc: GREEN
please call 605-338-2652
`.trim(),
  },
  {
    pageId: "inv-6164242",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 7,
    extractedText: `
Johnstone Supply
Remit To: Johnstone Supply
335 N Weber Ave
Sioux Falls SD 57103

Customer #: 0018114
Sales Order #: 6164242
Invoice #: 6164242
Customer P/O #: TOPS STOCK PICKUP
Order Date: 06/23/2026
Invoice Date: 06/23/2026
Ship Date: 06/23/2026
Buyer: CONNOR SMITH
Ship Via:
Job Number:

Sold To: TWIN PILLAR HEATING & COOLING
Ship To: TWIN PILLAR HEATING & COOLING
2944 HOLMGREN WAY, GREEN BAY WI 54304

LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 2 2 0 AOX-016 R410A-25 R410A CYLINDER
2 1 1 0 CORE-16 CORE CHARGE
3 1 -1 0 AOX-045 R410A-25 Return from Invoice # 6164000
4 1 1 0 AOX-045 R410A-25 R410A CYLINDER

please call 605-338-2652
`.trim(),
  },
  {
    pageId: "inv-6164100-truck",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 5,
    extractedText: `
Johnstone Supply
Remit To: Johnstone Supply
335 N Weber Ave
Sioux Falls SD 57103

Customer #: 0018114
Sales Order #: 6164100
Invoice #: 6164100
Customer P/O #: TRUCK STOCK PICKUP
Order Date: 06/23/2026
Invoice Date: 06/23/2026
Ship Date: 06/23/2026
Buyer: CONNOR SMITH
Ship Via:

Sold To: TWIN PILLAR HEATING & COOLING
Ship To: TWIN PILLAR HEATING & COOLING
2944 HOLMGREN WAY, GREEN BAY WI 54304

LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 1 1 0 L46-100 TEST-001 FILTER DRIER

please call 605-338-2652
`.trim(),
  },
  {
    pageId: "inv-6164101-exhaust",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 2,
    extractedText: `
Johnstone Supply
Remit To: Johnstone Supply
335 N Weber Ave
Sioux Falls SD 57103

Customer #: 0018114
Sales Order #: 6164101
Invoice #: 6164101
Customer P/O #: EXHAUST FANS PICKUP
Order Date: 06/23/2026
Invoice Date: 06/23/2026
Ship Date: 06/23/2026
Buyer: CONNOR SMITH
Ship Via:

Sold To: TWIN PILLAR HEATING & COOLING
Ship To: TWIN PILLAR HEATING & COOLING
2944 HOLMGREN WAY, GREEN BAY WI 54304

LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 3 3 0 B86-100 FAN-MOTOR EXHAUST FAN MOTOR

please call 605-338-2652
`.trim(),
  },
  {
    pageId: "inv-6164102-kalafat",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 0,
    extractedText: `
Johnstone Supply
Remit To: Johnstone Supply
335 N Weber Ave
Sioux Falls SD 57103

Customer #: 0018114
Sales Order #: 6164102
Invoice #: 6164102
Customer P/O #: KALAFAT Tuesday John
Order Date: 06/22/2026
Invoice Date: 06/22/2026
Ship Date: 06/22/2026
Buyer: GAVIN PHILIPPON
Ship Via:

Sold To: TWIN PILLAR HEATING & COOLING
Ship To: TWIN PILLAR HEATING & COOLING
2944 HOLMGREN WAY, GREEN BAY WI 54304

LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 1 1 0 L46-200 PART-001 REPAIR PART

please call 605-338-2652
`.trim(),
  },
  {
    pageId: "inv-6164159-dup",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 99,
    extractedText: INV_6164159_TEXT,
  },
  {
    pageId: "inv-pickup-all-backorder",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 10,
    extractedText: `
Johnstone Supply
Remit To: Johnstone Supply
335 N Weber Ave
Sioux Falls SD 57103

Customer #: 0018114
Sales Order #: 6164300
Invoice #: 6164300
Customer P/O #: PLANET FITNESS PICKUP
Order Date: 06/24/2026
Invoice Date: 06/24/2026
Ship Date: 06/24/2026
Buyer: CONNOR SMITH
Ship Via:
Job Number:

Sold To: TWIN PILLAR HEATING & COOLING
Ship To: TWIN PILLAR HEATING & COOLING
2944 HOLMGREN WAY, GREEN BAY WI 54304

LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 2 0 2 L46-668 TH8320R1003/U THERMOSTAT PROGRAMMABLE REDLINK
2 1 0 1 B86-380 4050-08 SEALANT REFRIGERATIO EASYSEAL

please call 605-338-2652
`.trim(),
  },
  {
    pageId: "inv-pickup-partial-backorder",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 11,
    extractedText: `
Johnstone Supply
Remit To: Johnstone Supply
335 N Weber Ave
Sioux Falls SD 57103

Customer #: 0018114
Sales Order #: 6164301
Invoice #: 6164301
Customer P/O #: TRUCK STOCK PICKUP
Order Date: 06/24/2026
Invoice Date: 06/24/2026
Ship Date: 06/24/2026
Buyer: CONNOR SMITH
Ship Via:
Job Number:

Sold To: TWIN PILLAR HEATING & COOLING
Ship To: TWIN PILLAR HEATING & COOLING
2944 HOLMGREN WAY, GREEN BAY WI 54304

LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 1 1 0 L46-100 TEST-001 FILTER DRIER
2 2 0 2 B86-200 TEST-002 EXPANSION VALVE

please call 605-338-2652
`.trim(),
  },
  {
    pageId: "inv-delivery-all-backorder",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 12,
    extractedText: `
Johnstone Supply
Remit To: Johnstone Supply
335 N Weber Ave
Sioux Falls SD 57103

Customer #: 0018114
Sales Order #: 6164302
Invoice #: 6164302
Customer P/O #: La Crosse PF
Order Date: 06/24/2026
Invoice Date: 06/24/2026
Ship Date: 06/24/2026
Buyer: GAVIN PHILIPPON
Ship Via: TRUCK DELIVE
Job Number:

Sold To: TWIN PILLAR HEATING & COOLING
Ship To: TWIN PILLAR HEATING & COOLING
2944 HOLMGREN WAY, GREEN BAY WI 54304

LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 1 0 1 NS10762605 105105 GREENHECK FAN
2 3 0 3 NS99999999 999999 BACKORDERED PART

please call 605-338-2652
`.trim(),
  },
  {
    pageId: "inv-ambiguous-all-backorder",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 13,
    extractedText: `
Johnstone Supply
Remit To: Johnstone Supply
335 N Weber Ave
Sioux Falls SD 57103

Customer #: 0018114
Sales Order #: 6164303
Invoice #: 6164303
Customer P/O #: KALAFAT Tuesday John
Order Date: 06/24/2026
Invoice Date: 06/24/2026
Ship Date: 06/24/2026
Buyer: GAVIN PHILIPPON
Ship Via:
Job Number:

Sold To: TWIN PILLAR HEATING & COOLING
Ship To: TWIN PILLAR HEATING & COOLING
2944 HOLMGREN WAY, GREEN BAY WI 54304

LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 2 0 2 L46-200 PART-001 REPAIR PART

please call 605-338-2652
`.trim(),
  },
  {
    pageId: "inv-partial-delivery",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 14,
    extractedText: `
Johnstone Supply
Remit To: Johnstone Supply
335 N Weber Ave
Sioux Falls SD 57103

Customer #: 0018114
Sales Order #: 6164304
Invoice #: 6164304
Customer P/O #: La Crosse PF
Order Date: 06/24/2026
Invoice Date: 06/24/2026
Ship Date: 06/24/2026
Buyer: GAVIN PHILIPPON
Ship Via: TRUCK DELIVE
Job Number:

Sold To: TWIN PILLAR HEATING & COOLING
Ship To: TWIN PILLAR HEATING & COOLING
2944 HOLMGREN WAY, GREEN BAY WI 54304

LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 3 2 0 L46-668 TH8320R1003/U THERMOSTAT PROGRAMMABLE REDLINK
2 1 1 0 B86-380 4050-08 SEALANT REFRIGERATIO EASYSEAL

please call 605-338-2652
`.trim(),
  },
  {
    pageId: "inv-ship-complete-hold",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 15,
    extractedText: `
Johnstone Supply
Remit To: Johnstone Supply
335 N Weber Ave
Sioux Falls SD 57103

Customer #: 0018114
Sales Order #: 6164305
Invoice #: 6164305
Customer P/O #: La Crosse PF
Order Date: 06/24/2026
Invoice Date: 06/24/2026
Ship Date: 06/24/2026
Buyer: GAVIN PHILIPPON
Ship Via: TRUCK DELIVE
Job Number:

Invoice Message: SHIP COMPLETE — DELIVERY HOLD until all lines available

Sold To: TWIN PILLAR HEATING & COOLING
Ship To: TWIN PILLAR HEATING & COOLING
2944 HOLMGREN WAY, GREEN BAY WI 54304

LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 2 0 2 NS10762605 105105 GREENHECK FAN
2 1 0 1 NS99999999 999999 BACKORDERED PART

please call 605-338-2652
`.trim(),
  },
  {
    pageId: "inv-backorder-truck-delive",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 16,
    extractedText: `
Johnstone Supply
Remit To: Johnstone Supply
335 N Weber Ave
Sioux Falls SD 57103

Customer #: 0018114
Sales Order #: 6164306
Invoice #: 6164306
Customer P/O #: La Crosse PF
Order Date: 06/24/2026
Invoice Date: 06/24/2026
Ship Date: 06/24/2026
Buyer: GAVIN PHILIPPON
Ship Via: TRUCK DELIVE
Job Number:

Sold To: TWIN PILLAR HEATING & COOLING
Ship To: TWIN PILLAR HEATING & COOLING
2944 HOLMGREN WAY, GREEN BAY WI 54304

LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 1 0 1 NS10762605 105105 GREENHECK FAN
2 2 1 1 B86-380 4050-08 SEALANT REFRIGERATIO EASYSEAL

please call 605-338-2652
`.trim(),
  },
  {
    pageId: "inv-so-4046362",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 20,
    extractedText: `
Johnstone Supply - Sioux Falls
SALES ORDER CONFIRMATION
Remit To: Johnstone Supply
335 N Weber Ave Sioux Falls SD 57103

Customer # Sales Order # Customer P/O # Order Date
0018114 4046362 blackduck hartford 06/23/2026
Buyer Ship Via Job Number
CONNOR SMITH TRUCK DELIVE

Sold To: TWIN PILLAR HEATING & COOLING
Ship To: TWIN PILLAR HEATING & COOLING

LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 2 2 0 L46-668 THERMOSTAT PROGRAMMABLE

please call 605-338-2652
`.trim(),
  },
  {
    pageId: "inv-so-4046362-colon",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 21,
    extractedText: `
Johnstone Supply
Customer #: 0018114
Sales Order #: 4046362
Customer P/O #: blackduck hartford
Order Date: 06/23/2026
Buyer: CONNOR SMITH
Ship Via: TRUCK DELIVE

LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 1 1 0 L46-668 THERMOSTAT
`.trim(),
  },
  {
    pageId: "inv-so-4046362-invoice-date",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 22,
    extractedText: `
Johnstone Supply
Customer #: 0018114
Sales Order #: 4046362
Customer P/O #: blackduck hartford
Order Date: 06/23/2026
Invoice Date: 06/23/2026
Buyer: CONNOR SMITH

LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 1 1 0 L46-668 THERMOSTAT
`.trim(),
  },
];

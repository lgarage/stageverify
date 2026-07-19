import type { JohnstoneInvoicePageText } from "./types";

const BATCH_ID = "batch-firstsupply-dan-2026-02-24";

/** Golden fixtures from Dan's First Supply PDF (text extract only — PDF not committed). */
export const FIRST_SUPPLY_INVOICE_FIXTURES: JohnstoneInvoicePageText[] = [
  {
    pageId: "inv-firstsupply-15047500-00",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 0,
    extractedText: `Invoice
Customer # 91132956
First Supply LLC-Appleton
P.O. Box 78614 Invoice # 15047500-00
Milwaukee, WI 53278-8614
Page # 1 of 1
(608)222-7799
Ship Point First Supply LLC - Appleton
Via COUNTER PU
Terms 1%10Prox+1mo
D Ordered 02/24/26
A Picked 02/24/26
T Shipped 02/24/26
E Invoiced 02/24/26
BILL TO:
S Printed 02/24/26 19:46
SHIP TO:
Twin Pillars Heating & Cooling Twin Pillars Heating & Cooling
55 Jewelers Park Dr 55 Jewelers Park Dr
Neenah WI 54956
Neenah, WI 54956
Taken By scwi Sales In scwi Sales Out aplh Placed By Customer P/O 2026-152
Instructions
Product and Quantity Quantity Quantity Qty. Unit Amount
Ln #
Description Ordered B.O. Shipped UM Price (Net)
1 MHARDK10 20.00 0.00 20.00 FT 29.82 596.40
2X10 M HARD COP TUBE
2 P40PEPG20 20.00 0.00 20.00 FT 0.37 7.40
1X20 SCH40 PVC PLAIN END PIPE
3 P40S90G 6.00 0.00 6.00 EA 1.11 6.66
406-010 1 SCH40 PVC SXS 90 ELL
4 CON10077753 2.00 0.00 2.00 EA 51.81 103.62
811 11/2X11/2X1 PRESS COP CXCXC TEE 10077753
5 CON10075076 1.00 0.00 1.00 EA 63.22 63.22
1015076 807-2 2 FTGXC 90 ELL(ALT FOR 10075076)
5 Lines Total Total 777.30
Taxes 42.75
Invoice Total 820.05
Cash Discount 7.77 If Paid By 04/10/26
TO VIEW ONLINE GO TO: http://firstsupply.billtrust.com
CUSTOMER COPY Page 1 of 1
USE THIS ENROLLMENT TOKEN: DQG WQZ SHX`,
  },
  {
    pageId: "inv-firstsupply-15046467-00",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 1,
    extractedText: `Invoice
Customer # 91132956
First Supply LLC-Green Bay
P.O. Box 78614 Invoice # 15046467-00
Milwaukee, WI 53278-8614
Page # 1 of 1
(608)222-7799
Ship Point First Supply LLC - Green Bay
Via EXPRESS PU
Terms 1%10Prox+1mo
D Ordered 02/24/26
A Picked 02/24/26
T Shipped 02/24/26
E Invoiced 02/24/26
BILL TO:
S Printed 02/24/26 19:47
SHIP TO:
Twin Pillars Heating & Cooling Twin Pillars Heating & Cooling
55 Jewelers Park Dr 55 Jewelers Park Dr
Neenah WI 54956
Neenah, WI 54956
Taken By kebe Sales In kebe Sales Out aplh Placed By logan Customer P/O 2026-0200
Instructions
Product and Quantity Quantity Quantity Qty. Unit Amount
Ln #
Description Ordered B.O. Shipped UM Price (Net)
1 CON10075130 10.00 0.00 10.00 EA 42.13 421.30
801-R 2X11/2 PRESS COP REDU CPLG 10075130
2 CON10075074 3.00 0.00 3.00 EA 44.53 133.59
807-2 11/2 FTGXP PRESS COP ST 90 ELL 10075074
3 PWR7481430 6.00 0.00 6.00 EA 28.11 168.66
407G 1 PXP 90 ELL POWERPRESS GAS
4 PWR7481551 2.00 0.00 2.00 EA 32.00 64.00
406G 1 PXP 45 ELL POWERPRESS GAS
5 PWR7482101 2.00 0.00 2.00 EA 35.46 70.92
404G 1 PXM ADAPTER POWERPRESS GAS
6 MIL48005784 1.00 0.00 1.00 EA 15.97 15.97
48-00-5784 6 18T (5/PK) TORCH SAWZALL BLADE
6 Lines Total Total 874.44
Taxes 48.10
Invoice Total 922.54
Cash Discount 8.74 If Paid By 04/10/26
TO VIEW ONLINE GO TO: http://firstsupply.billtrust.com
CUSTOMER COPY Page 1 of 1
USE THIS ENROLLMENT TOKEN: DQG WQZ SHX`,
  },
  {
    pageId: "inv-firstsupply-3869488-00",
    importBatchId: BATCH_ID,
    pageIndexInBatch: 2,
    extractedText: `Invoice
Customer # 91132956
First Supply LLC-Oshkosh
P.O. Box 78614 Invoice # 3869488-00
Milwaukee, WI 53278-8614
Page # 1 of 1
(608)222-7799
Ship Point First Supply LLC - Oshkosh
Via EXPRESS PU
Terms 1%10Prox+1mo
D Ordered 02/24/26
A Picked 02/24/26
T Shipped 02/24/26
E Invoiced 02/24/26
BILL TO:
S Printed 02/24/26 19:48
SHIP TO:
Twin Pillars Heating & Cooling Twin Pillars Heating & Cooling
55 Jewelers Park Dr 55 Jewelers Park Dr
Neenah WI 54956
Neenah, WI 54956
Taken By kebe Sales In kebe Sales Out aplh Placed By logan Customer P/O 2026-0200
Instructions
Product and Quantity Quantity Quantity Qty. Unit Amount
Ln #
Description Ordered B.O. Shipped UM Price (Net)
1 RWCUP256 114.00 0.00 114.00 EA 1.10 125.40
UP256 3/4 PEX POLY 90 ELL
1 Lines Total Total 125.40
Taxes 6.27
Invoice Total 131.67
Cash Discount 1.25 If Paid By 04/10/26
TO VIEW ONLINE GO TO: http://firstsupply.billtrust.com
CUSTOMER COPY Page 1 of 1
USE THIS ENROLLMENT TOKEN: DQG WQZ SHX`,
  },
];

export const FIRST_SUPPLY_FIXTURE_EXPECTATIONS: Record<
  string,
  {
    parserFormatId: "first_supply";
    vendorInvoiceNumber: string;
    customerPoOrReference: string;
    vendorBranchContains: string;
    importStatus: string;
    lineCount: number;
    fulfillmentMethod: string;
  }
> = {
  "inv-firstsupply-15047500-00": {
    parserFormatId: "first_supply",
    vendorInvoiceNumber: "15047500-00",
    customerPoOrReference: "2026-152",
    vendorBranchContains: "Appleton",
    importStatus: "pickup_at_vendor",
    lineCount: 5,
    fulfillmentMethod: "will_call_pickup",
  },
  "inv-firstsupply-15046467-00": {
    parserFormatId: "first_supply",
    vendorInvoiceNumber: "15046467-00",
    customerPoOrReference: "2026-0200",
    vendorBranchContains: "Green Bay",
    importStatus: "pickup_at_vendor",
    lineCount: 6,
    fulfillmentMethod: "will_call_pickup",
  },
  "inv-firstsupply-3869488-00": {
    parserFormatId: "first_supply",
    vendorInvoiceNumber: "3869488-00",
    customerPoOrReference: "2026-0200",
    vendorBranchContains: "Oshkosh",
    importStatus: "pickup_at_vendor",
    lineCount: 1,
    fulfillmentMethod: "will_call_pickup",
  },
};

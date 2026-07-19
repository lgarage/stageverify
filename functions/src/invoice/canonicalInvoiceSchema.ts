/** Canonical invoice header fields — vendor-agnostic label synonyms for text search. */
export const CANONICAL_HEADER_LABELS: Record<string, readonly string[]> = {
  vendorInvoiceNumber: [
    "Invoice Number",
    "Invoice #",
    "Invoice No",
    "Inv #",
    "Receipt #",
    "Receipt Number",
    "Ticket",
    "Ticket #",
  ],
  vendorOrderNumber: [
    "Sales Order #",
    "Sales Order Number",
    "SO Number",
    "Order Number",
    "Order #",
    "S/O #",
  ],
  customerPoOrReference: [
    "Purchase Order",
    "Customer PO",
    "Customer P/O",
    "PO Reference",
    "PO #",
    "P/O",
    "PO Number",
  ],
  customerAccountNumber: ["Customer #", "Customer Number", "Account #", "Account Number"],
  orderDate: ["Order Date"],
  invoiceDate: ["Invoice Date", "Inv Date"],
  shipDate: ["Ship Date", "Shipped Date"],
  shipViaRaw: ["Ship Via", "Via", "Shipping Method"],
  soldToName: ["Sold To", "Bill To"],
  shipToName: ["Ship To", "Deliver To", "Ship To Name"],
  buyerName: ["Buyer", "Buyer Name"],
  quoteNumber: ["Quote #", "Quote Number"],
};

/** Company-name hints on the first lines of extracted PDF text. */
export const VENDOR_COMPANY_SUFFIX =
  /\b(?:LLC|Inc\.?|Corp\.?|Company|Co\.|Supply|Enterprises|Distributors?|HVAC)\b/i;

import type { VendorInvoiceImportReview } from "../models";
import { vendorInvoiceImportDisplayLabelForRow } from "./invoiceDisplayHelpers";
import {
  documentTypeLabel,
  inferDocumentType,
} from "./inferDocumentType";
import {
  formatInvoiceHeaderField,
  readInvoiceHeaderField,
} from "./invoiceReviewHeaderHelpers";
import type { VendorInvoiceImportStatus } from "./types";

export type ExpectedFieldStatus = "found" | "missing" | "questionable" | "na";

export interface ExpectedFieldRow {
  field: string;
  expectedForInvoice: string;
  actualValue: string;
  status: ExpectedFieldStatus;
  notes: string;
}

export interface ExpectedFieldsSummary {
  documentType: string;
  importStatus: string;
  reviewStatus: string;
  approvalEligible: boolean;
  blockReason: string;
  zeroLinesNote?: string;
  rows: ExpectedFieldRow[];
  lineRows: ExpectedFieldRow[];
}

function statusFrom(
  expectedInDoc: boolean,
  actual: string,
  questionable = false,
): ExpectedFieldStatus {
  const hasActual = actual.trim() !== "" && actual !== "—";
  if (!expectedInDoc && !hasActual) return "na";
  if (hasActual) return questionable ? "questionable" : "found";
  if (expectedInDoc) return "missing";
  return "na";
}

function reviewStatusLabel(
  status: VendorInvoiceImportReview["reviewStatus"],
): string {
  if (status === "pending_review") return "Pending review";
  if (status === "approved") return "Approved";
  return "Rejected";
}

function buildHeaderRows(importRow: VendorInvoiceImportReview): ExpectedFieldRow[] {
  const header = importRow.parsedHeader;
  const docType = inferDocumentType(importRow);
  const isSoConfirmation = docType === "sales_order_confirmation";

  const defs: Array<{
    field: string;
    key: string;
    expectedForInvoice: string;
    expectedInThisDoc: boolean;
    questionable?: boolean;
  }> = [
    { field: "Customer account #", key: "customerAccountNumber", expectedForInvoice: "Yes", expectedInThisDoc: true },
    { field: "Vendor / branch", key: "vendorBranchName", expectedForInvoice: "Yes", expectedInThisDoc: true },
    { field: "Vendor order / S/O #", key: "vendorOrderNumber", expectedForInvoice: "Yes", expectedInThisDoc: true },
    { field: "Vendor invoice #", key: "vendorInvoiceNumber", expectedForInvoice: "Yes", expectedInThisDoc: !isSoConfirmation },
    { field: "Customer P/O", key: "customerPoOrReference", expectedForInvoice: "Yes", expectedInThisDoc: true },
    { field: "Buyer", key: "buyerName", expectedForInvoice: "Often", expectedInThisDoc: true },
    { field: "Sold to", key: "soldToName", expectedForInvoice: "Often", expectedInThisDoc: !isSoConfirmation },
    { field: "Ship to", key: "shipToName", expectedForInvoice: "Often", expectedInThisDoc: !isSoConfirmation },
    { field: "Order date", key: "orderDate", expectedForInvoice: "Yes", expectedInThisDoc: true },
    { field: "Invoice date", key: "invoiceDate", expectedForInvoice: "Invoices", expectedInThisDoc: !isSoConfirmation },
    { field: "Ship via / fulfillment", key: "shipViaRaw", expectedForInvoice: "Often", expectedInThisDoc: true },
    { field: "Payment terms", key: "paymentTermsRaw", expectedForInvoice: "When present", expectedInThisDoc: false },
    { field: "Ship-complete flag", key: "shipCompletePolicy", expectedForInvoice: "When present", expectedInThisDoc: false },
  ];

  return defs.map((d) => {
    const raw =
      d.key === "shipCompletePolicy"
        ? readInvoiceHeaderField(header, d.key) || readInvoiceHeaderField(header, "fulfillmentMethod")
        : readInvoiceHeaderField(header, d.key);
    const actual = formatInvoiceHeaderField(raw);
    let notes = "";
    if (d.key === "vendorInvoiceNumber" && isSoConfirmation && !raw) {
      notes = "S/O confirmations omit Invoice # — blocks approve until billable invoice arrives.";
    }
    if (d.key === "vendorOrderNumber" && !raw && importRow.pageId === "page-0") {
      notes = "Empty header often means PDF text extraction failed (garbled extract), not parser miss on clean text.";
    }
    return {
      field: d.field,
      expectedForInvoice: d.expectedForInvoice,
      actualValue: actual,
      status: statusFrom(d.expectedInThisDoc, actual, d.questionable),
      notes,
    };
  });
}

function buildLineRows(importRow: VendorInvoiceImportReview): ExpectedFieldRow[] {
  const lines = importRow.parsedLines ?? [];
  const lineCount = importRow.parsedLineCount ?? lines.length;
  const orderNum = readInvoiceHeaderField(importRow.parsedHeader, "vendorOrderNumber");

  if (lineCount === 0) {
    let notes =
      "No lines stored. If the PDF had a line table, use Refresh Now to reprocess from cached extracted text.";
    if (orderNum === "4046362") {
      notes =
        "Fixture inv-so-4046362 yields 1 line from clean text; zero here → extract/backfill issue — try Refresh Now reprocess.";
    }
    return [
      {
        field: "Line items",
        expectedForInvoice: "Yes",
        actualValue: "0 lines",
        status: "missing",
        notes,
      },
    ];
  }

  const first = lines[0];
  return [
    {
      field: "Product code",
      expectedForInvoice: "Yes",
      actualValue: first?.vendorProductNumber ?? "—",
      status: statusFrom(true, first?.vendorProductNumber ?? ""),
      notes: `${lineCount} line(s) parsed`,
    },
    {
      field: "Description",
      expectedForInvoice: "Yes",
      actualValue: first?.description ?? "—",
      status: statusFrom(true, first?.description ?? ""),
      notes: "",
    },
    {
      field: "Qty ordered / shipped",
      expectedForInvoice: "Yes",
      actualValue: `${first?.quantityOrdered ?? "—"} / ${first?.quantityShipped ?? "—"}`,
      status: statusFrom(true, String(first?.quantityOrdered ?? "")),
      notes: "",
    },
    {
      field: "UOM / backorder",
      expectedForInvoice: "When present",
      actualValue: `B/O ${first?.quantityBackordered ?? 0}`,
      status: first?.quantityBackordered != null ? "found" : "na",
      notes: "",
    },
  ];
}

export function buildExpectedJohnstoneFieldChecklist(
  importRow: VendorInvoiceImportReview,
): ExpectedFieldsSummary {
  const approveBlocked = importRow.importStatus === "issue";
  const lineCount = importRow.parsedLineCount ?? importRow.parsedLines?.length ?? 0;
  const blockReason =
    importRow.error?.trim() ||
    (approveBlocked
      ? "Issue import — missing required fields (e.g. Invoice # on S/O confirmation)."
      : "");

  const zeroLinesNote =
    lineCount === 0
      ? "Zero parsed lines — may need Refresh Now reprocess if the PDF has line items."
      : undefined;

  return {
    documentType: documentTypeLabel(inferDocumentType(importRow)),
    importStatus: vendorInvoiceImportDisplayLabelForRow(
      importRow.importStatus as VendorInvoiceImportStatus,
      importRow.orderNotes,
    ),
    reviewStatus: reviewStatusLabel(importRow.reviewStatus),
    approvalEligible:
      (importRow.reviewStatus === "pending_review" ||
        importRow.reviewStatus === "rejected") &&
      !approveBlocked,
    blockReason,
    zeroLinesNote,
    rows: buildHeaderRows(importRow),
    lineRows: buildLineRows(importRow),
  };
}

export function statusLabel(status: ExpectedFieldStatus): string {
  if (status === "found") return "Found";
  if (status === "missing") return "Missing";
  if (status === "questionable") return "Questionable";
  return "N/A";
}

export function statusColor(status: ExpectedFieldStatus): string {
  if (status === "found") return "#166534";
  if (status === "missing") return "#991b1b";
  if (status === "questionable") return "#9a3412";
  return "#6b7280";
}

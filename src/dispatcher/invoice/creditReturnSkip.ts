/**
 * Johnstone CREDIT / return memo detection and apply-now dismiss when training notes teach ignore.
 */
import type { ParsedJohnstoneInvoice } from "./types";
import type { VendorInvoiceImportReview } from "../models";
import type { VendorInvoiceImportStatus } from "./types";
import {
  normalizeParsedHeader,
  readInvoiceHeaderField,
} from "./invoiceReviewHeaderHelpers";

export const CREDIT_RETURN_SKIP_REASON = "credit_return" as const;

/** Taught fingerprint ignore (any document type) — system auto-skip. */
export const DOCUMENT_IGNORE_SKIP_REASON = "document_ignore" as const;

/** Exact business-invoice resend (new Gmail message, same vendor invoice). */
export const DUPLICATE_BUSINESS_INVOICE_SKIP_REASON =
  "duplicate_business_invoice" as const;

export const DUPLICATE_BUSINESS_INVOICE_SKIP_LABEL =
  "Skipped — duplicate invoice resend";

/** Legacy auto-skipped / manually dismissed credit imports in Rejected archive. */
export const CREDIT_RETURN_SKIP_LABEL = "Skipped — credit/return";

/** System auto-skip after vendor ignore rule taught + confirmed. */
export const CREDIT_RETURN_AUTO_SKIP_LABEL =
  "Auto-skipped — vendor ignore rule";

/** Pending queue — user must reject manually (no auto-reject on ingest). */
export const CREDIT_RETURN_ADVISORY_LABEL =
  "Credit/return — reject manually";

function parsedBranchIsCredit(branchRaw: string | undefined): boolean {
  const branch = (branchRaw ?? "").trim();
  return branch.length > 0 && /^CREDIT$/i.test(branch);
}

function pageTextSignalsBranchCredit(text: string): boolean {
  return (
    /\bBranch\s*[=:]\s*CREDIT\b/i.test(text) ||
    /\bBRANCH\s+CREDIT\b/i.test(text)
  );
}

function coerceLineQty(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

type CreditScanLine = {
  quantityShipped?: number | string;
  lineType?: string;
  description?: string;
};

/** Line-item credit/return — not enough to classify the whole document. */
function lineIsCreditOrReturn(line: CreditScanLine): boolean {
  const qty = coerceLineQty(line.quantityShipped);
  return (
    line.lineType === "return" ||
    qty < 0 ||
    /return from invoice/i.test(line.description ?? "")
  );
}

/** Purchased product still on the invoice — document stays a normal invoice. */
function isPurchasedProductLine(line: CreditScanLine): boolean {
  if (lineIsCreditOrReturn(line)) return false;
  if (line.lineType && line.lineType !== "product") return false;
  return coerceLineQty(line.quantityShipped) >= 0;
}

/**
 * Document-level only when every remaining line is a credit/return
 * (or notes say return-from-invoice and no purchased products remain).
 */
function linesIndicateDocumentLevelCredit(
  lines: CreditScanLine[],
  notes: readonly string[] = [],
): boolean {
  if (lines.some(isPurchasedProductLine)) return false;
  return (
    lines.some(lineIsCreditOrReturn) ||
    notes.some((n) => /return from invoice/i.test(n))
  );
}

/** User-visible label when skipReason is credit_return, document_ignore, or duplicate resend. */
export function creditReturnSkipLabel(
  skipReason?: string,
  rejectedBy?: string,
): string | null {
  if (skipReason === DUPLICATE_BUSINESS_INVOICE_SKIP_REASON) {
    return DUPLICATE_BUSINESS_INVOICE_SKIP_LABEL;
  }
  if (skipReason === DOCUMENT_IGNORE_SKIP_REASON) {
    return CREDIT_RETURN_AUTO_SKIP_LABEL;
  }
  if (skipReason !== CREDIT_RETURN_SKIP_REASON) return null;
  if (
    rejectedBy === "system:credit_return_skip" ||
    rejectedBy === "system:document_ignore_skip" ||
    rejectedBy === "system:duplicate_business_invoice"
  ) {
    return CREDIT_RETURN_AUTO_SKIP_LABEL;
  }
  return CREDIT_RETURN_SKIP_LABEL;
}

export function isSystemIgnoreSkipReason(skipReason?: string): boolean {
  return (
    skipReason === CREDIT_RETURN_SKIP_REASON ||
    skipReason === DOCUMENT_IGNORE_SKIP_REASON ||
    skipReason === DUPLICATE_BUSINESS_INVOICE_SKIP_REASON
  );
}

/** Keep in sync with functions/src/invoice/creditReturnSkip.ts SYSTEM_AUTO_REJECTED_BY. */
const SYSTEM_AUTO_REJECTED_BY = [
  "system:credit_return_skip",
  "system:document_ignore_skip",
  "system:duplicate_business_invoice",
] as const;

/**
 * Rejected by ingest/auto-skip — eligible for Re-open.
 * Manual (dispatcher uid) rejections are sticky and must not offer Re-open.
 */
export function isSystemAutoRejectedImport(doc?: {
  reviewStatus?: string;
  rejectedBy?: string;
}): boolean {
  return (
    doc?.reviewStatus === "rejected" &&
    typeof doc.rejectedBy === "string" &&
    (SYSTEM_AUTO_REJECTED_BY as readonly string[]).includes(doc.rejectedBy)
  );
}

/** Pending credit/return imports — prominent advisory (not auto-rejected). */
export function creditReturnAdvisoryLabel(
  importRow: Pick<
    VendorInvoiceImportReview,
    "reviewStatus" | "parsedHeader" | "parsedLines" | "orderNotes" | "skipReason"
  >,
): string | null {
  if (importRow.reviewStatus !== "pending_review") return null;
  if (creditReturnSkipLabel(importRow.skipReason)) return null;
  if (isCreditReturnImportDoc(importRow)) return CREDIT_RETURN_ADVISORY_LABEL;
  return null;
}

/** Credit/return memos are auto-skipped — do not surface as Issue when only return lines parsed. */
export function importStatusForCreditSkip(
  parsed: ParsedJohnstoneInvoice,
  pageText: string,
  baseStatus: VendorInvoiceImportStatus,
): VendorInvoiceImportStatus {
  if (!isCreditReturnInvoice(parsed, pageText)) return baseStatus;
  if (baseStatus === "issue") return "pending";
  return baseStatus;
}

/** Structural signals — auto-skip on ingest / refresh (regex-owned routing). */
export function isCreditReturnInvoice(
  parsed: ParsedJohnstoneInvoice,
  pageText: string,
): boolean {
  const text = pageText ?? "";
  if (/^\s*CREDIT\b/m.test(text)) return true;
  if (pageTextSignalsBranchCredit(text)) return true;
  if (/\bCREDIT\s+MEMO\b/i.test(text)) return true;
  if (parsedBranchIsCredit(parsed.header.vendorBranchName)) return true;

  const po = (parsed.header.customerPoOrReference ?? "").trim();
  const returnPo = /\bRETURN\b/i.test(po) && /\b(PICKUP|CREDIT)\b/i.test(po);

  if (parsed.lines.length === 0) {
    return returnPo || parsedBranchIsCredit(parsed.header.vendorBranchName);
  }

  if (returnPo && !parsed.lines.some(isPurchasedProductLine)) return true;

  return linesIndicateDocumentLevelCredit(parsed.lines, parsed.orderNotes);
}

/** Detect ignore-CREDIT/returns intent in a generalized training note. */
export function correctionNoteTeachesIgnoreCreditReturns(note: string): boolean {
  const n = note.trim();
  if (!n) return false;
  if (/\bignore\b[\s\S]{0,40}\b(credit|returns?)\b/i.test(n)) return true;
  if (/\bskip\b[\s\S]{0,40}\b(credit|returns?)\b/i.test(n)) return true;
  if (/\bdismiss\b[\s\S]{0,40}\b(credit|returns?)\b/i.test(n)) return true;
  if (/\b(credit|returns?)\b[\s\S]{0,40}\b(ignore|skip|dismiss)\b/i.test(n)) return true;
  if (/\bCREDIT\b/.test(n) && /\b(ignore|skip|negative\s+qty)\b/i.test(n)) return true;
  return false;
}

export function isCreditReturnImportDoc(
  doc: Pick<
    VendorInvoiceImportReview,
    "parsedHeader" | "parsedLines" | "orderNotes"
  >,
): boolean {
  const header = normalizeParsedHeader(doc.parsedHeader);
  const branch = readInvoiceHeaderField(header, "vendorBranchName");
  if (parsedBranchIsCredit(branch)) return true;

  const po = readInvoiceHeaderField(header, "customerPoOrReference");
  const notes = doc.orderNotes ?? [];
  if (notes.some((n) => /CREDIT\/return memo/i.test(n))) return true;

  const lines = (doc.parsedLines ?? []).map((line) => ({
    ...line,
    quantityShipped: coerceLineQty(line.quantityShipped),
    quantityOrdered: coerceLineQty(line.quantityOrdered),
  }));
  if (lines.length === 0) {
    return /\bRETURN\b/i.test(po) || parsedBranchIsCredit(branch);
  }

  const returnPo = /\bRETURN\b/i.test(po) && /\b(PICKUP|CREDIT)\b/i.test(po);
  if (returnPo && !lines.some(isPurchasedProductLine)) return true;

  return linesIndicateDocumentLevelCredit(lines, notes);
}

/** Apply-now: dismiss current import when note teaches ignore and import is CREDIT/return. */
export function shouldApplyNowDismissCreditImport(
  note: string,
  doc: Pick<
    VendorInvoiceImportReview,
    "parsedHeader" | "parsedLines" | "orderNotes"
  >,
): boolean {
  if (!correctionNoteTeachesIgnoreCreditReturns(note)) return false;
  return isCreditReturnImportDoc(doc);
}

/** CF + ingest — credit/return memos must never become deliveries. */
export const CREDIT_RETURN_DELIVERY_BLOCKED_MESSAGE =
  "Credit/return memos cannot become deliveries — reject or leave in Rejected Invoices.";

export function creditReturnBlocksDeliveryCreation(
  doc: Pick<
    VendorInvoiceImportReview,
    "parsedHeader" | "parsedLines" | "orderNotes" | "skipReason"
  >,
): boolean {
  if (doc.skipReason === CREDIT_RETURN_SKIP_REASON) return true;
  return isCreditReturnImportDoc(doc);
}

/** User-visible incomplete order copy when B/O or partial ship lines exist. */
export function orderIncompleteMessage(
  importRow: Pick<
    VendorInvoiceImportReview,
    "importStatus" | "parsedLines" | "parsedLineCount"
  >,
): string | null {
  if (importRow.importStatus === "partial") {
    return "Order not complete — backordered or partially shipped lines remain.";
  }
  const lines = importRow.parsedLines ?? [];
  const hasBo = lines.some((l) => (l.quantityBackordered ?? 0) > 0);
  const hasPartialShip = lines.some(
    (l) =>
      (l.quantityShipped ?? 0) < (l.quantityOrdered ?? 0) &&
      (l.quantityBackordered ?? 0) === 0,
  );
  if (hasBo || hasPartialShip) {
    return "Order not complete — backordered or partially shipped lines remain.";
  }
  return null;
}

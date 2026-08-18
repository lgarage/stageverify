/**
 * Johnstone CREDIT / return memo detection and apply-now dismiss when training notes teach ignore.
 */
import type { ParsedJohnstoneInvoice, VendorInvoiceImportStatus } from "./types";
import type { VendorInvoiceImportParsedLine } from "../inboundEmail/types";

export const CREDIT_RETURN_SKIP_REASON = "credit_return" as const;

/** Taught fingerprint ignore (any document type) — review-queue auto-skip only. */
export const DOCUMENT_IGNORE_SKIP_REASON = "document_ignore" as const;

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

/** User-visible label when skipReason is credit_return or document_ignore. */
export function creditReturnSkipLabel(
  skipReason?: string,
  rejectedBy?: string,
): string | null {
  if (skipReason === DOCUMENT_IGNORE_SKIP_REASON) {
    return CREDIT_RETURN_AUTO_SKIP_LABEL;
  }
  if (skipReason !== CREDIT_RETURN_SKIP_REASON) return null;
  if (
    rejectedBy === "system:credit_return_skip" ||
    rejectedBy === "system:document_ignore_skip"
  ) {
    return CREDIT_RETURN_AUTO_SKIP_LABEL;
  }
  return CREDIT_RETURN_SKIP_LABEL;
}

/** Firestore patch fields when auto-skipping a credit/return import. */
export function creditReturnSkipFields(now: string): {
  reviewStatus: "rejected";
  skipReason: typeof CREDIT_RETURN_SKIP_REASON;
  rejectedAt: string;
  rejectedBy: "system:credit_return_skip";
  humanReviewRequired: false;
  updatedAt: string;
} {
  return {
    reviewStatus: "rejected",
    skipReason: CREDIT_RETURN_SKIP_REASON,
    rejectedAt: now,
    rejectedBy: "system:credit_return_skip",
    humanReviewRequired: false,
    updatedAt: now,
  };
}

/** Firestore patch when auto-skipping via taught document fingerprint. */
export function documentIgnoreSkipFields(now: string): {
  reviewStatus: "rejected";
  skipReason: typeof DOCUMENT_IGNORE_SKIP_REASON;
  rejectedAt: string;
  rejectedBy: "system:document_ignore_skip";
  humanReviewRequired: false;
  updatedAt: string;
} {
  return {
    reviewStatus: "rejected",
    skipReason: DOCUMENT_IGNORE_SKIP_REASON,
    rejectedAt: now,
    rejectedBy: "system:document_ignore_skip",
    humanReviewRequired: false,
    updatedAt: now,
  };
}

export function isSystemIgnoreSkipReason(skipReason?: string): boolean {
  return (
    skipReason === CREDIT_RETURN_SKIP_REASON ||
    skipReason === DOCUMENT_IGNORE_SKIP_REASON
  );
}

const SYSTEM_AUTO_REJECTED_BY = [
  "system:credit_return_skip",
  "system:document_ignore_skip",
] as const;

/** Rejected by ingest/auto-skip — Gmail reparse may refresh. User rejections must never reopen. */
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
  if (/\bRETURN\b/i.test(po) && /\b(PICKUP|CREDIT)\b/i.test(po)) return true;

  if (parsed.lines.length === 0) {
    return parsedBranchIsCredit(parsed.header.vendorBranchName);
  }

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

export function isCreditReturnImportDoc(doc: {
  parsedHeader?: Record<string, unknown>;
  parsedLines?: VendorInvoiceImportParsedLine[];
  orderNotes?: string[];
}): boolean {
  const header = doc.parsedHeader ?? {};
  const branch = String(header.vendorBranchName ?? "").trim();
  if (parsedBranchIsCredit(branch)) return true;

  const po = String(header.customerPoOrReference ?? "").trim();
  const notes = doc.orderNotes ?? [];
  if (notes.some((n) => /CREDIT\/return memo/i.test(n))) return true;

  const lines = (doc.parsedLines ?? []).map((line) => ({
    ...line,
    quantityShipped: coerceLineQty(line.quantityShipped),
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
  doc: {
    parsedHeader?: Record<string, unknown>;
    parsedLines?: VendorInvoiceImportParsedLine[];
    orderNotes?: string[];
  },
): boolean {
  if (!correctionNoteTeachesIgnoreCreditReturns(note)) return false;
  return isCreditReturnImportDoc(doc);
}

/** CF + ingest — credit/return memos must never become deliveries. */
export const CREDIT_RETURN_DELIVERY_BLOCKED_MESSAGE =
  "Credit/return memos cannot become deliveries — reject or leave in Rejected Invoices.";

export function creditReturnBlocksDeliveryCreation(doc: {
  parsedHeader?: Record<string, unknown>;
  parsedLines?: VendorInvoiceImportParsedLine[];
  orderNotes?: string[];
  skipReason?: string;
}): boolean {
  if (doc.skipReason === CREDIT_RETURN_SKIP_REASON) return true;
  return isCreditReturnImportDoc(doc);
}

/** Ingest: auto-reject structural credits on first write; preserve on reparse. */
export function resolveCreditReturnIngestSkip(input: {
  isNewImport: boolean;
  creditReturnSkip: boolean;
  duplicate: boolean;
  now: string;
  existingRejectedBy?: string;
}): ReturnType<typeof creditReturnSkipFields> | null {
  if (input.duplicate || !input.creditReturnSkip) return null;
  const preserveCredit =
    input.existingRejectedBy === "system:credit_return_skip";
  if (input.isNewImport || preserveCredit) {
    return creditReturnSkipFields(input.now);
  }
  return null;
}

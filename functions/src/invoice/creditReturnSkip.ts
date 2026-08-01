/**
 * Johnstone CREDIT / return memo detection and apply-now dismiss when training notes teach ignore.
 */
import type { ParsedJohnstoneInvoice, VendorInvoiceImportStatus } from "./types";
import type { VendorInvoiceImportParsedLine } from "../inboundEmail/types";

export const CREDIT_RETURN_SKIP_REASON = "credit_return" as const;

export const CREDIT_RETURN_SKIP_LABEL = "Skipped — credit/return";

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

/** User-visible label when skipReason is credit_return. */
export function creditReturnSkipLabel(skipReason?: string): string | null {
  if (skipReason === CREDIT_RETURN_SKIP_REASON) return CREDIT_RETURN_SKIP_LABEL;
  return null;
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

  const lines = parsed.lines.filter((l) => !l.excludeFromExpectedItems);
  const scanLines = lines.length > 0 ? lines : parsed.lines;
  if (scanLines.length === 0) {
    return parsedBranchIsCredit(parsed.header.vendorBranchName);
  }

  const anyNegShip = scanLines.some((l) => l.quantityShipped < 0);
  const anyReturnLine = parsed.lines.some((l) => l.lineType === "return");
  const returnFromInvoice =
    parsed.lines.some((l) => /return from invoice/i.test(l.description ?? "")) ||
    parsed.orderNotes.some((n) => /return from invoice/i.test(n));

  if (anyReturnLine && anyNegShip) return true;
  if (returnFromInvoice && anyNegShip) return true;
  if (scanLines.every((l) => l.quantityShipped < 0)) return true;

  return false;
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
  const lines = doc.parsedLines ?? [];
  if (lines.length === 0) {
    return /\bRETURN\b/i.test(po) || parsedBranchIsCredit(branch);
  }

  const anyNegShip = lines.some((l) => (l.quantityShipped ?? 0) < 0);
  const anyReturnLine = lines.some((l) => l.lineType === "return");
  const returnDesc = lines.some((l) =>
    /return from invoice/i.test(l.description ?? ""),
  );
  const returnPo = /\bRETURN\b/i.test(po);
  const notes = doc.orderNotes ?? [];
  const noteReturn = notes.some((n) => /return from invoice/i.test(n));

  if (anyReturnLine && anyNegShip) return true;
  if (returnDesc && anyNegShip) return true;
  if (noteReturn && anyNegShip) return true;
  if (lines.every((l) => (l.quantityShipped ?? 0) < 0)) return true;
  if (returnPo && anyNegShip) return true;

  return false;
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
  if (isCreditReturnImportDoc(doc)) return true;
  return (
    /\b(?:ignore|skip|dismiss)\b/i.test(note) && /\bCREDIT\b/.test(note)
  );
}

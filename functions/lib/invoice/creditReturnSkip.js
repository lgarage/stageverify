"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CREDIT_RETURN_DELIVERY_BLOCKED_MESSAGE = exports.CREDIT_RETURN_ADVISORY_LABEL = exports.CREDIT_RETURN_AUTO_SKIP_LABEL = exports.CREDIT_RETURN_SKIP_LABEL = exports.DUPLICATE_BUSINESS_INVOICE_SKIP_LABEL = exports.DUPLICATE_BUSINESS_INVOICE_SKIP_REASON = exports.DOCUMENT_IGNORE_SKIP_REASON = exports.CREDIT_RETURN_SKIP_REASON = void 0;
exports.creditReturnSkipLabel = creditReturnSkipLabel;
exports.creditReturnSkipFields = creditReturnSkipFields;
exports.documentIgnoreSkipFields = documentIgnoreSkipFields;
exports.duplicateBusinessInvoiceSkipFields = duplicateBusinessInvoiceSkipFields;
exports.isSystemIgnoreSkipReason = isSystemIgnoreSkipReason;
exports.isSystemAutoRejectedImport = isSystemAutoRejectedImport;
exports.importStatusForCreditSkip = importStatusForCreditSkip;
exports.isCreditReturnInvoice = isCreditReturnInvoice;
exports.correctionNoteTeachesIgnoreCreditReturns = correctionNoteTeachesIgnoreCreditReturns;
exports.isCreditReturnImportDoc = isCreditReturnImportDoc;
exports.shouldApplyNowDismissCreditImport = shouldApplyNowDismissCreditImport;
exports.creditReturnBlocksDeliveryCreation = creditReturnBlocksDeliveryCreation;
exports.resolveCreditReturnIngestSkip = resolveCreditReturnIngestSkip;
exports.CREDIT_RETURN_SKIP_REASON = "credit_return";
/** Taught fingerprint ignore (any document type) — review-queue auto-skip only. */
exports.DOCUMENT_IGNORE_SKIP_REASON = "document_ignore";
/** Exact business-invoice resend (new Gmail message, same vendor invoice). */
exports.DUPLICATE_BUSINESS_INVOICE_SKIP_REASON = "duplicate_business_invoice";
exports.DUPLICATE_BUSINESS_INVOICE_SKIP_LABEL = "Skipped — duplicate invoice resend";
/** Legacy auto-skipped / manually dismissed credit imports in Rejected archive. */
exports.CREDIT_RETURN_SKIP_LABEL = "Skipped — credit/return";
/** System auto-skip after vendor ignore rule taught + confirmed. */
exports.CREDIT_RETURN_AUTO_SKIP_LABEL = "Auto-skipped — vendor ignore rule";
/** Pending queue — user must reject manually (no auto-reject on ingest). */
exports.CREDIT_RETURN_ADVISORY_LABEL = "Credit/return — reject manually";
function parsedBranchIsCredit(branchRaw) {
    const branch = (branchRaw ?? "").trim();
    return branch.length > 0 && /^CREDIT$/i.test(branch);
}
function pageTextSignalsBranchCredit(text) {
    return (/\bBranch\s*[=:]\s*CREDIT\b/i.test(text) ||
        /\bBRANCH\s+CREDIT\b/i.test(text));
}
function coerceLineQty(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string") {
        const parsed = Number(value.trim());
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}
/** Line-item credit/return — not enough to classify the whole document. */
function lineIsCreditOrReturn(line) {
    const qty = coerceLineQty(line.quantityShipped);
    return (line.lineType === "return" ||
        qty < 0 ||
        /return from invoice/i.test(line.description ?? ""));
}
/** Purchased product still on the invoice — document stays a normal invoice. */
function isPurchasedProductLine(line) {
    if (lineIsCreditOrReturn(line))
        return false;
    if (line.lineType && line.lineType !== "product")
        return false;
    return coerceLineQty(line.quantityShipped) >= 0;
}
/**
 * Document-level only when every remaining line is a credit/return
 * (or notes say return-from-invoice and no purchased products remain).
 */
function linesIndicateDocumentLevelCredit(lines, notes = []) {
    if (lines.some(isPurchasedProductLine))
        return false;
    return (lines.some(lineIsCreditOrReturn) ||
        notes.some((n) => /return from invoice/i.test(n)));
}
/** User-visible label when skipReason is credit_return, document_ignore, or duplicate resend. */
function creditReturnSkipLabel(skipReason, rejectedBy) {
    if (skipReason === exports.DUPLICATE_BUSINESS_INVOICE_SKIP_REASON) {
        return exports.DUPLICATE_BUSINESS_INVOICE_SKIP_LABEL;
    }
    if (skipReason === exports.DOCUMENT_IGNORE_SKIP_REASON) {
        return exports.CREDIT_RETURN_AUTO_SKIP_LABEL;
    }
    if (skipReason !== exports.CREDIT_RETURN_SKIP_REASON)
        return null;
    if (rejectedBy === "system:credit_return_skip" ||
        rejectedBy === "system:document_ignore_skip" ||
        rejectedBy === "system:duplicate_business_invoice") {
        return exports.CREDIT_RETURN_AUTO_SKIP_LABEL;
    }
    return exports.CREDIT_RETURN_SKIP_LABEL;
}
/** Firestore patch fields when auto-skipping a credit/return import. */
function creditReturnSkipFields(now) {
    return {
        reviewStatus: "rejected",
        skipReason: exports.CREDIT_RETURN_SKIP_REASON,
        rejectedAt: now,
        rejectedBy: "system:credit_return_skip",
        humanReviewRequired: false,
        updatedAt: now,
    };
}
/** Firestore patch when auto-skipping via taught document fingerprint. */
function documentIgnoreSkipFields(now) {
    return {
        reviewStatus: "rejected",
        skipReason: exports.DOCUMENT_IGNORE_SKIP_REASON,
        rejectedAt: now,
        rejectedBy: "system:document_ignore_skip",
        humanReviewRequired: false,
        updatedAt: now,
    };
}
/** Firestore patch when auto-skipping an exact business-invoice resend. */
function duplicateBusinessInvoiceSkipFields(now) {
    return {
        reviewStatus: "rejected",
        skipReason: exports.DUPLICATE_BUSINESS_INVOICE_SKIP_REASON,
        rejectedAt: now,
        rejectedBy: "system:duplicate_business_invoice",
        humanReviewRequired: false,
        updatedAt: now,
    };
}
function isSystemIgnoreSkipReason(skipReason) {
    return (skipReason === exports.CREDIT_RETURN_SKIP_REASON ||
        skipReason === exports.DOCUMENT_IGNORE_SKIP_REASON ||
        skipReason === exports.DUPLICATE_BUSINESS_INVOICE_SKIP_REASON);
}
const SYSTEM_AUTO_REJECTED_BY = [
    "system:credit_return_skip",
    "system:document_ignore_skip",
    "system:duplicate_business_invoice",
];
/** Rejected by ingest/auto-skip — Gmail reparse may refresh. User rejections must never reopen. */
function isSystemAutoRejectedImport(doc) {
    return (doc?.reviewStatus === "rejected" &&
        typeof doc.rejectedBy === "string" &&
        SYSTEM_AUTO_REJECTED_BY.includes(doc.rejectedBy));
}
/** Credit/return memos are auto-skipped — do not surface as Issue when only return lines parsed. */
function importStatusForCreditSkip(parsed, pageText, baseStatus) {
    if (!isCreditReturnInvoice(parsed, pageText))
        return baseStatus;
    if (baseStatus === "issue")
        return "pending";
    return baseStatus;
}
/** Structural signals — auto-skip on ingest / refresh (regex-owned routing). */
function isCreditReturnInvoice(parsed, pageText) {
    const text = pageText ?? "";
    if (/^\s*CREDIT\b/m.test(text))
        return true;
    if (pageTextSignalsBranchCredit(text))
        return true;
    if (/\bCREDIT\s+MEMO\b/i.test(text))
        return true;
    if (parsedBranchIsCredit(parsed.header.vendorBranchName))
        return true;
    const po = (parsed.header.customerPoOrReference ?? "").trim();
    const returnPo = /\bRETURN\b/i.test(po) && /\b(PICKUP|CREDIT)\b/i.test(po);
    if (parsed.lines.length === 0) {
        return returnPo || parsedBranchIsCredit(parsed.header.vendorBranchName);
    }
    if (returnPo && !parsed.lines.some(isPurchasedProductLine))
        return true;
    return linesIndicateDocumentLevelCredit(parsed.lines, parsed.orderNotes);
}
/** Detect ignore-CREDIT/returns intent in a generalized training note. */
function correctionNoteTeachesIgnoreCreditReturns(note) {
    const n = note.trim();
    if (!n)
        return false;
    if (/\bignore\b[\s\S]{0,40}\b(credit|returns?)\b/i.test(n))
        return true;
    if (/\bskip\b[\s\S]{0,40}\b(credit|returns?)\b/i.test(n))
        return true;
    if (/\bdismiss\b[\s\S]{0,40}\b(credit|returns?)\b/i.test(n))
        return true;
    if (/\b(credit|returns?)\b[\s\S]{0,40}\b(ignore|skip|dismiss)\b/i.test(n))
        return true;
    if (/\bCREDIT\b/.test(n) && /\b(ignore|skip|negative\s+qty)\b/i.test(n))
        return true;
    return false;
}
function isCreditReturnImportDoc(doc) {
    const header = doc.parsedHeader ?? {};
    const branch = String(header.vendorBranchName ?? "").trim();
    if (parsedBranchIsCredit(branch))
        return true;
    const po = String(header.customerPoOrReference ?? "").trim();
    const notes = doc.orderNotes ?? [];
    if (notes.some((n) => /CREDIT\/return memo/i.test(n)))
        return true;
    const lines = (doc.parsedLines ?? []).map((line) => ({
        ...line,
        quantityShipped: coerceLineQty(line.quantityShipped),
    }));
    if (lines.length === 0) {
        return /\bRETURN\b/i.test(po) || parsedBranchIsCredit(branch);
    }
    const returnPo = /\bRETURN\b/i.test(po) && /\b(PICKUP|CREDIT)\b/i.test(po);
    if (returnPo && !lines.some(isPurchasedProductLine))
        return true;
    return linesIndicateDocumentLevelCredit(lines, notes);
}
/** Apply-now: dismiss current import when note teaches ignore and import is CREDIT/return. */
function shouldApplyNowDismissCreditImport(note, doc) {
    if (!correctionNoteTeachesIgnoreCreditReturns(note))
        return false;
    return isCreditReturnImportDoc(doc);
}
/** CF + ingest — credit/return memos must never become deliveries. */
exports.CREDIT_RETURN_DELIVERY_BLOCKED_MESSAGE = "Credit/return memos cannot become deliveries — reject or leave in Rejected Invoices.";
function creditReturnBlocksDeliveryCreation(doc) {
    if (doc.skipReason === exports.CREDIT_RETURN_SKIP_REASON)
        return true;
    return isCreditReturnImportDoc(doc);
}
/** Ingest: auto-reject structural credits on first write; preserve on reparse. */
function resolveCreditReturnIngestSkip(input) {
    if (input.duplicate || !input.creditReturnSkip)
        return null;
    const preserveCredit = input.existingRejectedBy === "system:credit_return_skip";
    if (input.isNewImport || preserveCredit) {
        return creditReturnSkipFields(input.now);
    }
    return null;
}
//# sourceMappingURL=creditReturnSkip.js.map
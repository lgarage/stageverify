"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CREDIT_RETURN_ADVISORY_LABEL = exports.CREDIT_RETURN_AUTO_SKIP_LABEL = exports.CREDIT_RETURN_SKIP_LABEL = exports.DOCUMENT_IGNORE_SKIP_REASON = exports.CREDIT_RETURN_SKIP_REASON = void 0;
exports.creditReturnSkipLabel = creditReturnSkipLabel;
exports.creditReturnSkipFields = creditReturnSkipFields;
exports.documentIgnoreSkipFields = documentIgnoreSkipFields;
exports.isSystemIgnoreSkipReason = isSystemIgnoreSkipReason;
exports.importStatusForCreditSkip = importStatusForCreditSkip;
exports.isCreditReturnInvoice = isCreditReturnInvoice;
exports.correctionNoteTeachesIgnoreCreditReturns = correctionNoteTeachesIgnoreCreditReturns;
exports.isCreditReturnImportDoc = isCreditReturnImportDoc;
exports.shouldApplyNowDismissCreditImport = shouldApplyNowDismissCreditImport;
exports.CREDIT_RETURN_SKIP_REASON = "credit_return";
/** Taught fingerprint ignore (any document type) — review-queue auto-skip only. */
exports.DOCUMENT_IGNORE_SKIP_REASON = "document_ignore";
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
/** User-visible label when skipReason is credit_return or document_ignore. */
function creditReturnSkipLabel(skipReason, rejectedBy) {
    if (skipReason === exports.DOCUMENT_IGNORE_SKIP_REASON) {
        return exports.CREDIT_RETURN_AUTO_SKIP_LABEL;
    }
    if (skipReason !== exports.CREDIT_RETURN_SKIP_REASON)
        return null;
    if (rejectedBy === "system:credit_return_skip" ||
        rejectedBy === "system:document_ignore_skip") {
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
function isSystemIgnoreSkipReason(skipReason) {
    return (skipReason === exports.CREDIT_RETURN_SKIP_REASON ||
        skipReason === exports.DOCUMENT_IGNORE_SKIP_REASON);
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
    if (/\bRETURN\b/i.test(po) && /\b(PICKUP|CREDIT)\b/i.test(po))
        return true;
    const lines = parsed.lines.filter((l) => !l.excludeFromExpectedItems);
    const scanLines = lines.length > 0 ? lines : parsed.lines;
    if (scanLines.length === 0) {
        return parsedBranchIsCredit(parsed.header.vendorBranchName);
    }
    const anyNegShip = scanLines.some((l) => l.quantityShipped < 0);
    const anyReturnLine = parsed.lines.some((l) => l.lineType === "return");
    const returnFromInvoice = parsed.lines.some((l) => /return from invoice/i.test(l.description ?? "")) ||
        parsed.orderNotes.some((n) => /return from invoice/i.test(n));
    if (anyReturnLine && anyNegShip)
        return true;
    if (returnFromInvoice && anyNegShip)
        return true;
    if (scanLines.every((l) => l.quantityShipped < 0))
        return true;
    return false;
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
    const lines = doc.parsedLines ?? [];
    if (lines.length === 0) {
        return /\bRETURN\b/i.test(po) || parsedBranchIsCredit(branch);
    }
    const anyNegShip = lines.some((l) => (l.quantityShipped ?? 0) < 0);
    const anyReturnLine = lines.some((l) => l.lineType === "return");
    const returnDesc = lines.some((l) => /return from invoice/i.test(l.description ?? ""));
    const returnPo = /\bRETURN\b/i.test(po);
    const noteReturn = notes.some((n) => /return from invoice/i.test(n));
    if (anyReturnLine && anyNegShip)
        return true;
    if (returnDesc && anyNegShip)
        return true;
    if (noteReturn && anyNegShip)
        return true;
    if (lines.every((l) => (l.quantityShipped ?? 0) < 0))
        return true;
    if (returnPo && anyNegShip)
        return true;
    if (returnPo && anyReturnLine)
        return true;
    return false;
}
/** Apply-now: dismiss current import when note teaches ignore and import is CREDIT/return. */
function shouldApplyNowDismissCreditImport(note, doc) {
    if (!correctionNoteTeachesIgnoreCreditReturns(note))
        return false;
    if (isCreditReturnImportDoc(doc))
        return true;
    return (/\b(?:ignore|skip|dismiss)\b/i.test(note) && /\bCREDIT\b/.test(note));
}
//# sourceMappingURL=creditReturnSkip.js.map
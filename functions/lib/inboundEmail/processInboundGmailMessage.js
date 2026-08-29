"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldReprocessExistingDoc = shouldReprocessExistingDoc;
exports.processInboundGmailMessage = processInboundGmailMessage;
exports.reparseVendorInvoiceImportFromCache = reparseVendorInvoiceImportFromCache;
/**
 * Process a single Gmail message into inboundEmailProcessing (+ review queue on M2).
 * Idempotent by gmailMessageId. Does NOT write deliveries/items.
 */
const admin = require("firebase-admin");
const crypto_1 = require("crypto");
const gmailInbound_1 = require("../gmailInbound");
const extractPdfText_1 = require("./extractPdfText");
const normalizePdfText_1 = require("./normalizePdfText");
const invoiceDocumentSplit_1 = require("../invoice/invoiceDocumentSplit");
const pdfTextAdapter_1 = require("../invoice/pdfTextAdapter");
const correctionAuditRecovery_1 = require("../invoice/reviewChat/correctionAuditRecovery");
const reconcileAfterFieldCorrection_1 = require("../invoice/reviewChat/reconcileAfterFieldCorrection");
const inferImportStatus_1 = require("../invoice/inferImportStatus");
const parsedHeaderValidation_1 = require("../invoice/parsedHeaderValidation");
const creditReturnSkip_1 = require("../invoice/creditReturnSkip");
const businessInvoiceIdentity_1 = require("../invoice/businessInvoiceIdentity");
const vendorIgnoreRules_1 = require("../invoice/aiShadow/vendorIgnoreRules");
const ignoreRuleAudit_1 = require("../invoice/aiShadow/ignoreRuleAudit");
const strongInvoiceSignals_1 = require("../invoice/strongInvoiceSignals");
const adminConfig_1 = require("../invoice/aiShadow/adminConfig");
const processInvoiceForInbound_1 = require("../invoice/processInvoiceForInbound");
const runInvoiceAiShadow_1 = require("../invoice/aiShadow/runInvoiceAiShadow");
const firestoreSafeValue_1 = require("./firestoreSafeValue");
const sanitizeParsedLines_1 = require("./sanitizeParsedLines");
const loadOutboundEmailContext_1 = require("../email/loadOutboundEmailContext");
const replyRouter_1 = require("./replyRouter");
const COLLECTION = "inboundEmailProcessing";
const REVIEW_COLLECTION = "vendorInvoiceImports";
const MAX_EXTRACTED_TEXT_STORE = 120_000;
const MAX_SUBJECT_LEN = 4096;
const MAX_SENDER_LEN = 320;
const MAX_PDF_ATTACHMENTS_PER_MESSAGE = 5;
/** Archive Gmail only after durable import/review persistence (never plain no_pdf/error). */
const GMAIL_ARCHIVE_ELIGIBLE_STATUSES = new Set(["parsed", "reply_processed"]);
/**
 * Soft-fail INBOX remove after durable StageVerify persist.
 * Never throws — archive failure must not flip a successful ingest to error.
 */
async function archiveInboxMessageSoftFail(ref, accessToken, gmailMessageId, processingStatus, alreadyArchivedAt) {
    if (alreadyArchivedAt)
        return;
    if (!GMAIL_ARCHIVE_ELIGIBLE_STATUSES.has(processingStatus))
        return;
    try {
        await (0, gmailInbound_1.archiveGmailMessageRemoveInbox)(accessToken, gmailMessageId);
        await ref.set({ gmailInboxArchivedAt: new Date().toISOString() }, { merge: true });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`processInboundGmailMessage: archive failed for ${gmailMessageId} — ${message.slice(0, 200)}`);
    }
}
function getDb() {
    return admin.firestore();
}
function docIdForMessage(gmailMessageId) {
    return `inbound-${gmailMessageId}`;
}
function trimStoredText(text) {
    if (text.length <= MAX_EXTRACTED_TEXT_STORE)
        return text;
    return `${text.slice(0, MAX_EXTRACTED_TEXT_STORE)}\n…[truncated]`;
}
function sanitizeSubject(subject) {
    return subject.slice(0, MAX_SUBJECT_LEN);
}
function sanitizeSender(sender) {
    return sender.slice(0, MAX_SENDER_LEN).toLowerCase();
}
function issueReviewError(proc, rowError, creditReturnSkip) {
    if (creditReturnSkip)
        return undefined;
    if (rowError?.trim())
        return rowError.trim();
    if (proc.importStatus !== "issue")
        return undefined;
    const warnings = proc.parsed.parseWarnings.filter(Boolean);
    if (warnings.length > 0)
        return warnings.join("; ");
    return "Parse issue — missing required invoice fields for expected-order import.";
}
/** Exported for sync backfill collection on Refresh Now. */
function shouldReprocessExistingDoc(data, options) {
    const cached = data.combinedExtractedText?.trim();
    const reviewIds = data.parseResult?.reviewRecordIds ?? [];
    const total = data.parseResult?.total ?? 0;
    // Stale issue reparse — scheduled sync + Refresh Now backfill (no full error retry required).
    if (options?.reparseStaleReviews &&
        cached &&
        !(0, normalizePdfText_1.hasCustomFontPdfEncoding)(cached) &&
        data.processingStatus === "parsed" &&
        reviewIds.length > 0) {
        return true;
    }
    if (data.processingStatus === "reply_processed")
        return false;
    if (data.processingStatus === "message_gone")
        return false;
    if (!options?.retryOnError)
        return false;
    if (data.processingStatus === "no_pdf")
        return false;
    if (data.processingStatus === "error")
        return true;
    if (cached && (0, normalizePdfText_1.hasCustomFontPdfEncoding)(cached))
        return true;
    if (data.processingStatus !== "parsed")
        return false;
    // Backfill any parsed email with pages but zero queued review rows.
    if (total > 0 && reviewIds.length === 0)
        return true;
    return false;
}
const GMAIL_MESSAGE_GONE_ERROR = "Message no longer in Gmail mailbox (deleted or permanently inaccessible).";
async function tombstoneGmailMessageGone(ref, docId, gmailMessageId, existing) {
    const now = new Date().toISOString();
    await ref.set({
        id: docId,
        gmailMessageId,
        processingStatus: "message_gone",
        processingError: GMAIL_MESSAGE_GONE_ERROR,
        updatedAt: now,
        ...(existing
            ? {}
            : {
                senderEmail: "",
                subject: "",
                receivedAt: now,
                attachmentFilenames: [],
                pdfAttachments: [],
                reviewStatus: "pending_review",
                createdAt: now,
            }),
    }, { merge: true });
    return {
        docId,
        gmailMessageId,
        skipped: true,
        processingStatus: "message_gone",
        reviewRecordIds: existing?.parseResult?.reviewRecordIds ?? [],
        skippedProcessingStatus: "message_gone",
    };
}
async function finalizeParsedInboundDoc(ref, inboundDoc, combinedExtractedText, gmailMessageId) {
    const db = getDb();
    const preFormat = (0, invoiceDocumentSplit_1.preferredPreParseFormat)(combinedExtractedText, {
        senderEmail: inboundDoc.senderEmail,
    });
    const normalizedText = trimStoredText(preFormat === "johnstone" || (0, normalizePdfText_1.hasCustomFontPdfEncoding)(combinedExtractedText)
        ? (0, normalizePdfText_1.postProcessExtractedPdfText)(combinedExtractedText)
        : (0, pdfTextAdapter_1.normalizeExtractedPageText)(combinedExtractedText));
    const importBatchId = `batch-email-${gmailMessageId.slice(0, 12)}-${(0, crypto_1.randomBytes)(3).toString("hex")}`;
    const batchResult = (0, processInvoiceForInbound_1.parseInboundInvoiceText)(normalizedText, {
        importBatchId,
        gmailMessageId,
        senderEmail: inboundDoc.senderEmail,
    });
    const partialDoc = {
        ...inboundDoc,
        combinedExtractedText: normalizedText,
        processingStatus: "extracted",
        updatedAt: new Date().toISOString(),
    };
    await ref.set(partialDoc);
    const reviewRecordIds = await writeReviewRecords(db, partialDoc, batchResult);
    await maybeRunInvoiceAiShadow(db, partialDoc, batchResult);
    const parsedDoc = {
        ...partialDoc,
        processingStatus: "parsed",
        parseResult: {
            importBatchId: batchResult.importBatchId,
            processed: 0,
            needsReview: batchResult.summary.needsReview,
            failed: batchResult.summary.failed,
            total: batchResult.summary.total,
            reviewRecordIds,
        },
        updatedAt: new Date().toISOString(),
    };
    await ref.set(parsedDoc);
    return {
        docId: inboundDoc.id,
        gmailMessageId,
        skipped: false,
        processingStatus: "parsed",
        reviewRecordIds,
    };
}
/**
 * Optional Johnstone AI shadow (flag-gated). Never changes reviewStatus / deliveries.
 * Failures are swallowed so inbound parse always completes.
 */
async function maybeRunInvoiceAiShadow(db, inboundDoc, batchResult) {
    try {
        if (!(await (0, runInvoiceAiShadow_1.isInvoiceAiShadowEnabled)(db)))
            return;
    }
    catch {
        return;
    }
    for (const row of batchResult.results) {
        if (!row.processing || row.outcome === "failed")
            continue;
        if (row.processing.parserFormatId !== "johnstone")
            continue;
        const reviewId = `vii-${inboundDoc.gmailMessageId}-${row.pageId}`;
        try {
            const existing = await db.collection(REVIEW_COLLECTION).doc(reviewId).get();
            if (!existing.exists)
                continue;
            const status = existing.data().reviewStatus;
            if (status === "approved" || status === "rejected")
                continue;
            const vendorKey = row.processing.detectedVendorName?.trim() ||
                "johnstone";
            const shadow = await (0, runInvoiceAiShadow_1.runInvoiceAiShadow)({
                extractedText: row.processing.page.extractedText,
                vendorKey,
                parserFormatId: row.processing.parserFormatId,
                regexLines: row.processing.parsed.lines,
            });
            await db.collection(REVIEW_COLLECTION).doc(reviewId).update({
                aiShadowParse: (0, firestoreSafeValue_1.firestoreSafeValue)(shadow),
                updatedAt: new Date().toISOString(),
            });
        }
        catch {
            // Shadow must never fail inbound ingest.
        }
    }
}
async function writeReviewRecords(db, inboundDoc, batchResult) {
    const reviewIds = [];
    const now = new Date().toISOString();
    for (const row of batchResult.results) {
        if (!row.processing || row.outcome === "failed")
            continue;
        const reviewId = `vii-${inboundDoc.gmailMessageId}-${row.pageId}`;
        reviewIds.push(reviewId);
        const existingSnap = await db.collection(REVIEW_COLLECTION).doc(reviewId).get();
        const existingData = existingSnap.exists
            ? existingSnap.data()
            : undefined;
        const existingStatus = existingData?.reviewStatus;
        const existingSystemSkip = (0, creditReturnSkip_1.isSystemIgnoreSkipReason)(existingData?.skipReason);
        if (existingStatus === "approved") {
            continue;
        }
        if (existingStatus === "rejected" && !(0, creditReturnSkip_1.isSystemAutoRejectedImport)(existingData)) {
            continue;
        }
        const proc = row.processing;
        const parsedLines = (0, sanitizeParsedLines_1.sanitizeParsedLines)(proc.parsed.lines);
        const creditReturnSkip = (0, creditReturnSkip_1.isCreditReturnInvoice)(proc.parsed, proc.page.extractedText) && !proc.duplicate;
        const reviewError = issueReviewError(proc, row.error, creditReturnSkip);
        const isNewImport = !existingSnap.exists;
        const vendorKeyRaw = (0, adminConfig_1.vendorKeyFromImportDoc)({
            detectedVendorName: proc.detectedVendorName,
            parserFormatId: proc.parserFormatId,
        });
        const provisionalImport = {
            skipReason: existingData?.skipReason,
            parsedHeader: proc.parsed.header,
            parsedLines,
            orderNotes: proc.parsed.orderNotes,
            parseWarnings: proc.parsed.parseWarnings,
            importStatus: proc.importStatus,
            pageId: row.pageId,
        };
        const fingerprint = (0, vendorIgnoreRules_1.fingerprintFromImport)({
            vendorKey: vendorKeyRaw,
            parserFormatId: proc.parserFormatId,
            importRow: provisionalImport,
        });
        const ignoreMatch = (0, vendorIgnoreRules_1.isArmableVendorKey)(vendorKeyRaw)
            ? await (0, vendorIgnoreRules_1.vendorIgnoresFingerprint)(db, fingerprint, inboundDoc.senderEmail)
            : { matched: false };
        const ignoreRuleArmed = ignoreMatch.matched;
        const matchedRuleId = ignoreMatch.ruleId;
        const strongSignals = (0, strongInvoiceSignals_1.hasStrongInvoiceSignals)({
            vendorInvoiceNumber: proc.parsed.header.vendorInvoiceNumber,
            extractedText: proc.page.extractedText,
        });
        // New import + taught fingerprint → auto-skip unless strong invoice signals. Re-opened imports stay pending.
        const autoSkipDocument = isNewImport && ignoreRuleArmed && !proc.duplicate && !strongSignals;
        // Preserve document-ignore auto-skip on reprocess when rule still armed.
        const preserveDocumentIgnoreSkip = existingSystemSkip &&
            existingData?.rejectedBy === "system:document_ignore_skip" &&
            ignoreRuleArmed;
        const creditIngestSkip = (0, creditReturnSkip_1.resolveCreditReturnIngestSkip)({
            isNewImport,
            creditReturnSkip,
            duplicate: proc.duplicate,
            now,
            existingRejectedBy: existingData?.rejectedBy,
        });
        // Preserve C2 field corrections across Refresh/reparse: parser output is the
        // base, then durable fieldCorrectionLog overrides are re-applied.
        // Chat/corrections stay per-import (page-scoped reviewId). Shared
        // inbound.combinedExtractedText is intentional read-only batch evidence only.
        const existingExtras = (existingData ?? {});
        let durableLog = Array.isArray(existingExtras.fieldCorrectionLog)
            ? existingExtras.fieldCorrectionLog
            : [];
        if (durableLog.length === 0 && existingSnap.exists) {
            // Historical wipe recovery: rebuild log from audit when import log is gone.
            durableLog = await (0, correctionAuditRecovery_1.recoverFieldCorrectionLogFromAudit)(db, reviewId);
        }
        const parserHeader = proc.parsed.header;
        const createdAt = existingSnap.exists && existingSnap.data().createdAt
            ? existingSnap.data().createdAt
            : now;
        const skipFields = creditIngestSkip ??
            (autoSkipDocument || preserveDocumentIgnoreSkip
                ? (0, creditReturnSkip_1.documentIgnoreSkipFields)(now)
                : null);
        const resolvedMatchedRuleId = skipFields && matchedRuleId
            ? existingData?.matchedRuleId ?? matchedRuleId
            : undefined;
        const vendorInvoiceNumberRaw = String(proc.parsed.header
            .vendorInvoiceNumber ?? "");
        const headerForIdentity = proc.parsed.header;
        const businessIdentity = !skipFields && !proc.duplicate
            ? (0, businessInvoiceIdentity_1.tryBuildBusinessInvoiceIdentity)({
                detectedVendorId: existingData?.detectedVendorId,
                detectedVendorName: proc.detectedVendorName,
                parserFormatId: proc.parserFormatId,
                vendorInvoiceNumber: vendorInvoiceNumberRaw,
                customerPoOrReference: headerForIdentity.customerPoOrReference,
                vendorOrderNumber: headerForIdentity.vendorOrderNumber,
                fulfillmentMethod: headerForIdentity.fulfillmentMethod,
                parsedLines,
            })
            : null;
        const buildReviewDoc = (input) => {
            const activeSkip = input.effectiveSkipFields ?? skipFields;
            return {
                id: reviewId,
                inboundEmailProcessingId: inboundDoc.id,
                gmailMessageId: inboundDoc.gmailMessageId,
                importBatchId: batchResult.importBatchId,
                pageId: row.pageId,
                pageIndexInBatch: row.pageIndexInBatch,
                reviewStatus: activeSkip ? activeSkip.reviewStatus : "pending_review",
                importStatus: input.importStatus,
                confidenceTier: proc.confidenceTier,
                confidenceScore: proc.confidenceScore,
                humanReviewRequired: activeSkip
                    ? activeSkip.humanReviewRequired
                    : true,
                duplicate: proc.duplicate,
                parsedHeader: input.parsedHeader,
                parsedLines,
                parsedLineCount: parsedLines.length,
                parseWarnings: input.parseWarnings,
                orderNotes: proc.parsed.orderNotes,
                outcome: activeSkip ? "skipped" : "needs_review",
                autoImportEligible: input.autoImportEligible,
                autoImportConfidence: input.autoImportConfidence,
                autoImportReasons: input.autoImportReasons,
                reviewRequiredReasons: input.reviewRequiredReasons,
                importDecisionMode: input.importDecisionMode,
                suggestedAction: input.suggestedAction,
                parserFormatId: proc.parserFormatId,
                parserRouteConfidence: proc.parserRouteConfidence,
                detectedVendorName: proc.detectedVendorName,
                createdAt,
                updatedAt: now,
                ...(proc.duplicateOfPageId ? { duplicateOfPageId: proc.duplicateOfPageId } : {}),
                ...(reviewError ? { error: reviewError } : {}),
                ...(input.fieldCorrectionLog.length > 0
                    ? { fieldCorrectionLog: input.fieldCorrectionLog }
                    : {}),
                ...(input.originalParsedHeader
                    ? { originalParsedHeader: input.originalParsedHeader }
                    : {}),
                ...(Array.isArray(input.originalParseWarnings)
                    ? { originalParseWarnings: input.originalParseWarnings }
                    : {}),
                ...(input.fulfillmentOverride
                    ? { fulfillmentOverride: input.fulfillmentOverride }
                    : {}),
                ...(Array.isArray(input.draftPlannedStagingLocationIds)
                    ? { draftPlannedStagingLocationIds: input.draftPlannedStagingLocationIds }
                    : {}),
                ...(input.canonicalImportId
                    ? { canonicalImportId: input.canonicalImportId }
                    : {}),
                ...(input.possibleRevisionOfImportId
                    ? { possibleRevisionOfImportId: input.possibleRevisionOfImportId }
                    : {}),
                ...(activeSkip
                    ? {
                        skipReason: activeSkip.skipReason,
                        rejectedAt: activeSkip.rejectedAt,
                        rejectedBy: activeSkip.rejectedBy,
                        ...(resolvedMatchedRuleId &&
                            activeSkip.skipReason !== "duplicate_business_invoice"
                            ? { matchedRuleId: resolvedMatchedRuleId }
                            : {}),
                    }
                    : ignoreRuleArmed && strongSignals
                        ? { ignoreRuleSuppressedBy: strongInvoiceSignals_1.STRONG_INVOICE_SIGNALS_REASON }
                        : {}),
            };
        };
        const reviewRef = db.collection(REVIEW_COLLECTION).doc(reviewId);
        await db.runTransaction(async (tx) => {
            const freshSnap = await tx.get(reviewRef);
            const keySnap = businessIdentity
                ? await (0, businessInvoiceIdentity_1.getBusinessInvoiceKeySnap)(tx, db, businessIdentity.keyDocId)
                : null;
            const freshData = freshSnap.exists
                ? freshSnap.data()
                : undefined;
            const freshStatus = freshData?.reviewStatus;
            const freshSystemSkip = (0, creditReturnSkip_1.isSystemIgnoreSkipReason)(freshData?.skipReason);
            if (freshStatus === "approved") {
                return;
            }
            if (freshStatus === "rejected" && !(0, creditReturnSkip_1.isSystemAutoRejectedImport)(freshData)) {
                return;
            }
            let businessClaim = null;
            if (businessIdentity && keySnap && !skipFields) {
                // Preserve user re-open of a prior system skip — do not re-claim as duplicate.
                const reopenedPending = freshSnap.exists &&
                    freshStatus === "pending_review" &&
                    !freshSystemSkip &&
                    !isNewImport;
                if (!reopenedPending) {
                    // Legacy pre-key resend: query prior imports before claim writes.
                    const legacyLookup = !keySnap.exists
                        ? await (0, businessInvoiceIdentity_1.findLegacyBusinessInvoiceCanonical)(tx, db, {
                            identity: businessIdentity,
                            vendorInvoiceNumberRaw,
                            excludeReviewId: reviewId,
                        })
                        : { kind: "none" };
                    if (legacyLookup.kind === "saturated") {
                        throw new Error(businessInvoiceIdentity_1.BUSINESS_INVOICE_LEGACY_LOOKUP_SATURATED);
                    }
                    businessClaim = (0, businessInvoiceIdentity_1.claimOrLinkBusinessInvoiceWithSnap)(tx, db, keySnap, {
                        identity: businessIdentity,
                        reviewId,
                        gmailMessageId: inboundDoc.gmailMessageId,
                        inboundEmailProcessingId: inboundDoc.id,
                        now,
                        legacyCanonicalHint: legacyLookup.kind === "found" ? legacyLookup.hint : null,
                    });
                }
            }
            const duplicateSkip = businessClaim?.kind === "exact_duplicate"
                ? (0, creditReturnSkip_1.duplicateBusinessInvoiceSkipFields)(now)
                : null;
            const revisionOfId = businessClaim?.kind === "possible_revision"
                ? businessClaim.canonicalImportId
                : undefined;
            const canonicalImportId = businessClaim?.kind === "exact_duplicate" ||
                businessClaim?.kind === "possible_revision"
                ? businessClaim.canonicalImportId
                : businessClaim?.kind === "same_message_multipage"
                    ? undefined
                    : undefined;
            // Recompute correction overrides from the fresh in-tx import snapshot so a
            // concurrent apply cannot be wiped by a stale pre-tx log read.
            const freshLog = Array.isArray(freshData?.fieldCorrectionLog)
                ? freshData.fieldCorrectionLog
                : durableLog;
            const freshOriginalHeader = freshData?.originalParsedHeader ?? existingExtras.originalParsedHeader;
            const freshOriginalWarnings = Array.isArray(freshData?.originalParseWarnings)
                ? freshData.originalParseWarnings
                : Array.isArray(existingExtras.originalParseWarnings)
                    ? existingExtras.originalParseWarnings
                    : undefined;
            const freshCorrectedHeader = (0, reconcileAfterFieldCorrection_1.applyFieldCorrectionLogToHeader)(parserHeader, freshLog);
            const freshOverrideHeader = (0, reconcileAfterFieldCorrection_1.applyFulfillmentOverrideToHeader)(freshCorrectedHeader, freshData?.fulfillmentOverride);
            let effectiveImportStatus = proc.importStatus;
            const overrideActive = freshData?.fulfillmentOverride?.active === true;
            if (overrideActive && proc.importStatus === "pickup_at_vendor") {
                const formatId = proc.parserFormatId === "johnstone" ||
                    proc.parserFormatId === "first_supply" ||
                    proc.parserFormatId === "generic" ||
                    proc.parserFormatId === "unknown"
                    ? proc.parserFormatId
                    : "johnstone";
                let headerForDerive;
                try {
                    headerForDerive = (0, parsedHeaderValidation_1.asParsedHeaderForImport)(freshOverrideHeader);
                }
                catch {
                    headerForDerive = {
                        ...freshOverrideHeader,
                        fulfillmentMethod: "delivery",
                    };
                }
                effectiveImportStatus = (0, inferImportStatus_1.deriveImportStatus)({
                    header: headerForDerive,
                    lines: parsedLines,
                    parseWarnings: proc.parsed.parseWarnings,
                    orderNotes: proc.parsed.orderNotes,
                }, formatId);
            }
            const freshReconciled = (0, reconcileAfterFieldCorrection_1.reconcileImportStateAfterCorrection)({
                parsedHeader: freshOverrideHeader,
                parseWarnings: proc.parsed.parseWarnings,
                importStatus: effectiveImportStatus,
                confidenceScore: proc.confidenceScore,
                humanReviewRequired: proc.humanReviewRequired,
                duplicate: proc.duplicate,
                parsedLines,
                parsedLineCount: parsedLines.length,
                pageId: row.pageId,
                parserFormatId: proc.parserFormatId,
                orderNotes: proc.parsed.orderNotes,
                fieldCorrectionLog: freshLog,
            });
            const freshReviewDoc = buildReviewDoc({
                parsedHeader: freshOverrideHeader,
                parseWarnings: freshReconciled.parseWarnings,
                autoImportEligible: freshReconciled.autoImportEligible,
                autoImportConfidence: freshReconciled.autoImportConfidence,
                autoImportReasons: freshReconciled.autoImportReasons,
                reviewRequiredReasons: revisionOfId
                    ? [
                        ...freshReconciled.reviewRequiredReasons,
                        "possible_revision_of_existing_invoice",
                    ]
                    : freshReconciled.reviewRequiredReasons,
                importDecisionMode: revisionOfId
                    ? "review_required"
                    : freshReconciled.importDecisionMode,
                suggestedAction: freshReconciled.suggestedAction,
                fieldCorrectionLog: freshLog,
                originalParsedHeader: freshOriginalHeader,
                originalParseWarnings: freshOriginalWarnings,
                importStatus: effectiveImportStatus,
                fulfillmentOverride: freshData?.fulfillmentOverride,
                draftPlannedStagingLocationIds: freshData?.draftPlannedStagingLocationIds,
                effectiveSkipFields: duplicateSkip ?? skipFields,
                canonicalImportId,
                possibleRevisionOfImportId: revisionOfId,
            });
            // User re-opened a system skip (pending, no skipReason) — do not re-auto-skip.
            if (freshSnap.exists &&
                freshStatus === "pending_review" &&
                !freshSystemSkip &&
                !isNewImport) {
                const reopenSafeDoc = {
                    ...freshReviewDoc,
                    reviewStatus: "pending_review",
                    humanReviewRequired: true,
                    outcome: "needs_review",
                };
                delete reopenSafeDoc.skipReason;
                delete reopenSafeDoc.rejectedAt;
                delete reopenSafeDoc.rejectedBy;
                delete reopenSafeDoc.matchedRuleId;
                tx.set(reviewRef, (0, firestoreSafeValue_1.firestoreSafeValue)(reopenSafeDoc));
                return;
            }
            tx.set(reviewRef, (0, firestoreSafeValue_1.firestoreSafeValue)(freshReviewDoc));
        });
        if (autoSkipDocument && matchedRuleId) {
            // Fail-open: email ingest must not abort when audit logging fails.
            try {
                await (0, vendorIgnoreRules_1.incrementVendorIgnoreRuleMatch)(db, matchedRuleId, reviewId);
                await (0, ignoreRuleAudit_1.writeIgnoreRuleAuditEvent)(db, {
                    ruleId: matchedRuleId,
                    eventType: "rule_matched",
                    actorUid: "system",
                    importId: reviewId,
                });
            }
            catch (err) {
                console.error("ignore rule match audit failed:", err);
            }
        }
        else if (isNewImport &&
            ignoreRuleArmed &&
            strongSignals &&
            matchedRuleId) {
            // Fail-open: email ingest must not abort when audit logging fails.
            try {
                await (0, ignoreRuleAudit_1.writeIgnoreRuleAuditEvent)(db, {
                    ruleId: matchedRuleId,
                    eventType: "match_suppressed_strong_signals",
                    actorUid: "system",
                    importId: reviewId,
                });
            }
            catch (err) {
                console.error("ignore rule suppress audit failed:", err);
            }
        }
    }
    return reviewIds;
}
/** Core processor — usable from sync, watch handler, or unit tests with fixture messages. */
async function processInboundGmailMessage(accessToken, gmailMessageId, options) {
    const db = getDb();
    const docId = docIdForMessage(gmailMessageId);
    const ref = db.collection(COLLECTION).doc(docId);
    const existing = await ref.get();
    if (existing.exists) {
        const data = existing.data();
        if (!shouldReprocessExistingDoc(data, options)) {
            await archiveInboxMessageSoftFail(ref, accessToken, gmailMessageId, data.processingStatus, data.gmailInboxArchivedAt);
            return {
                docId,
                gmailMessageId,
                skipped: true,
                processingStatus: data.processingStatus,
                reviewRecordIds: data.parseResult?.reviewRecordIds ?? [],
                skippedProcessingStatus: data.processingStatus,
            };
        }
        const cachedText = data.combinedExtractedText?.trim();
        if (cachedText && !(0, normalizePdfText_1.hasCustomFontPdfEncoding)(cachedText)) {
            const now = new Date().toISOString();
            await ref.set({
                processingStatus: "processing",
                updatedAt: now,
            }, { merge: true });
            try {
                const result = await finalizeParsedInboundDoc(ref, data, trimStoredText(cachedText), gmailMessageId);
                await archiveInboxMessageSoftFail(ref, accessToken, gmailMessageId, result.processingStatus, data.gmailInboxArchivedAt);
                return result;
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                await ref.set({
                    processingStatus: "error",
                    processingError: message.slice(0, 500),
                    updatedAt: new Date().toISOString(),
                }, { merge: true });
                throw err;
            }
        }
        // retryOnError / zero-queue backfill: fall through — full Gmail re-fetch
    }
    const now = new Date().toISOString();
    await ref.set({
        id: docId,
        gmailMessageId,
        senderEmail: "",
        subject: "",
        receivedAt: now,
        attachmentFilenames: [],
        pdfAttachments: [],
        processingStatus: "processing",
        reviewStatus: "pending_review",
        createdAt: now,
        updatedAt: now,
    });
    try {
        const message = options?.prefetchedMessage ?? (await (0, gmailInbound_1.fetchGmailMessage)(accessToken, gmailMessageId));
        const headers = (0, gmailInbound_1.parseGmailHeaders)(message.payload?.headers);
        const receivedAt = message.internalDate && !Number.isNaN(Number(message.internalDate))
            ? new Date(Number(message.internalDate)).toISOString()
            : headers.receivedAt;
        const pdfRefs = (0, gmailInbound_1.findPdfAttachments)(message.payload).slice(0, MAX_PDF_ATTACHMENTS_PER_MESSAGE);
        const attachmentFilenames = pdfRefs.map((p) => p.filename);
        if (pdfRefs.length === 0) {
            const replySettings = await (0, loadOutboundEmailContext_1.loadReplyIngestSettings)();
            const eligibleForReply = replySettings.enabled &&
                (0, loadOutboundEmailContext_1.isMessageEligibleForReplyIngest)(receivedAt, replySettings.since);
            let processingStatus = "no_pdf";
            let vendorEmailEventId;
            if (eligibleForReply) {
                const routerResult = await (0, replyRouter_1.processInboundReply)({
                    gmailMessageId,
                    threadId: message.threadId,
                    headers,
                    bodyText: (0, gmailInbound_1.extractGmailBodyText)(message.payload),
                    snippet: message.snippet,
                    settings: replySettings,
                });
                if (routerResult.eventId && !routerResult.skipped) {
                    processingStatus = "reply_processed";
                    vendorEmailEventId = routerResult.eventId;
                }
            }
            const noPdfDoc = {
                id: docId,
                gmailMessageId,
                threadId: message.threadId,
                senderEmail: sanitizeSender(headers.senderEmail),
                subject: sanitizeSubject(headers.subject),
                receivedAt,
                attachmentFilenames: [],
                pdfAttachments: [],
                processingStatus,
                reviewStatus: "pending_review",
                createdAt: now,
                updatedAt: new Date().toISOString(),
                ...(vendorEmailEventId ? { vendorEmailEventId } : {}),
                ...(headers.messageIdHeader ? { messageIdHeader: headers.messageIdHeader } : {}),
                ...(headers.inReplyTo ? { inReplyTo: headers.inReplyTo } : {}),
                ...(headers.references?.length ? { references: headers.references } : {}),
            };
            await ref.set(noPdfDoc);
            await archiveInboxMessageSoftFail(ref, accessToken, gmailMessageId, processingStatus, undefined);
            return {
                docId,
                gmailMessageId,
                skipped: false,
                processingStatus,
                reviewRecordIds: [],
                vendorEmailEventId,
            };
        }
        const pdfAttachments = [];
        const textParts = [];
        for (const pdf of pdfRefs) {
            const record = {
                filename: pdf.filename,
                mimeType: pdf.mimeType,
                sizeBytes: pdf.sizeBytes,
                gmailAttachmentId: pdf.attachmentId,
            };
            try {
                const bytes = await (0, gmailInbound_1.downloadGmailAttachment)(accessToken, gmailMessageId, pdf.attachmentId);
                const extracted = await (0, extractPdfText_1.extractTextFromPdfBuffer)(bytes);
                record.extractedText = trimStoredText(extracted.text);
                if (extracted.rawText) {
                    record.extractedTextRaw = trimStoredText(extracted.rawText);
                }
                record.pageCount = extracted.pageCount;
                textParts.push(extracted.text);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                record.extractError = message.slice(0, 500);
            }
            pdfAttachments.push(record);
        }
        const combinedExtractedText = trimStoredText(textParts.join("\n\n---PDF ATTACHMENT---\n\n"));
        const hasAnyText = textParts.some((t) => t.trim().length > 0);
        if (!hasAnyText) {
            const errorDoc = {
                id: docId,
                gmailMessageId,
                threadId: message.threadId,
                senderEmail: sanitizeSender(headers.senderEmail),
                subject: sanitizeSubject(headers.subject),
                receivedAt,
                attachmentFilenames,
                pdfAttachments,
                combinedExtractedText: combinedExtractedText || undefined,
                processingStatus: "error",
                processingError: "PDF text extraction failed for all attachments",
                reviewStatus: "pending_review",
                createdAt: now,
                updatedAt: new Date().toISOString(),
            };
            await ref.set(errorDoc);
            return {
                docId,
                gmailMessageId,
                skipped: false,
                processingStatus: "error",
                reviewRecordIds: [],
            };
        }
        const partialDoc = {
            id: docId,
            gmailMessageId,
            threadId: message.threadId,
            senderEmail: sanitizeSender(headers.senderEmail),
            subject: sanitizeSubject(headers.subject),
            receivedAt,
            attachmentFilenames,
            pdfAttachments,
            combinedExtractedText,
            processingStatus: "extracted",
            reviewStatus: "pending_review",
            createdAt: now,
            updatedAt: new Date().toISOString(),
        };
        const result = await finalizeParsedInboundDoc(ref, partialDoc, combinedExtractedText, gmailMessageId);
        await archiveInboxMessageSoftFail(ref, accessToken, gmailMessageId, result.processingStatus, undefined);
        return result;
    }
    catch (err) {
        if ((0, gmailInbound_1.isGmailApiNotFoundError)(err)) {
            const prior = existing.exists
                ? existing.data()
                : undefined;
            return tombstoneGmailMessageGone(ref, docId, gmailMessageId, prior);
        }
        const message = err instanceof Error ? err.message : String(err);
        await ref.set({
            processingStatus: "error",
            processingError: message.slice(0, 500),
            updatedAt: new Date().toISOString(),
        }, { merge: true });
        throw err;
    }
}
/** Re-run parser on cached inbound PDF text for one pending review import (modal Re-parse). */
async function reparseVendorInvoiceImportFromCache(importId) {
    const trimmedId = importId.trim();
    if (!trimmedId || trimmedId.length > 256) {
        throw new Error("import id is required.");
    }
    const db = getDb();
    const importSnap = await db.collection(REVIEW_COLLECTION).doc(trimmedId).get();
    if (!importSnap.exists) {
        throw new Error("Vendor invoice import not found.");
    }
    const importDoc = importSnap.data();
    if (importDoc.reviewStatus === "approved") {
        throw new Error("Cannot re-parse an approved import.");
    }
    if (importDoc.reviewStatus === "rejected" &&
        !(0, creditReturnSkip_1.isSystemAutoRejectedImport)(importDoc)) {
        throw new Error("Cannot re-parse a rejected import.");
    }
    const inboundId = importDoc.inboundEmailProcessingId?.trim();
    if (!inboundId) {
        throw new Error("Import has no inbound email record.");
    }
    const inboundSnap = await db.collection(COLLECTION).doc(inboundId).get();
    if (!inboundSnap.exists) {
        throw new Error("Inbound email processing record not found.");
    }
    const inbound = inboundSnap.data();
    const gmailMessageId = inbound.gmailMessageId?.trim();
    if (!gmailMessageId) {
        throw new Error("Inbound email has no Gmail message id.");
    }
    const cached = inbound.combinedExtractedText?.trim();
    if (!cached) {
        throw new Error("No cached PDF text on this email — use Refresh Now to re-fetch from Gmail.");
    }
    if ((0, normalizePdfText_1.hasCustomFontPdfEncoding)(cached)) {
        throw new Error("Cached text uses legacy font encoding — use Refresh Now to re-extract the PDF.");
    }
    const previousLineCount = importDoc.parsedLineCount ?? importDoc.parsedLines?.length ?? 0;
    const ref = db.collection(COLLECTION).doc(inboundId);
    const now = new Date().toISOString();
    await ref.set({ processingStatus: "processing", updatedAt: now }, { merge: true });
    try {
        await finalizeParsedInboundDoc(ref, inbound, trimStoredText(cached), gmailMessageId);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await ref.set({
            processingStatus: "error",
            processingError: message.slice(0, 500),
            updatedAt: new Date().toISOString(),
        }, { merge: true });
        throw err;
    }
    const updatedSnap = await db.collection(REVIEW_COLLECTION).doc(trimmedId).get();
    if (!updatedSnap.exists) {
        throw new Error("Import record missing after re-parse.");
    }
    const updated = updatedSnap.data();
    const newLineCount = updated.parsedLineCount ?? updated.parsedLines?.length ?? 0;
    return {
        importDoc: updated,
        reparse: {
            importId: trimmedId,
            gmailMessageId,
            previousLineCount,
            newLineCount,
            importStatus: updated.importStatus,
        },
    };
}
//# sourceMappingURL=processInboundGmailMessage.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processInboundGmailMessage = processInboundGmailMessage;
/**
 * Process a single Gmail message into inboundEmailProcessing (+ review queue on M2).
 * Idempotent by gmailMessageId. Does NOT write deliveries/items.
 */
const admin = require("firebase-admin");
const crypto_1 = require("crypto");
const gmailInbound_1 = require("../gmailInbound");
const extractPdfText_1 = require("./extractPdfText");
const processInvoiceForInbound_1 = require("../invoice/processInvoiceForInbound");
const COLLECTION = "inboundEmailProcessing";
const REVIEW_COLLECTION = "vendorInvoiceImports";
const MAX_EXTRACTED_TEXT_STORE = 120_000;
const MAX_SUBJECT_LEN = 4096;
const MAX_SENDER_LEN = 320;
const MAX_PDF_ATTACHMENTS_PER_MESSAGE = 5;
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
async function writeReviewRecords(db, inboundDoc, batchResult) {
    const reviewIds = [];
    const now = new Date().toISOString();
    for (const row of batchResult.results) {
        if (!row.processing || row.outcome === "failed")
            continue;
        const reviewId = `vii-${inboundDoc.gmailMessageId}-${row.pageId}`;
        reviewIds.push(reviewId);
        const proc = row.processing;
        const reviewDoc = {
            id: reviewId,
            inboundEmailProcessingId: inboundDoc.id,
            gmailMessageId: inboundDoc.gmailMessageId,
            importBatchId: batchResult.importBatchId,
            pageId: row.pageId,
            pageIndexInBatch: row.pageIndexInBatch,
            reviewStatus: "pending_review",
            importStatus: proc.importStatus,
            confidenceTier: proc.confidenceTier,
            confidenceScore: proc.confidenceScore,
            humanReviewRequired: true,
            duplicate: proc.duplicate,
            duplicateOfPageId: proc.duplicateOfPageId,
            parsedHeader: proc.parsed.header,
            parsedLineCount: proc.parsed.lines.length,
            parseWarnings: proc.parsed.parseWarnings,
            orderNotes: proc.parsed.orderNotes,
            outcome: "needs_review",
            error: row.error,
            createdAt: now,
            updatedAt: now,
        };
        await db.collection(REVIEW_COLLECTION).doc(reviewId).set(reviewDoc);
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
        return {
            docId,
            gmailMessageId,
            skipped: true,
            processingStatus: data.processingStatus,
            reviewRecordIds: data.parseResult?.reviewRecordIds ?? [],
        };
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
            const noPdfDoc = {
                id: docId,
                gmailMessageId,
                threadId: message.threadId,
                senderEmail: sanitizeSender(headers.senderEmail),
                subject: sanitizeSubject(headers.subject),
                receivedAt,
                attachmentFilenames: [],
                pdfAttachments: [],
                processingStatus: "no_pdf",
                reviewStatus: "pending_review",
                createdAt: now,
                updatedAt: new Date().toISOString(),
            };
            await ref.set(noPdfDoc);
            return {
                docId,
                gmailMessageId,
                skipped: false,
                processingStatus: "no_pdf",
                reviewRecordIds: [],
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
        const importBatchId = `batch-email-${gmailMessageId.slice(0, 12)}-${(0, crypto_1.randomBytes)(3).toString("hex")}`;
        const batchResult = (0, processInvoiceForInbound_1.parseInboundInvoiceText)(combinedExtractedText, {
            importBatchId,
            gmailMessageId,
        });
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
        await ref.set(partialDoc);
        const reviewRecordIds = await writeReviewRecords(db, partialDoc, batchResult);
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
            docId,
            gmailMessageId,
            skipped: false,
            processingStatus: "parsed",
            reviewRecordIds,
        };
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
//# sourceMappingURL=processInboundGmailMessage.js.map
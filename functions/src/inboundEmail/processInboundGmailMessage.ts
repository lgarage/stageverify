/**
 * Process a single Gmail message into inboundEmailProcessing (+ review queue on M2).
 * Idempotent by gmailMessageId. Does NOT write deliveries/items.
 */
import * as admin from "firebase-admin";
import { randomBytes } from "crypto";
import {
  archiveGmailMessageRemoveInbox,
  downloadGmailAttachment,
  extractGmailBodyText,
  fetchGmailMessage,
  findPdfAttachments,
  isGmailApiNotFoundError,
  parseGmailHeaders,
} from "../gmailInbound";
import { extractTextFromPdfBuffer } from "./extractPdfText";
import {
  hasCustomFontPdfEncoding,
  postProcessExtractedPdfText,
} from "./normalizePdfText";
import { preferredPreParseFormat } from "../invoice/invoiceDocumentSplit";
import { normalizeExtractedPageText } from "../invoice/pdfTextAdapter";
import { recoverFieldCorrectionLogFromAudit } from "../invoice/reviewChat/correctionAuditRecovery";
import {
  applyFieldCorrectionLogToHeader,
  reconcileImportStateAfterCorrection,
  type FieldCorrectionLogEntry,
} from "../invoice/reviewChat/reconcileAfterFieldCorrection";
import {
  isCreditReturnInvoice,
  documentIgnoreSkipFields,
  isSystemAutoRejectedImport,
  isSystemIgnoreSkipReason,
  resolveCreditReturnIngestSkip,
} from "../invoice/creditReturnSkip";
import {
  fingerprintFromImport,
  incrementVendorIgnoreRuleMatch,
  isArmableVendorKey,
  vendorIgnoresFingerprint,
} from "../invoice/aiShadow/vendorIgnoreRules";
import { writeIgnoreRuleAuditEvent } from "../invoice/aiShadow/ignoreRuleAudit";
import {
  hasStrongInvoiceSignals,
  STRONG_INVOICE_SIGNALS_REASON,
} from "../invoice/strongInvoiceSignals";
import { vendorKeyFromImportDoc } from "../invoice/aiShadow/adminConfig";
import { parseInboundInvoiceText } from "../invoice/processInvoiceForInbound";
import {
  isInvoiceAiShadowEnabled,
  runInvoiceAiShadow,
} from "../invoice/aiShadow/runInvoiceAiShadow";
import { firestoreSafeValue } from "./firestoreSafeValue";
import { sanitizeParsedLines } from "./sanitizeParsedLines";
import {
  isMessageEligibleForReplyIngest,
  loadReplyIngestSettings,
} from "../email/loadOutboundEmailContext";
import { processInboundReply } from "./replyRouter";
import type {
  GmailMessage,
  InboundEmailProcessingDoc,
  InboundPdfAttachmentRecord,
  VendorInvoiceImportDoc,
} from "./types";

const COLLECTION = "inboundEmailProcessing";
const REVIEW_COLLECTION = "vendorInvoiceImports";
const MAX_EXTRACTED_TEXT_STORE = 120_000;
const MAX_SUBJECT_LEN = 4096;
const MAX_SENDER_LEN = 320;
const MAX_PDF_ATTACHMENTS_PER_MESSAGE = 5;

/** Archive Gmail only after durable import/review persistence (never plain no_pdf/error). */
const GMAIL_ARCHIVE_ELIGIBLE_STATUSES = new Set<
  InboundEmailProcessingDoc["processingStatus"]
>(["parsed", "reply_processed"]);

/**
 * Soft-fail INBOX remove after durable StageVerify persist.
 * Never throws — archive failure must not flip a successful ingest to error.
 */
async function archiveInboxMessageSoftFail(
  ref: admin.firestore.DocumentReference,
  accessToken: string,
  gmailMessageId: string,
  processingStatus: InboundEmailProcessingDoc["processingStatus"],
  alreadyArchivedAt: string | undefined,
): Promise<void> {
  if (alreadyArchivedAt) return;
  if (!GMAIL_ARCHIVE_ELIGIBLE_STATUSES.has(processingStatus)) return;
  try {
    await archiveGmailMessageRemoveInbox(accessToken, gmailMessageId);
    await ref.set({ gmailInboxArchivedAt: new Date().toISOString() }, { merge: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `processInboundGmailMessage: archive failed for ${gmailMessageId} — ${message.slice(0, 200)}`,
    );
  }
}

function getDb() {
  return admin.firestore();
}

function docIdForMessage(gmailMessageId: string): string {
  return `inbound-${gmailMessageId}`;
}

function trimStoredText(text: string): string {
  if (text.length <= MAX_EXTRACTED_TEXT_STORE) return text;
  return `${text.slice(0, MAX_EXTRACTED_TEXT_STORE)}\n…[truncated]`;
}

function sanitizeSubject(subject: string): string {
  return subject.slice(0, MAX_SUBJECT_LEN);
}

function sanitizeSender(sender: string): string {
  return sender.slice(0, MAX_SENDER_LEN).toLowerCase();
}

export interface ProcessInboundGmailMessageResult {
  docId: string;
  gmailMessageId: string;
  skipped: boolean;
  processingStatus: InboundEmailProcessingDoc["processingStatus"];
  reviewRecordIds: string[];
  /** Set when skipped=true — existing doc status before skip. */
  skippedProcessingStatus?: InboundEmailProcessingDoc["processingStatus"];
  /** Inbound vendorEmailEvents id when reply router processed a non-PDF message. */
  vendorEmailEventId?: string;
}

export interface ProcessInboundGmailMessageOptions {
  prefetchedMessage?: GmailMessage;
  /** Manual sync: re-run messages previously marked error. */
  retryOnError?: boolean;
  /** Refresh Now: re-parse cached text for pending_review issue imports (parser/extractor improved). */
  reparseStaleReviews?: boolean;
}

function issueReviewError(
  proc: NonNullable<
    ReturnType<typeof parseInboundInvoiceText>["results"][number]["processing"]
  >,
  rowError?: string,
  creditReturnSkip?: boolean,
): string | undefined {
  if (creditReturnSkip) return undefined;
  if (rowError?.trim()) return rowError.trim();
  if (proc.importStatus !== "issue") return undefined;
  const warnings = proc.parsed.parseWarnings.filter(Boolean);
  if (warnings.length > 0) return warnings.join("; ");
  return "Parse issue — missing required invoice fields for expected-order import.";
}

/** Exported for sync backfill collection on Refresh Now. */
export function shouldReprocessExistingDoc(
  data: InboundEmailProcessingDoc,
  options?: ProcessInboundGmailMessageOptions,
): boolean {
  const cached = data.combinedExtractedText?.trim();
  const reviewIds = data.parseResult?.reviewRecordIds ?? [];
  const total = data.parseResult?.total ?? 0;

  // Stale issue reparse — scheduled sync + Refresh Now backfill (no full error retry required).
  if (
    options?.reparseStaleReviews &&
    cached &&
    !hasCustomFontPdfEncoding(cached) &&
    data.processingStatus === "parsed" &&
    reviewIds.length > 0
  ) {
    return true;
  }

  if (data.processingStatus === "reply_processed") return false;
  if (data.processingStatus === "message_gone") return false;

  if (!options?.retryOnError) return false;
  if (data.processingStatus === "no_pdf") return false;
  if (data.processingStatus === "error") return true;
  if (cached && hasCustomFontPdfEncoding(cached)) return true;
  if (data.processingStatus !== "parsed") return false;
  // Backfill any parsed email with pages but zero queued review rows.
  if (total > 0 && reviewIds.length === 0) return true;
  return false;
}

const GMAIL_MESSAGE_GONE_ERROR =
  "Message no longer in Gmail mailbox (deleted or permanently inaccessible).";

async function tombstoneGmailMessageGone(
  ref: admin.firestore.DocumentReference,
  docId: string,
  gmailMessageId: string,
  existing?: InboundEmailProcessingDoc,
): Promise<ProcessInboundGmailMessageResult> {
  const now = new Date().toISOString();
  await ref.set(
    {
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
    },
    { merge: true },
  );
  return {
    docId,
    gmailMessageId,
    skipped: true,
    processingStatus: "message_gone",
    reviewRecordIds: existing?.parseResult?.reviewRecordIds ?? [],
    skippedProcessingStatus: "message_gone",
  };
}

async function finalizeParsedInboundDoc(
  ref: admin.firestore.DocumentReference,
  inboundDoc: InboundEmailProcessingDoc,
  combinedExtractedText: string,
  gmailMessageId: string,
): Promise<ProcessInboundGmailMessageResult> {
  const db = getDb();
  const preFormat = preferredPreParseFormat(combinedExtractedText, {
    senderEmail: inboundDoc.senderEmail,
  });
  const normalizedText = trimStoredText(
    preFormat === "johnstone" || hasCustomFontPdfEncoding(combinedExtractedText)
      ? postProcessExtractedPdfText(combinedExtractedText)
      : normalizeExtractedPageText(combinedExtractedText),
  );
  const importBatchId = `batch-email-${gmailMessageId.slice(0, 12)}-${randomBytes(3).toString("hex")}`;
  const batchResult = parseInboundInvoiceText(normalizedText, {
    importBatchId,
    gmailMessageId,
    senderEmail: inboundDoc.senderEmail,
  });

  const partialDoc: InboundEmailProcessingDoc = {
    ...inboundDoc,
    combinedExtractedText: normalizedText,
    processingStatus: "extracted",
    updatedAt: new Date().toISOString(),
  };
  await ref.set(partialDoc);

  const reviewRecordIds = await writeReviewRecords(db, partialDoc, batchResult);
  await maybeRunInvoiceAiShadow(db, partialDoc, batchResult);

  const parsedDoc: InboundEmailProcessingDoc = {
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
async function maybeRunInvoiceAiShadow(
  db: admin.firestore.Firestore,
  inboundDoc: InboundEmailProcessingDoc,
  batchResult: ReturnType<typeof parseInboundInvoiceText>,
): Promise<void> {
  try {
    if (!(await isInvoiceAiShadowEnabled(db))) return;
  } catch {
    return;
  }

  for (const row of batchResult.results) {
    if (!row.processing || row.outcome === "failed") continue;
    if (row.processing.parserFormatId !== "johnstone") continue;

    const reviewId = `vii-${inboundDoc.gmailMessageId}-${row.pageId}`;
    try {
      const existing = await db.collection(REVIEW_COLLECTION).doc(reviewId).get();
      if (!existing.exists) continue;
      const status = (existing.data() as VendorInvoiceImportDoc).reviewStatus;
      if (status === "approved" || status === "rejected") continue;

      const vendorKey =
        row.processing.detectedVendorName?.trim() ||
        "johnstone";
      const shadow = await runInvoiceAiShadow({
        extractedText: row.processing.page.extractedText,
        vendorKey,
        parserFormatId: row.processing.parserFormatId,
        regexLines: row.processing.parsed.lines,
      });
      await db.collection(REVIEW_COLLECTION).doc(reviewId).update({
        aiShadowParse: firestoreSafeValue(shadow),
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // Shadow must never fail inbound ingest.
    }
  }
}

async function writeReviewRecords(
  db: admin.firestore.Firestore,
  inboundDoc: InboundEmailProcessingDoc,
  batchResult: ReturnType<typeof parseInboundInvoiceText>,
): Promise<string[]> {
  const reviewIds: string[] = [];
  const now = new Date().toISOString();

  for (const row of batchResult.results) {
    if (!row.processing || row.outcome === "failed") continue;

    const reviewId = `vii-${inboundDoc.gmailMessageId}-${row.pageId}`;
    reviewIds.push(reviewId);

    const existingSnap = await db.collection(REVIEW_COLLECTION).doc(reviewId).get();
    const existingData = existingSnap.exists
      ? (existingSnap.data() as VendorInvoiceImportDoc)
      : undefined;
    const existingStatus = existingData?.reviewStatus;
    const existingSystemSkip = isSystemIgnoreSkipReason(existingData?.skipReason);
    if (existingStatus === "approved") {
      continue;
    }
    if (existingStatus === "rejected" && !isSystemAutoRejectedImport(existingData)) {
      continue;
    }

    const proc = row.processing;
    const parsedLines = sanitizeParsedLines(proc.parsed.lines);
    const creditReturnSkip =
      isCreditReturnInvoice(proc.parsed, proc.page.extractedText) && !proc.duplicate;
    const reviewError = issueReviewError(proc, row.error, creditReturnSkip);
    const isNewImport = !existingSnap.exists;
    const vendorKeyRaw = vendorKeyFromImportDoc({
      detectedVendorName: proc.detectedVendorName,
      parserFormatId: proc.parserFormatId,
    });
    const provisionalImport = {
      skipReason: existingData?.skipReason,
      parsedHeader: proc.parsed.header as unknown as Record<string, unknown>,
      parsedLines,
      orderNotes: proc.parsed.orderNotes,
      parseWarnings: proc.parsed.parseWarnings,
      importStatus: proc.importStatus,
      pageId: row.pageId,
    };
    const fingerprint = fingerprintFromImport({
      vendorKey: vendorKeyRaw,
      parserFormatId: proc.parserFormatId,
      importRow: provisionalImport,
    });
    const ignoreMatch = isArmableVendorKey(vendorKeyRaw)
      ? await vendorIgnoresFingerprint(db, fingerprint, inboundDoc.senderEmail)
      : { matched: false as const };
    const ignoreRuleArmed = ignoreMatch.matched;
    const matchedRuleId = ignoreMatch.ruleId;
    const strongSignals = hasStrongInvoiceSignals({
      vendorInvoiceNumber: proc.parsed.header.vendorInvoiceNumber,
      extractedText: proc.page.extractedText,
    });
    // New import + taught fingerprint → auto-skip unless strong invoice signals. Re-opened imports stay pending.
    const autoSkipDocument =
      isNewImport && ignoreRuleArmed && !proc.duplicate && !strongSignals;
    // Preserve document-ignore auto-skip on reprocess when rule still armed.
    const preserveDocumentIgnoreSkip =
      existingSystemSkip &&
      existingData?.rejectedBy === "system:document_ignore_skip" &&
      ignoreRuleArmed;
    const creditIngestSkip = resolveCreditReturnIngestSkip({
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
    const existingExtras = (existingData ?? {}) as VendorInvoiceImportDoc & {
      fieldCorrectionLog?: unknown;
      originalParsedHeader?: Record<string, unknown>;
      originalParseWarnings?: string[];
    };
    let durableLog: FieldCorrectionLogEntry[] = Array.isArray(
      existingExtras.fieldCorrectionLog,
    )
      ? (existingExtras.fieldCorrectionLog as FieldCorrectionLogEntry[])
      : [];
    if (durableLog.length === 0 && existingSnap.exists) {
      // Historical wipe recovery: rebuild log from audit when import log is gone.
      durableLog = await recoverFieldCorrectionLogFromAudit(db, reviewId);
    }
    const parserHeader = proc.parsed.header as unknown as Record<string, unknown>;
    const createdAt =
      existingSnap.exists && (existingSnap.data() as VendorInvoiceImportDoc).createdAt
        ? (existingSnap.data() as VendorInvoiceImportDoc).createdAt
        : now;
    const skipFields =
      creditIngestSkip ??
      (autoSkipDocument || preserveDocumentIgnoreSkip
        ? documentIgnoreSkipFields(now)
        : null);
    const resolvedMatchedRuleId =
      skipFields && matchedRuleId
        ? existingData?.matchedRuleId ?? matchedRuleId
        : undefined;

    const buildReviewDoc = (input: {
      parsedHeader: Record<string, unknown>;
      parseWarnings: string[];
      autoImportEligible: boolean;
      autoImportConfidence: number;
      autoImportReasons: string[];
      reviewRequiredReasons: string[];
      importDecisionMode: NonNullable<VendorInvoiceImportDoc["importDecisionMode"]>;
      suggestedAction: string;
      fieldCorrectionLog: FieldCorrectionLogEntry[];
      originalParsedHeader?: Record<string, unknown>;
      originalParseWarnings?: string[];
    }): VendorInvoiceImportDoc & {
      fieldCorrectionLog?: FieldCorrectionLogEntry[];
      originalParsedHeader?: Record<string, unknown>;
      originalParseWarnings?: string[];
    } => ({
      id: reviewId,
      inboundEmailProcessingId: inboundDoc.id,
      gmailMessageId: inboundDoc.gmailMessageId,
      importBatchId: batchResult.importBatchId,
      pageId: row.pageId,
      pageIndexInBatch: row.pageIndexInBatch,
      reviewStatus: skipFields ? skipFields.reviewStatus : "pending_review",
      importStatus: proc.importStatus,
      confidenceTier: proc.confidenceTier,
      confidenceScore: proc.confidenceScore,
      humanReviewRequired: skipFields
        ? skipFields.humanReviewRequired
        : true,
      duplicate: proc.duplicate,
      parsedHeader: input.parsedHeader,
      parsedLines,
      parsedLineCount: parsedLines.length,
      parseWarnings: input.parseWarnings,
      orderNotes: proc.parsed.orderNotes,
      outcome: skipFields ? "skipped" : "needs_review",
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
      ...(skipFields
        ? {
            skipReason: skipFields.skipReason,
            rejectedAt: skipFields.rejectedAt,
            rejectedBy: skipFields.rejectedBy,
            ...(resolvedMatchedRuleId
              ? { matchedRuleId: resolvedMatchedRuleId }
              : {}),
          }
        : ignoreRuleArmed && strongSignals
          ? { ignoreRuleSuppressedBy: STRONG_INVOICE_SIGNALS_REASON }
          : {}),
    });

    const reviewRef = db.collection(REVIEW_COLLECTION).doc(reviewId);
    await db.runTransaction(async (tx) => {
      const freshSnap = await tx.get(reviewRef);
      const freshData = freshSnap.exists
        ? (freshSnap.data() as VendorInvoiceImportDoc)
        : undefined;
      const freshStatus = freshData?.reviewStatus;
      const freshSystemSkip = isSystemIgnoreSkipReason(freshData?.skipReason);
      if (freshStatus === "approved") {
        return;
      }
      if (freshStatus === "rejected" && !isSystemAutoRejectedImport(freshData)) {
        return;
      }

      // Recompute correction overrides from the fresh in-tx import snapshot so a
      // concurrent apply cannot be wiped by a stale pre-tx log read.
      const freshLog = Array.isArray(freshData?.fieldCorrectionLog)
        ? (freshData!.fieldCorrectionLog as FieldCorrectionLogEntry[])
        : durableLog;
      const freshOriginalHeader =
        freshData?.originalParsedHeader ?? existingExtras.originalParsedHeader;
      const freshOriginalWarnings = Array.isArray(freshData?.originalParseWarnings)
        ? freshData!.originalParseWarnings
        : Array.isArray(existingExtras.originalParseWarnings)
          ? existingExtras.originalParseWarnings
          : undefined;
      const freshCorrectedHeader = applyFieldCorrectionLogToHeader(
        parserHeader,
        freshLog,
      );
      const freshReconciled = reconcileImportStateAfterCorrection({
        parsedHeader: freshCorrectedHeader,
        parseWarnings: proc.parsed.parseWarnings,
        importStatus: proc.importStatus,
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
        parsedHeader: freshCorrectedHeader,
        parseWarnings: freshReconciled.parseWarnings,
        autoImportEligible: freshReconciled.autoImportEligible,
        autoImportConfidence: freshReconciled.autoImportConfidence,
        autoImportReasons: freshReconciled.autoImportReasons,
        reviewRequiredReasons: freshReconciled.reviewRequiredReasons,
        importDecisionMode: freshReconciled.importDecisionMode,
        suggestedAction: freshReconciled.suggestedAction,
        fieldCorrectionLog: freshLog,
        originalParsedHeader: freshOriginalHeader,
        originalParseWarnings: freshOriginalWarnings,
      });

      // User re-opened a system skip (pending, no skipReason) — do not re-auto-skip.
      if (
        freshSnap.exists &&
        freshStatus === "pending_review" &&
        !freshSystemSkip &&
        !isNewImport
      ) {
        const reopenSafeDoc = {
          ...freshReviewDoc,
          reviewStatus: "pending_review" as const,
          humanReviewRequired: true,
          outcome: "needs_review" as const,
        };
        delete (reopenSafeDoc as { skipReason?: string }).skipReason;
        delete (reopenSafeDoc as { rejectedAt?: string }).rejectedAt;
        delete (reopenSafeDoc as { rejectedBy?: string }).rejectedBy;
        delete (reopenSafeDoc as { matchedRuleId?: string }).matchedRuleId;
        tx.set(reviewRef, firestoreSafeValue(reopenSafeDoc));
        return;
      }
      tx.set(reviewRef, firestoreSafeValue(freshReviewDoc));
    });

    if (autoSkipDocument && matchedRuleId) {
      // Fail-open: email ingest must not abort when audit logging fails.
      try {
        await incrementVendorIgnoreRuleMatch(db, matchedRuleId, reviewId);
        await writeIgnoreRuleAuditEvent(db, {
          ruleId: matchedRuleId,
          eventType: "rule_matched",
          actorUid: "system",
          importId: reviewId,
        });
      } catch (err) {
        console.error("ignore rule match audit failed:", err);
      }
    } else if (
      isNewImport &&
      ignoreRuleArmed &&
      strongSignals &&
      matchedRuleId
    ) {
      // Fail-open: email ingest must not abort when audit logging fails.
      try {
        await writeIgnoreRuleAuditEvent(db, {
          ruleId: matchedRuleId,
          eventType: "match_suppressed_strong_signals",
          actorUid: "system",
          importId: reviewId,
        });
      } catch (err) {
        console.error("ignore rule suppress audit failed:", err);
      }
    }
  }

  return reviewIds;
}

/** Core processor — usable from sync, watch handler, or unit tests with fixture messages. */
export async function processInboundGmailMessage(
  accessToken: string,
  gmailMessageId: string,
  options?: ProcessInboundGmailMessageOptions,
): Promise<ProcessInboundGmailMessageResult> {
  const db = getDb();
  const docId = docIdForMessage(gmailMessageId);
  const ref = db.collection(COLLECTION).doc(docId);
  const existing = await ref.get();

  if (existing.exists) {
    const data = existing.data() as InboundEmailProcessingDoc;
    if (!shouldReprocessExistingDoc(data, options)) {
      await archiveInboxMessageSoftFail(
        ref,
        accessToken,
        gmailMessageId,
        data.processingStatus,
        data.gmailInboxArchivedAt,
      );
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
    if (cachedText && !hasCustomFontPdfEncoding(cachedText)) {
      const now = new Date().toISOString();
      await ref.set(
        {
          processingStatus: "processing",
          updatedAt: now,
        },
        { merge: true },
      );
      try {
        const result = await finalizeParsedInboundDoc(
          ref,
          data,
          trimStoredText(cachedText),
          gmailMessageId,
        );
        await archiveInboxMessageSoftFail(
          ref,
          accessToken,
          gmailMessageId,
          result.processingStatus,
          data.gmailInboxArchivedAt,
        );
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await ref.set(
          {
            processingStatus: "error",
            processingError: message.slice(0, 500),
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        );
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
  } satisfies Partial<InboundEmailProcessingDoc>);

  try {
    const message =
      options?.prefetchedMessage ?? (await fetchGmailMessage(accessToken, gmailMessageId));

    const headers = parseGmailHeaders(message.payload?.headers);
    const receivedAt =
      message.internalDate && !Number.isNaN(Number(message.internalDate))
        ? new Date(Number(message.internalDate)).toISOString()
        : headers.receivedAt;

    const pdfRefs = findPdfAttachments(message.payload).slice(0, MAX_PDF_ATTACHMENTS_PER_MESSAGE);
    const attachmentFilenames = pdfRefs.map((p) => p.filename);

    if (pdfRefs.length === 0) {
      const replySettings = await loadReplyIngestSettings();
      const eligibleForReply =
        replySettings.enabled &&
        isMessageEligibleForReplyIngest(receivedAt, replySettings.since);

      let processingStatus: InboundEmailProcessingDoc["processingStatus"] = "no_pdf";
      let vendorEmailEventId: string | undefined;

      if (eligibleForReply) {
        const routerResult = await processInboundReply({
          gmailMessageId,
          threadId: message.threadId,
          headers,
          bodyText: extractGmailBodyText(message.payload),
          snippet: message.snippet,
          settings: replySettings,
        });
        if (routerResult.eventId && !routerResult.skipped) {
          processingStatus = "reply_processed";
          vendorEmailEventId = routerResult.eventId;
        }
      }

      const noPdfDoc: InboundEmailProcessingDoc = {
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
      await archiveInboxMessageSoftFail(
        ref,
        accessToken,
        gmailMessageId,
        processingStatus,
        undefined,
      );
      return {
        docId,
        gmailMessageId,
        skipped: false,
        processingStatus,
        reviewRecordIds: [],
        vendorEmailEventId,
      };
    }

    const pdfAttachments: InboundPdfAttachmentRecord[] = [];
    const textParts: string[] = [];

    for (const pdf of pdfRefs) {
      const record: InboundPdfAttachmentRecord = {
        filename: pdf.filename,
        mimeType: pdf.mimeType,
        sizeBytes: pdf.sizeBytes,
        gmailAttachmentId: pdf.attachmentId,
      };

      try {
        const bytes = await downloadGmailAttachment(
          accessToken,
          gmailMessageId,
          pdf.attachmentId,
        );
        const extracted = await extractTextFromPdfBuffer(bytes);
        record.extractedText = trimStoredText(extracted.text);
        if (extracted.rawText) {
          record.extractedTextRaw = trimStoredText(extracted.rawText);
        }
        record.pageCount = extracted.pageCount;
        textParts.push(extracted.text);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        record.extractError = message.slice(0, 500);
      }

      pdfAttachments.push(record);
    }

    const combinedExtractedText = trimStoredText(textParts.join("\n\n---PDF ATTACHMENT---\n\n"));
    const hasAnyText = textParts.some((t) => t.trim().length > 0);

    if (!hasAnyText) {
      const errorDoc: InboundEmailProcessingDoc = {
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

    const partialDoc: InboundEmailProcessingDoc = {
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

    const result = await finalizeParsedInboundDoc(
      ref,
      partialDoc,
      combinedExtractedText,
      gmailMessageId,
    );
    await archiveInboxMessageSoftFail(
      ref,
      accessToken,
      gmailMessageId,
      result.processingStatus,
      undefined,
    );
    return result;
  } catch (err) {
    if (isGmailApiNotFoundError(err)) {
      const prior = existing.exists
        ? (existing.data() as InboundEmailProcessingDoc)
        : undefined;
      return tombstoneGmailMessageGone(ref, docId, gmailMessageId, prior);
    }
    const message = err instanceof Error ? err.message : String(err);
    await ref.set(
      {
        processingStatus: "error",
        processingError: message.slice(0, 500),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    throw err;
  }
}

export interface ReparseVendorInvoiceImportResult {
  importId: string;
  gmailMessageId: string;
  previousLineCount: number;
  newLineCount: number;
  importStatus: string;
}

/** Re-run parser on cached inbound PDF text for one pending review import (modal Re-parse). */
export async function reparseVendorInvoiceImportFromCache(
  importId: string,
): Promise<{ importDoc: VendorInvoiceImportDoc; reparse: ReparseVendorInvoiceImportResult }> {
  const trimmedId = importId.trim();
  if (!trimmedId || trimmedId.length > 256) {
    throw new Error("import id is required.");
  }

  const db = getDb();
  const importSnap = await db.collection(REVIEW_COLLECTION).doc(trimmedId).get();
  if (!importSnap.exists) {
    throw new Error("Vendor invoice import not found.");
  }
  const importDoc = importSnap.data() as VendorInvoiceImportDoc;
  if (importDoc.reviewStatus === "approved") {
    throw new Error("Cannot re-parse an approved import.");
  }
  if (
    importDoc.reviewStatus === "rejected" &&
    !isSystemAutoRejectedImport(importDoc)
  ) {
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
  const inbound = inboundSnap.data() as InboundEmailProcessingDoc;
  const gmailMessageId = inbound.gmailMessageId?.trim();
  if (!gmailMessageId) {
    throw new Error("Inbound email has no Gmail message id.");
  }

  const cached = inbound.combinedExtractedText?.trim();
  if (!cached) {
    throw new Error("No cached PDF text on this email — use Refresh Now to re-fetch from Gmail.");
  }
  if (hasCustomFontPdfEncoding(cached)) {
    throw new Error(
      "Cached text uses legacy font encoding — use Refresh Now to re-extract the PDF.",
    );
  }

  const previousLineCount = importDoc.parsedLineCount ?? importDoc.parsedLines?.length ?? 0;
  const ref = db.collection(COLLECTION).doc(inboundId);
  const now = new Date().toISOString();
  await ref.set({ processingStatus: "processing", updatedAt: now }, { merge: true });

  try {
    await finalizeParsedInboundDoc(ref, inbound, trimStoredText(cached), gmailMessageId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ref.set(
      {
        processingStatus: "error",
        processingError: message.slice(0, 500),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    throw err;
  }

  const updatedSnap = await db.collection(REVIEW_COLLECTION).doc(trimmedId).get();
  if (!updatedSnap.exists) {
    throw new Error("Import record missing after re-parse.");
  }
  const updated = updatedSnap.data() as VendorInvoiceImportDoc;
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

/**
 * Lane C C2 — apply a proposed current-import field correction (model-free).
 */
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { classifyCorrectionEvidence } from "./classifyCorrectionEvidence";
import {
  CORRECTION_AUDIT_COLLECTION,
  correctionAuditDocId,
  headerFieldAsString,
  isCorrectableFieldKey,
  type InvoiceCorrectableFieldKey,
  type ReviewProposedCorrection,
} from "./correctionAllowlist";
import {
  REVIEW_CHAT_COLLECTION,
  REVIEW_CHAT_MESSAGES_SUB,
} from "./reviewAgentTypes";
import { REVIEW_CHAT_RECENT_TURNS } from "../aiShadow/constants";
import {
  reconcileImportStateAfterCorrection,
  type ReconciledImportState,
} from "./reconcileAfterFieldCorrection";

export class ApplyCorrectionInputError extends Error {
  code:
    | "invalid-argument"
    | "not-found"
    | "failed-precondition"
    | "permission-denied";
  constructor(
    code: ApplyCorrectionInputError["code"],
    message: string,
  ) {
    super(message);
    this.name = "ApplyCorrectionInputError";
    this.code = code;
  }
}

export type ApplyCorrectionTriggerMode =
  | "apply_button"
  | "chat_direct_command"
  | "chat_confirmation";

export interface ApplyInvoiceReviewFieldCorrectionResult {
  vendorInvoiceImportId: string;
  field: InvoiceCorrectableFieldKey;
  previousValue: string;
  newValue: string;
  applied: boolean;
  alreadyApplied: boolean;
  correctionId: string;
  parsedHeader: Record<string, unknown>;
  reviewStatus: string;
  /** Authoritative current unresolved parse warnings after correction. */
  parseWarnings: string[];
  autoImportEligible: boolean;
  autoImportConfidence: number;
  autoImportReasons: string[];
  reviewRequiredReasons: string[];
  importDecisionMode: ReconciledImportState["importDecisionMode"];
  suggestedAction: string;
}

function isoNow(): string {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function reconcileFromImportDoc(
  importDoc: Record<string, unknown>,
  parsedHeader: Record<string, unknown>,
  fieldCorrectionLogOverride?: unknown,
): ReconciledImportState {
  return reconcileImportStateAfterCorrection({
    parsedHeader,
    parseWarnings: importDoc.parseWarnings,
    importStatus: importDoc.importStatus,
    confidenceScore: importDoc.confidenceScore,
    humanReviewRequired: importDoc.humanReviewRequired,
    duplicate: importDoc.duplicate,
    parsedLines: importDoc.parsedLines,
    parsedLineCount: importDoc.parsedLineCount,
    pageId: importDoc.pageId,
    parserFormatId: importDoc.parserFormatId,
    orderNotes: importDoc.orderNotes,
    fieldCorrectionLog:
      fieldCorrectionLogOverride ?? importDoc.fieldCorrectionLog,
  });
}

function resultWithReconcile(base: {
  vendorInvoiceImportId: string;
  field: InvoiceCorrectableFieldKey;
  previousValue: string;
  newValue: string;
  applied: boolean;
  alreadyApplied: boolean;
  correctionId: string;
  reviewStatus: string;
  importDoc: Record<string, unknown>;
  parsedHeader: Record<string, unknown>;
}): ApplyInvoiceReviewFieldCorrectionResult {
  const reconciled = reconcileFromImportDoc(base.importDoc, base.parsedHeader);
  return {
    vendorInvoiceImportId: base.vendorInvoiceImportId,
    field: base.field,
    previousValue: base.previousValue,
    newValue: base.newValue,
    applied: base.applied,
    alreadyApplied: base.alreadyApplied,
    correctionId: base.correctionId,
    parsedHeader: reconciled.parsedHeader,
    reviewStatus: base.reviewStatus,
    parseWarnings: reconciled.parseWarnings,
    autoImportEligible: reconciled.autoImportEligible,
    autoImportConfidence: reconciled.autoImportConfidence,
    autoImportReasons: reconciled.autoImportReasons,
    reviewRequiredReasons: reconciled.reviewRequiredReasons,
    importDecisionMode: reconciled.importDecisionMode,
    suggestedAction: reconciled.suggestedAction,
  };
}

async function loadCombinedExtractedText(
  db: Firestore,
  importDoc: Record<string, unknown>,
): Promise<string> {
  const inboundId =
    typeof importDoc.inboundEmailProcessingId === "string"
      ? importDoc.inboundEmailProcessingId.trim()
      : "";
  if (!inboundId) return "";
  const inboundSnap = await db
    .collection("inboundEmailProcessing")
    .doc(inboundId)
    .get();
  if (!inboundSnap.exists) return "";
  const inbound = inboundSnap.data() as Record<string, unknown>;
  return typeof inbound.combinedExtractedText === "string"
    ? inbound.combinedExtractedText
    : "";
}

async function loadRecentDispatcherTexts(
  db: Firestore,
  importId: string,
): Promise<string[]> {
  const snap = await db
    .collection(REVIEW_CHAT_COLLECTION)
    .doc(importId)
    .collection(REVIEW_CHAT_MESSAGES_SUB)
    .orderBy("createdAt", "desc")
    .limit(REVIEW_CHAT_RECENT_TURNS)
    .get();
  const texts: string[] = [];
  for (const doc of snap.docs) {
    const data = doc.data() as { role?: string; text?: string };
    if (data.role === "dispatcher" && typeof data.text === "string") {
      texts.push(data.text);
    }
  }
  return texts;
}

function parseProposedCorrection(
  raw: unknown,
): ReviewProposedCorrection | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!isCorrectableFieldKey(o.field)) return null;
  const proposedValue =
    typeof o.proposedValue === "string" ? o.proposedValue.trim() : "";
  if (!proposedValue) return null;
  const currentValue =
    typeof o.currentValue === "string" ? o.currentValue.trim() : "";
  const sourceType =
    o.sourceType === "document_evidence" ||
    o.sourceType === "dispatcher_assertion" ||
    o.sourceType === "agent_interpretation"
      ? o.sourceType
      : "agent_interpretation";
  return {
    field: o.field,
    currentValue,
    proposedValue,
    sourceType,
  };
}

async function markSiblingProposalsSuperseded(
  db: Firestore,
  importId: string,
  field: InvoiceCorrectableFieldKey,
  keepMessageId: string,
): Promise<void> {
  try {
    const snap = await db
      .collection(REVIEW_CHAT_COLLECTION)
      .doc(importId)
      .collection(REVIEW_CHAT_MESSAGES_SUB)
      .orderBy("createdAt", "desc")
      .limit(40)
      .get();
    const batch = db.batch();
    let ops = 0;
    for (const doc of snap.docs) {
      if (doc.id === keepMessageId) continue;
      const data = doc.data() as Record<string, unknown>;
      if (data.correctionStatus !== "proposed") continue;
      const pc = parseProposedCorrection(data.proposedCorrection);
      if (!pc || pc.field !== field) continue;
      batch.update(doc.ref, { correctionStatus: "superseded" });
      ops += 1;
    }
    if (ops > 0) await batch.commit();
  } catch (err) {
    console.warn("markSiblingProposalsSuperseded failed (non-blocking):", err);
  }
}

export async function runApplyInvoiceReviewFieldCorrectionCore(input: {
  db: Firestore;
  uid: string;
  vendorInvoiceImportId: string;
  sourceMessageId: string;
  idempotencyKey: string;
  triggerMode?: ApplyCorrectionTriggerMode;
}): Promise<ApplyInvoiceReviewFieldCorrectionResult> {
  const importId = input.vendorInvoiceImportId.trim();
  const sourceMessageId = input.sourceMessageId.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  const triggerMode = input.triggerMode ?? "apply_button";

  if (!importId || importId.length > 256) {
    throw new ApplyCorrectionInputError(
      "invalid-argument",
      "Invalid vendorInvoiceImportId.",
    );
  }
  if (!sourceMessageId || sourceMessageId.length > 200) {
    throw new ApplyCorrectionInputError(
      "invalid-argument",
      "Invalid sourceMessageId.",
    );
  }
  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw new ApplyCorrectionInputError(
      "invalid-argument",
      "Invalid idempotencyKey.",
    );
  }

  const messageRef = input.db
    .collection(REVIEW_CHAT_COLLECTION)
    .doc(importId)
    .collection(REVIEW_CHAT_MESSAGES_SUB)
    .doc(sourceMessageId);
  const messageSnap = await messageRef.get();
  if (!messageSnap.exists) {
    throw new ApplyCorrectionInputError(
      "not-found",
      "Correction proposal message not found.",
    );
  }
  const messageData = messageSnap.data() as Record<string, unknown>;
  if (messageData.role !== "agent") {
    throw new ApplyCorrectionInputError(
      "failed-precondition",
      "Correction proposal must be an agent message.",
    );
  }

  const proposed = parseProposedCorrection(messageData.proposedCorrection);
  if (!proposed) {
    throw new ApplyCorrectionInputError(
      "failed-precondition",
      "Message has no valid proposedCorrection.",
    );
  }

  const status =
    typeof messageData.correctionStatus === "string"
      ? messageData.correctionStatus
      : "proposed";

  const correctionId = correctionAuditDocId(
    importId,
    proposed.field,
    sourceMessageId,
  );
  const auditRef = input.db
    .collection(CORRECTION_AUDIT_COLLECTION)
    .doc(correctionId);

  if (status === "applied") {
    const importSnap = await input.db
      .collection("vendorInvoiceImports")
      .doc(importId)
      .get();
    const importDoc = importSnap.exists
      ? (importSnap.data() as Record<string, unknown>)
      : {};
    const parsedHeader = asRecord(importDoc.parsedHeader);
    return resultWithReconcile({
      vendorInvoiceImportId: importId,
      field: proposed.field,
      previousValue: proposed.currentValue,
      newValue: proposed.proposedValue,
      applied: false,
      alreadyApplied: true,
      correctionId,
      importDoc,
      parsedHeader,
      reviewStatus:
        typeof importDoc.reviewStatus === "string"
          ? importDoc.reviewStatus
          : "",
    });
  }

  if (status === "superseded" || status === "unresolvable") {
    throw new ApplyCorrectionInputError(
      "failed-precondition",
      "correction_no_longer_current",
    );
  }

  if (!isCorrectableFieldKey(proposed.field)) {
    throw new ApplyCorrectionInputError(
      "failed-precondition",
      "field_not_allowed",
    );
  }

  const importRef = input.db.collection("vendorInvoiceImports").doc(importId);
  const importSnap = await importRef.get();
  if (!importSnap.exists) {
    throw new ApplyCorrectionInputError("not-found", "Invoice import not found.");
  }
  const importDoc = importSnap.data() as Record<string, unknown>;
  const reviewStatus =
    typeof importDoc.reviewStatus === "string" ? importDoc.reviewStatus : "";
  if (reviewStatus !== "pending_review") {
    throw new ApplyCorrectionInputError(
      "failed-precondition",
      "import_not_pending_review",
    );
  }

  const liveCurrent = headerFieldAsString(importDoc.parsedHeader, proposed.field);
  if (liveCurrent === proposed.proposedValue) {
    // Already correct — ensure audit exists, mark message applied, reconcile UI state.
    const alreadyResult = await input.db.runTransaction(async (tx) => {
      const auditSnap = await tx.get(auditRef);
      const freshImport = await tx.get(importRef);
      const freshDoc = (freshImport.data() ?? {}) as Record<string, unknown>;
      const header = asRecord(freshDoc.parsedHeader);
      const reconciled = reconcileFromImportDoc(freshDoc, header);
      if (!auditSnap.exists) {
        tx.set(auditRef, {
          id: correctionId,
          vendorInvoiceImportId: importId,
          field: proposed.field,
          previousValue: proposed.currentValue,
          newValue: proposed.proposedValue,
          appliedByUid: input.uid,
          appliedAt: isoNow(),
          appliedAtServer: FieldValue.serverTimestamp(),
          sourceChatMessageId: sourceMessageId,
          correctionSourceType: "document_evidence",
          triggerMode,
          clientIdempotencyKey: idempotencyKey,
          alreadyMatched: true,
        });
      }
      tx.update(importRef, {
        parseWarnings: reconciled.parseWarnings,
        autoImportEligible: reconciled.autoImportEligible,
        autoImportConfidence: reconciled.autoImportConfidence,
        autoImportReasons: reconciled.autoImportReasons,
        reviewRequiredReasons: reconciled.reviewRequiredReasons,
        importDecisionMode: reconciled.importDecisionMode,
        suggestedAction: reconciled.suggestedAction,
        updatedAt: isoNow(),
      });
      tx.update(messageRef, {
        correctionStatus: "applied",
        correctionAppliedAt: FieldValue.serverTimestamp(),
        correctionAppliedBy: input.uid,
      });
      return resultWithReconcile({
        vendorInvoiceImportId: importId,
        field: proposed.field,
        previousValue: proposed.currentValue,
        newValue: proposed.proposedValue,
        applied: false,
        alreadyApplied: true,
        correctionId,
        importDoc: freshDoc,
        parsedHeader: header,
        reviewStatus:
          typeof freshDoc.reviewStatus === "string"
            ? freshDoc.reviewStatus
            : reviewStatus,
      });
    });
    return alreadyResult;
  }

  if (liveCurrent !== proposed.currentValue) {
    throw new ApplyCorrectionInputError(
      "failed-precondition",
      "expected_current_value_stale",
    );
  }

  const combinedExtractedText = await loadCombinedExtractedText(
    input.db,
    importDoc,
  );
  const recentDispatcherTexts = await loadRecentDispatcherTexts(
    input.db,
    importId,
  );
  const evidence = classifyCorrectionEvidence({
    proposedValue: proposed.proposedValue,
    combinedExtractedText,
    recentDispatcherTexts,
  });
  if (!evidence.sourceType) {
    throw new ApplyCorrectionInputError(
      "failed-precondition",
      "not_independently_verifiable",
    );
  }

  const appliedAt = isoNow();
  const result = await input.db.runTransaction(async (tx) => {
    const auditSnap = await tx.get(auditRef);
    const freshImport = await tx.get(importRef);
    const freshMessage = await tx.get(messageRef);

    if (!freshImport.exists) {
      throw new ApplyCorrectionInputError(
        "not-found",
        "Invoice import not found.",
      );
    }
    const freshDoc = freshImport.data() as Record<string, unknown>;
    const freshHeader = asRecord(freshDoc.parsedHeader);
    const freshReview =
      typeof freshDoc.reviewStatus === "string" ? freshDoc.reviewStatus : "";
    if (freshReview !== "pending_review") {
      throw new ApplyCorrectionInputError(
        "failed-precondition",
        "import_not_pending_review",
      );
    }

    if (auditSnap.exists) {
      const audit = auditSnap.data() as Record<string, unknown>;
      return resultWithReconcile({
        vendorInvoiceImportId: importId,
        field: proposed.field,
        previousValue:
          typeof audit.previousValue === "string"
            ? audit.previousValue
            : proposed.currentValue,
        newValue:
          typeof audit.newValue === "string"
            ? audit.newValue
            : proposed.proposedValue,
        applied: false,
        alreadyApplied: true,
        correctionId,
        importDoc: freshDoc,
        parsedHeader: freshHeader,
        reviewStatus: freshReview,
      });
    }

    const msgData = (freshMessage.data() ?? {}) as Record<string, unknown>;
    if (msgData.correctionStatus === "applied") {
      return resultWithReconcile({
        vendorInvoiceImportId: importId,
        field: proposed.field,
        previousValue: proposed.currentValue,
        newValue: proposed.proposedValue,
        applied: false,
        alreadyApplied: true,
        correctionId,
        importDoc: freshDoc,
        parsedHeader: freshHeader,
        reviewStatus: freshReview,
      });
    }

    const freshCurrent = headerFieldAsString(freshHeader, proposed.field);
    if (freshCurrent === proposed.proposedValue) {
      const reconciledAlready = reconcileFromImportDoc(freshDoc, freshHeader);
      tx.set(auditRef, {
        id: correctionId,
        vendorInvoiceImportId: importId,
        field: proposed.field,
        previousValue: proposed.currentValue,
        newValue: proposed.proposedValue,
        appliedByUid: input.uid,
        appliedAt,
        appliedAtServer: FieldValue.serverTimestamp(),
        sourceChatMessageId: sourceMessageId,
        correctionSourceType: evidence.sourceType,
        ...(evidence.evidenceCitationText
          ? { evidenceCitationText: evidence.evidenceCitationText }
          : {}),
        ...(typeof evidence.evidenceSpanStart === "number"
          ? { evidenceSpanStart: evidence.evidenceSpanStart }
          : {}),
        ...(typeof evidence.evidenceSpanEnd === "number"
          ? { evidenceSpanEnd: evidence.evidenceSpanEnd }
          : {}),
        triggerMode,
        clientIdempotencyKey: idempotencyKey,
        alreadyMatched: true,
      });
      tx.update(importRef, {
        parseWarnings: reconciledAlready.parseWarnings,
        autoImportEligible: reconciledAlready.autoImportEligible,
        autoImportConfidence: reconciledAlready.autoImportConfidence,
        autoImportReasons: reconciledAlready.autoImportReasons,
        reviewRequiredReasons: reconciledAlready.reviewRequiredReasons,
        importDecisionMode: reconciledAlready.importDecisionMode,
        suggestedAction: reconciledAlready.suggestedAction,
        updatedAt: appliedAt,
      });
      tx.update(messageRef, {
        correctionStatus: "applied",
        correctionAppliedAt: FieldValue.serverTimestamp(),
        correctionAppliedBy: input.uid,
      });
      return resultWithReconcile({
        vendorInvoiceImportId: importId,
        field: proposed.field,
        previousValue: proposed.currentValue,
        newValue: proposed.proposedValue,
        applied: false,
        alreadyApplied: true,
        correctionId,
        importDoc: freshDoc,
        parsedHeader: freshHeader,
        reviewStatus: freshReview,
      });
    }

    if (freshCurrent !== proposed.currentValue) {
      throw new ApplyCorrectionInputError(
        "failed-precondition",
        "expected_current_value_stale",
      );
    }

    const nextHeader: Record<string, unknown> = {
      ...freshHeader,
      [proposed.field]: proposed.proposedValue,
    };
    const priorLog = Array.isArray(freshDoc.fieldCorrectionLog)
      ? (freshDoc.fieldCorrectionLog as Array<Record<string, unknown>>)
      : [];
    const logEntry = {
      field: proposed.field,
      previousValue: proposed.currentValue,
      newValue: proposed.proposedValue,
      at: appliedAt,
      by: input.uid,
      correctionId,
    };
    const nextLog = [...priorLog, logEntry].slice(-20);
    // Pass nextLog so the correction applied in this write is visible to the
    // stale-veto gate immediately (not one cycle late).
    const reconciled = reconcileFromImportDoc(freshDoc, nextHeader, nextLog);

    const updatePayload: Record<string, unknown> = {
      [`parsedHeader.${proposed.field}`]: proposed.proposedValue,
      updatedAt: appliedAt,
      fieldCorrectionLog: nextLog,
      parseWarnings: reconciled.parseWarnings,
      autoImportEligible: reconciled.autoImportEligible,
      autoImportConfidence: reconciled.autoImportConfidence,
      autoImportReasons: reconciled.autoImportReasons,
      reviewRequiredReasons: reconciled.reviewRequiredReasons,
      importDecisionMode: reconciled.importDecisionMode,
      suggestedAction: reconciled.suggestedAction,
    };
    if (!freshDoc.originalParsedHeader) {
      updatePayload.originalParsedHeader = { ...freshHeader };
    }
    if (!Array.isArray(freshDoc.originalParseWarnings)) {
      updatePayload.originalParseWarnings = Array.isArray(freshDoc.parseWarnings)
        ? [...(freshDoc.parseWarnings as string[])]
        : [];
    }

    tx.update(importRef, updatePayload);
    tx.set(auditRef, {
      id: correctionId,
      vendorInvoiceImportId: importId,
      field: proposed.field,
      previousValue: proposed.currentValue,
      newValue: proposed.proposedValue,
      appliedByUid: input.uid,
      appliedAt,
      appliedAtServer: FieldValue.serverTimestamp(),
      sourceChatMessageId: sourceMessageId,
      correctionSourceType: evidence.sourceType,
      ...(evidence.evidenceCitationText
        ? { evidenceCitationText: evidence.evidenceCitationText }
        : {}),
      ...(typeof evidence.evidenceSpanStart === "number"
        ? { evidenceSpanStart: evidence.evidenceSpanStart }
        : {}),
      ...(typeof evidence.evidenceSpanEnd === "number"
        ? { evidenceSpanEnd: evidence.evidenceSpanEnd }
        : {}),
      triggerMode,
      clientIdempotencyKey: idempotencyKey,
    });
    tx.update(messageRef, {
      correctionStatus: "applied",
      correctionAppliedAt: FieldValue.serverTimestamp(),
      correctionAppliedBy: input.uid,
    });

    // Durable chat event — new agent message (created outside tx for simplicity
    // would race; create here with tx.set on a new doc ref).
    const appliedMsgRef = input.db
      .collection(REVIEW_CHAT_COLLECTION)
      .doc(importId)
      .collection(REVIEW_CHAT_MESSAGES_SUB)
      .doc();
    const displayField =
      proposed.field === "customerPoOrReference"
        ? "Customer PO"
        : proposed.field === "vendorOrderNumber"
          ? "Vendor order #"
          : "Invoice #";
    const prevLabel = proposed.currentValue || "blank";
    tx.set(appliedMsgRef, {
      role: "agent",
      text: `Applied. ${displayField} changed from ${prevLabel} to ${proposed.proposedValue}.`,
      createdAt: FieldValue.serverTimestamp(),
      createdByUid: "system",
      actionType: "answer",
      correctionAppliedFromMessageId: sourceMessageId,
      correctionId,
    });

    return {
      vendorInvoiceImportId: importId,
      field: proposed.field,
      previousValue: proposed.currentValue,
      newValue: proposed.proposedValue,
      applied: true,
      alreadyApplied: false,
      correctionId,
      parsedHeader: reconciled.parsedHeader,
      reviewStatus: freshReview,
      parseWarnings: reconciled.parseWarnings,
      autoImportEligible: reconciled.autoImportEligible,
      autoImportConfidence: reconciled.autoImportConfidence,
      autoImportReasons: reconciled.autoImportReasons,
      reviewRequiredReasons: reconciled.reviewRequiredReasons,
      importDecisionMode: reconciled.importDecisionMode,
      suggestedAction: reconciled.suggestedAction,
    };
  });

  void markSiblingProposalsSuperseded(
    input.db,
    importId,
    proposed.field,
    sourceMessageId,
  );

  return result;
}

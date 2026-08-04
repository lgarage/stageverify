/**
 * Invoice training Admin — configure alert email/password, Save lesson, MD editor.
 * Password hash in invoiceTrainingAdminSecrets (CF-only). Never in public appSettings.
 */
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  requireDispatcherAuth,
  requireManagerAuth,
  hasManagerRole,
  clampListLimit,
} from "./inboundEmail/dispatcherAuth";
import {
  asAdminPassword,
  asAlertEmail,
  isAdminFullyConfigured,
  AdminPasswordLockedError,
  storeAdminConfig,
  verifyAdminPassword,
  vendorKeyFromImportDoc,
} from "./invoice/aiShadow/adminConfig";
import {
  readVendorTrainingMd,
  sanitizeVendorKey,
  writeVendorTrainingMd,
} from "./invoice/aiShadow/vendorTrainingMd";
import { saveTrainingLessonCore, recordIgnoreLaneTrainingNote } from "./invoice/aiShadow/saveTrainingLessonCore";
import { classifyLessonNoteRejection } from "./invoice/aiShadow/classifyLessonNoteRejection";
import { listTrainingNoteAudit } from "./invoice/aiShadow/trainingNoteAudit";
import type { VendorInvoiceImportDoc } from "./inboundEmail/types";
import {
  CREDIT_RETURN_SKIP_REASON,
  documentIgnoreSkipFields,
  shouldApplyNowDismissCreditImport,
} from "./invoice/creditReturnSkip";
import {
  activateVendorIgnoreRuleDoc,
  archiveVendorIgnoreRuleDoc,
  disableVendorIgnoreRuleDoc,
  fingerprintFromImport,
  getVendorIgnoreRuleById,
  ignoreRuleDocId,
  isArmableFingerprint,
  isArmableVendorKey,
  listVendorIgnoreRules,
  upsertVendorIgnoreRule,
  type VendorIgnoreFingerprint,
} from "./invoice/aiShadow/vendorIgnoreRules";
import {
  armableFingerprintError,
  buildProposeEchoText,
  computeEchoToken,
  normalizeSenderDomains,
} from "./invoice/vendorIgnoreEcho";
import {
  documentTypeLabel,
  normalizeParserFormatId,
  type InvoiceDocumentType,
} from "./invoice/inferDocumentType";
import { writeIgnoreRuleAuditEvent } from "./invoice/aiShadow/ignoreRuleAudit";
import { migrateLegacyVendorIgnoreRulesCore } from "./invoice/aiShadow/migrateLegacyVendorIgnoreRules";
import { listIgnoreRuleAuditEvents } from "./invoice/aiShadow/ignoreRuleAudit";
import { bulkReopenImportsSkippedByRuleCore } from "./invoice/aiShadow/reopenIgnoreSkippedImport";

function getDb() {
  return admin.firestore();
}

async function auditRuleEvent(input: {
  ruleId: string;
  eventType: Parameters<typeof writeIgnoreRuleAuditEvent>[1]["eventType"];
  actorUid: string | "system";
  importId?: string;
  detail?: string;
}): Promise<void> {
  try {
    await writeIgnoreRuleAuditEvent(getDb(), input);
  } catch (err) {
    console.error("ignoreRuleAudit write failed:", err);
    throw err;
  }
}

async function requirePassword(data: unknown): Promise<void> {
  const password = asAdminPassword(
    (data as { password?: unknown } | null)?.password,
  );
  if (!password) {
    throw new HttpsError(
      "invalid-argument",
      `Admin password required (${8}–${128} characters).`,
    );
  }
  try {
    const ok = await verifyAdminPassword(password);
    if (!ok) {
      throw new HttpsError("permission-denied", "Incorrect Admin password.");
    }
  } catch (err) {
    if (err instanceof AdminPasswordLockedError) {
      throw new HttpsError("resource-exhausted", err.message);
    }
    throw err;
  }
}

export const getInvoiceTrainingAdminStatus = onCall(
  { region: "us-central1" },
  async (request) => {
    await requireDispatcherAuth(request);
    const status = await isAdminFullyConfigured();
    return {
      alertEmailConfigured: status.alertEmailConfigured,
      passwordConfigured: status.passwordConfigured,
      fullyConfigured:
        status.alertEmailConfigured && status.passwordConfigured,
      alertEmail: status.alertEmail,
    };
  },
);

export const configureInvoiceTrainingAdmin = onCall(
  { region: "us-central1" },
  async (request) => {
    await requireDispatcherAuth(request);
    const data = (request.data ?? {}) as {
      alertEmail?: unknown;
      password?: unknown;
    };
    const alertEmail = asAlertEmail(data.alertEmail);
    if (!alertEmail) {
      throw new HttpsError(
        "invalid-argument",
        "A valid alert email is required.",
      );
    }
    const password = asAdminPassword(data.password);
    if (!password) {
      throw new HttpsError(
        "invalid-argument",
        "Admin password must be 8–128 characters.",
      );
    }

    await storeAdminConfig({ alertEmail, password });

    return {
      success: true,
      alertEmailConfigured: true,
      passwordConfigured: true,
      fullyConfigured: true,
      alertEmail,
    };
  },
);

export const saveInvoiceTrainingLesson = onCall(
  { region: "us-central1" },
  async (request) => {
    const uid = await requireDispatcherAuth(request);
    const data = (request.data ?? {}) as {
      vendorInvoiceImportId?: unknown;
      correctionNote?: unknown;
    };
    const importId =
      typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    if (!importId || importId.length > 200) {
      throw new HttpsError(
        "invalid-argument",
        "vendorInvoiceImportId is required.",
      );
    }
    const correctionNote =
      typeof data.correctionNote === "string" ? data.correctionNote : "";
    if (!correctionNote.trim()) {
      throw new HttpsError(
        "invalid-argument",
        "Training note is required to save a lesson.",
      );
    }

    const importRef = getDb().collection("vendorInvoiceImports").doc(importId);
    const snap = await importRef.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Invoice import not found.");
    }
    const importDoc = snap.data() as VendorInvoiceImportDoc;
    const vendorKey = vendorKeyFromImportDoc(importDoc);
    const now = new Date().toISOString();
    const applyNowDismiss =
      importDoc.reviewStatus === "pending_review" &&
      shouldApplyNowDismissCreditImport(correctionNote, importDoc);
    const result = await saveTrainingLessonCore({
      uid,
      vendorKey,
      correctionNoteRaw: correctionNote,
      importId,
      atIso: now,
    });

    if (result.reason === "rate_limited") {
      throw new HttpsError(
        "resource-exhausted",
        "Training note limit reached (20 per hour). Try again later.",
      );
    }

    let importDismissed = false;
    let reviewStatus = importDoc.reviewStatus ?? "pending_review";
    if (result.trainingLessonWrote && applyNowDismiss) {
      await getDb().runTransaction(async (tx) => {
        const freshSnap = await tx.get(importRef);
        if (!freshSnap.exists) {
          throw new HttpsError("not-found", "Invoice import not found.");
        }
        const fresh = freshSnap.data() as VendorInvoiceImportDoc;
        if (fresh.reviewStatus !== "pending_review") {
          return;
        }
        tx.update(importRef, {
          reviewStatus: "rejected",
          skipReason: CREDIT_RETURN_SKIP_REASON,
          rejectedAt: now,
          rejectedBy: uid,
          trainingLessonAppendedAt: now,
          updatedAt: now,
        });
        importDismissed = true;
      });
      if (importDismissed) {
        reviewStatus = "rejected";
      }
    } else if (result.trainingLessonWrote) {
      await importRef.update({
        trainingLessonAppendedAt: now,
        updatedAt: now,
      });
    }

    return {
      vendorInvoiceImportId: importId,
      vendorKey: sanitizeVendorKey(vendorKey),
      importDismissed,
      reviewStatus,
      ...result,
    };
  },
);

export const previewTrainingLessonRedaction = onCall(
  { region: "us-central1" },
  async (request) => {
    await requireDispatcherAuth(request);
    const data = (request.data ?? {}) as { note?: unknown };
    const note = typeof data.note === "string" ? data.note : "";
    const preview = classifyLessonNoteRejection(note);
    return {
      noteRedacted: preview.noteRedacted,
      safe: preview.safe,
      ...(preview.rejectClass ? { rejectClass: preview.rejectClass } : {}),
    };
  },
);

/** Manager or dispatcher+admin password — recent training-note audit (D-59 P7). */
export const listTrainingNoteAuditCallable = onCall(
  { region: "us-central1" },
  async (request) => {
    const uid = await requireDispatcherAuth(request);
    const data = (request.data ?? {}) as {
      password?: unknown;
      limit?: unknown;
    };
    const isManager = await hasManagerRole(uid);
    if (!isManager) {
      await requirePassword(data);
    }
    const limit = clampListLimit(data.limit, 20, 100);
    const entries = await listTrainingNoteAudit(getDb(), {
      limit,
      includeRaw: true,
    });
    return { entries };
  },
);

export const getVendorTrainingPlaybook = onCall(
  { region: "us-central1" },
  async (request) => {
    await requireDispatcherAuth(request);
    await requirePassword(request.data);
    const data = (request.data ?? {}) as {
      vendorKey?: unknown;
      vendorInvoiceImportId?: unknown;
    };

    let vendorKeyRaw = "";
    if (typeof data.vendorKey === "string" && data.vendorKey.trim()) {
      vendorKeyRaw = data.vendorKey.trim();
    } else if (
      typeof data.vendorInvoiceImportId === "string" &&
      data.vendorInvoiceImportId.trim()
    ) {
      const snap = await getDb()
        .collection("vendorInvoiceImports")
        .doc(data.vendorInvoiceImportId.trim())
        .get();
      if (!snap.exists) {
        throw new HttpsError("not-found", "Invoice import not found.");
      }
      vendorKeyRaw = vendorKeyFromImportDoc(
        snap.data() as {
          detectedVendorName?: string;
          parserFormatId?: string;
        },
      );
    } else {
      throw new HttpsError(
        "invalid-argument",
        "vendorKey or vendorInvoiceImportId is required.",
      );
    }

    const vendorKey = sanitizeVendorKey(vendorKeyRaw);
    const markdown = await readVendorTrainingMd(vendorKey);
    return { vendorKey, markdown };
  },
);

export const saveVendorTrainingPlaybook = onCall(
  { region: "us-central1" },
  async (request) => {
    await requireDispatcherAuth(request);
    await requirePassword(request.data);
    const data = (request.data ?? {}) as {
      vendorKey?: unknown;
      markdown?: unknown;
    };
    const vendorKeyRaw =
      typeof data.vendorKey === "string" ? data.vendorKey.trim() : "";
    if (!vendorKeyRaw) {
      throw new HttpsError("invalid-argument", "vendorKey is required.");
    }
    const markdown = typeof data.markdown === "string" ? data.markdown : "";
    const vendorKey = sanitizeVendorKey(vendorKeyRaw);
    const result = await writeVendorTrainingMd({ vendorKey, markdown });
    if (!result.wrote) {
      throw new HttpsError(
        "invalid-argument",
        result.reason === "md_size_cap"
          ? "Playbook exceeds size limit."
          : "Playbook markdown is empty.",
      );
    }
    return { vendorKey, wrote: true };
  },
);

function parseFingerprintFromAdminData(data: {
  vendorKey?: unknown;
  parserFormatId?: unknown;
  documentType?: unknown;
  ruleId?: unknown;
}): VendorIgnoreFingerprint | null {
  if (typeof data.ruleId === "string" && data.ruleId.includes("__")) {
    const parts = data.ruleId.split("__");
    if (parts.length >= 3) {
      const documentType = parts[parts.length - 1] as InvoiceDocumentType;
      const parserFormatId = normalizeParserFormatId(parts[parts.length - 2]);
      const vendorKey = parts.slice(0, parts.length - 2).join("__");
      if (
        documentType === "sales_order_confirmation" ||
        documentType === "invoice" ||
        documentType === "credit_memo" ||
        documentType === "unknown"
      ) {
        return {
          vendorKey: sanitizeVendorKey(vendorKey),
          parserFormatId,
          documentType,
        };
      }
    }
  }
  const vendorKeyRaw =
    typeof data.vendorKey === "string" ? data.vendorKey.trim() : "";
  const documentType = data.documentType;
  if (
    !vendorKeyRaw ||
    (documentType !== "sales_order_confirmation" &&
      documentType !== "invoice" &&
      documentType !== "credit_memo" &&
      documentType !== "unknown")
  ) {
    return null;
  }
  return {
    vendorKey: sanitizeVendorKey(vendorKeyRaw),
    parserFormatId: normalizeParserFormatId(data.parserFormatId),
    documentType,
  };
}

async function loadImportForIgnoreRule(
  importId: string,
): Promise<{ ref: FirebaseFirestore.DocumentReference; doc: VendorInvoiceImportDoc }> {
  const importRef = getDb().collection("vendorInvoiceImports").doc(importId);
  const snap = await importRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Invoice import not found.");
  }
  return {
    ref: importRef,
    doc: snap.data() as VendorInvoiceImportDoc,
  };
}

async function senderDomainsForImport(
  importDoc: VendorInvoiceImportDoc,
): Promise<string[]> {
  const inboundId = importDoc.inboundEmailProcessingId?.trim();
  if (!inboundId) {
    throw new HttpsError(
      "failed-precondition",
      "Cannot propose an ignore rule — source email is not linked to this import.",
    );
  }
  const inboundSnap = await getDb()
    .collection("inboundEmailProcessing")
    .doc(inboundId)
    .get();
  if (!inboundSnap.exists) {
    throw new HttpsError(
      "failed-precondition",
      "Cannot propose an ignore rule — source email record is missing.",
    );
  }
  const senderEmail =
    typeof inboundSnap.data()?.senderEmail === "string"
      ? inboundSnap.data()!.senderEmail
      : "";
  const senderDomains = normalizeSenderDomains([senderEmail]);
  if (senderDomains.length === 0) {
    throw new HttpsError(
      "failed-precondition",
      "Cannot propose an ignore rule — sender email domain is unavailable.",
    );
  }
  return senderDomains;
}

function vendorLabelFromImport(importDoc: VendorInvoiceImportDoc): string {
  if (
    typeof importDoc.detectedVendorName === "string" &&
    importDoc.detectedVendorName.trim()
  ) {
    return importDoc.detectedVendorName.trim();
  }
  if (importDoc.parserFormatId === "johnstone") return "Johnstone";
  return importDoc.parserFormatId ?? "this vendor";
}

/**
 * Teach-chat propose: server computes fingerprint + echo + echoToken.
 * Rejects unknown type/format, invoice type, unknown-vendor (D-59 P1).
 */
export const proposeVendorIgnoreRule = onCall(
  { region: "us-central1" },
  async (request) => {
    const uid = await requireDispatcherAuth(request);
    const data = (request.data ?? {}) as {
      vendorInvoiceImportId?: unknown;
    };
    const importId =
      typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    if (!importId || importId.length > 200) {
      throw new HttpsError(
        "invalid-argument",
        "vendorInvoiceImportId is required.",
      );
    }

    const { doc: importDoc } = await loadImportForIgnoreRule(importId);
    const vendorKeyRaw = vendorKeyFromImportDoc(importDoc);
    const fingerprint = fingerprintFromImport({
      vendorKey: vendorKeyRaw,
      parserFormatId: importDoc.parserFormatId,
      importRow: importDoc,
    });

    const rejectReason = armableFingerprintError(fingerprint);
    if (rejectReason) {
      await auditRuleEvent({
        ruleId: ignoreRuleDocId(fingerprint),
        eventType: "validation_rejected",
        actorUid: uid,
        importId,
        detail: rejectReason,
      });
      throw new HttpsError("failed-precondition", rejectReason);
    }

    const senderDomains = await senderDomainsForImport(importDoc);
    const importUpdatedAt =
      typeof importDoc.updatedAt === "string" && importDoc.updatedAt.trim()
        ? importDoc.updatedAt.trim()
        : "";
    if (!importUpdatedAt) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot propose an ignore rule — import record is missing a timestamp.",
      );
    }

    const echoToken = computeEchoToken({
      importId,
      vendorKey: fingerprint.vendorKey,
      parserFormatId: fingerprint.parserFormatId,
      documentType: fingerprint.documentType,
      senderDomains,
      importUpdatedAt,
    });

    const echoText = buildProposeEchoText({
      fingerprint,
      vendorLabel: vendorLabelFromImport(importDoc),
      senderDomains,
    });

    return {
      echoText,
      echoToken,
      fingerprint,
      senderDomains,
    };
  },
);

/**
 * Teach-chat consent: dispatcher confirms "yes" after server echo → arm ignore rule in Firestore.
 * Requires valid echoToken bound to import content (D-59 P1).
 * Fingerprint is recomputed server-side from the import (not client-trusted).
 * SAFETY: only writes vendorInvoiceIgnoreRules + may reject the current import in
 * vendorInvoiceImports — never touches deliveries, items, or auto-approves.
 */
export const confirmVendorIgnoreRule = onCall(
  { region: "us-central1" },
  async (request) => {
    const uid = await requireDispatcherAuth(request);
    const data = (request.data ?? {}) as {
      vendorInvoiceImportId?: unknown;
      confirm?: unknown;
      echoToken?: unknown;
      trainingNote?: unknown;
    };
    const importId =
      typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    if (!importId || importId.length > 200) {
      throw new HttpsError(
        "invalid-argument",
        "vendorInvoiceImportId is required.",
      );
    }
    if (data.confirm !== true) {
      throw new HttpsError(
        "invalid-argument",
        "confirm must be true after the teach-chat echo.",
      );
    }
    const echoToken =
      typeof data.echoToken === "string" ? data.echoToken.trim() : "";
    if (!echoToken) {
      throw new HttpsError(
        "failed-precondition",
        "echoToken is required — propose the rule again to get a fresh echo.",
      );
    }

    const { ref: importRef, doc: importDoc } =
      await loadImportForIgnoreRule(importId);
    const vendorKeyRaw = vendorKeyFromImportDoc(importDoc);
    const fingerprint = fingerprintFromImport({
      vendorKey: vendorKeyRaw,
      parserFormatId: importDoc.parserFormatId,
      importRow: importDoc,
    });

    const rejectReason = armableFingerprintError(fingerprint);
    if (rejectReason) {
      await auditRuleEvent({
        ruleId: ignoreRuleDocId(fingerprint),
        eventType: "validation_rejected",
        actorUid: uid,
        importId,
        detail: rejectReason,
      });
      throw new HttpsError("failed-precondition", rejectReason);
    }

    const senderDomains = await senderDomainsForImport(importDoc);
    const importUpdatedAt =
      typeof importDoc.updatedAt === "string" && importDoc.updatedAt.trim()
        ? importDoc.updatedAt.trim()
        : "";
    if (!importUpdatedAt) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot confirm — import record is missing a timestamp. Propose again.",
      );
    }

    const expectedToken = computeEchoToken({
      importId,
      vendorKey: fingerprint.vendorKey,
      parserFormatId: fingerprint.parserFormatId,
      documentType: fingerprint.documentType,
      senderDomains,
      importUpdatedAt,
    });
    if (echoToken !== expectedToken) {
      throw new HttpsError(
        "failed-precondition",
        "This import changed since the echo — propose the rule again to confirm.",
      );
    }

    const existingRule = await getVendorIgnoreRuleById(
      getDb(),
      ignoreRuleDocId(fingerprint),
    );
    const wasActive = existingRule?.status === "active";
    const now = new Date().toISOString();
    let rule;
    try {
      if (wasActive) {
        // Idempotent: already active — do not downgrade to proposed.
        rule = existingRule!;
      } else {
        rule = await upsertVendorIgnoreRule(getDb(), {
          fingerprint,
          status: "proposed",
          uid,
          sourceImportId: importId,
          proposedBy: uid,
          proposedAt: now,
          senderDomains,
        });
      }
    } catch (err) {
      if (err instanceof Error && err.message === "fingerprint_not_armable") {
        throw new HttpsError(
          "failed-precondition",
          armableFingerprintError(fingerprint) ??
            "This document type cannot be used for an ignore rule.",
        );
      }
      throw err;
    }

    if (!wasActive) {
      await auditRuleEvent({
        ruleId: ignoreRuleDocId(fingerprint),
        eventType: "proposed",
        actorUid: uid,
        importId,
      });
    }

    let importDismissed = false;
    let reviewStatus = importDoc.reviewStatus ?? "pending_review";
    if (importDoc.reviewStatus === "pending_review") {
      const skip = documentIgnoreSkipFields(now);
      await getDb().runTransaction(async (tx) => {
        const freshSnap = await tx.get(importRef);
        if (!freshSnap.exists) {
          throw new HttpsError("not-found", "Invoice import not found.");
        }
        const fresh = freshSnap.data() as VendorInvoiceImportDoc;
        if (fresh.reviewStatus !== "pending_review") {
          return;
        }
        tx.update(importRef, {
          ...skip,
          rejectedBy: skip.rejectedBy,
        });
        importDismissed = true;
      });
      if (importDismissed) {
        reviewStatus = "rejected";
      }
    }

    const trainingNoteRaw =
      typeof data.trainingNote === "string" ? data.trainingNote.trim() : "";
    if (trainingNoteRaw) {
      if (trainingNoteRaw.length > 800) {
        throw new HttpsError(
          "invalid-argument",
          "Training note must be 800 characters or fewer.",
        );
      }
      const ignoreNote = await recordIgnoreLaneTrainingNote({
        uid,
        importId,
        vendorKey: rule.vendorKey,
        noteRaw: trainingNoteRaw,
      });
      if (ignoreNote.reason === "rate_limited") {
        throw new HttpsError(
          "resource-exhausted",
          "Training note limit reached (20 per hour). Try again later.",
        );
      }
    }

    return {
      vendorKey: rule.vendorKey,
      ignoreCreditReturns: rule.documentType === "credit_memo" && rule.enabled,
      importDismissed,
      reviewStatus,
      rule,
      echoSummary: `Skip future ${documentTypeLabel(rule.documentType)} for ${rule.vendorKey} (${rule.parserFormatId})`,
    };
  },
);

function ruleToCallableResponse(rule: Awaited<ReturnType<typeof upsertVendorIgnoreRule>>) {
  return {
    ...rule,
    ruleId: ignoreRuleDocId(rule),
    ignoreCreditReturns: rule.documentType === "credit_memo" && rule.status === "active",
  };
}

/** Manager activates a proposed or disabled ignore rule (D-59 P2). */
export const activateVendorIgnoreRule = onCall(
  { region: "us-central1" },
  async (request) => {
    const uid = await requireManagerAuth(request);
    const data = (request.data ?? {}) as {
      vendorKey?: unknown;
      parserFormatId?: unknown;
      documentType?: unknown;
      ruleId?: unknown;
      senderDomains?: unknown;
    };
    const fingerprint = parseFingerprintFromAdminData(data);
    if (!fingerprint || !isArmableFingerprint(fingerprint)) {
      const rejectDetail =
        fingerprint
          ? (armableFingerprintError(fingerprint) ??
              "This document type cannot be used for an ignore rule.")
          : "A valid rule fingerprint (vendorKey + documentType) or ruleId is required.";
      await auditRuleEvent({
        ruleId:
          typeof data.ruleId === "string" && data.ruleId.trim()
            ? data.ruleId.trim()
            : fingerprint
              ? ignoreRuleDocId(fingerprint)
              : "unknown",
        eventType: "validation_rejected",
        actorUid: uid,
        detail: rejectDetail,
      });
      throw new HttpsError(
        "invalid-argument",
        rejectDetail,
      );
    }
    try {
      const rule = await activateVendorIgnoreRuleDoc(getDb(), {
        fingerprint,
        uid,
        senderDomains:
          data.senderDomains !== undefined
            ? normalizeSenderDomains(data.senderDomains)
            : undefined,
      });
      await auditRuleEvent({
        ruleId: ignoreRuleDocId(fingerprint),
        eventType: "activated",
        actorUid: uid,
      });
      return { rule: ruleToCallableResponse(rule) };
    } catch (err) {
      if (err instanceof Error && err.message === "rule_not_found") {
        throw new HttpsError("not-found", "Ignore rule not found.");
      }
      if (err instanceof Error && err.message === "rule_archived") {
        throw new HttpsError(
          "failed-precondition",
          "Archived rules cannot be activated — propose a new rule instead.",
        );
      }
      if (err instanceof Error && err.message === "domains_required") {
        throw new HttpsError(
          "failed-precondition",
          "At least one sender domain is required to activate this rule.",
        );
      }
      if (err instanceof Error && err.message === "fingerprint_not_armable") {
        throw new HttpsError(
          "failed-precondition",
          armableFingerprintError(fingerprint) ??
            "This document type cannot be used for an ignore rule.",
        );
      }
      throw err;
    }
  },
);

/** Manager archives (declines) an ignore rule — status archived (D-59 P2). */
export const archiveVendorIgnoreRule = onCall(
  { region: "us-central1" },
  async (request) => {
    const uid = await requireManagerAuth(request);
    const data = (request.data ?? {}) as {
      vendorKey?: unknown;
      parserFormatId?: unknown;
      documentType?: unknown;
      ruleId?: unknown;
      reason?: unknown;
    };
    const fingerprint = parseFingerprintFromAdminData(data);
    if (!fingerprint || !isArmableVendorKey(fingerprint.vendorKey)) {
      throw new HttpsError(
        "invalid-argument",
        "A valid ruleId or vendorKey + documentType is required.",
      );
    }
    const reason =
      typeof data.reason === "string" ? data.reason.trim() : undefined;
    try {
      const rule = await archiveVendorIgnoreRuleDoc(getDb(), {
        fingerprint,
        uid,
        reason,
      });
      await auditRuleEvent({
        ruleId: ignoreRuleDocId(fingerprint),
        eventType: "archived",
        actorUid: uid,
        detail: reason,
      });
      return { rule: ruleToCallableResponse(rule), archived: true };
    } catch (err) {
      if (err instanceof Error && err.message === "rule_not_found") {
        throw new HttpsError("not-found", "Ignore rule not found.");
      }
      throw err;
    }
  },
);

/** Admin password-gated list of Firestore ignore rules. */
export const listVendorIgnoreRulesCallable = onCall(
  { region: "us-central1" },
  async (request) => {
    await requireDispatcherAuth(request);
    await requirePassword(request.data);
    const rules = await listVendorIgnoreRules(getDb());
    return {
      rules: rules.map((r) => ruleToCallableResponse(r)),
    };
  },
);

/**
 * Legacy update callable — D-59 P2: disable only via manager auth; enable rejected.
 * Admin-password toggle is read-only (permission error).
 */
export const updateVendorIgnoreRuleCallable = onCall(
  { region: "us-central1" },
  async (request) => {
    await requireDispatcherAuth(request);
    const data = (request.data ?? {}) as {
      vendorKey?: unknown;
      parserFormatId?: unknown;
      documentType?: unknown;
      ruleId?: unknown;
      enabled?: unknown;
      ignoreCreditReturns?: unknown;
      password?: unknown;
    };
    let fingerprint = parseFingerprintFromAdminData(data);
    if (
      !fingerprint &&
      typeof data.vendorKey === "string" &&
      typeof data.ignoreCreditReturns === "boolean"
    ) {
      fingerprint = {
        vendorKey: sanitizeVendorKey(data.vendorKey),
        parserFormatId: "johnstone",
        documentType: "credit_memo",
      };
    }
    if (!fingerprint || !isArmableFingerprint(fingerprint)) {
      throw new HttpsError(
        "invalid-argument",
        fingerprint
          ? (armableFingerprintError(fingerprint) ??
              "This document type cannot be used for an ignore rule.")
          : "A valid rule fingerprint (vendorKey + documentType) or ruleId is required.",
      );
    }
    const wantsEnable =
      typeof data.enabled === "boolean"
        ? data.enabled
        : typeof data.ignoreCreditReturns === "boolean"
          ? data.ignoreCreditReturns
          : null;
    if (wantsEnable === true) {
      throw new HttpsError(
        "failed-precondition",
        "Use activateVendorIgnoreRule to enable a proposed or disabled rule.",
      );
    }
    if (wantsEnable !== false) {
      throw new HttpsError(
        "invalid-argument",
        "enabled must be false to disable a rule.",
      );
    }
    // Admin-password-only callers cannot toggle (read-only after P2).
    const password = asAdminPassword(data.password);
    if (password) {
      try {
        const ok = await verifyAdminPassword(password);
        if (ok) {
          throw new HttpsError(
            "permission-denied",
            "Ignore rule toggles require manager role — use Activate or Disable in Settings.",
          );
        }
      } catch (err) {
        if (err instanceof HttpsError) throw err;
        if (err instanceof AdminPasswordLockedError) {
          throw new HttpsError("resource-exhausted", err.message);
        }
        throw err;
      }
    }
    const uid = await requireManagerAuth(request);
    try {
      const rule = await disableVendorIgnoreRuleDoc(getDb(), {
        fingerprint,
        uid,
      });
      await auditRuleEvent({
        ruleId: ignoreRuleDocId(fingerprint),
        eventType: "deactivated_manual",
        actorUid: uid,
      });
      return { rule: ruleToCallableResponse(rule) };
    } catch (err) {
      if (err instanceof Error && err.message === "rule_not_found") {
        throw new HttpsError("not-found", "Ignore rule not found.");
      }
      if (err instanceof Error && err.message === "rule_archived") {
        throw new HttpsError(
          "failed-precondition",
          "Archived rules cannot be disabled.",
        );
      }
      throw err;
    }
  },
);

/**
 * Admin password-gated delete re-routed to archive (D-59 P2 — no hard delete).
 * Managers may also use archiveVendorIgnoreRule without admin password.
 */
export const deleteVendorIgnoreRuleCallable = onCall(
  { region: "us-central1" },
  async (request) => {
    let uid = await requireDispatcherAuth(request);
    const data = (request.data ?? {}) as {
      vendorKey?: unknown;
      parserFormatId?: unknown;
      documentType?: unknown;
      ruleId?: unknown;
      password?: unknown;
    };
    const fingerprint = parseFingerprintFromAdminData(data);
    if (!fingerprint || !isArmableVendorKey(fingerprint.vendorKey)) {
      throw new HttpsError(
        "invalid-argument",
        "A valid ruleId or vendorKey + documentType is required.",
      );
    }
    const password = asAdminPassword(data.password);
    let archivedVia: "admin_password" | "manager" = "manager";
    if (password) {
      try {
        const ok = await verifyAdminPassword(password);
        if (!ok) {
          throw new HttpsError("permission-denied", "Incorrect Admin password.");
        }
      } catch (err) {
        if (err instanceof HttpsError) throw err;
        if (err instanceof AdminPasswordLockedError) {
          throw new HttpsError("resource-exhausted", err.message);
        }
        throw err;
      }
      archivedVia = "admin_password";
    } else {
      uid = await requireManagerAuth(request);
    }
    try {
      const rule = await archiveVendorIgnoreRuleDoc(getDb(), {
        fingerprint,
        uid,
        reason: archivedVia === "admin_password" ? "admin_delete" : "manual",
      });
      await auditRuleEvent({
        ruleId: ignoreRuleDocId(fingerprint),
        eventType: "archived",
        actorUid: uid,
        detail: archivedVia === "admin_password" ? "admin_delete" : "manual",
      });
      return {
        vendorKey: fingerprint.vendorKey,
        ruleId: ignoreRuleDocId(fingerprint),
        deleted: true,
        archived: true,
        rule: ruleToCallableResponse(rule),
      };
    } catch (err) {
      if (err instanceof Error && err.message === "rule_not_found") {
        throw new HttpsError("not-found", "Ignore rule not found.");
      }
      throw err;
    }
  },
);

/** Dispatcher + admin password — audit drill-in for one ignore rule (D-59 P5). */
export const listIgnoreRuleAuditEventsCallable = onCall(
  { region: "us-central1" },
  async (request) => {
    await requireDispatcherAuth(request);
    await requirePassword(request.data);
    const data = (request.data ?? {}) as {
      ruleId?: unknown;
      limit?: unknown;
    };
    const ruleId =
      typeof data.ruleId === "string" ? data.ruleId.trim() : "";
    if (!ruleId) {
      throw new HttpsError("invalid-argument", "ruleId is required.");
    }
    const limit =
      typeof data.limit === "number" && Number.isFinite(data.limit)
        ? data.limit
        : undefined;
    const events = await listIgnoreRuleAuditEvents(getDb(), { ruleId, limit });
    return { events };
  },
);

/** Manager-only idempotent legacy vendor-only → 3-part rule migration (D-59 P5). */
export const migrateLegacyVendorIgnoreRules = onCall(
  { region: "us-central1" },
  async (request) => {
    const uid = await requireManagerAuth(request);
    void request;
    const result = await migrateLegacyVendorIgnoreRulesCore(getDb(), uid);
    return result;
  },
);

/** Manager bulk-reopen imports auto-skipped by one ignore rule (D-59 P6). */
export const bulkReopenImportsSkippedByRule = onCall(
  { region: "us-central1" },
  async (request) => {
    const uid = await requireManagerAuth(request);
    const data = (request.data ?? {}) as { ruleId?: unknown };
    const ruleId =
      typeof data.ruleId === "string" ? data.ruleId.trim() : "";
    if (!ruleId) {
      throw new HttpsError("invalid-argument", "ruleId is required.");
    }
    const rule = await getVendorIgnoreRuleById(getDb(), ruleId);
    if (!rule) {
      throw new HttpsError("not-found", "Ignore rule not found.");
    }
    try {
      const result = await bulkReopenImportsSkippedByRuleCore(getDb(), {
        ruleId,
        actorUid: uid,
      });
      return result;
    } catch (err) {
      if (err instanceof Error && err.message === "rule_id_required") {
        throw new HttpsError("invalid-argument", "ruleId is required.");
      }
      throw err;
    }
  },
);

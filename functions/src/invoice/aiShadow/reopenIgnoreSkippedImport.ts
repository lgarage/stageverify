/**
 * D-59 P6 — circuit breaker on reopen of document-ignore-skipped imports.
 * Shared by approveVendorInvoiceImport reopen + bulkReopenImportsSkippedByRule.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { VendorInvoiceImportDoc } from "../../inboundEmail/types";
import {
  buildImportDecisionLogEntry,
  computeAutoImportEligibility,
  type ImportDecisionLogEntry,
} from "../computeAutoImportEligibility";
import {
  VENDOR_IGNORE_RULES_COLLECTION,
} from "./vendorIgnoreRules";
import { writeIgnoreRuleAuditEvent } from "./ignoreRuleAudit";
import { readAlertEmailFromSecrets } from "./adminConfig";
import { notifyTrainingLessonPendingAdmin } from "./notifyTrainingLessonPending";

export const CIRCUIT_BREAKER_REOPEN_THRESHOLD = 2;

const MAX_DECISION_LOG = 20;

export function qualifiesForCircuitBreakerReopen(doc: {
  rejectedBy?: string;
  matchedRuleId?: string;
}): boolean {
  return (
    doc.rejectedBy === "system:document_ignore_skip" &&
    typeof doc.matchedRuleId === "string" &&
    doc.matchedRuleId.trim().length > 0
  );
}

function eligibilityFromDoc(doc: VendorInvoiceImportDoc) {
  return computeAutoImportEligibility({
    importStatus: doc.importStatus,
    confidenceScore: doc.confidenceScore,
    humanReviewRequired: doc.humanReviewRequired,
    duplicate: doc.duplicate,
    parseWarnings: doc.parseWarnings,
    parsedHeader: doc.parsedHeader,
    parsedLines: doc.parsedLines,
    parsedLineCount: doc.parsedLineCount,
    pageId: doc.pageId,
  });
}

function appendDecisionLogUpdate(
  doc: VendorInvoiceImportDoc,
  entry: ImportDecisionLogEntry,
): VendorInvoiceImportDoc["importDecisionLog"] {
  const prior = doc.importDecisionLog ?? [];
  return [...prior, entry].slice(-MAX_DECISION_LOG);
}

export type ReopenSkippedImportResult = {
  reopened: boolean;
  skipped: boolean;
  reason?: "not_rejected" | "already_pending";
  matchedRuleId?: string;
  reopenCount?: number;
  autoDisabled?: boolean;
};

type CircuitBreakerTxResult = {
  reopenCount: number;
  autoDisabled: boolean;
  vendorKey: string;
};

async function applyCircuitBreakerOnRule(
  db: Firestore,
  ruleId: string,
  importId: string,
  actorUid: string,
): Promise<CircuitBreakerTxResult> {
  const ruleRef = db.collection(VENDOR_IGNORE_RULES_COLLECTION).doc(ruleId);
  const txResult = await db.runTransaction(async (tx) => {
    const ruleSnap = await tx.get(ruleRef);
    if (!ruleSnap.exists) {
      return { reopenCount: 0, autoDisabled: false, vendorKey: ruleId };
    }
    const raw = (ruleSnap.data() ?? {}) as Record<string, unknown>;
    const priorCount =
      typeof raw.reopenCount === "number" && Number.isFinite(raw.reopenCount)
        ? raw.reopenCount
        : 0;
    const nextCount = priorCount + 1;
    const status = raw.status;
    const shouldDisable =
      nextCount >= CIRCUIT_BREAKER_REOPEN_THRESHOLD && status === "active";
    const now = new Date().toISOString();
    const vendorKey =
      typeof raw.vendorKey === "string" && raw.vendorKey.trim()
        ? raw.vendorKey.trim()
        : ruleId;
    const patch: Record<string, unknown> = {
      reopenCount: nextCount,
      updatedAt: now,
    };
    if (shouldDisable) {
      patch.status = "disabled";
      patch.enabled = false;
      patch.disabledReason = "auto_false_positive";
      patch.disabledBy = "system";
      patch.disabledAt = now;
      patch.updatedBy = "system";
    }
    tx.set(ruleRef, patch, { merge: true });
    return { reopenCount: nextCount, autoDisabled: shouldDisable, vendorKey };
  });

  await writeIgnoreRuleAuditEvent(db, {
    ruleId,
    eventType: "match_reopened",
    actorUid,
    importId,
  });

  if (txResult.autoDisabled) {
    await writeIgnoreRuleAuditEvent(db, {
      ruleId,
      eventType: "auto_disabled_false_positive",
      actorUid: "system",
      importId,
      detail: `reopenCount reached ${txResult.reopenCount}`,
    });
    try {
      const alertEmail = await readAlertEmailFromSecrets();
      if (alertEmail) {
        await notifyTrainingLessonPendingAdmin({
          alertEmail,
          vendorKey: txResult.vendorKey,
          reason: `Ignore rule auto-disabled after ${txResult.reopenCount} re-opens (false-positive circuit breaker). Rule: ${ruleId}`,
          importId,
        });
      }
    } catch (err) {
      console.error("circuit breaker admin alert failed:", err);
    }
  }

  return txResult;
}

/**
 * Reopen one rejected import. Increments rule reopenCount only when
 * rejectedBy === system:document_ignore_skip and matchedRuleId is set.
 */
export async function reopenVendorInvoiceImportCore(
  db: Firestore,
  input: {
    importId: string;
    actorUid: string;
    now?: string;
  },
): Promise<ReopenSkippedImportResult> {
  const importId = input.importId.trim();
  const now = input.now ?? new Date().toISOString();
  const importRef = db.collection("vendorInvoiceImports").doc(importId);

  const preSnap = await importRef.get();
  if (!preSnap.exists) {
    throw new Error("import_not_found");
  }
  const pre = preSnap.data() as VendorInvoiceImportDoc;
  if (pre.reviewStatus === "pending_review") {
    return { reopened: false, skipped: true, reason: "already_pending" };
  }
  if (pre.reviewStatus !== "rejected") {
    throw new Error("not_rejected");
  }
  const matchedRuleId = qualifiesForCircuitBreakerReopen(pre)
    ? pre.matchedRuleId!.trim()
    : undefined;

  await db.runTransaction(async (tx) => {
    const freshImport = await tx.get(importRef);
    if (!freshImport.exists) {
      throw new Error("import_not_found");
    }
    const fresh = freshImport.data() as VendorInvoiceImportDoc;
    if (fresh.reviewStatus !== "rejected") {
      if (fresh.reviewStatus === "pending_review") {
        return;
      }
      throw new Error("not_rejected");
    }
    tx.update(importRef, {
      reviewStatus: "pending_review",
      rejectedAt: FieldValue.delete(),
      rejectedBy: FieldValue.delete(),
      skipReason: FieldValue.delete(),
      matchedRuleId: FieldValue.delete(),
      updatedAt: now,
      importDecisionLog: appendDecisionLogUpdate(
        fresh,
        buildImportDecisionLogEntry(
          "reopen",
          input.actorUid,
          now,
          eligibilityFromDoc(fresh),
        ),
      ),
    });
  });

  const afterSnap = await importRef.get();
  const after = afterSnap.data() as VendorInvoiceImportDoc;
  if (after.reviewStatus !== "pending_review") {
    return { reopened: false, skipped: true, reason: "already_pending" };
  }

  if (!matchedRuleId) {
    return { reopened: true, skipped: false };
  }

  const circuit = await applyCircuitBreakerOnRule(
    db,
    matchedRuleId,
    importId,
    input.actorUid,
  );

  return {
    reopened: true,
    skipped: false,
    matchedRuleId,
    reopenCount: circuit.reopenCount,
    autoDisabled: circuit.autoDisabled,
  };
}

/** Bulk reopen all rejected document-ignore skips for one rule (manager). */
export async function bulkReopenImportsSkippedByRuleCore(
  db: Firestore,
  input: { ruleId: string; actorUid: string },
): Promise<{
  ruleId: string;
  scanned: number;
  reopened: number;
  skipped: number;
  autoDisabled: boolean;
  reopenCount?: number;
}> {
  const ruleId = input.ruleId.trim();
  if (!ruleId) {
    throw new Error("rule_id_required");
  }
  const snap = await db
    .collection("vendorInvoiceImports")
    .where("matchedRuleId", "==", ruleId)
    .where("reviewStatus", "==", "rejected")
    .where("rejectedBy", "==", "system:document_ignore_skip")
    .get();

  let reopened = 0;
  let skipped = 0;
  let autoDisabled = false;
  let lastReopenCount: number | undefined;

  for (const docSnap of snap.docs) {
    const result = await reopenVendorInvoiceImportCore(db, {
      importId: docSnap.id,
      actorUid: input.actorUid,
    });
    if (result.reopened) {
      reopened++;
      if (result.autoDisabled) autoDisabled = true;
      if (result.reopenCount != null) lastReopenCount = result.reopenCount;
    } else if (result.skipped) {
      skipped++;
    }
  }

  return {
    ruleId,
    scanned: snap.size,
    reopened,
    skipped,
    autoDisabled,
    reopenCount: lastReopenCount,
  };
}

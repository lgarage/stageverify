/**
 * Idempotent migration: vendorKey-only legacy ignoreCreditReturns → 3-part fingerprint docs (D-59 P5).
 */
import type { Firestore } from "firebase-admin/firestore";
import { readAlertEmailFromSecrets } from "./adminConfig";
import { writeIgnoreRuleAuditEvent } from "./ignoreRuleAudit";
import { notifyTrainingLessonPendingAdmin } from "./notifyTrainingLessonPending";
import {
  fingerprintFromImport,
  getVendorIgnoreRuleById,
  ignoreRuleDocId,
  upsertVendorIgnoreRule,
  VENDOR_IGNORE_RULES_COLLECTION,
  type VendorIgnoreFingerprint,
} from "./vendorIgnoreRules";
import type { VendorInvoiceImportDoc } from "../../inboundEmail/types";
import { normalizeSenderDomains } from "../vendorIgnoreEcho";

export type MigrateLegacyVendorIgnoreRulesResult = {
  scanned: number;
  migrated: number;
  skipped: number;
  proposedCount: number;
  activeCount: number;
  errors: string[];
};

function isLegacyVendorOnlyDoc(
  docId: string,
  data: Record<string, unknown>,
): boolean {
  if (docId.includes("__")) return false;
  if (data.ignoreCreditReturns !== true) return false;
  if (typeof data.documentType === "string" && data.documentType !== "") {
    return false;
  }
  return true;
}

async function senderDomainsFromSourceImport(
  db: Firestore,
  sourceImportId?: string,
): Promise<string[]> {
  if (!sourceImportId?.trim()) return [];
  const importSnap = await db
    .collection("vendorInvoiceImports")
    .doc(sourceImportId.trim())
    .get();
  if (!importSnap.exists) return [];
  const importDoc = importSnap.data() as VendorInvoiceImportDoc;
  const inboundId = importDoc.inboundEmailProcessingId?.trim();
  if (!inboundId) return [];
  const inboundSnap = await db
    .collection("inboundEmailProcessing")
    .doc(inboundId)
    .get();
  if (!inboundSnap.exists) return [];
  const senderEmail =
    typeof inboundSnap.data()?.senderEmail === "string"
      ? inboundSnap.data()!.senderEmail
      : "";
  return normalizeSenderDomains([senderEmail]);
}

async function archiveLegacyDocById(
  db: Firestore,
  legacyDocId: string,
  uid: string,
  reason: string,
  detail?: string,
): Promise<void> {
  const legacyRef = db.collection(VENDOR_IGNORE_RULES_COLLECTION).doc(legacyDocId);
  const legacySnap = await legacyRef.get();
  if (!legacySnap.exists) return;
  const legacyData = legacySnap.data() as Record<string, unknown>;
  if (legacyData.status === "archived") return;
  const now = new Date().toISOString();
  await legacyRef.set(
    {
      status: "archived",
      enabled: false,
      archivedBy: uid,
      archivedAt: now,
      archivedReason: reason,
      updatedAt: now,
      updatedBy: uid,
    },
    { merge: true },
  );
  await writeIgnoreRuleAuditEvent(db, {
    ruleId: legacyDocId,
    eventType: "archived",
    actorUid: uid,
    detail: detail ?? reason,
  });
}

export async function migrateLegacyVendorIgnoreRulesCore(
  db: Firestore,
  uid: string,
): Promise<MigrateLegacyVendorIgnoreRulesResult> {
  const result: MigrateLegacyVendorIgnoreRulesResult = {
    scanned: 0,
    migrated: 0,
    skipped: 0,
    proposedCount: 0,
    activeCount: 0,
    errors: [],
  };

  const snap = await db.collection(VENDOR_IGNORE_RULES_COLLECTION).get();
  const proposedRuleIds: string[] = [];

  for (const docSnap of snap.docs) {
    const data = (docSnap.data() ?? {}) as Record<string, unknown>;
    if (!isLegacyVendorOnlyDoc(docSnap.id, data)) continue;
    result.scanned++;

    const vendorKey =
      typeof data.vendorKey === "string" && data.vendorKey.trim()
        ? data.vendorKey.trim()
        : docSnap.id;
    const parserFormatId =
      vendorKey.includes("first") || vendorKey.includes("1supply")
        ? "first_supply"
        : "johnstone";
    const fingerprint: VendorIgnoreFingerprint = {
      vendorKey,
      parserFormatId,
      documentType: "credit_memo",
    };
    const newId = ignoreRuleDocId(fingerprint);
    const existingNew = await getVendorIgnoreRuleById(db, newId);

    if (existingNew && existingNew.status !== "archived") {
      result.skipped++;
      try {
        await archiveLegacyDocById(
          db,
          docSnap.id,
          uid,
          "legacy_migration_superseded",
          `superseded by existing ${newId}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(`${docSnap.id}: ${message}`);
      }
      continue;
    }

    const sourceImportId =
      typeof data.sourceImportId === "string" ? data.sourceImportId : undefined;
    const senderDomains = await senderDomainsFromSourceImport(db, sourceImportId);
    const status = senderDomains.length > 0 ? "active" : "proposed";

    try {
      const now = new Date().toISOString();
      await upsertVendorIgnoreRule(db, {
        fingerprint,
        status,
        uid,
        sourceImportId,
        taughtAt: typeof data.taughtAt === "string" ? data.taughtAt : now,
        proposedBy: status === "proposed" ? uid : undefined,
        proposedAt: status === "proposed" ? now : undefined,
        activatedBy: status === "active" ? uid : undefined,
        activatedAt: status === "active" ? now : undefined,
        senderDomains: senderDomains.length > 0 ? senderDomains : undefined,
        clearDomainGrace: senderDomains.length > 0,
      });

      await writeIgnoreRuleAuditEvent(db, {
        ruleId: newId,
        eventType: status === "active" ? "activated" : "proposed",
        actorUid: uid,
        importId: sourceImportId,
        detail: `legacy_migration from ${docSnap.id}`,
      });

      await archiveLegacyDocById(
        db,
        docSnap.id,
        uid,
        "legacy_migration_replaced",
        `replaced by ${newId}`,
      );

      result.migrated++;
      if (status === "proposed") {
        result.proposedCount++;
        proposedRuleIds.push(newId);
      } else {
        result.activeCount++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`${docSnap.id}: ${message}`);
    }
  }

  if (proposedRuleIds.length > 0) {
    const alertEmail = await readAlertEmailFromSecrets();
    if (alertEmail) {
      await notifyTrainingLessonPendingAdmin({
        alertEmail,
        vendorKey: "legacy-migration",
        reason: `Legacy ignore-rule migration created ${proposedRuleIds.length} proposed rule(s) needing manager activation: ${proposedRuleIds.join(", ")}`,
      });
    }
  }

  return result;
}

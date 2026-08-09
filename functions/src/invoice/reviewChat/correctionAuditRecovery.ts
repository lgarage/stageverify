/**
 * Lane C C2 — recover durable fieldCorrectionLog from audit docs when the
 * import doc log was wiped (historical reparse tx.set without preservation).
 */
import type { Firestore } from "firebase-admin/firestore";
import {
  isCorrectableFieldKey,
  type InvoiceCorrectableFieldKey,
} from "./correctionAllowlist";
import type { FieldCorrectionLogEntry } from "./reconcileAfterFieldCorrection";

const AUDIT_COLLECTION = "vendorInvoiceFieldCorrections";

function asLogEntry(raw: Record<string, unknown>): FieldCorrectionLogEntry | null {
  if (!isCorrectableFieldKey(raw.field)) return null;
  const newValue = typeof raw.newValue === "string" ? raw.newValue.trim() : "";
  if (!newValue) return null;
  const previousValue =
    typeof raw.previousValue === "string" ? raw.previousValue : "";
  return {
    field: raw.field as InvoiceCorrectableFieldKey,
    previousValue,
    newValue,
    ...(typeof raw.appliedAt === "string" ? { at: raw.appliedAt } : {}),
    ...(typeof raw.appliedByUid === "string" ? { by: raw.appliedByUid } : {}),
    ...(typeof raw.id === "string"
      ? { correctionId: raw.id }
      : typeof raw.correctionId === "string"
        ? { correctionId: raw.correctionId }
        : {}),
  };
}

/**
 * Load audit corrections for one import and collapse to latest-per-field log.
 * Returns [] when none exist (caller keeps empty log).
 */
export async function recoverFieldCorrectionLogFromAudit(
  db: Firestore,
  vendorInvoiceImportId: string,
): Promise<FieldCorrectionLogEntry[]> {
  const importId = vendorInvoiceImportId.trim();
  if (!importId) return [];

  const snap = await db
    .collection(AUDIT_COLLECTION)
    .where("vendorInvoiceImportId", "==", importId)
    .get();

  if (snap.empty) return [];

  const byField = new Map<string, FieldCorrectionLogEntry>();
  const ranked: Array<{ at: string; entry: FieldCorrectionLogEntry }> = [];

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const entry = asLogEntry({ ...data, id: data.id ?? doc.id });
    if (!entry) continue;
    const at =
      typeof data.appliedAt === "string"
        ? data.appliedAt
        : typeof entry.at === "string"
          ? entry.at
          : "";
    ranked.push({ at, entry });
  }

  ranked.sort((a, b) => a.at.localeCompare(b.at));
  for (const row of ranked) {
    byField.set(row.entry.field, row.entry);
  }

  return [...byField.values()].slice(-20);
}

/**
 * Vendor invoice ignore rules — Firestore SSOT for taught document fingerprints.
 * CF Admin SDK only; clients use callables.
 */
import type { Firestore } from "firebase-admin/firestore";
import { sanitizeVendorKey } from "./vendorTrainingMd";
import {
  documentTypeLabel,
  inferDocumentType,
  normalizeParserFormatId,
  type InvoiceDocumentType,
  type InvoiceParserFormatId,
  type InferDocumentTypeInput,
} from "../inferDocumentType";

export const VENDOR_IGNORE_RULES_COLLECTION = "vendorInvoiceIgnoreRules";

export type VendorIgnoreFingerprint = {
  vendorKey: string;
  parserFormatId: InvoiceParserFormatId;
  documentType: InvoiceDocumentType;
};

export type VendorIgnoreRuleDoc = VendorIgnoreFingerprint & {
  enabled: boolean;
  taughtBy: string;
  taughtAt: string;
  updatedAt: string;
  updatedBy: string;
  label: string;
  sourceImportId?: string;
  /** Legacy v0.0.195 shape — migrated on read. */
  ignoreCreditReturns?: boolean;
};

export function isArmableVendorKey(raw: string): boolean {
  const key = sanitizeVendorKey(raw);
  return key !== "unknown-vendor" && key.length > 0;
}

/** Never-unknown + non-invoice enforcement (D-59 P1). */
export function isArmableFingerprint(fp: VendorIgnoreFingerprint): boolean {
  if (!isArmableVendorKey(fp.vendorKey)) return false;
  if (fp.parserFormatId === "unknown") return false;
  if (fp.documentType === "unknown" || fp.documentType === "invoice") {
    return false;
  }
  return (
    fp.documentType === "sales_order_confirmation" ||
    fp.documentType === "credit_memo"
  );
}

export function ignoreRuleDocId(fp: VendorIgnoreFingerprint): string {
  const vendorKey = sanitizeVendorKey(fp.vendorKey);
  const format = normalizeParserFormatId(fp.parserFormatId);
  const docType = fp.documentType || "unknown";
  return `${vendorKey}__${format}__${docType}`;
}

export function fingerprintFromImport(input: {
  vendorKey: string;
  parserFormatId?: unknown;
  importRow: InferDocumentTypeInput;
}): VendorIgnoreFingerprint {
  return {
    vendorKey: sanitizeVendorKey(input.vendorKey),
    parserFormatId: normalizeParserFormatId(input.parserFormatId),
    documentType: inferDocumentType(input.importRow),
  };
}

function normalizeRuleDoc(
  docId: string,
  data: Record<string, unknown>,
): VendorIgnoreRuleDoc | null {
  // Legacy: doc id was vendorKey only with ignoreCreditReturns boolean.
  const legacyCredit =
    data.ignoreCreditReturns === true &&
    typeof data.documentType !== "string";

  let vendorKey = sanitizeVendorKey(
    typeof data.vendorKey === "string" ? data.vendorKey : docId.split("__")[0] ?? docId,
  );
  let parserFormatId = normalizeParserFormatId(data.parserFormatId);
  let documentType: InvoiceDocumentType =
    data.documentType === "sales_order_confirmation" ||
    data.documentType === "invoice" ||
    data.documentType === "credit_memo" ||
    data.documentType === "unknown"
      ? data.documentType
      : "unknown";

  if (legacyCredit) {
    vendorKey = sanitizeVendorKey(
      typeof data.vendorKey === "string" ? data.vendorKey : docId,
    );
    parserFormatId =
      vendorKey.includes("first") || vendorKey.includes("1supply")
        ? "first_supply"
        : "johnstone";
    documentType = "credit_memo";
  }

  if (!isArmableVendorKey(vendorKey)) return null;

  const enabled =
    typeof data.enabled === "boolean"
      ? data.enabled
      : legacyCredit
        ? true
        : data.ignoreCreditReturns === true;

  const fp: VendorIgnoreFingerprint = {
    vendorKey,
    parserFormatId,
    documentType,
  };

  return {
    ...fp,
    enabled,
    taughtBy: typeof data.taughtBy === "string" ? data.taughtBy : "",
    taughtAt: typeof data.taughtAt === "string" ? data.taughtAt : "",
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : "",
    label:
      typeof data.label === "string" && data.label.trim()
        ? data.label.trim()
        : `${documentTypeLabel(documentType)} · ${parserFormatId}`,
    ...(typeof data.sourceImportId === "string" && data.sourceImportId
      ? { sourceImportId: data.sourceImportId }
      : {}),
    ...(legacyCredit ? { ignoreCreditReturns: true } : {}),
  };
}

export async function getVendorIgnoreRuleById(
  db: Firestore,
  ruleId: string,
): Promise<VendorIgnoreRuleDoc | null> {
  const snap = await db
    .collection(VENDOR_IGNORE_RULES_COLLECTION)
    .doc(ruleId)
    .get();
  if (!snap.exists) return null;
  return normalizeRuleDoc(snap.id, (snap.data() ?? {}) as Record<string, unknown>);
}

export async function vendorIgnoresFingerprint(
  db: Firestore,
  fp: VendorIgnoreFingerprint,
): Promise<boolean> {
  if (!isArmableFingerprint(fp)) return false;
  const id = ignoreRuleDocId(fp);
  const rule = await getVendorIgnoreRuleById(db, id);
  if (rule?.enabled) return true;

  // Legacy credit rule stored under vendorKey only.
  if (fp.documentType === "credit_memo") {
    const legacy = await getVendorIgnoreRuleById(
      db,
      sanitizeVendorKey(fp.vendorKey),
    );
    if (legacy?.enabled && legacy.documentType === "credit_memo") {
      return true;
    }
  }
  return false;
}

export async function upsertVendorIgnoreRule(
  db: Firestore,
  input: {
    fingerprint: VendorIgnoreFingerprint;
    enabled: boolean;
    uid: string;
    sourceImportId?: string;
    taughtAt?: string;
  },
): Promise<VendorIgnoreRuleDoc> {
  const vendorKey = sanitizeVendorKey(input.fingerprint.vendorKey);
  const fingerprint: VendorIgnoreFingerprint = {
    vendorKey,
    parserFormatId: normalizeParserFormatId(input.fingerprint.parserFormatId),
    documentType: input.fingerprint.documentType || "unknown",
  };
  if (!isArmableFingerprint(fingerprint)) {
    throw new Error("fingerprint_not_armable");
  }
  const id = ignoreRuleDocId(fingerprint);
  const existing = await getVendorIgnoreRuleById(db, id);
  const now = new Date().toISOString();
  const taughtAt = existing?.taughtAt || input.taughtAt || now;
  const taughtBy = existing?.taughtBy || input.uid;
  const doc: VendorIgnoreRuleDoc = {
    ...fingerprint,
    enabled: input.enabled,
    taughtBy,
    taughtAt,
    updatedAt: now,
    updatedBy: input.uid,
    label: `${documentTypeLabel(fingerprint.documentType)} · ${fingerprint.parserFormatId}`,
    ...(input.sourceImportId
      ? { sourceImportId: input.sourceImportId }
      : existing?.sourceImportId
        ? { sourceImportId: existing.sourceImportId }
        : {}),
  };
  await db.collection(VENDOR_IGNORE_RULES_COLLECTION).doc(id).set(doc, {
    merge: true,
  });
  return doc;
}

export async function listVendorIgnoreRules(
  db: Firestore,
): Promise<VendorIgnoreRuleDoc[]> {
  const snap = await db.collection(VENDOR_IGNORE_RULES_COLLECTION).get();
  const rows: VendorIgnoreRuleDoc[] = [];
  const seen = new Set<string>();
  for (const docSnap of snap.docs) {
    const rule = normalizeRuleDoc(
      docSnap.id,
      (docSnap.data() ?? {}) as Record<string, unknown>,
    );
    if (!rule) continue;
    const id = ignoreRuleDocId(rule);
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push(rule);
  }
  rows.sort((a, b) => {
    const vk = a.vendorKey.localeCompare(b.vendorKey);
    if (vk !== 0) return vk;
    return a.documentType.localeCompare(b.documentType);
  });
  return rows;
}

export async function deleteVendorIgnoreRule(
  db: Firestore,
  ruleIdOrVendorKey: string,
): Promise<{ deleted: boolean }> {
  const raw = ruleIdOrVendorKey.trim();
  if (!raw) return { deleted: false };

  // Prefer fingerprint doc id; also try legacy vendor-only id.
  const candidates = [raw, sanitizeVendorKey(raw)];
  let deleted = false;
  for (const id of candidates) {
    const ref = db.collection(VENDOR_IGNORE_RULES_COLLECTION).doc(id);
    const snap = await ref.get();
    if (snap.exists) {
      await ref.delete();
      deleted = true;
    }
  }
  return { deleted };
}

/** Delete by fingerprint fields. */
export async function deleteVendorIgnoreRuleByFingerprint(
  db: Firestore,
  fp: VendorIgnoreFingerprint,
): Promise<{ deleted: boolean }> {
  const id = ignoreRuleDocId(fp);
  const ref = db.collection(VENDOR_IGNORE_RULES_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    // Legacy credit doc
    if (fp.documentType === "credit_memo") {
      return deleteVendorIgnoreRule(db, fp.vendorKey);
    }
    return { deleted: false };
  }
  await ref.delete();
  return { deleted: true };
}

/**
 * Vendor invoice ignore rules — Firestore SSOT for "skip future CREDIT/returns".
 * CF Admin SDK only; clients use callables.
 */
import type { Firestore } from "firebase-admin/firestore";
import { sanitizeVendorKey } from "./vendorTrainingMd";

export const VENDOR_IGNORE_RULES_COLLECTION = "vendorInvoiceIgnoreRules";

export type VendorIgnoreRuleDoc = {
  vendorKey: string;
  ignoreCreditReturns: boolean;
  taughtBy: string;
  taughtAt: string;
  updatedAt: string;
  updatedBy: string;
  sourceImportId?: string;
};

export function isArmableVendorKey(raw: string): boolean {
  const key = sanitizeVendorKey(raw);
  return key !== "unknown-vendor" && key.length > 0;
}

export async function getVendorIgnoreRule(
  db: Firestore,
  vendorKeyRaw: string,
): Promise<VendorIgnoreRuleDoc | null> {
  const vendorKey = sanitizeVendorKey(vendorKeyRaw);
  if (!isArmableVendorKey(vendorKey)) return null;
  const snap = await db
    .collection(VENDOR_IGNORE_RULES_COLLECTION)
    .doc(vendorKey)
    .get();
  if (!snap.exists) return null;
  const data = snap.data() as VendorIgnoreRuleDoc;
  return {
    vendorKey,
    ignoreCreditReturns: data.ignoreCreditReturns === true,
    taughtBy: typeof data.taughtBy === "string" ? data.taughtBy : "",
    taughtAt: typeof data.taughtAt === "string" ? data.taughtAt : "",
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : "",
    ...(typeof data.sourceImportId === "string" && data.sourceImportId
      ? { sourceImportId: data.sourceImportId }
      : {}),
  };
}

export async function vendorIgnoresCreditReturns(
  db: Firestore,
  vendorKeyRaw: string,
): Promise<boolean> {
  const rule = await getVendorIgnoreRule(db, vendorKeyRaw);
  return rule?.ignoreCreditReturns === true;
}

export async function upsertVendorIgnoreRule(
  db: Firestore,
  input: {
    vendorKey: string;
    ignoreCreditReturns: boolean;
    uid: string;
    sourceImportId?: string;
    taughtAt?: string;
  },
): Promise<VendorIgnoreRuleDoc> {
  const vendorKey = sanitizeVendorKey(input.vendorKey);
  if (!isArmableVendorKey(vendorKey)) {
    throw new Error("unknown_vendor_not_armable");
  }
  const now = new Date().toISOString();
  const existing = await getVendorIgnoreRule(db, vendorKey);
  const taughtAt = existing?.taughtAt || input.taughtAt || now;
  const taughtBy = existing?.taughtBy || input.uid;
  const doc: VendorIgnoreRuleDoc = {
    vendorKey,
    ignoreCreditReturns: input.ignoreCreditReturns,
    taughtBy,
    taughtAt,
    updatedAt: now,
    updatedBy: input.uid,
    ...(input.sourceImportId
      ? { sourceImportId: input.sourceImportId }
      : existing?.sourceImportId
        ? { sourceImportId: existing.sourceImportId }
        : {}),
  };
  await db.collection(VENDOR_IGNORE_RULES_COLLECTION).doc(vendorKey).set(doc, {
    merge: true,
  });
  return doc;
}

export async function listVendorIgnoreRules(
  db: Firestore,
): Promise<VendorIgnoreRuleDoc[]> {
  const snap = await db.collection(VENDOR_IGNORE_RULES_COLLECTION).get();
  const rows: VendorIgnoreRuleDoc[] = [];
  for (const doc of snap.docs) {
    const data = doc.data() as VendorIgnoreRuleDoc;
    rows.push({
      vendorKey: sanitizeVendorKey(doc.id),
      ignoreCreditReturns: data.ignoreCreditReturns === true,
      taughtBy: typeof data.taughtBy === "string" ? data.taughtBy : "",
      taughtAt: typeof data.taughtAt === "string" ? data.taughtAt : "",
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
      updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : "",
      ...(typeof data.sourceImportId === "string" && data.sourceImportId
        ? { sourceImportId: data.sourceImportId }
        : {}),
    });
  }
  rows.sort((a, b) => a.vendorKey.localeCompare(b.vendorKey));
  return rows;
}

export async function deleteVendorIgnoreRule(
  db: Firestore,
  vendorKeyRaw: string,
): Promise<{ deleted: boolean }> {
  const vendorKey = sanitizeVendorKey(vendorKeyRaw);
  if (!isArmableVendorKey(vendorKey)) {
    return { deleted: false };
  }
  const ref = db.collection(VENDOR_IGNORE_RULES_COLLECTION).doc(vendorKey);
  const snap = await ref.get();
  if (!snap.exists) return { deleted: false };
  await ref.delete();
  return { deleted: true };
}

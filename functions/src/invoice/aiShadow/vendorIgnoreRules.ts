/**
 * Vendor invoice ignore rules — Firestore SSOT for taught document fingerprints.
 * CF Admin SDK only; clients use callables.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { sanitizeVendorKey } from "./vendorTrainingMd";
import {
  documentTypeLabel,
  inferDocumentType,
  normalizeParserFormatId,
  type InvoiceDocumentType,
  type InvoiceParserFormatId,
  type InferDocumentTypeInput,
} from "../inferDocumentType";
import {
  extractSenderDomain,
  normalizeSenderDomains,
} from "../vendorIgnoreEcho";

export const VENDOR_IGNORE_RULES_COLLECTION = "vendorInvoiceIgnoreRules";

export const DOMAIN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export type VendorIgnoreRuleStatus =
  | "proposed"
  | "active"
  | "disabled"
  | "archived";

export type VendorIgnoreFingerprint = {
  vendorKey: string;
  parserFormatId: InvoiceParserFormatId;
  documentType: InvoiceDocumentType;
};

export type VendorIgnoreRuleDoc = VendorIgnoreFingerprint & {
  status: VendorIgnoreRuleStatus;
  enabled: boolean;
  taughtBy: string;
  taughtAt: string;
  updatedAt: string;
  updatedBy: string;
  label: string;
  sourceImportId?: string;
  /** Legacy v0.0.195 shape — migrated on read. */
  ignoreCreditReturns?: boolean;
  proposedBy?: string;
  proposedAt?: string;
  activatedBy?: string;
  activatedAt?: string;
  disabledBy?: string;
  disabledAt?: string;
  disabledReason?: string;
  archivedBy?: string;
  archivedAt?: string;
  archivedReason?: string;
  /** Pinned sender domains (max 5) — inbound From must match when non-empty. */
  senderDomains?: string[];
  /** ISO timestamp when 7-day grace began for active rules with no domains (P3). */
  domainGraceStartedAt?: string;
  /** P5 — inbound auto-skip match stats. */
  matchCount?: number;
  lastMatchedAt?: string;
  lastMatchImportId?: string;
};

export type VendorIgnoreMatchResult = {
  matched: boolean;
  ruleId?: string;
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

export function isDomainGraceActive(
  rule: Pick<VendorIgnoreRuleDoc, "senderDomains" | "domainGraceStartedAt">,
  now: Date = new Date(),
): boolean {
  const domains = rule.senderDomains ?? [];
  if (domains.length > 0) return false;
  const started = rule.domainGraceStartedAt;
  if (!started) return true;
  const startMs = Date.parse(started);
  if (Number.isNaN(startMs)) return true;
  return now.getTime() < startMs + DOMAIN_GRACE_MS;
}

export function isDomainGraceExpired(
  rule: Pick<VendorIgnoreRuleDoc, "senderDomains" | "domainGraceStartedAt">,
  now: Date = new Date(),
): boolean {
  const domains = rule.senderDomains ?? [];
  if (domains.length > 0) return false;
  const started = rule.domainGraceStartedAt;
  if (!started) return false;
  const startMs = Date.parse(started);
  if (Number.isNaN(startMs)) return false;
  return now.getTime() >= startMs + DOMAIN_GRACE_MS;
}

function readSenderDomains(data: Record<string, unknown>): string[] {
  return normalizeSenderDomains(data.senderDomains);
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

function resolveStatusFromLegacy(
  data: Record<string, unknown>,
  legacyEnabled: boolean,
): VendorIgnoreRuleStatus {
  const raw = data.status;
  if (
    raw === "proposed" ||
    raw === "active" ||
    raw === "disabled" ||
    raw === "archived"
  ) {
    return raw;
  }
  return legacyEnabled ? "active" : "disabled";
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

  const legacyEnabled =
    typeof data.enabled === "boolean"
      ? data.enabled
      : legacyCredit
        ? true
        : data.ignoreCreditReturns === true;

  const status = resolveStatusFromLegacy(data, legacyEnabled);
  const enabled = status === "active";

  const fp: VendorIgnoreFingerprint = {
    vendorKey,
    parserFormatId,
    documentType,
  };

  return {
    ...fp,
    status,
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
    ...(typeof data.proposedBy === "string" && data.proposedBy
      ? { proposedBy: data.proposedBy }
      : {}),
    ...(typeof data.proposedAt === "string" && data.proposedAt
      ? { proposedAt: data.proposedAt }
      : {}),
    ...(typeof data.activatedBy === "string" && data.activatedBy
      ? { activatedBy: data.activatedBy }
      : {}),
    ...(typeof data.activatedAt === "string" && data.activatedAt
      ? { activatedAt: data.activatedAt }
      : {}),
    ...(typeof data.disabledBy === "string" && data.disabledBy
      ? { disabledBy: data.disabledBy }
      : {}),
    ...(typeof data.disabledAt === "string" && data.disabledAt
      ? { disabledAt: data.disabledAt }
      : {}),
    ...(typeof data.disabledReason === "string" && data.disabledReason
      ? { disabledReason: data.disabledReason }
      : {}),
    ...(typeof data.archivedBy === "string" && data.archivedBy
      ? { archivedBy: data.archivedBy }
      : {}),
    ...(typeof data.archivedAt === "string" && data.archivedAt
      ? { archivedAt: data.archivedAt }
      : {}),
    ...(typeof data.archivedReason === "string" && data.archivedReason
      ? { archivedReason: data.archivedReason }
      : {}),
    ...(readSenderDomains(data).length > 0
      ? { senderDomains: readSenderDomains(data) }
      : {}),
    ...(typeof data.domainGraceStartedAt === "string" &&
    data.domainGraceStartedAt
      ? { domainGraceStartedAt: data.domainGraceStartedAt }
      : {}),
    ...(typeof data.matchCount === "number" && Number.isFinite(data.matchCount)
      ? { matchCount: data.matchCount }
      : {}),
    ...(typeof data.lastMatchedAt === "string" && data.lastMatchedAt
      ? { lastMatchedAt: data.lastMatchedAt }
      : {}),
    ...(typeof data.lastMatchImportId === "string" && data.lastMatchImportId
      ? { lastMatchImportId: data.lastMatchImportId }
      : {}),
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

async function backfillDomainGraceIfNeeded(
  db: Firestore,
  ruleId: string,
  rule: VendorIgnoreRuleDoc,
): Promise<VendorIgnoreRuleDoc> {
  if (rule.status !== "active") return rule;
  if ((rule.senderDomains?.length ?? 0) > 0) return rule;
  if (rule.domainGraceStartedAt) return rule;
  const now = new Date().toISOString();
  try {
    await db
      .collection(VENDOR_IGNORE_RULES_COLLECTION)
      .doc(ruleId)
      .set({ domainGraceStartedAt: now }, { merge: true });
    return { ...rule, domainGraceStartedAt: now };
  } catch {
    return rule;
  }
}

async function activeRuleMatchesInbound(
  db: Firestore,
  ruleId: string,
  rule: VendorIgnoreRuleDoc,
  senderEmail?: string,
): Promise<boolean> {
  const domains = rule.senderDomains ?? [];
  if (domains.length > 0) {
    const inboundDomain = senderEmail
      ? extractSenderDomain(senderEmail)
      : null;
    if (!inboundDomain) return false;
    return domains.includes(inboundDomain);
  }

  const now = new Date();
  let graceRule = rule;
  if (!rule.domainGraceStartedAt) {
    const nowIso = now.toISOString();
    try {
      await db
        .collection(VENDOR_IGNORE_RULES_COLLECTION)
        .doc(ruleId)
        .set({ domainGraceStartedAt: nowIso }, { merge: true });
      graceRule = { ...rule, domainGraceStartedAt: nowIso };
    } catch {
      return true;
    }
  }
  return isDomainGraceActive(graceRule, now);
}

export async function vendorIgnoresFingerprint(
  db: Firestore,
  fp: VendorIgnoreFingerprint,
  senderEmail?: string,
): Promise<VendorIgnoreMatchResult> {
  if (!isArmableFingerprint(fp)) return { matched: false };
  const id = ignoreRuleDocId(fp);
  const rule = await getVendorIgnoreRuleById(db, id);
  if (rule?.status === "active") {
    const matched = await activeRuleMatchesInbound(db, id, rule, senderEmail);
    return matched ? { matched: true, ruleId: id } : { matched: false };
  }
  return { matched: false };
}

/** P5 — increment match stats on rule doc (Admin SDK only). */
export async function incrementVendorIgnoreRuleMatch(
  db: Firestore,
  ruleId: string,
  importId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .collection(VENDOR_IGNORE_RULES_COLLECTION)
    .doc(ruleId)
    .set(
      {
        matchCount: FieldValue.increment(1),
        lastMatchedAt: now,
        lastMatchImportId: importId,
        updatedAt: now,
      },
      { merge: true },
    );
}

export async function upsertVendorIgnoreRule(
  db: Firestore,
  input: {
    fingerprint: VendorIgnoreFingerprint;
    status: VendorIgnoreRuleStatus;
    uid: string;
    sourceImportId?: string;
    taughtAt?: string;
    proposedBy?: string;
    proposedAt?: string;
    activatedBy?: string;
    activatedAt?: string;
    disabledBy?: string;
    disabledAt?: string;
    disabledReason?: string;
    archivedBy?: string;
    archivedAt?: string;
    archivedReason?: string;
    senderDomains?: string[];
    clearDomainGrace?: boolean;
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
  const enabled = input.status === "active";
  const mergedDomains =
    input.senderDomains !== undefined
      ? normalizeSenderDomains(input.senderDomains)
      : existing?.senderDomains ?? [];
  const clearGrace =
    input.clearDomainGrace === true ||
    (mergedDomains.length > 0 && existing?.domainGraceStartedAt != null);
  const domainGraceStartedAt =
    mergedDomains.length > 0
      ? undefined
      : existing?.domainGraceStartedAt;
  const doc: VendorIgnoreRuleDoc = {
    ...fingerprint,
    status: input.status,
    enabled,
    taughtBy,
    taughtAt,
    updatedAt: now,
    updatedBy: input.uid,
    label: `${documentTypeLabel(fingerprint.documentType)} · ${fingerprint.parserFormatId}`,
    ...(mergedDomains.length > 0 ? { senderDomains: mergedDomains } : {}),
    ...(domainGraceStartedAt ? { domainGraceStartedAt } : {}),
    ...(input.sourceImportId
      ? { sourceImportId: input.sourceImportId }
      : existing?.sourceImportId
        ? { sourceImportId: existing.sourceImportId }
        : {}),
    ...(input.proposedBy || existing?.proposedBy
      ? { proposedBy: input.proposedBy ?? existing!.proposedBy }
      : {}),
    ...(input.proposedAt || existing?.proposedAt
      ? { proposedAt: input.proposedAt ?? existing!.proposedAt }
      : {}),
    ...(input.activatedBy || existing?.activatedBy
      ? { activatedBy: input.activatedBy ?? existing!.activatedBy }
      : {}),
    ...(input.activatedAt || existing?.activatedAt
      ? { activatedAt: input.activatedAt ?? existing!.activatedAt }
      : {}),
    ...(input.disabledBy || existing?.disabledBy
      ? { disabledBy: input.disabledBy ?? existing!.disabledBy }
      : {}),
    ...(input.disabledAt || existing?.disabledAt
      ? { disabledAt: input.disabledAt ?? existing!.disabledAt }
      : {}),
    ...(input.disabledReason || existing?.disabledReason
      ? { disabledReason: input.disabledReason ?? existing!.disabledReason }
      : {}),
    ...(input.archivedBy || existing?.archivedBy
      ? { archivedBy: input.archivedBy ?? existing!.archivedBy }
      : {}),
    ...(input.archivedAt || existing?.archivedAt
      ? { archivedAt: input.archivedAt ?? existing!.archivedAt }
      : {}),
    ...(input.archivedReason || existing?.archivedReason
      ? { archivedReason: input.archivedReason ?? existing!.archivedReason }
      : {}),
  };
  const writePayload: Record<string, unknown> = { ...doc };
  if (clearGrace) {
    writePayload.domainGraceStartedAt = FieldValue.delete();
  }
  await db.collection(VENDOR_IGNORE_RULES_COLLECTION).doc(id).set(writePayload, {
    merge: true,
  });
  if (clearGrace) {
    delete doc.domainGraceStartedAt;
  }
  return doc;
}

export async function activateVendorIgnoreRuleDoc(
  db: Firestore,
  input: {
    fingerprint: VendorIgnoreFingerprint;
    uid: string;
    senderDomains?: string[];
  },
): Promise<VendorIgnoreRuleDoc> {
  const existing = await getVendorIgnoreRuleById(
    db,
    ignoreRuleDocId(input.fingerprint),
  );
  if (!existing) {
    throw new Error("rule_not_found");
  }
  if (existing.status === "archived") {
    throw new Error("rule_archived");
  }
  if (!isArmableFingerprint(input.fingerprint)) {
    throw new Error("fingerprint_not_armable");
  }
  const mergedDomains = normalizeSenderDomains([
    ...(existing.senderDomains ?? []),
    ...(input.senderDomains ?? []),
  ]);
  if (mergedDomains.length < 1) {
    throw new Error("domains_required");
  }
  const now = new Date().toISOString();
  return upsertVendorIgnoreRule(db, {
    fingerprint: input.fingerprint,
    status: "active",
    uid: input.uid,
    activatedBy: input.uid,
    activatedAt: now,
    sourceImportId: existing.sourceImportId,
    taughtAt: existing.taughtAt,
    proposedBy: existing.proposedBy,
    proposedAt: existing.proposedAt,
    senderDomains: mergedDomains,
    clearDomainGrace: true,
  });
}

export async function disableVendorIgnoreRuleDoc(
  db: Firestore,
  input: {
    fingerprint: VendorIgnoreFingerprint;
    uid: string;
  },
): Promise<VendorIgnoreRuleDoc> {
  const existing = await getVendorIgnoreRuleById(
    db,
    ignoreRuleDocId(input.fingerprint),
  );
  if (!existing) {
    throw new Error("rule_not_found");
  }
  if (existing.status === "archived") {
    throw new Error("rule_archived");
  }
  const now = new Date().toISOString();
  return upsertVendorIgnoreRule(db, {
    fingerprint: input.fingerprint,
    status: "disabled",
    uid: input.uid,
    disabledBy: input.uid,
    disabledAt: now,
    disabledReason: "manual",
    sourceImportId: existing.sourceImportId,
    taughtAt: existing.taughtAt,
    proposedBy: existing.proposedBy,
    proposedAt: existing.proposedAt,
    activatedBy: existing.activatedBy,
    activatedAt: existing.activatedAt,
  });
}

export async function archiveVendorIgnoreRuleDoc(
  db: Firestore,
  input: {
    fingerprint: VendorIgnoreFingerprint;
    uid: string;
    reason?: string;
  },
): Promise<VendorIgnoreRuleDoc> {
  const existing = await getVendorIgnoreRuleById(
    db,
    ignoreRuleDocId(input.fingerprint),
  );
  if (!existing) {
    throw new Error("rule_not_found");
  }
  const now = new Date().toISOString();
  return upsertVendorIgnoreRule(db, {
    fingerprint: input.fingerprint,
    status: "archived",
    uid: input.uid,
    archivedBy: input.uid,
    archivedAt: now,
    archivedReason: input.reason?.trim() || "manual",
    sourceImportId: existing.sourceImportId,
    taughtAt: existing.taughtAt,
    proposedBy: existing.proposedBy,
    proposedAt: existing.proposedAt,
    activatedBy: existing.activatedBy,
    activatedAt: existing.activatedAt,
    disabledBy: existing.disabledBy,
    disabledAt: existing.disabledAt,
    disabledReason: existing.disabledReason,
  });
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
    const backfilled = await backfillDomainGraceIfNeeded(db, id, rule);
    rows.push(backfilled);
  }
  rows.sort((a, b) => {
    const statusOrder = (s: VendorIgnoreRuleStatus) => {
      if (s === "proposed") return 0;
      if (s === "active") return 1;
      if (s === "disabled") return 2;
      return 3;
    };
    const so = statusOrder(a.status) - statusOrder(b.status);
    if (so !== 0) return so;
    const vk = a.vendorKey.localeCompare(b.vendorKey);
    if (vk !== 0) return vk;
    return a.documentType.localeCompare(b.documentType);
  });
  return rows;
}

/** @deprecated Hard delete removed D-59 P5 — use archiveVendorIgnoreRuleDoc. */
export async function deleteVendorIgnoreRule(
  _db: Firestore,
  _ruleIdOrVendorKey: string,
): Promise<{ deleted: boolean }> {
  throw new Error("hard_delete_forbidden_use_archive");
}

/** @deprecated Hard delete removed D-59 P5 — use archiveVendorIgnoreRuleDoc. */
export async function deleteVendorIgnoreRuleByFingerprint(
  _db: Firestore,
  _fp: VendorIgnoreFingerprint,
): Promise<{ deleted: boolean }> {
  throw new Error("hard_delete_forbidden_use_archive");
}

/**
 * Cross-message business-invoice identity — exact resend idempotency.
 * Admin SDK / CF only. Does not rename legacy vii-{gmailMessageId}-{pageId} docs.
 */
import { createHash } from "crypto";
import {
  FieldValue,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type QuerySnapshot,
  type Transaction,
} from "firebase-admin/firestore";
import { isArmableVendorKey } from "./aiShadow/vendorIgnoreRules";
import { sanitizeVendorKey } from "./aiShadow/vendorTrainingMd";
import { vendorKeyFromImportDoc } from "./aiShadow/adminConfig";
import type { VendorInvoiceImportParsedLine } from "../inboundEmail/types";

export const BUSINESS_INVOICE_KEYS_COLLECTION = "vendorBusinessInvoiceKeys";

export type BusinessInvoiceKeyDoc = {
  vendorScope: string;
  vendorKey: string;
  normalizedInvoiceNumber: string;
  canonicalImportId: string;
  canonicalGmailMessageId: string;
  contentFingerprint: string;
  createdAt: string;
  updatedAt: string;
};

export type BusinessInvoiceIdentity = {
  vendorScope: string;
  vendorKey: string;
  normalizedInvoiceNumber: string;
  keyDocId: string;
  contentFingerprint: string;
};

export type BusinessInvoiceClaimOutcome =
  | { kind: "canonical" }
  | {
      kind: "exact_duplicate";
      canonicalImportId: string;
      canonicalGmailMessageId: string;
    }
  | {
      kind: "possible_revision";
      canonicalImportId: string;
      canonicalGmailMessageId: string;
    }
  | { kind: "same_message_multipage"; canonicalImportId: string };

export function normalizeBusinessInvoiceNumber(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Refuse weak / unknown vendor scopes (tenant-safe). */
export function resolveVendorScopeForBusinessIdentity(importDoc: {
  detectedVendorId?: string;
  detectedVendorName?: string;
  parserFormatId?: string;
}):
  | { ok: true; vendorScope: string; vendorKey: string }
  | { ok: false; reason: "unknown_vendor" } {
  const detectedId =
    typeof importDoc.detectedVendorId === "string"
      ? importDoc.detectedVendorId.trim()
      : "";
  if (detectedId) {
    const vendorKey = sanitizeVendorKey(detectedId);
    if (!isArmableVendorKey(vendorKey)) {
      return { ok: false, reason: "unknown_vendor" };
    }
    return { ok: true, vendorScope: `vendor:${detectedId}`, vendorKey };
  }

  const vendorKey = sanitizeVendorKey(vendorKeyFromImportDoc(importDoc));
  if (!isArmableVendorKey(vendorKey)) {
    return { ok: false, reason: "unknown_vendor" };
  }
  return { ok: true, vendorScope: `key:${vendorKey}`, vendorKey };
}

function sanitizeKeySegment(raw: string, max: number): string {
  return raw
    .replace(/[^a-zA-Z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

export function businessInvoiceKeyDocId(
  vendorScope: string,
  normalizedInvoiceNumber: string,
): string {
  const scope = sanitizeKeySegment(vendorScope, 120);
  const inv = sanitizeKeySegment(normalizedInvoiceNumber, 80);
  return `${scope}__${inv}`;
}

/**
 * Stable content fingerprint for exact-resend vs material-revision.
 * Uses authoritative parsed header + line fields — not gmail/message ids.
 */
export function businessInvoiceContentFingerprint(input: {
  normalizedInvoiceNumber: string;
  customerPoOrReference?: string;
  vendorOrderNumber?: string;
  fulfillmentMethod?: string;
  parsedLines: Array<
    Pick<
      VendorInvoiceImportParsedLine,
      | "vendorProductNumber"
      | "quantityOrdered"
      | "quantityShipped"
      | "quantityBackordered"
      | "lineType"
      | "excludeFromExpectedItems"
    >
  >;
}): string {
  const lineParts = input.parsedLines
    .filter((line) => !line.excludeFromExpectedItems)
    .map((line) => {
      const sku = String(line.vendorProductNumber ?? "")
        .trim()
        .toUpperCase();
      const qo = Number(line.quantityOrdered) || 0;
      const qs = Number(line.quantityShipped) || 0;
      const qb = Number(line.quantityBackordered) || 0;
      const lt = String(line.lineType ?? "").trim().toLowerCase();
      return `${sku}|${qo}|${qs}|${qb}|${lt}`;
    })
    .sort();
  const po = String(input.customerPoOrReference ?? "")
    .trim()
    .toUpperCase();
  const order = String(input.vendorOrderNumber ?? "")
    .trim()
    .toUpperCase();
  const fulfillment = String(input.fulfillmentMethod ?? "")
    .trim()
    .toLowerCase();
  const payload = [
    input.normalizedInvoiceNumber,
    `po=${po}`,
    `order=${order}`,
    `fulfillment=${fulfillment}`,
    `lines=${lineParts.length}`,
    ...lineParts,
  ].join("\n");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function tryBuildBusinessInvoiceIdentity(input: {
  detectedVendorId?: string;
  detectedVendorName?: string;
  parserFormatId?: string;
  vendorInvoiceNumber: string;
  customerPoOrReference?: string;
  vendorOrderNumber?: string;
  fulfillmentMethod?: string;
  parsedLines: VendorInvoiceImportParsedLine[];
}): BusinessInvoiceIdentity | null {
  const normalizedInvoiceNumber = normalizeBusinessInvoiceNumber(
    input.vendorInvoiceNumber,
  );
  if (!normalizedInvoiceNumber || !/\d/.test(normalizedInvoiceNumber)) {
    return null;
  }
  const scope = resolveVendorScopeForBusinessIdentity(input);
  if (!scope.ok) return null;

  const contentFingerprint = businessInvoiceContentFingerprint({
    normalizedInvoiceNumber,
    customerPoOrReference: input.customerPoOrReference,
    vendorOrderNumber: input.vendorOrderNumber,
    fulfillmentMethod: input.fulfillmentMethod,
    parsedLines: input.parsedLines,
  });
  return {
    vendorScope: scope.vendorScope,
    vendorKey: scope.vendorKey,
    normalizedInvoiceNumber,
    keyDocId: businessInvoiceKeyDocId(
      scope.vendorScope,
      normalizedInvoiceNumber,
    ),
    contentFingerprint,
  };
}

/** Candidate row for legacy (pre-key) business-invoice selection. */
export type LegacyBusinessInvoiceImportRow = {
  id: string;
  gmailMessageId?: string;
  createdAt?: string;
  linkedDeliveryOrderId?: string;
  detectedVendorId?: string;
  detectedVendorName?: string;
  parserFormatId?: string;
  parsedHeader?: Record<string, unknown>;
  parsedLines?: VendorInvoiceImportParsedLine[];
};

/** Hint when a prior import exists but vendorBusinessInvoiceKeys does not. */
export type LegacyBusinessInvoiceCanonicalHint = {
  canonicalImportId: string;
  canonicalGmailMessageId: string;
  contentFingerprint: string;
  linkedDeliveryOrderId?: string;
};

/** Legacy lookup result — saturated queries must not mint a new canonical. */
export type LegacyBusinessInvoiceLookupResult =
  | { kind: "none" }
  | { kind: "found"; hint: LegacyBusinessInvoiceCanonicalHint }
  | { kind: "saturated" };

export const BUSINESS_INVOICE_LEGACY_LOOKUP_SATURATED =
  "business_invoice_legacy_lookup_saturated";

export const LEGACY_INVOICE_QUERY_LIMIT = 25;

export function isLegacyInvoiceQuerySaturated(resultSize: number): boolean {
  return resultSize >= LEGACY_INVOICE_QUERY_LIMIT;
}

function createdAtMs(raw: string | undefined): number {
  const ms = Date.parse(String(raw ?? ""));
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

/**
 * Pure selection: same vendorScope+invoice identity, exclude current review.
 * Prefer earliest among those with linkedDeliveryOrderId; else earliest createdAt.
 */
export function selectLegacyBusinessInvoiceCanonical(
  rows: LegacyBusinessInvoiceImportRow[],
  identity: BusinessInvoiceIdentity,
  excludeReviewId: string,
): LegacyBusinessInvoiceCanonicalHint | null {
  const exclude = excludeReviewId.trim();
  const matched: Array<{
    row: LegacyBusinessInvoiceImportRow;
    candidateIdentity: BusinessInvoiceIdentity;
  }> = [];

  for (const row of rows) {
    const id = String(row.id ?? "").trim();
    if (!id || (exclude && id === exclude)) continue;
    const header = row.parsedHeader ?? {};
    const candidateIdentity = tryBuildBusinessInvoiceIdentity({
      detectedVendorId: row.detectedVendorId,
      detectedVendorName: row.detectedVendorName,
      parserFormatId: row.parserFormatId,
      vendorInvoiceNumber: String(header.vendorInvoiceNumber ?? ""),
      customerPoOrReference: String(header.customerPoOrReference ?? ""),
      vendorOrderNumber: String(header.vendorOrderNumber ?? ""),
      fulfillmentMethod: String(header.fulfillmentMethod ?? ""),
      parsedLines: row.parsedLines ?? [],
    });
    if (!candidateIdentity) continue;
    if (candidateIdentity.keyDocId !== identity.keyDocId) continue;
    matched.push({ row, candidateIdentity });
  }

  if (matched.length === 0) return null;

  matched.sort((a, b) => {
    const aLinked = String(a.row.linkedDeliveryOrderId ?? "").trim() ? 0 : 1;
    const bLinked = String(b.row.linkedDeliveryOrderId ?? "").trim() ? 0 : 1;
    if (aLinked !== bLinked) return aLinked - bLinked;
    return createdAtMs(a.row.createdAt) - createdAtMs(b.row.createdAt);
  });

  const winner = matched[0];
  const linked = String(winner.row.linkedDeliveryOrderId ?? "").trim();
  return {
    canonicalImportId: String(winner.row.id).trim(),
    canonicalGmailMessageId: String(winner.row.gmailMessageId ?? "").trim(),
    contentFingerprint: winner.candidateIdentity.contentFingerprint,
    ...(linked ? { linkedDeliveryOrderId: linked } : {}),
  };
}

function invoiceNumberQueryVariants(vendorInvoiceNumberRaw: string): string[] {
  const raw = vendorInvoiceNumberRaw.trim();
  const normalized = normalizeBusinessInvoiceNumber(raw);
  const variants = new Set<string>();
  if (raw) variants.add(raw);
  if (normalized) variants.add(normalized);
  return [...variants];
}

function rowFromImportSnapData(
  id: string,
  data: DocumentData | undefined,
): LegacyBusinessInvoiceImportRow | null {
  if (!data || typeof data !== "object") return null;
  const linked =
    typeof data.linkedDeliveryOrderId === "string"
      ? data.linkedDeliveryOrderId.trim()
      : "";
  return {
    id,
    gmailMessageId:
      typeof data.gmailMessageId === "string" ? data.gmailMessageId : undefined,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : undefined,
    ...(linked ? { linkedDeliveryOrderId: linked } : {}),
    detectedVendorId:
      typeof data.detectedVendorId === "string"
        ? data.detectedVendorId
        : undefined,
    detectedVendorName:
      typeof data.detectedVendorName === "string"
        ? data.detectedVendorName
        : undefined,
    parserFormatId:
      typeof data.parserFormatId === "string" ? data.parserFormatId : undefined,
    parsedHeader:
      data.parsedHeader && typeof data.parsedHeader === "object"
        ? (data.parsedHeader as Record<string, unknown>)
        : undefined,
    parsedLines: Array.isArray(data.parsedLines)
      ? (data.parsedLines as VendorInvoiceImportParsedLine[])
      : undefined,
  };
}

type QueryGetter = {
  get(query: Query): Promise<QuerySnapshot>;
};

/** Plain Firestore adapter so approve path shares the same loader as tx. */
function firestoreQueryGetter(db: Firestore): QueryGetter {
  return {
    get(query: Query): Promise<QuerySnapshot> {
      return query.get();
    },
  };
}

async function loadLegacyImportRowsByInvoiceNumber(
  getter: QueryGetter,
  db: Firestore,
  vendorInvoiceNumberRaw: string,
): Promise<{ rows: LegacyBusinessInvoiceImportRow[]; saturated: boolean }> {
  const variants = invoiceNumberQueryVariants(vendorInvoiceNumberRaw);
  const byId = new Map<string, LegacyBusinessInvoiceImportRow>();
  let saturated = false;
  for (const variant of variants) {
    const q = db
      .collection("vendorInvoiceImports")
      .where("parsedHeader.vendorInvoiceNumber", "==", variant)
      .limit(LEGACY_INVOICE_QUERY_LIMIT);
    const snap = await getter.get(q);
    if (isLegacyInvoiceQuerySaturated(snap.size)) {
      saturated = true;
    }
    for (const docSnap of snap.docs) {
      const row = rowFromImportSnapData(docSnap.id, docSnap.data());
      if (row) byId.set(row.id, row);
    }
  }
  return { rows: [...byId.values()], saturated };
}

function lookupResultFromRows(
  rows: LegacyBusinessInvoiceImportRow[],
  saturated: boolean,
  identity: BusinessInvoiceIdentity,
  excludeReviewId: string,
): LegacyBusinessInvoiceLookupResult {
  // Any full page is an incomplete sample — never mint self-canonical from it.
  if (saturated) {
    return { kind: "saturated" };
  }
  const hint = selectLegacyBusinessInvoiceCanonical(
    rows,
    identity,
    excludeReviewId,
  );
  return hint ? { kind: "found", hint } : { kind: "none" };
}

/**
 * Transactional legacy lookup (all reads before claim writes).
 * App-side vendor isolation via keyDocId match after invoice-number query.
 */
export async function findLegacyBusinessInvoiceCanonical(
  tx: Transaction,
  db: Firestore,
  input: {
    identity: BusinessInvoiceIdentity;
    vendorInvoiceNumberRaw: string;
    excludeReviewId: string;
  },
): Promise<LegacyBusinessInvoiceLookupResult> {
  const { rows, saturated } = await loadLegacyImportRowsByInvoiceNumber(
    tx,
    db,
    input.vendorInvoiceNumberRaw,
  );
  return lookupResultFromRows(
    rows,
    saturated,
    input.identity,
    input.excludeReviewId,
  );
}

/** Non-transactional legacy lookup for approve redirect. */
export async function findLegacyBusinessInvoiceCanonicalOutsideTx(
  db: Firestore,
  input: {
    identity: BusinessInvoiceIdentity;
    vendorInvoiceNumberRaw: string;
    excludeReviewId: string;
  },
): Promise<LegacyBusinessInvoiceLookupResult> {
  const { rows, saturated } = await loadLegacyImportRowsByInvoiceNumber(
    firestoreQueryGetter(db),
    db,
    input.vendorInvoiceNumberRaw,
  );
  return lookupResultFromRows(
    rows,
    saturated,
    input.identity,
    input.excludeReviewId,
  );
}

/** Pass keySnap from tx.get already performed (all reads before writes). */
export function claimOrLinkBusinessInvoiceWithSnap(
  tx: Transaction,
  db: Firestore,
  keySnap: DocumentSnapshot,
  input: {
    identity: BusinessInvoiceIdentity;
    reviewId: string;
    gmailMessageId: string;
    inboundEmailProcessingId: string;
    now: string;
    /** When key missing: prior import to claim as canonical (legacy pre-key resend). */
    legacyCanonicalHint?: LegacyBusinessInvoiceCanonicalHint | null;
  },
): BusinessInvoiceClaimOutcome {
  const keyRef = keySnap.ref;

  if (!keySnap.exists) {
    const hint = input.legacyCanonicalHint;
    if (
      hint &&
      hint.canonicalImportId &&
      hint.canonicalImportId !== input.reviewId
    ) {
      const doc: BusinessInvoiceKeyDoc = {
        vendorScope: input.identity.vendorScope,
        vendorKey: input.identity.vendorKey,
        normalizedInvoiceNumber: input.identity.normalizedInvoiceNumber,
        canonicalImportId: hint.canonicalImportId,
        canonicalGmailMessageId: hint.canonicalGmailMessageId,
        contentFingerprint: hint.contentFingerprint,
        createdAt: input.now,
        updatedAt: input.now,
      };
      tx.create(keyRef, doc);

      const canonicalRef = db
        .collection("vendorInvoiceImports")
        .doc(hint.canonicalImportId);
      tx.set(
        canonicalRef,
        {
          linkedGmailMessageIds: FieldValue.arrayUnion(input.gmailMessageId),
          linkedInboundEmailProcessingIds: FieldValue.arrayUnion(
            input.inboundEmailProcessingId,
          ),
          updatedAt: input.now,
        },
        { merge: true },
      );

      const exact =
        hint.contentFingerprint.length > 0 &&
        hint.contentFingerprint === input.identity.contentFingerprint;
      if (exact) {
        return {
          kind: "exact_duplicate",
          canonicalImportId: hint.canonicalImportId,
          canonicalGmailMessageId: hint.canonicalGmailMessageId,
        };
      }
      return {
        kind: "possible_revision",
        canonicalImportId: hint.canonicalImportId,
        canonicalGmailMessageId: hint.canonicalGmailMessageId,
      };
    }

    const doc: BusinessInvoiceKeyDoc = {
      vendorScope: input.identity.vendorScope,
      vendorKey: input.identity.vendorKey,
      normalizedInvoiceNumber: input.identity.normalizedInvoiceNumber,
      canonicalImportId: input.reviewId,
      canonicalGmailMessageId: input.gmailMessageId,
      contentFingerprint: input.identity.contentFingerprint,
      createdAt: input.now,
      updatedAt: input.now,
    };
    tx.create(keyRef, doc);
    return { kind: "canonical" };
  }

  const existing = keySnap.data() as BusinessInvoiceKeyDoc;
  const canonicalImportId = String(existing.canonicalImportId ?? "").trim();
  const canonicalGmailMessageId = String(
    existing.canonicalGmailMessageId ?? "",
  ).trim();
  if (!canonicalImportId) {
    // Corrupt key — reclaim for this import.
    tx.set(
      keyRef,
      {
        vendorScope: input.identity.vendorScope,
        vendorKey: input.identity.vendorKey,
        normalizedInvoiceNumber: input.identity.normalizedInvoiceNumber,
        canonicalImportId: input.reviewId,
        canonicalGmailMessageId: input.gmailMessageId,
        contentFingerprint: input.identity.contentFingerprint,
        updatedAt: input.now,
        createdAt: existing.createdAt ?? input.now,
      } satisfies BusinessInvoiceKeyDoc,
      { merge: true },
    );
    return { kind: "canonical" };
  }

  if (canonicalImportId === input.reviewId) {
    tx.set(
      keyRef,
      {
        contentFingerprint: input.identity.contentFingerprint,
        updatedAt: input.now,
      },
      { merge: true },
    );
    return { kind: "canonical" };
  }

  // Same Gmail message, different page — multi-page invoice, not a resend.
  if (
    canonicalGmailMessageId &&
    canonicalGmailMessageId === input.gmailMessageId
  ) {
    return { kind: "same_message_multipage", canonicalImportId };
  }

  const priorFp = String(existing.contentFingerprint ?? "");
  const exact =
    priorFp.length > 0 && priorFp === input.identity.contentFingerprint;

  const canonicalRef = db
    .collection("vendorInvoiceImports")
    .doc(canonicalImportId);
  tx.set(
    canonicalRef,
    {
      linkedGmailMessageIds: FieldValue.arrayUnion(input.gmailMessageId),
      linkedInboundEmailProcessingIds: FieldValue.arrayUnion(
        input.inboundEmailProcessingId,
      ),
      updatedAt: input.now,
    },
    { merge: true },
  );

  if (exact) {
    return {
      kind: "exact_duplicate",
      canonicalImportId,
      canonicalGmailMessageId,
    };
  }
  return {
    kind: "possible_revision",
    canonicalImportId,
    canonicalGmailMessageId,
  };
}

/** Read key snap inside a transaction (must precede writes). */
export async function getBusinessInvoiceKeySnap(
  tx: Transaction,
  db: Firestore,
  keyDocId: string,
): Promise<DocumentSnapshot> {
  return tx.get(db.collection(BUSINESS_INVOICE_KEYS_COLLECTION).doc(keyDocId));
}

/**
 * Approve-time redirect: if another import already owns this business invoice's
 * delivery, reuse that delivery instead of create_shell.
 */
export async function resolveApproveBusinessInvoiceRedirect(
  db: Firestore,
  importId: string,
  importDoc: {
    detectedVendorId?: string;
    detectedVendorName?: string;
    parserFormatId?: string;
    parsedHeader?: Record<string, unknown>;
    parsedLines?: VendorInvoiceImportParsedLine[];
    canonicalImportId?: string;
    skipReason?: string;
  },
): Promise<{
  canonicalImportId: string;
  linkedDeliveryOrderId?: string;
} | null> {
  const header = importDoc.parsedHeader ?? {};
  const vendorInvoiceNumber = String(header.vendorInvoiceNumber ?? "");
  const identity = tryBuildBusinessInvoiceIdentity({
    detectedVendorId: importDoc.detectedVendorId,
    detectedVendorName: importDoc.detectedVendorName,
    parserFormatId: importDoc.parserFormatId,
    vendorInvoiceNumber,
    customerPoOrReference: String(header.customerPoOrReference ?? ""),
    vendorOrderNumber: String(header.vendorOrderNumber ?? ""),
    fulfillmentMethod: String(header.fulfillmentMethod ?? ""),
    parsedLines: importDoc.parsedLines ?? [],
  });
  if (!identity) return null;

  const keySnap = await db
    .collection(BUSINESS_INVOICE_KEYS_COLLECTION)
    .doc(identity.keyDocId)
    .get();
  if (!keySnap.exists) {
    const legacyLookup = await findLegacyBusinessInvoiceCanonicalOutsideTx(db, {
      identity,
      vendorInvoiceNumberRaw: vendorInvoiceNumber,
      excludeReviewId: importId,
    });
    if (legacyLookup.kind === "saturated") {
      throw new Error(BUSINESS_INVOICE_LEGACY_LOOKUP_SATURATED);
    }
    if (legacyLookup.kind === "found") {
      const legacy = legacyLookup.hint;
      if (legacy.canonicalImportId !== importId) {
        return {
          canonicalImportId: legacy.canonicalImportId,
          ...(legacy.linkedDeliveryOrderId
            ? { linkedDeliveryOrderId: legacy.linkedDeliveryOrderId }
            : {}),
        };
      }
    }
    const typedCanonical = importDoc.canonicalImportId?.trim() ?? "";
    if (!typedCanonical || typedCanonical === importId) return null;
    const canonSnap = await db
      .collection("vendorInvoiceImports")
      .doc(typedCanonical)
      .get();
    if (!canonSnap.exists) return { canonicalImportId: typedCanonical };
    const linked =
      typeof canonSnap.data()?.linkedDeliveryOrderId === "string"
        ? String(canonSnap.data()?.linkedDeliveryOrderId).trim()
        : "";
    return {
      canonicalImportId: typedCanonical,
      ...(linked ? { linkedDeliveryOrderId: linked } : {}),
    };
  }

  const key = keySnap.data() as BusinessInvoiceKeyDoc;
  const canonicalImportId = String(key.canonicalImportId ?? "").trim();
  if (!canonicalImportId || canonicalImportId === importId) return null;

  const canonSnap = await db
    .collection("vendorInvoiceImports")
    .doc(canonicalImportId)
    .get();
  const linked =
    canonSnap.exists &&
    typeof canonSnap.data()?.linkedDeliveryOrderId === "string"
      ? String(canonSnap.data()?.linkedDeliveryOrderId).trim()
      : "";
  return {
    canonicalImportId,
    ...(linked ? { linkedDeliveryOrderId: linked } : {}),
  };
}

/** Ownership for approve when delivery is stamped by the canonical sibling import. */
export function isDeliveryOwnedForBusinessInvoiceApprove(
  delivery: {
    createdFromInvoiceImport?: boolean;
    vendorInvoiceImportId?: string;
  } | null | undefined,
  importId: string,
  canonicalImportId?: string,
): boolean {
  if (!delivery) return false;
  const owner =
    typeof delivery.vendorInvoiceImportId === "string"
      ? delivery.vendorInvoiceImportId.trim()
      : "";
  if (!owner) return true;
  if (owner === importId) return true;
  const canonical = canonicalImportId?.trim() ?? "";
  return Boolean(canonical) && owner === canonical;
}

/**
 * Cross-message business-invoice identity — exact resend idempotency.
 * Admin SDK / CF only. Does not rename legacy vii-{gmailMessageId}-{pageId} docs.
 */
import { createHash } from "crypto";
import {
  FieldValue,
  type DocumentSnapshot,
  type Firestore,
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
  },
): BusinessInvoiceClaimOutcome {
  const keyRef = keySnap.ref;

  if (!keySnap.exists) {
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

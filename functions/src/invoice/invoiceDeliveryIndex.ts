/**
 * Business-invoice → delivery index (vendor scope + normalized invoice # → deliveryOrderId).
 * Johnstone: invoice number is authoritative. Other vendors: disambiguate with sales order #.
 */
import type { DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import type { VendorInvoiceImportDoc } from "../inboundEmail/types";
import {
  BUSINESS_INVOICE_KEYS_COLLECTION,
  type BusinessInvoiceIdentity,
  type BusinessInvoiceKeyDoc,
  businessInvoiceKeyDocId,
  getBusinessInvoiceKeySnap,
  normalizeBusinessInvoiceNumber,
  tryBuildBusinessInvoiceIdentity,
  deliveryOrderIdFromKeyDoc,
} from "./businessInvoiceIdentity";

/** How approve/create_shell keys deliveries in vendorBusinessInvoiceKeys. */
export type VendorDeliveryIndexMode =
  | "invoice_only"
  | "invoice_and_sales_order"
  | "off";

const PARSER_DELIVERY_INDEX_MODE: Record<string, VendorDeliveryIndexMode> = {
  johnstone: "invoice_only",
  first_supply: "invoice_and_sales_order",
};

export function deliveryIndexModeForParser(
  parserFormatId?: string,
): VendorDeliveryIndexMode {
  if (!parserFormatId) return "off";
  return PARSER_DELIVERY_INDEX_MODE[parserFormatId] ?? "off";
}

export function deliveryIndexActiveForParser(parserFormatId?: string): boolean {
  return deliveryIndexModeForParser(parserFormatId) !== "off";
}

export function invoiceNumberIsBossForParser(parserFormatId?: string): boolean {
  return deliveryIndexModeForParser(parserFormatId) === "invoice_only";
}

/**
 * Non-Johnstone indexed vendors keep separate deliveries when the sales order differs.
 * Johnstone ignores S/O (invoice number is the boss). Blank S/O does not split.
 */
export function salesOrdersDisagreeForSeparateDeliveries(
  parserFormatId: string | undefined,
  importVendorOrderNumber: string | undefined,
  deliveryVendorOrderNumber: string | undefined,
): boolean {
  if (invoiceNumberIsBossForParser(parserFormatId)) return false;
  if (!deliveryIndexActiveForParser(parserFormatId)) return false;
  const want = normalizeBusinessInvoiceNumber(importVendorOrderNumber ?? "");
  const have = normalizeBusinessInvoiceNumber(deliveryVendorOrderNumber ?? "");
  if (!want || !have) return false;
  return want !== have;
}

function sanitizeKeySegment(raw: string, max: number): string {
  return raw
    .replace(/[^a-zA-Z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

/** Firestore doc id for delivery index — extends business-invoice key with S/O when required. */
export function businessInvoiceDeliveryIndexKeyDocId(
  identity: BusinessInvoiceIdentity,
  parserFormatId: string | undefined,
  vendorOrderNumberRaw: string,
): string {
  const mode = deliveryIndexModeForParser(parserFormatId);
  if (mode === "off") {
    return identity.keyDocId;
  }
  if (mode === "invoice_only") {
    return identity.keyDocId;
  }
  const order = normalizeBusinessInvoiceNumber(vendorOrderNumberRaw);
  if (!order) {
    return identity.keyDocId;
  }
  return `${identity.keyDocId}__so-${sanitizeKeySegment(order, 80)}`;
}

export type BusinessInvoiceIndexContext = {
  identity: BusinessInvoiceIdentity;
  indexKeyDocId: string;
};

export function tryBuildBusinessInvoiceIndexContext(
  importDoc: Pick<
    VendorInvoiceImportDoc,
    | "detectedVendorId"
    | "detectedVendorName"
    | "parserFormatId"
    | "parsedHeader"
    | "parsedLines"
  >,
): BusinessInvoiceIndexContext | null {
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
  if (!deliveryIndexActiveForParser(importDoc.parserFormatId)) {
    return null;
  }
  const indexKeyDocId = businessInvoiceDeliveryIndexKeyDocId(
    identity,
    importDoc.parserFormatId,
    String(header.vendorOrderNumber ?? ""),
  );
  return { identity, indexKeyDocId };
}

export async function getBusinessInvoiceDeliveryIndexSnap(
  tx: Transaction,
  db: Firestore,
  indexKeyDocId: string,
): Promise<DocumentSnapshot> {
  return tx.get(db.collection(BUSINESS_INVOICE_KEYS_COLLECTION).doc(indexKeyDocId));
}

export async function readIndexedDeliveryOrderId(
  db: Firestore,
  indexKeyDocId: string,
): Promise<string | undefined> {
  const snap = await db
    .collection(BUSINESS_INVOICE_KEYS_COLLECTION)
    .doc(indexKeyDocId)
    .get();
  if (!snap.exists) return undefined;
  const id = deliveryOrderIdFromKeyDoc(snap.data() as BusinessInvoiceKeyDoc);
  return id || undefined;
}

/**
 * Inside approve/create_shell transaction: prefer indexed delivery over a new shell id.
 */
export function resolveDeliveryTargetFromIndexSnap(
  indexSnap: DocumentSnapshot,
  provisionalShellDeliveryId: string,
): { targetDeliveryOrderId: string; indexedHit: boolean } {
  if (!indexSnap.exists) {
    return {
      targetDeliveryOrderId: provisionalShellDeliveryId,
      indexedHit: false,
    };
  }
  const indexed = deliveryOrderIdFromKeyDoc(
    indexSnap.data() as BusinessInvoiceKeyDoc,
  );
  if (!indexed) {
    return {
      targetDeliveryOrderId: provisionalShellDeliveryId,
      indexedHit: false,
    };
  }
  return { targetDeliveryOrderId: indexed, indexedHit: true };
}

/**
 * After first shell write: stamp deliveryOrderId on the index doc (create-if-absent field).
 * Key doc may already exist from intake claim — merge only.
 */
export function stampDeliveryOrderIdOnBusinessInvoiceKeyInTx(
  tx: Transaction,
  indexSnap: DocumentSnapshot,
  input: {
    identity: BusinessInvoiceIdentity;
    indexKeyDocId: string;
    deliveryOrderId: string;
    canonicalImportId: string;
    canonicalGmailMessageId: string;
    contentFingerprint: string;
    now: string;
  },
): void {
  const deliveryOrderId = input.deliveryOrderId.trim();
  if (!deliveryOrderId) return;

  const keyRef = indexSnap.ref;
  if (!indexSnap.exists) {
    const doc: BusinessInvoiceKeyDoc = {
      vendorScope: input.identity.vendorScope,
      vendorKey: input.identity.vendorKey,
      normalizedInvoiceNumber: input.identity.normalizedInvoiceNumber,
      canonicalImportId: input.canonicalImportId,
      canonicalGmailMessageId: input.canonicalGmailMessageId,
      contentFingerprint: input.contentFingerprint,
      deliveryOrderId,
      createdAt: input.now,
      updatedAt: input.now,
    };
    tx.create(keyRef, doc);
    return;
  }

  const existing = indexSnap.data() as BusinessInvoiceKeyDoc;
  const prior = deliveryOrderIdFromKeyDoc(existing);
  if (prior && prior !== deliveryOrderId) {
    // Index winner already set — never overwrite with a second delivery.
    return;
  }
  tx.set(
    keyRef,
    {
      deliveryOrderId,
      updatedAt: input.now,
      ...(prior
        ? {}
        : {
            vendorScope: input.identity.vendorScope,
            vendorKey: input.identity.vendorKey,
            normalizedInvoiceNumber: input.identity.normalizedInvoiceNumber,
          }),
    },
    { merge: true },
  );
}

/** Re-export for approve transaction reads aligned with intake key id. */
export { getBusinessInvoiceKeySnap, businessInvoiceKeyDocId };

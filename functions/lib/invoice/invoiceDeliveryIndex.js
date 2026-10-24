"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.businessInvoiceKeyDocId = exports.getBusinessInvoiceKeySnap = void 0;
exports.invoiceNumberIsBossForParser = invoiceNumberIsBossForParser;
exports.businessInvoiceDeliveryIndexKeyDocId = businessInvoiceDeliveryIndexKeyDocId;
exports.tryBuildBusinessInvoiceIndexContext = tryBuildBusinessInvoiceIndexContext;
exports.getBusinessInvoiceDeliveryIndexSnap = getBusinessInvoiceDeliveryIndexSnap;
exports.readIndexedDeliveryOrderId = readIndexedDeliveryOrderId;
exports.resolveDeliveryTargetFromIndexSnap = resolveDeliveryTargetFromIndexSnap;
exports.stampDeliveryOrderIdOnBusinessInvoiceKeyInTx = stampDeliveryOrderIdOnBusinessInvoiceKeyInTx;
const businessInvoiceIdentity_1 = require("./businessInvoiceIdentity");
Object.defineProperty(exports, "businessInvoiceKeyDocId", { enumerable: true, get: function () { return businessInvoiceIdentity_1.businessInvoiceKeyDocId; } });
Object.defineProperty(exports, "getBusinessInvoiceKeySnap", { enumerable: true, get: function () { return businessInvoiceIdentity_1.getBusinessInvoiceKeySnap; } });
function invoiceNumberIsBossForParser(parserFormatId) {
    return parserFormatId === "johnstone";
}
function sanitizeKeySegment(raw, max) {
    return raw
        .replace(/[^a-zA-Z0-9:_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, max);
}
/** Firestore doc id for delivery index — extends business-invoice key with S/O when required. */
function businessInvoiceDeliveryIndexKeyDocId(identity, parserFormatId, vendorOrderNumberRaw) {
    if (invoiceNumberIsBossForParser(parserFormatId)) {
        return identity.keyDocId;
    }
    const order = (0, businessInvoiceIdentity_1.normalizeBusinessInvoiceNumber)(vendorOrderNumberRaw);
    if (!order) {
        return identity.keyDocId;
    }
    return `${identity.keyDocId}__so-${sanitizeKeySegment(order, 80)}`;
}
function tryBuildBusinessInvoiceIndexContext(importDoc) {
    const header = importDoc.parsedHeader ?? {};
    const vendorInvoiceNumber = String(header.vendorInvoiceNumber ?? "");
    const identity = (0, businessInvoiceIdentity_1.tryBuildBusinessInvoiceIdentity)({
        detectedVendorId: importDoc.detectedVendorId,
        detectedVendorName: importDoc.detectedVendorName,
        parserFormatId: importDoc.parserFormatId,
        vendorInvoiceNumber,
        customerPoOrReference: String(header.customerPoOrReference ?? ""),
        vendorOrderNumber: String(header.vendorOrderNumber ?? ""),
        fulfillmentMethod: String(header.fulfillmentMethod ?? ""),
        parsedLines: importDoc.parsedLines ?? [],
    });
    if (!identity)
        return null;
    const indexKeyDocId = businessInvoiceDeliveryIndexKeyDocId(identity, importDoc.parserFormatId, String(header.vendorOrderNumber ?? ""));
    return { identity, indexKeyDocId };
}
async function getBusinessInvoiceDeliveryIndexSnap(tx, db, indexKeyDocId) {
    return tx.get(db.collection(businessInvoiceIdentity_1.BUSINESS_INVOICE_KEYS_COLLECTION).doc(indexKeyDocId));
}
async function readIndexedDeliveryOrderId(db, indexKeyDocId) {
    const snap = await db
        .collection(businessInvoiceIdentity_1.BUSINESS_INVOICE_KEYS_COLLECTION)
        .doc(indexKeyDocId)
        .get();
    if (!snap.exists)
        return undefined;
    const id = (0, businessInvoiceIdentity_1.deliveryOrderIdFromKeyDoc)(snap.data());
    return id || undefined;
}
/**
 * Inside approve/create_shell transaction: prefer indexed delivery over a new shell id.
 */
function resolveDeliveryTargetFromIndexSnap(indexSnap, provisionalShellDeliveryId) {
    if (!indexSnap.exists) {
        return {
            targetDeliveryOrderId: provisionalShellDeliveryId,
            indexedHit: false,
        };
    }
    const indexed = (0, businessInvoiceIdentity_1.deliveryOrderIdFromKeyDoc)(indexSnap.data());
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
function stampDeliveryOrderIdOnBusinessInvoiceKeyInTx(tx, indexSnap, input) {
    const deliveryOrderId = input.deliveryOrderId.trim();
    if (!deliveryOrderId)
        return;
    const keyRef = indexSnap.ref;
    if (!indexSnap.exists) {
        const doc = {
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
    const existing = indexSnap.data();
    const prior = (0, businessInvoiceIdentity_1.deliveryOrderIdFromKeyDoc)(existing);
    if (prior && prior !== deliveryOrderId) {
        // Index winner already set — never overwrite with a second delivery.
        return;
    }
    tx.set(keyRef, {
        deliveryOrderId,
        updatedAt: input.now,
        ...(prior
            ? {}
            : {
                vendorScope: input.identity.vendorScope,
                vendorKey: input.identity.vendorKey,
                normalizedInvoiceNumber: input.identity.normalizedInvoiceNumber,
            }),
    }, { merge: true });
}
//# sourceMappingURL=invoiceDeliveryIndex.js.map
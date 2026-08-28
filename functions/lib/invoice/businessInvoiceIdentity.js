"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUSINESS_INVOICE_KEYS_COLLECTION = void 0;
exports.normalizeBusinessInvoiceNumber = normalizeBusinessInvoiceNumber;
exports.resolveVendorScopeForBusinessIdentity = resolveVendorScopeForBusinessIdentity;
exports.businessInvoiceKeyDocId = businessInvoiceKeyDocId;
exports.businessInvoiceContentFingerprint = businessInvoiceContentFingerprint;
exports.tryBuildBusinessInvoiceIdentity = tryBuildBusinessInvoiceIdentity;
exports.claimOrLinkBusinessInvoiceWithSnap = claimOrLinkBusinessInvoiceWithSnap;
exports.getBusinessInvoiceKeySnap = getBusinessInvoiceKeySnap;
exports.resolveApproveBusinessInvoiceRedirect = resolveApproveBusinessInvoiceRedirect;
exports.isDeliveryOwnedForBusinessInvoiceApprove = isDeliveryOwnedForBusinessInvoiceApprove;
/**
 * Cross-message business-invoice identity — exact resend idempotency.
 * Admin SDK / CF only. Does not rename legacy vii-{gmailMessageId}-{pageId} docs.
 */
const crypto_1 = require("crypto");
const firestore_1 = require("firebase-admin/firestore");
const vendorIgnoreRules_1 = require("./aiShadow/vendorIgnoreRules");
const vendorTrainingMd_1 = require("./aiShadow/vendorTrainingMd");
const adminConfig_1 = require("./aiShadow/adminConfig");
exports.BUSINESS_INVOICE_KEYS_COLLECTION = "vendorBusinessInvoiceKeys";
function normalizeBusinessInvoiceNumber(raw) {
    return raw.trim().toUpperCase();
}
/** Refuse weak / unknown vendor scopes (tenant-safe). */
function resolveVendorScopeForBusinessIdentity(importDoc) {
    const detectedId = typeof importDoc.detectedVendorId === "string"
        ? importDoc.detectedVendorId.trim()
        : "";
    if (detectedId) {
        const vendorKey = (0, vendorTrainingMd_1.sanitizeVendorKey)(detectedId);
        if (!(0, vendorIgnoreRules_1.isArmableVendorKey)(vendorKey)) {
            return { ok: false, reason: "unknown_vendor" };
        }
        return { ok: true, vendorScope: `vendor:${detectedId}`, vendorKey };
    }
    const vendorKey = (0, vendorTrainingMd_1.sanitizeVendorKey)((0, adminConfig_1.vendorKeyFromImportDoc)(importDoc));
    if (!(0, vendorIgnoreRules_1.isArmableVendorKey)(vendorKey)) {
        return { ok: false, reason: "unknown_vendor" };
    }
    return { ok: true, vendorScope: `key:${vendorKey}`, vendorKey };
}
function sanitizeKeySegment(raw, max) {
    return raw
        .replace(/[^a-zA-Z0-9:_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, max);
}
function businessInvoiceKeyDocId(vendorScope, normalizedInvoiceNumber) {
    const scope = sanitizeKeySegment(vendorScope, 120);
    const inv = sanitizeKeySegment(normalizedInvoiceNumber, 80);
    return `${scope}__${inv}`;
}
/**
 * Stable content fingerprint for exact-resend vs material-revision.
 * Uses authoritative parsed header + line fields — not gmail/message ids.
 */
function businessInvoiceContentFingerprint(input) {
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
    return (0, crypto_1.createHash)("sha256").update(payload, "utf8").digest("hex");
}
function tryBuildBusinessInvoiceIdentity(input) {
    const normalizedInvoiceNumber = normalizeBusinessInvoiceNumber(input.vendorInvoiceNumber);
    if (!normalizedInvoiceNumber || !/\d/.test(normalizedInvoiceNumber)) {
        return null;
    }
    const scope = resolveVendorScopeForBusinessIdentity(input);
    if (!scope.ok)
        return null;
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
        keyDocId: businessInvoiceKeyDocId(scope.vendorScope, normalizedInvoiceNumber),
        contentFingerprint,
    };
}
/** Pass keySnap from tx.get already performed (all reads before writes). */
function claimOrLinkBusinessInvoiceWithSnap(tx, db, keySnap, input) {
    const keyRef = keySnap.ref;
    if (!keySnap.exists) {
        const doc = {
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
    const existing = keySnap.data();
    const canonicalImportId = String(existing.canonicalImportId ?? "").trim();
    const canonicalGmailMessageId = String(existing.canonicalGmailMessageId ?? "").trim();
    if (!canonicalImportId) {
        // Corrupt key — reclaim for this import.
        tx.set(keyRef, {
            vendorScope: input.identity.vendorScope,
            vendorKey: input.identity.vendorKey,
            normalizedInvoiceNumber: input.identity.normalizedInvoiceNumber,
            canonicalImportId: input.reviewId,
            canonicalGmailMessageId: input.gmailMessageId,
            contentFingerprint: input.identity.contentFingerprint,
            updatedAt: input.now,
            createdAt: existing.createdAt ?? input.now,
        }, { merge: true });
        return { kind: "canonical" };
    }
    if (canonicalImportId === input.reviewId) {
        tx.set(keyRef, {
            contentFingerprint: input.identity.contentFingerprint,
            updatedAt: input.now,
        }, { merge: true });
        return { kind: "canonical" };
    }
    // Same Gmail message, different page — multi-page invoice, not a resend.
    if (canonicalGmailMessageId &&
        canonicalGmailMessageId === input.gmailMessageId) {
        return { kind: "same_message_multipage", canonicalImportId };
    }
    const priorFp = String(existing.contentFingerprint ?? "");
    const exact = priorFp.length > 0 && priorFp === input.identity.contentFingerprint;
    const canonicalRef = db
        .collection("vendorInvoiceImports")
        .doc(canonicalImportId);
    tx.set(canonicalRef, {
        linkedGmailMessageIds: firestore_1.FieldValue.arrayUnion(input.gmailMessageId),
        linkedInboundEmailProcessingIds: firestore_1.FieldValue.arrayUnion(input.inboundEmailProcessingId),
        updatedAt: input.now,
    }, { merge: true });
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
async function getBusinessInvoiceKeySnap(tx, db, keyDocId) {
    return tx.get(db.collection(exports.BUSINESS_INVOICE_KEYS_COLLECTION).doc(keyDocId));
}
/**
 * Approve-time redirect: if another import already owns this business invoice's
 * delivery, reuse that delivery instead of create_shell.
 */
async function resolveApproveBusinessInvoiceRedirect(db, importId, importDoc) {
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
    if (!identity)
        return null;
    const keySnap = await db
        .collection(exports.BUSINESS_INVOICE_KEYS_COLLECTION)
        .doc(identity.keyDocId)
        .get();
    if (!keySnap.exists) {
        const typedCanonical = importDoc.canonicalImportId?.trim() ?? "";
        if (!typedCanonical || typedCanonical === importId)
            return null;
        const canonSnap = await db
            .collection("vendorInvoiceImports")
            .doc(typedCanonical)
            .get();
        if (!canonSnap.exists)
            return { canonicalImportId: typedCanonical };
        const linked = typeof canonSnap.data()?.linkedDeliveryOrderId === "string"
            ? String(canonSnap.data()?.linkedDeliveryOrderId).trim()
            : "";
        return {
            canonicalImportId: typedCanonical,
            ...(linked ? { linkedDeliveryOrderId: linked } : {}),
        };
    }
    const key = keySnap.data();
    const canonicalImportId = String(key.canonicalImportId ?? "").trim();
    if (!canonicalImportId || canonicalImportId === importId)
        return null;
    const canonSnap = await db
        .collection("vendorInvoiceImports")
        .doc(canonicalImportId)
        .get();
    const linked = canonSnap.exists &&
        typeof canonSnap.data()?.linkedDeliveryOrderId === "string"
        ? String(canonSnap.data()?.linkedDeliveryOrderId).trim()
        : "";
    return {
        canonicalImportId,
        ...(linked ? { linkedDeliveryOrderId: linked } : {}),
    };
}
/** Ownership for approve when delivery is stamped by the canonical sibling import. */
function isDeliveryOwnedForBusinessInvoiceApprove(delivery, importId, canonicalImportId) {
    if (!delivery)
        return false;
    const owner = typeof delivery.vendorInvoiceImportId === "string"
        ? delivery.vendorInvoiceImportId.trim()
        : "";
    if (!owner)
        return true;
    if (owner === importId)
        return true;
    const canonical = canonicalImportId?.trim() ?? "";
    return Boolean(canonical) && owner === canonical;
}
//# sourceMappingURL=businessInvoiceIdentity.js.map
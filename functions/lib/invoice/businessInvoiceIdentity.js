"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEGACY_INVOICE_QUERY_LIMIT = exports.BUSINESS_INVOICE_LEGACY_LOOKUP_SATURATED = exports.BUSINESS_INVOICE_KEYS_COLLECTION = void 0;
exports.normalizeBusinessInvoiceNumber = normalizeBusinessInvoiceNumber;
exports.resolveVendorScopeForBusinessIdentity = resolveVendorScopeForBusinessIdentity;
exports.businessInvoiceKeyDocId = businessInvoiceKeyDocId;
exports.businessInvoiceContentFingerprint = businessInvoiceContentFingerprint;
exports.tryBuildBusinessInvoiceIdentity = tryBuildBusinessInvoiceIdentity;
exports.isLegacyInvoiceQuerySaturated = isLegacyInvoiceQuerySaturated;
exports.selectLegacyBusinessInvoiceCanonical = selectLegacyBusinessInvoiceCanonical;
exports.findLegacyBusinessInvoiceCanonical = findLegacyBusinessInvoiceCanonical;
exports.findLegacyBusinessInvoiceCanonicalOutsideTx = findLegacyBusinessInvoiceCanonicalOutsideTx;
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
exports.BUSINESS_INVOICE_LEGACY_LOOKUP_SATURATED = "business_invoice_legacy_lookup_saturated";
exports.LEGACY_INVOICE_QUERY_LIMIT = 25;
function isLegacyInvoiceQuerySaturated(resultSize) {
    return resultSize >= exports.LEGACY_INVOICE_QUERY_LIMIT;
}
function createdAtMs(raw) {
    const ms = Date.parse(String(raw ?? ""));
    return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}
/**
 * Pure selection: same vendorScope+invoice identity, exclude current review.
 * Prefer earliest among those with linkedDeliveryOrderId; else earliest createdAt.
 */
function selectLegacyBusinessInvoiceCanonical(rows, identity, excludeReviewId) {
    const exclude = excludeReviewId.trim();
    const matched = [];
    for (const row of rows) {
        const id = String(row.id ?? "").trim();
        if (!id || (exclude && id === exclude))
            continue;
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
        if (!candidateIdentity)
            continue;
        if (candidateIdentity.keyDocId !== identity.keyDocId)
            continue;
        matched.push({ row, candidateIdentity });
    }
    if (matched.length === 0)
        return null;
    matched.sort((a, b) => {
        const aLinked = String(a.row.linkedDeliveryOrderId ?? "").trim() ? 0 : 1;
        const bLinked = String(b.row.linkedDeliveryOrderId ?? "").trim() ? 0 : 1;
        if (aLinked !== bLinked)
            return aLinked - bLinked;
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
function invoiceNumberQueryVariants(vendorInvoiceNumberRaw) {
    const raw = vendorInvoiceNumberRaw.trim();
    const normalized = normalizeBusinessInvoiceNumber(raw);
    const variants = new Set();
    if (raw)
        variants.add(raw);
    if (normalized)
        variants.add(normalized);
    return [...variants];
}
function rowFromImportSnapData(id, data) {
    if (!data || typeof data !== "object")
        return null;
    const linked = typeof data.linkedDeliveryOrderId === "string"
        ? data.linkedDeliveryOrderId.trim()
        : "";
    return {
        id,
        gmailMessageId: typeof data.gmailMessageId === "string" ? data.gmailMessageId : undefined,
        createdAt: typeof data.createdAt === "string" ? data.createdAt : undefined,
        ...(linked ? { linkedDeliveryOrderId: linked } : {}),
        detectedVendorId: typeof data.detectedVendorId === "string"
            ? data.detectedVendorId
            : undefined,
        detectedVendorName: typeof data.detectedVendorName === "string"
            ? data.detectedVendorName
            : undefined,
        parserFormatId: typeof data.parserFormatId === "string" ? data.parserFormatId : undefined,
        parsedHeader: data.parsedHeader && typeof data.parsedHeader === "object"
            ? data.parsedHeader
            : undefined,
        parsedLines: Array.isArray(data.parsedLines)
            ? data.parsedLines
            : undefined,
    };
}
/** Plain Firestore adapter so approve path shares the same loader as tx. */
function firestoreQueryGetter(db) {
    return {
        get(query) {
            return query.get();
        },
    };
}
async function loadLegacyImportRowsByInvoiceNumber(getter, db, vendorInvoiceNumberRaw) {
    const variants = invoiceNumberQueryVariants(vendorInvoiceNumberRaw);
    const byId = new Map();
    let saturated = false;
    for (const variant of variants) {
        const q = db
            .collection("vendorInvoiceImports")
            .where("parsedHeader.vendorInvoiceNumber", "==", variant)
            .limit(exports.LEGACY_INVOICE_QUERY_LIMIT);
        const snap = await getter.get(q);
        if (isLegacyInvoiceQuerySaturated(snap.size)) {
            saturated = true;
        }
        for (const docSnap of snap.docs) {
            const row = rowFromImportSnapData(docSnap.id, docSnap.data());
            if (row)
                byId.set(row.id, row);
        }
    }
    return { rows: [...byId.values()], saturated };
}
function lookupResultFromRows(rows, saturated, identity, excludeReviewId) {
    // Any full page is an incomplete sample — never mint self-canonical from it.
    if (saturated) {
        return { kind: "saturated" };
    }
    const hint = selectLegacyBusinessInvoiceCanonical(rows, identity, excludeReviewId);
    return hint ? { kind: "found", hint } : { kind: "none" };
}
/**
 * Transactional legacy lookup (all reads before claim writes).
 * App-side vendor isolation via keyDocId match after invoice-number query.
 */
async function findLegacyBusinessInvoiceCanonical(tx, db, input) {
    const { rows, saturated } = await loadLegacyImportRowsByInvoiceNumber(tx, db, input.vendorInvoiceNumberRaw);
    return lookupResultFromRows(rows, saturated, input.identity, input.excludeReviewId);
}
/** Non-transactional legacy lookup for approve redirect. */
async function findLegacyBusinessInvoiceCanonicalOutsideTx(db, input) {
    const { rows, saturated } = await loadLegacyImportRowsByInvoiceNumber(firestoreQueryGetter(db), db, input.vendorInvoiceNumberRaw);
    return lookupResultFromRows(rows, saturated, input.identity, input.excludeReviewId);
}
/** Pass keySnap from tx.get already performed (all reads before writes). */
function claimOrLinkBusinessInvoiceWithSnap(tx, db, keySnap, input) {
    const keyRef = keySnap.ref;
    if (!keySnap.exists) {
        const hint = input.legacyCanonicalHint;
        if (hint &&
            hint.canonicalImportId &&
            hint.canonicalImportId !== input.reviewId) {
            const doc = {
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
            tx.set(canonicalRef, {
                linkedGmailMessageIds: firestore_1.FieldValue.arrayUnion(input.gmailMessageId),
                linkedInboundEmailProcessingIds: firestore_1.FieldValue.arrayUnion(input.inboundEmailProcessingId),
                updatedAt: input.now,
            }, { merge: true });
            const exact = hint.contentFingerprint.length > 0 &&
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
        const legacyLookup = await findLegacyBusinessInvoiceCanonicalOutsideTx(db, {
            identity,
            vendorInvoiceNumberRaw: vendorInvoiceNumber,
            excludeReviewId: importId,
        });
        if (legacyLookup.kind === "saturated") {
            throw new Error(exports.BUSINESS_INVOICE_LEGACY_LOOKUP_SATURATED);
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
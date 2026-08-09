"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asSpaceTier = asSpaceTier;
exports.asOptionalPackageCount = asOptionalPackageCount;
exports.writeUnplannedAudit = writeUnplannedAudit;
exports.runVendorScopedUnplannedMatch = runVendorScopedUnplannedMatch;
exports.pickAvailableStagingForTier = pickAvailableStagingForTier;
exports.createUpgradedVendorSession = createUpgradedVendorSession;
exports.buildUnplannedSuccessPayload = buildUnplannedSuccessPayload;
exports.publicCandidate = publicCandidate;
exports.checkUnplannedPreviewRateLimit = checkUnplannedPreviewRateLimit;
/**
 * Shared helpers for vendor unplanned match/create/confirm CFs.
 */
const admin = require("firebase-admin");
const crypto_1 = require("crypto");
const https_1 = require("firebase-functions/v2/https");
const loadMatchContext_1 = require("./email/loadMatchContext");
const deliveryDetailsResponse_1 = require("./deliveryDetailsResponse");
const unplannedVendorDeliveryMatching_1 = require("./unplannedVendorDeliveryMatching");
function getDb() {
    return admin.firestore();
}
function asSpaceTier(value) {
    if (value === "shelf" || value === "ground" || value === "large") {
        return value;
    }
    return null;
}
function asOptionalPackageCount(value) {
    if (value === undefined || value === null || value === "")
        return null;
    if (typeof value !== "number" || !Number.isFinite(value))
        return null;
    const n = Math.floor(value);
    if (n < 1 || n > 999)
        return null;
    return n;
}
async function getVendorSessionMinutes() {
    const snap = await getDb().collection("appSettings").doc("config").get();
    const minutes = snap.exists ? snap.data()?.vendorSessionMinutes : undefined;
    return typeof minutes === "number" && minutes > 0 && minutes <= 240
        ? minutes
        : 15;
}
async function writeUnplannedAudit(input) {
    const now = new Date().toISOString();
    const eventId = `unplanned-${(0, crypto_1.createHash)("sha256")
        .update(`${input.action}:${input.vendorId}:${now}:${(0, crypto_1.randomBytes)(8).toString("hex")}`)
        .digest("hex")
        .slice(0, 24)}`;
    await getDb()
        .collection("pinVerificationEvents")
        .doc(eventId)
        .set({
        id: eventId,
        action: input.action,
        vendorId: input.vendorId,
        vendorName: input.vendorName,
        timestamp: now,
        createdAt: now,
        ...(input.deliveryId ? { deliveryOrderId: input.deliveryId } : {}),
        ...(input.reference
            ? { unplannedSubmittedReference: input.reference.trim() }
            : {}),
        ...(input.details ?? {}),
    });
}
async function runVendorScopedUnplannedMatch(vendorId, reference) {
    const db = getDb();
    const [ctx, deliveriesSnap] = await Promise.all([
        (0, loadMatchContext_1.loadEmailMatchContext)(),
        db.collection("deliveries").where("vendorId", "==", vendorId).limit(200).get(),
    ]);
    const vendorScopedCtx = (0, unplannedVendorDeliveryMatching_1.filterMatchContextToVendor)(ctx, vendorId);
    const vendorDeliveries = deliveriesSnap.docs.map((doc) => {
        const data = doc.data();
        return {
            id: doc.id,
            orderNumber: typeof data.orderNumber === "string" ? data.orderNumber : doc.id,
            vendorInvoiceNumber: typeof data.vendorInvoiceNumber === "string"
                ? data.vendorInvoiceNumber
                : undefined,
            jobId: typeof data.jobId === "string" ? data.jobId : undefined,
            purchaseOrderId: typeof data.purchaseOrderId === "string"
                ? data.purchaseOrderId
                : undefined,
        };
    });
    // Prefer vendor-scoped deliveries for matcher too (query may exceed global 500 cap).
    const deliveryIds = new Set(vendorDeliveries.map((d) => d.id));
    for (const d of vendorScopedCtx.deliveries) {
        deliveryIds.add(d.id);
    }
    const mergedDeliveries = [
        ...vendorDeliveries.map((d) => ({
            id: d.id,
            orderNumber: d.orderNumber,
            jobId: d.jobId ?? "",
            vendorId,
            purchaseOrderId: d.purchaseOrderId,
        })),
        ...vendorScopedCtx.deliveries.filter((d) => !deliveryIds.has(d.id)),
    ];
    const jobNameById = new Map(ctx.jobs.map((j) => [j.id, j.jobName ?? j.jobNumber]));
    const poNumberById = new Map(ctx.purchaseOrders
        .filter((po) => po.vendorId === vendorId)
        .map((po) => [po.id, po.poNumber]));
    return (0, unplannedVendorDeliveryMatching_1.classifyUnplannedVendorMatch)({
        reference,
        vendorScopedCtx: {
            ...vendorScopedCtx,
            deliveries: mergedDeliveries,
        },
        vendorDeliveries,
        jobNameById,
        poNumberById,
    });
}
function isOversizedLoc(loc) {
    const w = typeof loc.widthFt === "number" ? loc.widthFt : 0;
    const d = typeof loc.depthFt === "number" ? loc.depthFt : 0;
    return w >= 8 || d >= 8;
}
/** Pick first available staging location for a size tier; null if none. */
async function pickAvailableStagingForTier(spaceTier, excludeDeliveryId) {
    const db = getDb();
    const [locsSnap, occupiedSnap] = await Promise.all([
        db.collection("stagingLocations").limit(300).get(),
        db.collection("deliveries").limit(400).get(),
    ]);
    const occupied = new Set();
    for (const doc of occupiedSnap.docs) {
        if (excludeDeliveryId && doc.id === excludeDeliveryId)
            continue;
        const data = doc.data();
        const primary = data?.stagingLocationId;
        if (typeof primary === "string" && primary.trim()) {
            occupied.add(primary.trim());
        }
        const extra = data?.additionalStagingLocationIds;
        if (Array.isArray(extra)) {
            for (const id of extra) {
                if (typeof id === "string" && id.trim())
                    occupied.add(id.trim());
            }
        }
    }
    const candidates = locsSnap.docs
        .map((doc) => ({ id: doc.id, data: doc.data() }))
        .filter(({ id, data }) => {
        if (occupied.has(id))
            return false;
        if (data.active === false)
            return false;
        const type = String(data.type ?? "");
        if (spaceTier === "shelf") {
            return (type === "shelf" || type === "bin") && !isOversizedLoc(data);
        }
        if (spaceTier === "ground") {
            return type === "ground" && !isOversizedLoc(data);
        }
        // large
        return type === "ground" && isOversizedLoc(data);
    })
        .sort((a, b) => String(a.data.code ?? a.id).localeCompare(String(b.data.code ?? b.id)));
    const pick = candidates[0];
    if (!pick)
        return null;
    const code = typeof pick.data.code === "string" && pick.data.code.trim()
        ? pick.data.code.trim()
        : pick.id;
    return { id: pick.id, code };
}
async function createUpgradedVendorSession(input) {
    const sessionMinutes = await getVendorSessionMinutes();
    const now = Date.now();
    const expiresAt = new Date(now + sessionMinutes * 60 * 1000).toISOString();
    const sessionToken = (0, crypto_1.randomBytes)(32).toString("hex");
    await getDb()
        .collection("vendorSessions")
        .doc(sessionToken)
        .set({
        id: sessionToken,
        deliveryId: input.deliveryId,
        vendorId: input.vendorId,
        vendorName: input.vendorName,
        expiresAt,
        createdAt: new Date(now).toISOString(),
        sessionScope: "vendor",
        ...(input.scannedStagingLocationId
            ? { scannedStagingLocationId: input.scannedStagingLocationId }
            : {}),
        ...(input.scannedStagingLocationCode
            ? { scannedStagingLocationCode: input.scannedStagingLocationCode }
            : {}),
    });
    return { sessionToken, expiresAt };
}
async function buildUnplannedSuccessPayload(input) {
    const deliverySnap = await getDb()
        .collection("deliveries")
        .doc(input.deliveryId)
        .get();
    if (!deliverySnap.exists) {
        throw new https_1.HttpsError("not-found", "Delivery not found.");
    }
    const deliveryData = deliverySnap.data();
    const session = await createUpgradedVendorSession({
        deliveryId: input.deliveryId,
        vendorId: input.vendorId,
        vendorName: input.vendorName,
        scannedStagingLocationId: input.session.scannedStagingLocationId,
        scannedStagingLocationCode: input.session.scannedStagingLocationCode,
    });
    const bootstrap = await (0, deliveryDetailsResponse_1.buildVendorPinBootstrap)(getDb(), input.deliveryId, deliveryData, input.vendorId, input.vendorName).catch(() => undefined);
    return {
        success: true,
        vendorId: input.vendorId,
        vendorName: input.vendorName,
        deliveryId: input.deliveryId,
        sessionScope: "vendor",
        sessionToken: session.sessionToken,
        expiresAt: session.expiresAt,
        ...(input.session.scannedStagingLocationCode
            ? { scannedStagingLocationCode: input.session.scannedStagingLocationCode }
            : {}),
        ...(bootstrap ? { bootstrap } : {}),
    };
}
function publicCandidate(c) {
    return {
        deliveryId: c.deliveryId,
        orderNumber: c.orderNumber,
        ...(c.jobName ? { jobName: c.jobName } : {}),
        ...(c.poNumber ? { poNumber: c.poNumber } : {}),
        confidenceScore: c.confidenceScore,
    };
}
async function checkUnplannedPreviewRateLimit(sessionToken) {
    const ref = getDb()
        .collection("vendorPinAttempts")
        .doc(`unplanned-preview:${sessionToken.slice(0, 32)}`);
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    const maxAttempts = 30;
    await getDb().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists ? snap.data() : {};
        const windowStart = data?.windowStartedAt
            ? Date.parse(String(data.windowStartedAt))
            : now;
        const inWindow = now - windowStart < windowMs;
        const count = inWindow ? Number(data?.count ?? 0) : 0;
        if (inWindow && count >= maxAttempts) {
            throw new https_1.HttpsError("resource-exhausted", "Too many match attempts. Try again later.");
        }
        tx.set(ref, {
            count: inWindow ? count + 1 : 1,
            windowStartedAt: inWindow
                ? String(data?.windowStartedAt ?? new Date(now).toISOString())
                : new Date(now).toISOString(),
            lastAttemptAt: new Date(now).toISOString(),
        });
    });
}
//# sourceMappingURL=unplannedVendorDeliveryShared.js.map
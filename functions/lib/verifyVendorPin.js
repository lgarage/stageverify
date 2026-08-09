"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyVendorPin = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const accessPinCrypto_1 = require("./accessPinCrypto");
const accessPinLookup_1 = require("./accessPinLookup");
const pinMatching_1 = require("./pinMatching");
const deliveryDetailsResponse_1 = require("./deliveryDetailsResponse");
const locationScanPinShared_1 = require("./locationScanPinShared");
function getDb() {
    return admin.firestore();
}
function asDeliveryId(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 128)
        return null;
    return trimmed;
}
function asJobId(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 128)
        return null;
    return trimmed;
}
async function resolveDeliveryId(deliveryId, orderId) {
    if (deliveryId)
        return deliveryId;
    if (!orderId)
        return null;
    const snap = await getDb()
        .collection("deliveries")
        .where("orderNumber", "==", orderId)
        .limit(1)
        .get();
    if (snap.empty)
        return null;
    return snap.docs[0].id;
}
async function verifyLegacyDeliveryPin(deliveryId, pin) {
    const deliverySnap = await getDb()
        .collection("deliveries")
        .doc(deliveryId)
        .get();
    if (!deliverySnap.exists) {
        throw new https_1.HttpsError("not-found", "Invalid code.");
    }
    const deliveryData = deliverySnap.data();
    const delivery = deliveryData;
    const jobId = typeof delivery.jobId === "string" && delivery.jobId.trim()
        ? delivery.jobId.trim()
        : undefined;
    if (jobId) {
        const jobSnap = await getDb().collection("jobs").doc(jobId).get();
        if (jobSnap.exists) {
            const job = jobSnap.data();
            if ((0, pinMatching_1.pinMatches)(job, pin)) {
                const vendorSnap = await getDb()
                    .collection("vendors")
                    .doc(delivery.vendorId)
                    .get();
                const vendor = vendorSnap.exists
                    ? vendorSnap.data()
                    : { name: delivery.vendorName ?? "Vendor" };
                return {
                    vendorId: delivery.vendorId,
                    vendorName: (0, locationScanPinShared_1.vendorDisplayName)(vendor),
                    deliveryId,
                    jobId,
                    pinMatchedVia: "job",
                    deliveryData,
                };
            }
        }
    }
    const vendorSnap = await getDb()
        .collection("vendors")
        .doc(delivery.vendorId)
        .get();
    if (!vendorSnap.exists) {
        throw new https_1.HttpsError("not-found", "Invalid code.");
    }
    const vendor = vendorSnap.data();
    if (vendor.active === false) {
        throw new https_1.HttpsError("not-found", "Invalid code.");
    }
    const legacyVendorMatch = (0, pinMatching_1.pinMatches)(vendor, pin);
    const secretVendorMatch = legacyVendorMatch
        ? false
        : await (0, accessPinLookup_1.vendorAccessPinSecretMatches)(delivery.vendorId, pin);
    if (!legacyVendorMatch && !secretVendorMatch) {
        throw new https_1.HttpsError("not-found", "Invalid code.");
    }
    return {
        vendorId: delivery.vendorId,
        vendorName: (0, locationScanPinShared_1.vendorDisplayName)(vendor),
        deliveryId,
        jobId,
        pinMatchedVia: "vendor",
        deliveryData,
    };
}
exports.verifyVendorPin = (0, https_1.onCall)({
    region: "us-central1",
    secrets: [accessPinCrypto_1.accessPinEncryptionKey],
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const data = (request.data ?? {});
    const pin = (0, pinMatching_1.asAccessPin)(data.pin);
    const stagingLocationCode = (0, locationScanPinShared_1.asStagingLocationCode)(data.stagingLocationCode);
    const explicitJobId = asJobId(data.jobId);
    const deliveryId = await resolveDeliveryId(asDeliveryId(data.deliveryId), asDeliveryId(data.orderId));
    if (!pin) {
        throw new https_1.HttpsError("invalid-argument", "Invalid code.");
    }
    const locationFirst = Boolean(stagingLocationCode) && !deliveryId;
    if (!locationFirst && !deliveryId) {
        throw new https_1.HttpsError("invalid-argument", "Invalid code.");
    }
    const attemptKey = locationFirst
        ? `loc:${stagingLocationCode}`
        : `del:${deliveryId}`;
    await (0, locationScanPinShared_1.checkPinRateLimit)("vendorPinAttempts", attemptKey);
    if (locationFirst) {
        await (0, locationScanPinShared_1.checkPinRateLimit)("vendorPinAttempts", "pin:location-first:global");
    }
    if (locationFirst) {
        const jobMatch = explicitJobId
            ? await (async () => {
                const snap = await getDb().collection("jobs").doc(explicitJobId).get();
                if (!snap.exists)
                    return null;
                const job = snap.data();
                return (0, pinMatching_1.pinMatches)(job, pin) ? { id: snap.id, data: job } : null;
            })()
            : await (0, locationScanPinShared_1.findJobByPin)(pin);
        if (!jobMatch) {
            const vendorMatch = await (0, locationScanPinShared_1.findVendorByCompanyPin)(pin);
            if (!vendorMatch) {
                return { success: false, message: "Invalid code." };
            }
            const anchorDeliveryId = await (0, locationScanPinShared_1.anchorDeliveryForVendor)(vendorMatch.id);
            const location = await (0, locationScanPinShared_1.resolveStagingLocation)(stagingLocationCode);
            const vendorName = (0, locationScanPinShared_1.vendorDisplayName)(vendorMatch.data);
            await (0, locationScanPinShared_1.clearPinRateLimit)("vendorPinAttempts", attemptKey);
            if (locationFirst) {
                await (0, locationScanPinShared_1.clearPinRateLimit)("vendorPinAttempts", "pin:location-first:global");
            }
            // Zero expected deliveries: issue unplanned-eligible session (not Invalid code).
            if (!anchorDeliveryId) {
                await (0, locationScanPinShared_1.writeVendorPinVerifiedAudit)({
                    deliveryId: `unplanned-anchor:${vendorMatch.id}`,
                    vendorId: vendorMatch.id,
                    vendorName,
                    stagingLocationCode: stagingLocationCode ?? undefined,
                });
                const session = await (0, locationScanPinShared_1.createVendorSession)({
                    deliveryId: "",
                    vendorId: vendorMatch.id,
                    vendorName,
                    sessionScope: "vendor_unplanned",
                    scannedStagingLocationId: location?.id,
                    scannedStagingLocationCode: location?.code ?? stagingLocationCode ?? undefined,
                    unplannedEligible: true,
                });
                return {
                    success: true,
                    vendorId: vendorMatch.id,
                    vendorName,
                    sessionScope: "vendor_unplanned",
                    noExpectedDelivery: true,
                    scannedStagingLocationCode: location?.code ?? stagingLocationCode,
                    sessionToken: session.sessionToken,
                    expiresAt: session.expiresAt,
                };
            }
            await (0, locationScanPinShared_1.writeVendorPinVerifiedAudit)({
                deliveryId: anchorDeliveryId,
                vendorId: vendorMatch.id,
                vendorName,
                stagingLocationCode: stagingLocationCode ?? undefined,
            });
            const session = await (0, locationScanPinShared_1.createVendorSession)({
                deliveryId: anchorDeliveryId,
                vendorId: vendorMatch.id,
                vendorName,
                sessionScope: "vendor",
                scannedStagingLocationId: location?.id,
                scannedStagingLocationCode: location?.code ?? stagingLocationCode ?? undefined,
            });
            return {
                success: true,
                vendorId: vendorMatch.id,
                vendorName,
                deliveryId: anchorDeliveryId,
                sessionScope: "vendor",
                scannedStagingLocationCode: location?.code ?? stagingLocationCode,
                sessionToken: session.sessionToken,
                expiresAt: session.expiresAt,
            };
        }
        const jobId = jobMatch.id;
        const vendorInfo = await (0, locationScanPinShared_1.primaryVendorForJob)(jobId);
        if (!vendorInfo) {
            return { success: false, message: "Invalid code." };
        }
        const location = await (0, locationScanPinShared_1.resolveStagingLocation)(stagingLocationCode);
        await (0, locationScanPinShared_1.clearPinRateLimit)("vendorPinAttempts", attemptKey);
        if (locationFirst) {
            await (0, locationScanPinShared_1.clearPinRateLimit)("vendorPinAttempts", "pin:location-first:global");
        }
        await (0, locationScanPinShared_1.writeVendorPinVerifiedAudit)({
            deliveryId: vendorInfo.deliveryId,
            vendorId: vendorInfo.vendorId,
            vendorName: vendorInfo.vendorName,
            jobId,
            stagingLocationCode: stagingLocationCode ?? undefined,
        });
        const session = await (0, locationScanPinShared_1.createVendorSession)({
            deliveryId: vendorInfo.deliveryId,
            vendorId: vendorInfo.vendorId,
            vendorName: vendorInfo.vendorName,
            sessionScope: "job",
            jobId,
            scannedStagingLocationId: location?.id,
            scannedStagingLocationCode: location?.code ?? stagingLocationCode ?? undefined,
        });
        return {
            success: true,
            vendorId: vendorInfo.vendorId,
            vendorName: vendorInfo.vendorName,
            deliveryId: vendorInfo.deliveryId,
            jobId,
            sessionScope: "job",
            scannedStagingLocationCode: location?.code ?? stagingLocationCode,
            sessionToken: session.sessionToken,
            expiresAt: session.expiresAt,
        };
    }
    let verified;
    try {
        verified = await verifyLegacyDeliveryPin(deliveryId, pin);
    }
    catch {
        return { success: false, message: "Invalid code." };
    }
    // Bootstrap in parallel with session writes — never blocks PIN success on failure.
    const bootstrapPromise = (0, deliveryDetailsResponse_1.buildVendorPinBootstrap)(getDb(), verified.deliveryId, verified.deliveryData, verified.vendorId, verified.vendorName).catch(() => undefined);
    await (0, locationScanPinShared_1.clearPinRateLimit)("vendorPinAttempts", attemptKey);
    await (0, locationScanPinShared_1.writeVendorPinVerifiedAudit)({
        deliveryId: verified.deliveryId,
        vendorId: verified.vendorId,
        vendorName: verified.vendorName,
        jobId: verified.jobId,
    });
    const sessionScope = verified.pinMatchedVia === "job" && verified.jobId ? "job" : "delivery";
    const session = await (0, locationScanPinShared_1.createVendorSession)({
        deliveryId: verified.deliveryId,
        vendorId: verified.vendorId,
        vendorName: verified.vendorName,
        sessionScope,
        jobId: sessionScope === "job" ? verified.jobId : undefined,
    });
    const bootstrap = await bootstrapPromise;
    return {
        success: true,
        vendorId: verified.vendorId,
        vendorName: verified.vendorName,
        deliveryId: verified.deliveryId,
        jobId: sessionScope === "job" ? verified.jobId : undefined,
        sessionScope,
        sessionToken: session.sessionToken,
        expiresAt: session.expiresAt,
        ...(bootstrap ? { bootstrap } : {}),
    };
});
//# sourceMappingURL=verifyVendorPin.js.map
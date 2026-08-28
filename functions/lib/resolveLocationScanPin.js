"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveLocationScanPin = void 0;
const https_1 = require("firebase-functions/v2/https");
const accessPinCrypto_1 = require("./accessPinCrypto");
const managementSessionValidation_1 = require("./managementSessionValidation");
const managementPinRegistry_1 = require("./managementPinRegistry");
const locationScanPinShared_1 = require("./locationScanPinShared");
const RATE_LIMIT_COLLECTION = "locationScanPinAttempts";
async function clearBothPinRateLimits(attemptKey) {
    await Promise.all([
        (0, locationScanPinShared_1.clearPinRateLimit)(RATE_LIMIT_COLLECTION, attemptKey),
        (0, locationScanPinShared_1.clearPinRateLimit)(RATE_LIMIT_COLLECTION, "pin:location-scan:global"),
    ]);
}
exports.resolveLocationScanPin = (0, https_1.onCall)({
    region: "us-central1",
    minInstances: 1,
    secrets: [accessPinCrypto_1.accessPinEncryptionKey],
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const tStart = Date.now();
    let writeMs = 0;
    const data = (request.data ?? {});
    const pin = (0, locationScanPinShared_1.asAccessPin)(data.pin);
    const stagingLocationCode = (0, locationScanPinShared_1.asStagingLocationCode)(data.stagingLocationCode);
    if (!pin || !stagingLocationCode) {
        throw new https_1.HttpsError("invalid-argument", "Invalid code.");
    }
    const attemptKey = `loc:${stagingLocationCode}`;
    await (0, locationScanPinShared_1.checkPinRateLimit)(RATE_LIMIT_COLLECTION, attemptKey);
    await (0, locationScanPinShared_1.checkPinRateLimit)(RATE_LIMIT_COLLECTION, "pin:location-scan:global");
    const rateLimitMs = Date.now() - tStart;
    const tLookup = Date.now();
    const [techMatch, jobMatch, vendorMatch, catchAllConfig, location, managementMatchRaw,] = await Promise.all([
        (0, locationScanPinShared_1.findTechnicianByPin)(pin),
        (0, locationScanPinShared_1.findJobByPin)(pin),
        (0, locationScanPinShared_1.findVendorByCompanyPin)(pin),
        (0, managementSessionValidation_1.loadCatchAllConfig)(),
        (0, locationScanPinShared_1.resolveStagingLocation)(stagingLocationCode),
        (0, managementPinRegistry_1.resolveManagementPinMatch)(pin),
    ]);
    const lookupMs = Date.now() - tLookup;
    const managementMatch = catchAllConfig ? managementMatchRaw : null;
    const typeMatches = [];
    if (techMatch) {
        typeMatches.push("technician");
    }
    if (jobMatch || vendorMatch) {
        typeMatches.push("vendor");
    }
    if (catchAllConfig && managementMatch) {
        typeMatches.push("management");
    }
    if (typeMatches.length === 0) {
        return { success: false, message: "Invalid code." };
    }
    if (typeMatches.length >= 2) {
        return { success: false, message: "Invalid code." };
    }
    const soleType = typeMatches[0];
    if (soleType === "management") {
        if (!managementMatch) {
            return { success: false, message: "Invalid code." };
        }
        if (!(0, managementPinRegistry_1.pinHasCapability)(managementMatch, "enterPortalAnyQr")) {
            return {
                success: false,
                message: "This PIN cannot open the office portal.",
            };
        }
        if (!location) {
            throw new https_1.HttpsError("failed-precondition", "Unknown staging location.");
        }
        const tWrite = Date.now();
        const session = await (0, locationScanPinShared_1.mintManagementSession)({
            location,
            pinId: managementMatch.id,
            permissions: managementMatch.permissions,
        });
        writeMs = Date.now() - tWrite;
        await clearBothPinRateLimits(attemptKey);
        console.info("resolveLocationScanPin timings", {
            rateLimitMs,
            lookupMs,
            writeMs,
            totalMs: Date.now() - tStart,
        });
        return {
            success: true,
            accessType: "management",
            sessionToken: session.sessionToken,
            expiresAt: session.expiresAt,
            scannedStagingLocationCode: session.scannedStagingLocationCode,
            pinId: managementMatch.id,
            permissions: managementMatch.permissions,
        };
    }
    if (soleType === "technician") {
        if (!techMatch) {
            return { success: false, message: "Invalid code." };
        }
        const technicianName = techMatch.data.name?.trim() || "Technician";
        const tWrite = Date.now();
        const session = await (0, locationScanPinShared_1.mintTechnicianSession)({
            technicianId: techMatch.id,
            technicianName,
            stagingLocationCode,
            resolvedLocation: location,
        });
        writeMs = Date.now() - tWrite;
        await clearBothPinRateLimits(attemptKey);
        console.info("resolveLocationScanPin timings", {
            rateLimitMs,
            lookupMs,
            writeMs,
            totalMs: Date.now() - tStart,
        });
        return {
            success: true,
            accessType: "technician",
            technicianId: techMatch.id,
            technicianName,
            sessionToken: session.sessionToken,
            expiresAt: session.expiresAt,
            scannedStagingLocationCode: session.scannedStagingLocationCode,
        };
    }
    // soleType === "vendor"
    if (jobMatch) {
        const jobId = jobMatch.id;
        const vendorInfo = await (0, locationScanPinShared_1.primaryVendorForJob)(jobId);
        if (!vendorInfo) {
            return { success: false, message: "Invalid code." };
        }
        const tWrite = Date.now();
        const [, session] = await Promise.all([
            (0, locationScanPinShared_1.writeVendorPinVerifiedAudit)({
                deliveryId: vendorInfo.deliveryId,
                vendorId: vendorInfo.vendorId,
                vendorName: vendorInfo.vendorName,
                jobId,
                stagingLocationCode,
            }),
            (0, locationScanPinShared_1.createVendorSession)({
                deliveryId: vendorInfo.deliveryId,
                vendorId: vendorInfo.vendorId,
                vendorName: vendorInfo.vendorName,
                sessionScope: "job",
                jobId,
                scannedStagingLocationId: location?.id,
                scannedStagingLocationCode: location?.code ?? stagingLocationCode,
            }),
        ]);
        writeMs = Date.now() - tWrite;
        await clearBothPinRateLimits(attemptKey);
        console.info("resolveLocationScanPin timings", {
            rateLimitMs,
            lookupMs,
            writeMs,
            totalMs: Date.now() - tStart,
        });
        return {
            success: true,
            accessType: "vendor",
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
    if (!vendorMatch) {
        return { success: false, message: "Invalid code." };
    }
    const anchorDeliveryId = await (0, locationScanPinShared_1.anchorDeliveryForVendor)(vendorMatch.id);
    const vendorName = (0, locationScanPinShared_1.vendorDisplayName)(vendorMatch.data);
    if (!anchorDeliveryId) {
        const tWrite = Date.now();
        const [, session] = await Promise.all([
            (0, locationScanPinShared_1.writeVendorPinVerifiedAudit)({
                deliveryId: `unplanned-anchor:${vendorMatch.id}`,
                vendorId: vendorMatch.id,
                vendorName,
                stagingLocationCode,
            }),
            (0, locationScanPinShared_1.createVendorSession)({
                deliveryId: "",
                vendorId: vendorMatch.id,
                vendorName,
                sessionScope: "vendor_unplanned",
                scannedStagingLocationId: location?.id,
                scannedStagingLocationCode: location?.code ?? stagingLocationCode,
                unplannedEligible: true,
            }),
        ]);
        writeMs = Date.now() - tWrite;
        await clearBothPinRateLimits(attemptKey);
        console.info("resolveLocationScanPin timings", {
            rateLimitMs,
            lookupMs,
            writeMs,
            totalMs: Date.now() - tStart,
        });
        return {
            success: true,
            accessType: "vendor",
            vendorId: vendorMatch.id,
            vendorName,
            sessionScope: "vendor_unplanned",
            noExpectedDelivery: true,
            scannedStagingLocationCode: location?.code ?? stagingLocationCode,
            sessionToken: session.sessionToken,
            expiresAt: session.expiresAt,
        };
    }
    const sessionScope = "vendor";
    const tWrite = Date.now();
    const [, session] = await Promise.all([
        (0, locationScanPinShared_1.writeVendorPinVerifiedAudit)({
            deliveryId: anchorDeliveryId,
            vendorId: vendorMatch.id,
            vendorName,
            stagingLocationCode,
        }),
        (0, locationScanPinShared_1.createVendorSession)({
            deliveryId: anchorDeliveryId,
            vendorId: vendorMatch.id,
            vendorName,
            sessionScope,
            scannedStagingLocationId: location?.id,
            scannedStagingLocationCode: location?.code ?? stagingLocationCode,
        }),
    ]);
    writeMs = Date.now() - tWrite;
    await clearBothPinRateLimits(attemptKey);
    console.info("resolveLocationScanPin timings", {
        rateLimitMs,
        lookupMs,
        writeMs,
        totalMs: Date.now() - tStart,
    });
    return {
        success: true,
        accessType: "vendor",
        vendorId: vendorMatch.id,
        vendorName,
        deliveryId: anchorDeliveryId,
        sessionScope,
        scannedStagingLocationCode: location?.code ?? stagingLocationCode,
        sessionToken: session.sessionToken,
        expiresAt: session.expiresAt,
    };
});
//# sourceMappingURL=resolveLocationScanPin.js.map
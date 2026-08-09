"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveLocationScanPin = void 0;
const https_1 = require("firebase-functions/v2/https");
const accessPinCrypto_1 = require("./accessPinCrypto");
const managementSessionValidation_1 = require("./managementSessionValidation");
const managementPinRegistry_1 = require("./managementPinRegistry");
const locationScanPinShared_1 = require("./locationScanPinShared");
const RATE_LIMIT_COLLECTION = "locationScanPinAttempts";
exports.resolveLocationScanPin = (0, https_1.onCall)({
    region: "us-central1",
    secrets: [accessPinCrypto_1.accessPinEncryptionKey],
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const data = (request.data ?? {});
    const pin = (0, locationScanPinShared_1.asAccessPin)(data.pin);
    const stagingLocationCode = (0, locationScanPinShared_1.asStagingLocationCode)(data.stagingLocationCode);
    if (!pin || !stagingLocationCode) {
        throw new https_1.HttpsError("invalid-argument", "Invalid code.");
    }
    const attemptKey = `loc:${stagingLocationCode}`;
    await (0, locationScanPinShared_1.checkPinRateLimit)(RATE_LIMIT_COLLECTION, attemptKey);
    await (0, locationScanPinShared_1.checkPinRateLimit)(RATE_LIMIT_COLLECTION, "pin:location-scan:global");
    const typeMatches = [];
    const techMatch = await (0, locationScanPinShared_1.findTechnicianByPin)(pin);
    if (techMatch) {
        typeMatches.push("technician");
    }
    const jobMatch = await (0, locationScanPinShared_1.findJobByPin)(pin);
    if (jobMatch) {
        typeMatches.push("vendor");
    }
    else {
        const vendorMatch = await (0, locationScanPinShared_1.findVendorByCompanyPin)(pin);
        if (vendorMatch) {
            typeMatches.push("vendor");
        }
    }
    let managementMatch = null;
    const catchAllConfig = await (0, managementSessionValidation_1.loadCatchAllConfig)();
    if (catchAllConfig) {
        managementMatch = await (0, managementPinRegistry_1.resolveManagementPinMatch)(pin);
        if (managementMatch) {
            typeMatches.push("management");
        }
    }
    if (typeMatches.length === 0) {
        return { success: false, message: "Invalid code." };
    }
    if (typeMatches.length >= 2) {
        return { success: false, message: "Invalid code." };
    }
    const soleType = typeMatches[0];
    const location = await (0, locationScanPinShared_1.resolveStagingLocation)(stagingLocationCode);
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
        const session = await (0, locationScanPinShared_1.mintManagementSession)({
            location,
            pinId: managementMatch.id,
            permissions: managementMatch.permissions,
        });
        await (0, locationScanPinShared_1.clearPinRateLimit)(RATE_LIMIT_COLLECTION, attemptKey);
        await (0, locationScanPinShared_1.clearPinRateLimit)(RATE_LIMIT_COLLECTION, "pin:location-scan:global");
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
        const session = await (0, locationScanPinShared_1.mintTechnicianSession)({
            technicianId: techMatch.id,
            technicianName,
            stagingLocationCode,
            resolvedLocation: location,
        });
        await (0, locationScanPinShared_1.clearPinRateLimit)(RATE_LIMIT_COLLECTION, attemptKey);
        await (0, locationScanPinShared_1.clearPinRateLimit)(RATE_LIMIT_COLLECTION, "pin:location-scan:global");
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
        await (0, locationScanPinShared_1.writeVendorPinVerifiedAudit)({
            deliveryId: vendorInfo.deliveryId,
            vendorId: vendorInfo.vendorId,
            vendorName: vendorInfo.vendorName,
            jobId,
            stagingLocationCode,
        });
        const session = await (0, locationScanPinShared_1.createVendorSession)({
            deliveryId: vendorInfo.deliveryId,
            vendorId: vendorInfo.vendorId,
            vendorName: vendorInfo.vendorName,
            sessionScope: "job",
            jobId,
            scannedStagingLocationId: location?.id,
            scannedStagingLocationCode: location?.code ?? stagingLocationCode,
        });
        await (0, locationScanPinShared_1.clearPinRateLimit)(RATE_LIMIT_COLLECTION, attemptKey);
        await (0, locationScanPinShared_1.clearPinRateLimit)(RATE_LIMIT_COLLECTION, "pin:location-scan:global");
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
    const vendorMatch = await (0, locationScanPinShared_1.findVendorByCompanyPin)(pin);
    if (!vendorMatch) {
        return { success: false, message: "Invalid code." };
    }
    const anchorDeliveryId = await (0, locationScanPinShared_1.anchorDeliveryForVendor)(vendorMatch.id);
    const vendorName = (0, locationScanPinShared_1.vendorDisplayName)(vendorMatch.data);
    if (!anchorDeliveryId) {
        await (0, locationScanPinShared_1.writeVendorPinVerifiedAudit)({
            deliveryId: `unplanned-anchor:${vendorMatch.id}`,
            vendorId: vendorMatch.id,
            vendorName,
            stagingLocationCode,
        });
        const session = await (0, locationScanPinShared_1.createVendorSession)({
            deliveryId: "",
            vendorId: vendorMatch.id,
            vendorName,
            sessionScope: "vendor_unplanned",
            scannedStagingLocationId: location?.id,
            scannedStagingLocationCode: location?.code ?? stagingLocationCode,
            unplannedEligible: true,
        });
        await (0, locationScanPinShared_1.clearPinRateLimit)(RATE_LIMIT_COLLECTION, attemptKey);
        await (0, locationScanPinShared_1.clearPinRateLimit)(RATE_LIMIT_COLLECTION, "pin:location-scan:global");
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
    await (0, locationScanPinShared_1.writeVendorPinVerifiedAudit)({
        deliveryId: anchorDeliveryId,
        vendorId: vendorMatch.id,
        vendorName,
        stagingLocationCode,
    });
    const sessionScope = "vendor";
    const session = await (0, locationScanPinShared_1.createVendorSession)({
        deliveryId: anchorDeliveryId,
        vendorId: vendorMatch.id,
        vendorName,
        sessionScope,
        scannedStagingLocationId: location?.id,
        scannedStagingLocationCode: location?.code ?? stagingLocationCode,
    });
    await (0, locationScanPinShared_1.clearPinRateLimit)(RATE_LIMIT_COLLECTION, attemptKey);
    await (0, locationScanPinShared_1.clearPinRateLimit)(RATE_LIMIT_COLLECTION, "pin:location-scan:global");
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
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { accessPinEncryptionKey } from "./accessPinCrypto";
import { loadCatchAllConfig } from "./managementSessionValidation";
import {
  pinHasCapability,
  resolveManagementPinMatch,
} from "./managementPinRegistry";
import {
  anchorDeliveryForVendor,
  asAccessPin,
  asStagingLocationCode,
  checkPinRateLimit,
  clearPinRateLimit,
  createVendorSession,
  findJobByPin,
  findTechnicianByPin,
  findVendorByCompanyPin,
  mintManagementSession,
  mintTechnicianSession,
  primaryVendorForJob,
  resolveStagingLocation,
  vendorDisplayName,
  writeVendorPinVerifiedAudit,
} from "./locationScanPinShared";
import type { VendorSessionScope } from "./vendorSessionValidation";

const RATE_LIMIT_COLLECTION = "locationScanPinAttempts";

type AccessTypeMatch = "technician" | "vendor" | "management";

async function clearBothPinRateLimits(attemptKey: string): Promise<void> {
  await Promise.all([
    clearPinRateLimit(RATE_LIMIT_COLLECTION, attemptKey),
    clearPinRateLimit(RATE_LIMIT_COLLECTION, "pin:location-scan:global"),
  ]);
}

export const resolveLocationScanPin = onCall(
  {
    region: "us-central1",
    secrets: [accessPinEncryptionKey],
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as {
      pin?: string;
      stagingLocationCode?: string;
    };
    const pin = asAccessPin(data.pin);
    const stagingLocationCode = asStagingLocationCode(data.stagingLocationCode);

    if (!pin || !stagingLocationCode) {
      throw new HttpsError("invalid-argument", "Invalid code.");
    }

    const attemptKey = `loc:${stagingLocationCode}`;
    await checkPinRateLimit(RATE_LIMIT_COLLECTION, attemptKey);
    await checkPinRateLimit(RATE_LIMIT_COLLECTION, "pin:location-scan:global");

    const [techMatch, jobMatch, vendorMatch, catchAllConfig, location] =
      await Promise.all([
        findTechnicianByPin(pin),
        findJobByPin(pin),
        findVendorByCompanyPin(pin),
        loadCatchAllConfig(),
        resolveStagingLocation(stagingLocationCode),
      ]);

    let managementMatch: Awaited<
      ReturnType<typeof resolveManagementPinMatch>
    > | null = null;
    if (catchAllConfig) {
      managementMatch = await resolveManagementPinMatch(pin);
    }

    const typeMatches: AccessTypeMatch[] = [];

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
      if (!pinHasCapability(managementMatch, "enterPortalAnyQr")) {
        return {
          success: false,
          message: "This PIN cannot open the office portal.",
        };
      }
      if (!location) {
        throw new HttpsError(
          "failed-precondition",
          "Unknown staging location.",
        );
      }

      const session = await mintManagementSession({
        location,
        pinId: managementMatch.id,
        permissions: managementMatch.permissions,
      });

      await clearBothPinRateLimits(attemptKey);

      return {
        success: true,
        accessType: "management" as const,
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
      const session = await mintTechnicianSession({
        technicianId: techMatch.id,
        technicianName,
        stagingLocationCode,
        resolvedLocation: location,
      });

      await clearBothPinRateLimits(attemptKey);

      return {
        success: true,
        accessType: "technician" as const,
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
      const vendorInfo = await primaryVendorForJob(jobId);
      if (!vendorInfo) {
        return { success: false, message: "Invalid code." };
      }

      await writeVendorPinVerifiedAudit({
        deliveryId: vendorInfo.deliveryId,
        vendorId: vendorInfo.vendorId,
        vendorName: vendorInfo.vendorName,
        jobId,
        stagingLocationCode,
      });

      const session = await createVendorSession({
        deliveryId: vendorInfo.deliveryId,
        vendorId: vendorInfo.vendorId,
        vendorName: vendorInfo.vendorName,
        sessionScope: "job",
        jobId,
        scannedStagingLocationId: location?.id,
        scannedStagingLocationCode: location?.code ?? stagingLocationCode,
      });

      await clearBothPinRateLimits(attemptKey);

      return {
        success: true,
        accessType: "vendor" as const,
        vendorId: vendorInfo.vendorId,
        vendorName: vendorInfo.vendorName,
        deliveryId: vendorInfo.deliveryId,
        jobId,
        sessionScope: "job" as const,
        scannedStagingLocationCode: location?.code ?? stagingLocationCode,
        sessionToken: session.sessionToken,
        expiresAt: session.expiresAt,
      };
    }

    if (!vendorMatch) {
      return { success: false, message: "Invalid code." };
    }

    const anchorDeliveryId = await anchorDeliveryForVendor(vendorMatch.id);
    const vendorName = vendorDisplayName(vendorMatch.data);

    if (!anchorDeliveryId) {
      await writeVendorPinVerifiedAudit({
        deliveryId: `unplanned-anchor:${vendorMatch.id}`,
        vendorId: vendorMatch.id,
        vendorName,
        stagingLocationCode,
      });

      const session = await createVendorSession({
        deliveryId: "",
        vendorId: vendorMatch.id,
        vendorName,
        sessionScope: "vendor_unplanned",
        scannedStagingLocationId: location?.id,
        scannedStagingLocationCode: location?.code ?? stagingLocationCode,
        unplannedEligible: true,
      });

      await clearBothPinRateLimits(attemptKey);

      return {
        success: true,
        accessType: "vendor" as const,
        vendorId: vendorMatch.id,
        vendorName,
        sessionScope: "vendor_unplanned" as const,
        noExpectedDelivery: true,
        scannedStagingLocationCode: location?.code ?? stagingLocationCode,
        sessionToken: session.sessionToken,
        expiresAt: session.expiresAt,
      };
    }

    await writeVendorPinVerifiedAudit({
      deliveryId: anchorDeliveryId,
      vendorId: vendorMatch.id,
      vendorName,
      stagingLocationCode,
    });

    const sessionScope: VendorSessionScope = "vendor";
    const session = await createVendorSession({
      deliveryId: anchorDeliveryId,
      vendorId: vendorMatch.id,
      vendorName,
      sessionScope,
      scannedStagingLocationId: location?.id,
      scannedStagingLocationCode: location?.code ?? stagingLocationCode,
    });

    await clearBothPinRateLimits(attemptKey);

    return {
      success: true,
      accessType: "vendor" as const,
      vendorId: vendorMatch.id,
      vendorName,
      deliveryId: anchorDeliveryId,
      sessionScope,
      scannedStagingLocationCode: location?.code ?? stagingLocationCode,
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
    };
  },
);

import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { accessPinEncryptionKey } from "./accessPinCrypto";
import { vendorAccessPinSecretMatches } from "./accessPinLookup";
import { asAccessPin, pinMatches } from "./pinMatching";
import type { VendorSessionScope } from "./vendorSessionValidation";
import { buildVendorPinBootstrap } from "./deliveryDetailsResponse";
import {
  anchorDeliveryForVendor,
  asStagingLocationCode,
  checkPinRateLimit,
  clearPinRateLimit,
  createVendorSession,
  findJobByPin,
  findVendorByCompanyPin,
  primaryVendorForJob,
  resolveStagingLocation,
  vendorDisplayName,
  writeVendorPinVerifiedAudit,
  type JobDoc,
  type VendorDoc,
} from "./locationScanPinShared";

function getDb() {
  return admin.firestore();
}

interface VerifyVendorPinRequest {
  deliveryId?: string;
  orderId?: string;
  pin?: string;
  /** Location-first permanent QR scan (Phase 3). */
  stagingLocationCode?: string;
  jobId?: string;
}

interface DeliveryDoc {
  id: string;
  vendorId: string;
  jobId?: string;
  orderNumber?: string;
  vendorName?: string;
}

function asDeliveryId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) return null;
  return trimmed;
}

function asJobId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) return null;
  return trimmed;
}

async function resolveDeliveryId(
  deliveryId: string | null,
  orderId: string | null,
): Promise<string | null> {
  if (deliveryId) return deliveryId;
  if (!orderId) return null;

  const snap = await getDb()
    .collection("deliveries")
    .where("orderNumber", "==", orderId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}

async function verifyLegacyDeliveryPin(
  deliveryId: string,
  pin: string,
): Promise<{
  vendorId: string;
  vendorName: string;
  deliveryId: string;
  jobId?: string;
  pinMatchedVia: "job" | "vendor";
  deliveryData: admin.firestore.DocumentData;
}> {
  const deliverySnap = await getDb()
    .collection("deliveries")
    .doc(deliveryId)
    .get();
  if (!deliverySnap.exists) {
    throw new HttpsError("not-found", "Invalid code.");
  }

  const deliveryData = deliverySnap.data() as admin.firestore.DocumentData;
  const delivery = deliveryData as DeliveryDoc;
  const jobId =
    typeof delivery.jobId === "string" && delivery.jobId.trim()
      ? delivery.jobId.trim()
      : undefined;

  if (jobId) {
    const jobSnap = await getDb().collection("jobs").doc(jobId).get();
    if (jobSnap.exists) {
      const job = jobSnap.data() as JobDoc;
      if (pinMatches(job, pin)) {
        const vendorSnap = await getDb()
          .collection("vendors")
          .doc(delivery.vendorId)
          .get();
        const vendor = vendorSnap.exists
          ? (vendorSnap.data() as VendorDoc)
          : { name: delivery.vendorName ?? "Vendor" };
        return {
          vendorId: delivery.vendorId,
          vendorName: vendorDisplayName(vendor),
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
    throw new HttpsError("not-found", "Invalid code.");
  }

  const vendor = vendorSnap.data() as VendorDoc;
  if (vendor.active === false) {
    throw new HttpsError("not-found", "Invalid code.");
  }

  const legacyVendorMatch = pinMatches(vendor, pin);
  const secretVendorMatch = legacyVendorMatch
    ? false
    : await vendorAccessPinSecretMatches(delivery.vendorId, pin);
  if (!legacyVendorMatch && !secretVendorMatch) {
    throw new HttpsError("not-found", "Invalid code.");
  }

  return {
    vendorId: delivery.vendorId,
    vendorName: vendorDisplayName(vendor),
    deliveryId,
    jobId,
    pinMatchedVia: "vendor",
    deliveryData,
  };
}

export const verifyVendorPin = onCall(
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
    const data = (request.data ?? {}) as VerifyVendorPinRequest;
    const pin = asAccessPin(data.pin);
    const stagingLocationCode = asStagingLocationCode(data.stagingLocationCode);
    const explicitJobId = asJobId(data.jobId);
    const deliveryId = await resolveDeliveryId(
      asDeliveryId(data.deliveryId),
      asDeliveryId(data.orderId),
    );

    if (!pin) {
      throw new HttpsError("invalid-argument", "Invalid code.");
    }

    const locationFirst = Boolean(stagingLocationCode) && !deliveryId;

    if (!locationFirst && !deliveryId) {
      throw new HttpsError("invalid-argument", "Invalid code.");
    }

    const attemptKey = locationFirst
      ? `loc:${stagingLocationCode}`
      : `del:${deliveryId}`;

    await checkPinRateLimit("vendorPinAttempts", attemptKey);
    if (locationFirst) {
      await checkPinRateLimit("vendorPinAttempts", "pin:location-first:global");
    }

    if (locationFirst) {
      const jobMatch = explicitJobId
        ? await (async () => {
            const snap = await getDb().collection("jobs").doc(explicitJobId).get();
            if (!snap.exists) return null;
            const job = snap.data() as JobDoc;
            return pinMatches(job, pin) ? { id: snap.id, data: job } : null;
          })()
        : await findJobByPin(pin);

      if (!jobMatch) {
        const vendorMatch = await findVendorByCompanyPin(pin);
        if (!vendorMatch) {
          return { success: false, message: "Invalid code." };
        }

        const anchorDeliveryId = await anchorDeliveryForVendor(vendorMatch.id);
        const location = await resolveStagingLocation(stagingLocationCode!);
        const vendorName = vendorDisplayName(vendorMatch.data);

        await clearPinRateLimit("vendorPinAttempts", attemptKey);
        if (locationFirst) {
          await clearPinRateLimit(
            "vendorPinAttempts",
            "pin:location-first:global",
          );
        }

        // Zero expected deliveries: issue unplanned-eligible session (not Invalid code).
        if (!anchorDeliveryId) {
          await writeVendorPinVerifiedAudit({
            deliveryId: `unplanned-anchor:${vendorMatch.id}`,
            vendorId: vendorMatch.id,
            vendorName,
            stagingLocationCode: stagingLocationCode ?? undefined,
          });

          const session = await createVendorSession({
            deliveryId: "",
            vendorId: vendorMatch.id,
            vendorName,
            sessionScope: "vendor_unplanned",
            scannedStagingLocationId: location?.id,
            scannedStagingLocationCode:
              location?.code ?? stagingLocationCode ?? undefined,
            unplannedEligible: true,
          });

          return {
            success: true,
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
          stagingLocationCode: stagingLocationCode ?? undefined,
        });

        const session = await createVendorSession({
          deliveryId: anchorDeliveryId,
          vendorId: vendorMatch.id,
          vendorName,
          sessionScope: "vendor",
          scannedStagingLocationId: location?.id,
          scannedStagingLocationCode:
            location?.code ?? stagingLocationCode ?? undefined,
        });

        return {
          success: true,
          vendorId: vendorMatch.id,
          vendorName,
          deliveryId: anchorDeliveryId,
          sessionScope: "vendor" as const,
          scannedStagingLocationCode: location?.code ?? stagingLocationCode,
          sessionToken: session.sessionToken,
          expiresAt: session.expiresAt,
        };
      }

      const jobId = jobMatch.id;
      const vendorInfo = await primaryVendorForJob(jobId);
      if (!vendorInfo) {
        return { success: false, message: "Invalid code." };
      }

      const location = await resolveStagingLocation(stagingLocationCode!);

      await clearPinRateLimit("vendorPinAttempts", attemptKey);
      if (locationFirst) {
        await clearPinRateLimit(
          "vendorPinAttempts",
          "pin:location-first:global",
        );
      }
      await writeVendorPinVerifiedAudit({
        deliveryId: vendorInfo.deliveryId,
        vendorId: vendorInfo.vendorId,
        vendorName: vendorInfo.vendorName,
        jobId,
        stagingLocationCode: stagingLocationCode ?? undefined,
      });

      const session = await createVendorSession({
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
        sessionScope: "job" as const,
        scannedStagingLocationCode: location?.code ?? stagingLocationCode,
        sessionToken: session.sessionToken,
        expiresAt: session.expiresAt,
      };
    }

    let verified: {
      vendorId: string;
      vendorName: string;
      deliveryId: string;
      jobId?: string;
      pinMatchedVia: "job" | "vendor";
      deliveryData: admin.firestore.DocumentData;
    };
    try {
      verified = await verifyLegacyDeliveryPin(deliveryId!, pin);
    } catch {
      return { success: false, message: "Invalid code." };
    }

    // Bootstrap in parallel with session writes — never blocks PIN success on failure.
    const bootstrapPromise = buildVendorPinBootstrap(
      getDb(),
      verified.deliveryId,
      verified.deliveryData,
      verified.vendorId,
      verified.vendorName,
    ).catch(() => undefined);

    await clearPinRateLimit("vendorPinAttempts", attemptKey);
    await writeVendorPinVerifiedAudit({
      deliveryId: verified.deliveryId,
      vendorId: verified.vendorId,
      vendorName: verified.vendorName,
      jobId: verified.jobId,
    });

    const sessionScope: VendorSessionScope =
      verified.pinMatchedVia === "job" && verified.jobId ? "job" : "delivery";

    const session = await createVendorSession({
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
  },
);

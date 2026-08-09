/**
 * Vendor confirms a strong match → stamp existing delivery; no duplicate shell.
 */
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  asDeliveryId,
  asSessionToken,
  assertVendorUnplannedSessionValid,
} from "./vendorSessionValidation";
import { asUnplannedReference } from "./unplannedVendorDeliveryMatching";
import {
  asOptionalPackageCount,
  asSpaceTier,
  buildUnplannedSuccessPayload,
  pickAvailableStagingForTier,
  runVendorScopedUnplannedMatch,
  writeUnplannedAudit,
} from "./unplannedVendorDeliveryShared";

function getDb() {
  return admin.firestore();
}

interface ConfirmUnplannedRequest {
  sessionToken?: string;
  reference?: string;
  deliveryId?: string;
  spaceTier?: string;
  packageCount?: number;
}

export const confirmUnplannedVendorDeliveryMatch = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as ConfirmUnplannedRequest;
    const sessionToken = asSessionToken(data.sessionToken);
    const reference = asUnplannedReference(data.reference);
    const clientDeliveryId = asDeliveryId(data.deliveryId);
    const spaceTier = asSpaceTier(data.spaceTier);
    const packageCount = asOptionalPackageCount(data.packageCount);

    if (!sessionToken || !reference || !clientDeliveryId) {
      throw new HttpsError("invalid-argument", "Invalid confirm request.");
    }

    const session = await assertVendorUnplannedSessionValid(sessionToken);

    // Re-run match server-side — never trust client-picked deliveryId alone.
    const classification = await runVendorScopedUnplannedMatch(
      session.vendorId,
      reference,
    );

    if (
      classification.outcome !== "strong_match" ||
      !classification.candidate ||
      classification.candidate.deliveryId !== clientDeliveryId
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Match is no longer valid. Search again.",
      );
    }

    const deliveryId = classification.candidate.deliveryId;
    const deliveryRef = getDb().collection("deliveries").doc(deliveryId);

    await getDb().runTransaction(async (tx) => {
      const snap = await tx.get(deliveryRef);
      if (!snap.exists) {
        throw new HttpsError("not-found", "Delivery not found.");
      }
      const delivery = snap.data() as admin.firestore.DocumentData;
      if (String(delivery.vendorId ?? "") !== session.vendorId) {
        throw new HttpsError(
          "permission-denied",
          "Session is not valid for this delivery.",
        );
      }

      const now = new Date().toISOString();
      const patch: Record<string, unknown> = {
        vendorUnplannedConfirmedAt: now,
        vendorUnplannedConfirmedVia: "vendor_pin_fallback",
        unplannedSubmittedReference: reference.trim(),
        updatedAt: now,
      };
      if (packageCount != null) {
        patch.unplannedPackageCount = packageCount;
      }
      if (
        session.scannedStagingLocationId &&
        !String(delivery.stagingLocationId ?? "").trim()
      ) {
        patch.scannedStagingLocationId = session.scannedStagingLocationId;
        if (session.scannedStagingLocationCode) {
          patch.scannedStagingLocationCode = session.scannedStagingLocationCode;
        }
      }
      tx.update(deliveryRef, patch);
    });

    let needMoreSpace = false;
    let assignedCode: string | undefined;
    if (spaceTier) {
      const picked = await pickAvailableStagingForTier(spaceTier, deliveryId);
      if (picked) {
        await deliveryRef.update({
          stagingLocationId: picked.id,
          updatedAt: new Date().toISOString(),
        });
        assignedCode = picked.code;
        await writeUnplannedAudit({
          action: "VENDOR_UNPLANNED_STAGING_ASSIGNED",
          vendorId: session.vendorId,
          vendorName: session.vendorName,
          deliveryId,
          reference,
          details: { spaceTier, stagingLocationId: picked.id, code: picked.code },
        });
      } else {
        needMoreSpace = true;
        await deliveryRef.update({
          unplannedNeedMoreSpace: true,
          unplannedSpaceTierRequested: spaceTier,
          updatedAt: new Date().toISOString(),
        });
        await writeUnplannedAudit({
          action: "VENDOR_UNPLANNED_NEED_MORE_SPACE",
          vendorId: session.vendorId,
          vendorName: session.vendorName,
          deliveryId,
          reference,
          details: { spaceTier },
        });
      }
    }

    await writeUnplannedAudit({
      action: "VENDOR_UNPLANNED_MATCH_CONFIRMED",
      vendorId: session.vendorId,
      vendorName: session.vendorName,
      deliveryId,
      reference,
    });

    const payload = await buildUnplannedSuccessPayload({
      deliveryId,
      vendorId: session.vendorId,
      vendorName: session.vendorName,
      session,
    });

    return {
      ...payload,
      needMoreSpace,
      ...(assignedCode ? { stagingLocationCode: assignedCode } : {}),
    };
  },
);

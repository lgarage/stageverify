import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { PhysicalLocation } from "./customerModels";
import { stripUndefined } from "./firestoreSerialize";
import { getDb, requireOperatorAuth } from "./operatorAuth";
import {
  CONSOLE_ACTIVITY_EVENTS_COLLECTION,
  CONSOLE_CUSTOMERS_COLLECTION,
  CONSOLE_LOCATIONS_COLLECTION,
  OPERATOR_CALLABLE_CORS,
} from "./operatorCollections";
import { buildActivityEvent } from "./operatorMutationCore";
import {
  mintOperationId,
  readIdempotentResult,
  writeOperationMarker,
} from "./operatorIdempotency";
import {
  parseOnboardingStatus,
  resolveClientOperationId,
} from "./operatorValidation";
import { transitionOnboarding } from "./onboardingTransitions";

export const transitionLocationOnboarding = onCall(
  {
    region: "us-central1",
    cors: OPERATOR_CALLABLE_CORS,
  },
  async (request) => {
    const actorUid = await requireOperatorAuth(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const operationId = mintOperationId(data.clientOperationId);
    const locationId =
      typeof data.locationId === "string" ? data.locationId.trim() : "";
    if (!locationId) {
      throw new HttpsError("invalid-argument", "locationId is required.");
    }
    const to = parseOnboardingStatus(data.to);

    const db = getDb();
    const existing = await readIdempotentResult<PhysicalLocation>(
      db,
      operationId,
    );
    if (existing) {
      return existing;
    }

    const locationRef = db
      .collection(CONSOLE_LOCATIONS_COLLECTION)
      .doc(locationId);
    const locationSnap = await locationRef.get();
    if (!locationSnap.exists) {
      throw new HttpsError("not-found", "Location not found.");
    }

    const current = locationSnap.data() as PhysicalLocation;
    let next: PhysicalLocation;
    try {
      next = transitionOnboarding(current, to, new Date().toISOString());
    } catch (err) {
      throw new HttpsError(
        "failed-precondition",
        err instanceof Error ? err.message : "Illegal onboarding transition.",
      );
    }

    const nowIso = next.updatedAt;
    const event = buildActivityEvent(
      {
        customerId: current.customerId,
        locationId,
        type: "onboarding.transition",
        message: `Location "${current.locationName}" onboarding ${current.onboardingStatus} → ${to}.`,
        actorUid,
      },
      nowIso,
    );

    const customerRef = db
      .collection(CONSOLE_CUSTOMERS_COLLECTION)
      .doc(current.customerId);

    await db.runTransaction(async (tx) => {
      const opRef = db.collection("operatorOperations").doc(operationId);
      const opSnap = await tx.get(opRef);
      if (opSnap.exists) return;

      tx.set(locationRef, next);
      tx.update(customerRef, { updatedAt: nowIso });
      tx.set(
        db.collection(CONSOLE_ACTIVITY_EVENTS_COLLECTION).doc(event.eventId),
        stripUndefined(event as unknown as Record<string, unknown>),
      );
      writeOperationMarker(tx, db, {
        operationId,
        operationType: "transitionLocationOnboarding",
        actorUid,
        result: next,
        nowIso,
      });
    });

    const replay = await readIdempotentResult<PhysicalLocation>(db, operationId);
    return replay ?? next;
  },
);

export { resolveClientOperationId };

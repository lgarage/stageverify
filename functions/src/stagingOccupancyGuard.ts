/**
 * Shared staging location occupancy checks — extracted from reassignDeliveryStagingLocation.
 */
import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";

/** Page size for occupancy scans — keep paging while a page is full. */
export const OCCUPANCY_PAGE_SIZE = 20;
/** Max pages per occupancy scan (500 docs ≈ Firestore tx read ceiling). */
export const OCCUPANCY_MAX_PAGES = 25;

export const ZONE_CLEARED = new Set(["complete", "picked_up", "installed"]);

export function isLocationDocActive(data: admin.firestore.DocumentData): boolean {
  if (typeof data.status === "string") {
    return data.status === "Active";
  }
  return data.active === true;
}

export function deliveryOccupiesDestination(
  data: admin.firestore.DocumentData | undefined,
): boolean {
  if (!data) return false;
  if (ZONE_CLEARED.has(String(data.status ?? ""))) return false;
  return true;
}

export function throwOccupied(): never {
  throw new HttpsError(
    "failed-precondition",
    "That location is no longer available.",
  );
}

export async function assertNoActiveOccupantInQuery(
  tx: admin.firestore.Transaction,
  baseQuery: admin.firestore.Query,
  deliveryId: string,
): Promise<void> {
  // Firestore transactions require all reads before writes; page with cursors
  // so cleared/stale docs cannot hide an active occupant behind a small limit.
  let last: admin.firestore.QueryDocumentSnapshot | undefined;
  let pageCount = 0;
  for (;;) {
    let q: admin.firestore.Query = baseQuery.limit(OCCUPANCY_PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await tx.get(q);
    pageCount += 1;
    if (snap.empty) return;
    for (const docSnap of snap.docs) {
      if (docSnap.id === deliveryId) continue;
      if (deliveryOccupiesDestination(docSnap.data())) {
        throwOccupied();
      }
    }
    if (snap.size < OCCUPANCY_PAGE_SIZE) return;
    if (pageCount >= OCCUPANCY_MAX_PAGES && snap.size === OCCUPANCY_PAGE_SIZE) {
      const lastDoc = snap.docs[snap.docs.length - 1];
      const probeSnap = await tx.get(baseQuery.limit(1).startAfter(lastDoc));
      if (!probeSnap.empty) {
        throw new HttpsError(
          "failed-precondition",
          "Occupancy lookup exceeded safety cap.",
        );
      }
      return;
    }
    last = snap.docs[snap.docs.length - 1];
  }
}

export async function assertStagingLocationAvailableInTransaction(
  tx: admin.firestore.Transaction,
  db: admin.firestore.Firestore,
  locationId: string,
  excludeDeliveryId: string,
): Promise<{ code: string }> {
  const locRef = db.collection("stagingLocations").doc(locationId);
  const locSnap = await tx.get(locRef);
  if (!locSnap.exists) {
    throw new HttpsError("not-found", "Staging location not found.");
  }
  const locData = locSnap.data() as admin.firestore.DocumentData;
  if (!isLocationDocActive(locData)) {
    throw new HttpsError(
      "failed-precondition",
      "That location is no longer available.",
    );
  }
  const code = String(locData.code ?? "").trim() || locationId;

  await assertNoActiveOccupantInQuery(
    tx,
    db.collection("deliveries").where("stagingLocationId", "==", locationId),
    excludeDeliveryId,
  );
  await assertNoActiveOccupantInQuery(
    tx,
    db
      .collection("deliveries")
      .where("additionalStagingLocationIds", "array-contains", locationId),
    excludeDeliveryId,
  );
  await assertNoActiveOccupantInQuery(
    tx,
    db
      .collection("deliveries")
      .where("plannedStagingLocationIds", "array-contains", locationId),
    excludeDeliveryId,
  );

  return { code };
}

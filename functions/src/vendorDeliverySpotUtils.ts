import * as admin from "firebase-admin";
import {
  RECEIVE_BLOCKED_DELIVERY_STATUSES,
  ZONE_CLEARED_DELIVERY_STATUSES,
  getAllStagingLocationIds,
} from "./deliveryDetailsResponse";

export function hasAssignableSpot(
  delivery: admin.firestore.DocumentData,
): boolean {
  if (
    typeof delivery.stagingLocationId === "string" &&
    delivery.stagingLocationId.trim()
  ) {
    return true;
  }
  const planned = delivery.plannedStagingLocationIds;
  if (Array.isArray(planned)) {
    return planned.some(
      (id) => typeof id === "string" && id.trim().length > 0,
    );
  }
  return false;
}

export function isActiveVendorDelivery(
  delivery: admin.firestore.DocumentData,
): boolean {
  const status = String(delivery.status ?? "");
  if (ZONE_CLEARED_DELIVERY_STATUSES.has(status as never)) return false;
  if (RECEIVE_BLOCKED_DELIVERY_STATUSES.has(status as never)) return false;
  return true;
}

export function collectLocationIds(
  delivery: admin.firestore.DocumentData,
): string[] {
  const ids = getAllStagingLocationIds(delivery);
  const planned = delivery.plannedStagingLocationIds;
  if (Array.isArray(planned)) {
    for (const id of planned) {
      if (typeof id === "string" && id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

export async function resolveLocationCodes(
  db: admin.firestore.Firestore,
  locationIds: string[],
): Promise<string[]> {
  if (locationIds.length === 0) return [];
  const codes: string[] = [];
  for (const id of locationIds) {
    const snap = await db.collection("stagingLocations").doc(id).get();
    if (snap.exists) {
      const code = snap.data()?.code;
      if (typeof code === "string" && code.trim()) {
        codes.push(code.trim());
      }
    }
  }
  return codes;
}

/** Batch-fetch staging location codes by id (additive helper for parallel enrichment). */
export async function resolveLocationCodesById(
  db: admin.firestore.Firestore,
  ids: string[],
): Promise<Map<string, string>> {
  const uniqueIds = [
    ...new Set(
      ids.filter((id) => typeof id === "string" && id.trim().length > 0),
    ),
  ];
  const map = new Map<string, string>();
  if (uniqueIds.length === 0) return map;

  const refs = uniqueIds.map((id) =>
    db.collection("stagingLocations").doc(id),
  );
  const snaps = await db.getAll(...refs);
  for (const snap of snaps) {
    if (snap.exists) {
      const code = snap.data()?.code;
      if (typeof code === "string" && code.trim()) {
        map.set(snap.id, code.trim());
      }
    }
  }
  return map;
}

/** Resolve ordered codes from a pre-fetched id→code map (same filter as resolveLocationCodes). */
export function locationCodesFromMap(
  locationIds: string[],
  codeById: Map<string, string>,
): string[] {
  const codes: string[] = [];
  for (const id of locationIds) {
    const code = codeById.get(id);
    if (code) codes.push(code);
  }
  return codes;
}

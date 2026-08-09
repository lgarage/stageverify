/**
 * Active shop-staging release when CURRENT fulfillment becomes Will-Call.
 * Occupancy is derived from delivery refs — clearing these frees the spot.
 * Audit: append plannedLocationReleases (do not truncate history).
 */
import type { DeliveryOrder, PlannedLocationRelease } from "./models";

export const WILL_CALL_STAGING_RELEASE_REASON =
  "fulfillment_switched_to_will_call" as const;

export type WillCallStagingClearSource = Pick<
  DeliveryOrder,
  | "plannedStagingLocationIds"
  | "stagingLocationId"
  | "additionalStagingLocationIds"
  | "combinationStagingGroupId"
  | "combinationMemberLocationIds"
>;

export type WillCallStagingClearPatch = {
  /** Fields safe for setDoc/update merge (empty arrays/strings). */
  fields: {
    plannedStagingLocationIds: [];
    stagingLocationId: "";
    additionalStagingLocationIds: [];
    combinationStagingGroupId: "";
    combinationMemberLocationIds: [];
  };
  /** Append-only audit rows for each previously planned id. */
  releaseEntries: PlannedLocationRelease[];
};

function nonEmptyIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return ids.filter(
    (id): id is string => typeof id === "string" && id.trim().length > 0,
  );
}

/**
 * Build the active-staging clear payload for a will-call transition.
 * Idempotent when already empty. Does not touch scannedStagingLocationId,
 * shop-stock fields, or prior plannedLocationReleases history.
 */
export function buildWillCallActiveStagingClearPatch(
  existing: WillCallStagingClearSource,
  opts: { releasedBy: string; releasedAt: string },
): WillCallStagingClearPatch {
  const plannedIds = nonEmptyIds(existing.plannedStagingLocationIds);
  const releaseEntries: PlannedLocationRelease[] = plannedIds.map(
    (locationId) => ({
      locationId,
      releasedAt: opts.releasedAt,
      releasedBy: opts.releasedBy,
      reason: WILL_CALL_STAGING_RELEASE_REASON,
    }),
  );

  return {
    fields: {
      plannedStagingLocationIds: [],
      stagingLocationId: "",
      additionalStagingLocationIds: [],
      combinationStagingGroupId: "",
      combinationMemberLocationIds: [],
    },
    releaseEntries,
  };
}

/** True when any active shop-staging ref remains on the delivery. */
export function deliveryHasActiveShopStaging(
  existing: WillCallStagingClearSource,
): boolean {
  if (nonEmptyIds(existing.plannedStagingLocationIds).length > 0) return true;
  if ((existing.stagingLocationId ?? "").trim()) return true;
  if (nonEmptyIds(existing.additionalStagingLocationIds).length > 0) return true;
  if ((existing.combinationStagingGroupId ?? "").trim()) return true;
  if (nonEmptyIds(existing.combinationMemberLocationIds).length > 0) return true;
  return false;
}

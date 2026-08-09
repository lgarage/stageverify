/**
 * Active shop-staging release when CURRENT fulfillment becomes Will-Call.
 * Mirrors src/dispatcher/willCallStagingRelease.ts (CF copy — no shared package).
 */
export const WILL_CALL_STAGING_RELEASE_REASON =
  "fulfillment_switched_to_will_call" as const;

export type WillCallStagingClearSource = {
  plannedStagingLocationIds?: unknown;
  stagingLocationId?: unknown;
  additionalStagingLocationIds?: unknown;
  combinationStagingGroupId?: unknown;
  combinationMemberLocationIds?: unknown;
};

export type PlannedLocationReleaseEntry = {
  locationId: string;
  releasedAt: string;
  releasedBy: string;
  reason: typeof WILL_CALL_STAGING_RELEASE_REASON;
};

export type WillCallStagingClearPatch = {
  fields: {
    plannedStagingLocationIds: [];
    stagingLocationId: "";
    additionalStagingLocationIds: [];
    combinationStagingGroupId: "";
    combinationMemberLocationIds: [];
  };
  releaseEntries: PlannedLocationReleaseEntry[];
};

function nonEmptyIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return ids.filter(
    (id): id is string => typeof id === "string" && id.trim().length > 0,
  );
}

export function buildWillCallActiveStagingClearPatch(
  existing: WillCallStagingClearSource,
  opts: { releasedBy: string; releasedAt: string },
): WillCallStagingClearPatch {
  const plannedIds = nonEmptyIds(existing.plannedStagingLocationIds);
  const releaseEntries: PlannedLocationReleaseEntry[] = plannedIds.map(
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

export function deliveryHasActiveShopStaging(
  existing: WillCallStagingClearSource,
): boolean {
  if (nonEmptyIds(existing.plannedStagingLocationIds).length > 0) return true;
  if (
    typeof existing.stagingLocationId === "string" &&
    existing.stagingLocationId.trim()
  ) {
    return true;
  }
  if (nonEmptyIds(existing.additionalStagingLocationIds).length > 0) return true;
  if (
    typeof existing.combinationStagingGroupId === "string" &&
    existing.combinationStagingGroupId.trim()
  ) {
    return true;
  }
  if (nonEmptyIds(existing.combinationMemberLocationIds).length > 0) return true;
  return false;
}

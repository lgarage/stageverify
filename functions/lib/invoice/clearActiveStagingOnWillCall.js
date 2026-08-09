"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WILL_CALL_STAGING_RELEASE_REASON = void 0;
exports.buildWillCallActiveStagingClearPatch = buildWillCallActiveStagingClearPatch;
exports.deliveryHasActiveShopStaging = deliveryHasActiveShopStaging;
/**
 * Active shop-staging release when CURRENT fulfillment becomes Will-Call.
 * Mirrors src/dispatcher/willCallStagingRelease.ts (CF copy — no shared package).
 */
exports.WILL_CALL_STAGING_RELEASE_REASON = "fulfillment_switched_to_will_call";
function nonEmptyIds(ids) {
    if (!Array.isArray(ids))
        return [];
    return ids.filter((id) => typeof id === "string" && id.trim().length > 0);
}
function buildWillCallActiveStagingClearPatch(existing, opts) {
    const plannedIds = nonEmptyIds(existing.plannedStagingLocationIds);
    const releaseEntries = plannedIds.map((locationId) => ({
        locationId,
        releasedAt: opts.releasedAt,
        releasedBy: opts.releasedBy,
        reason: exports.WILL_CALL_STAGING_RELEASE_REASON,
    }));
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
function deliveryHasActiveShopStaging(existing) {
    if (nonEmptyIds(existing.plannedStagingLocationIds).length > 0)
        return true;
    if (typeof existing.stagingLocationId === "string" &&
        existing.stagingLocationId.trim()) {
        return true;
    }
    if (nonEmptyIds(existing.additionalStagingLocationIds).length > 0)
        return true;
    if (typeof existing.combinationStagingGroupId === "string" &&
        existing.combinationStagingGroupId.trim()) {
        return true;
    }
    if (nonEmptyIds(existing.combinationMemberLocationIds).length > 0)
        return true;
    return false;
}
//# sourceMappingURL=clearActiveStagingOnWillCall.js.map
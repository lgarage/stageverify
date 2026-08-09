"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WILL_CALL_STAGING_RELEASE_REASON = void 0;
exports.buildWillCallActiveStagingClearPatch = buildWillCallActiveStagingClearPatch;
exports.deliveryHasActiveShopStaging = deliveryHasActiveShopStaging;
exports.effectiveFulfillmentAfterPatch = effectiveFulfillmentAfterPatch;
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
/**
 * Merge patch + existing to decide CURRENT fulfillment after an approve/create_shell write.
 * Used so Will-Call staging clear never wipes Drop-Off staging when D-79 preserveOps wins.
 */
function effectiveFulfillmentAfterPatch(existing, patch) {
    const base = existing ?? {};
    return {
        id: typeof base.id === "string" ? base.id : undefined,
        vendorInvoiceImportId: typeof patch.vendorInvoiceImportId === "string"
            ? patch.vendorInvoiceImportId
            : typeof base.vendorInvoiceImportId === "string"
                ? base.vendorInvoiceImportId
                : undefined,
        createdFromInvoiceImport: base.createdFromInvoiceImport === true ||
            patch.createdFromInvoiceImport === true,
        invoiceFulfillmentMethod: typeof patch.invoiceFulfillmentMethod === "string"
            ? patch.invoiceFulfillmentMethod
            : typeof base.invoiceFulfillmentMethod === "string"
                ? base.invoiceFulfillmentMethod
                : undefined,
        invoiceImportStatus: typeof patch.invoiceImportStatus === "string"
            ? patch.invoiceImportStatus
            : typeof base.invoiceImportStatus === "string"
                ? base.invoiceImportStatus
                : undefined,
        invoiceDeliverToSite: patch.invoiceDeliverToSite === true || base.invoiceDeliverToSite === true
            ? true
            : undefined,
    };
}
//# sourceMappingURL=clearActiveStagingOnWillCall.js.map
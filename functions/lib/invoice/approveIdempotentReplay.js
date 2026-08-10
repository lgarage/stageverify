"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveApproveIdempotentReplay = resolveApproveIdempotentReplay;
/**
 * Idempotent approve replay — shared pre-tx and in-tx paths.
 */
const https_1 = require("firebase-functions/v2/https");
const invoiceShellDisplayHelpers_1 = require("./invoiceShellDisplayHelpers");
const createDeliveryShellFromImport_1 = require("./createDeliveryShellFromImport");
function plannedSet(ids) {
    return new Set(ids.filter((id) => id.trim().length > 0));
}
function setsEqual(a, b) {
    if (a.size !== b.size)
        return false;
    for (const id of a) {
        if (!b.has(id))
            return false;
    }
    return true;
}
function livePlannedIds(live) {
    if (!Array.isArray(live.plannedStagingLocationIds))
        return [];
    return live.plannedStagingLocationIds.filter((id) => typeof id === "string" && id.trim().length > 0);
}
function replayStagingSkipped(importDoc, live) {
    const fulfillment = typeof live.invoiceFulfillmentMethod === "string"
        ? live.invoiceFulfillmentMethod
        : undefined;
    return (0, invoiceShellDisplayHelpers_1.isInvoiceShellNoShopStaging)({
        createdFromInvoiceImport: live.createdFromInvoiceImport === true,
        invoiceImportStatus: typeof live.invoiceImportStatus === "string"
            ? live.invoiceImportStatus
            : importDoc.importStatus,
        invoiceFulfillmentMethod: fulfillment,
        invoiceDeliverToSite: live.invoiceDeliverToSite === true,
    });
}
/**
 * When reviewStatus is already approved, validate retry params and return replay
 * payload without writes — or throw failed-precondition on mismatch.
 */
function resolveApproveIdempotentReplay(input) {
    const linkedId = input.importDoc.linkedDeliveryOrderId?.trim() ?? "";
    const shellId = (0, createDeliveryShellFromImport_1.shellDeliveryIdForImport)(input.importId);
    if (!linkedId) {
        throw new https_1.HttpsError("failed-precondition", "Import already approved.");
    }
    if (input.clientDeliveryOrderId &&
        input.clientDeliveryOrderId !== linkedId) {
        throw new https_1.HttpsError("failed-precondition", "Import was concurrently approved to a different delivery — reload and retry.");
    }
    if (!input.deliveryExists || !input.liveDelivery) {
        throw new https_1.HttpsError("failed-precondition", "Matched delivery no longer exists. Refresh and try again.");
    }
    const live = input.liveDelivery;
    const liveFulfillment = typeof live.invoiceFulfillmentMethod === "string"
        ? live.invoiceFulfillmentMethod
        : undefined;
    if (input.fulfillmentDecision !== undefined &&
        liveFulfillment &&
        (liveFulfillment === "delivery" || liveFulfillment === "will_call_pickup") &&
        liveFulfillment !== input.fulfillmentDecision) {
        throw new https_1.HttpsError("failed-precondition", "Import was already approved with a different fulfillment decision — reload and retry.");
    }
    const stagingSkipped = replayStagingSkipped(input.importDoc, live);
    if (!stagingSkipped && input.requestedPlannedIds.length > 0) {
        const requested = plannedSet(input.requestedPlannedIds);
        const liveSet = plannedSet(livePlannedIds(live));
        if (!setsEqual(requested, liveSet)) {
            throw new https_1.HttpsError("failed-precondition", "Import was already approved with different staging locations — reload and retry.");
        }
    }
    const appliedPlanned = stagingSkipped ? [] : livePlannedIds(live);
    return {
        vendorInvoiceImportId: input.importId,
        reviewStatus: "approved",
        deliveryOrderId: linkedId,
        itemsApplied: 0,
        shellCreated: false,
        deliveryMatched: linkedId !== shellId,
        plannedStagingLocationIds: appliedPlanned,
        idempotentReplay: true,
        trainingLessonWrote: false,
        trainingLessonPendingAdminReview: false,
        trainingLessonAlertEmailed: false,
    };
}
//# sourceMappingURL=approveIdempotentReplay.js.map
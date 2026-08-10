/**
 * Idempotent approve replay — shared pre-tx and in-tx paths.
 */
import { HttpsError } from "firebase-functions/v2/https";
import type { VendorInvoiceImportDoc } from "../inboundEmail/types";
import { isInvoiceShellNoShopStaging } from "./invoiceShellDisplayHelpers";
import { shellDeliveryIdForImport } from "./createDeliveryShellFromImport";

export type ApproveFulfillmentDecision = "delivery" | "will_call_pickup";

export interface ApproveIdempotentReplayInput {
  importId: string;
  importDoc: VendorInvoiceImportDoc;
  clientDeliveryOrderId: string;
  fulfillmentDecision?: ApproveFulfillmentDecision;
  requestedPlannedIds: string[];
  liveDelivery: Record<string, unknown> | null;
  deliveryExists: boolean;
}

export interface ApproveIdempotentReplaySuccess {
  vendorInvoiceImportId: string;
  reviewStatus: "approved";
  deliveryOrderId: string;
  itemsApplied: 0;
  shellCreated: false;
  deliveryMatched: boolean;
  plannedStagingLocationIds: string[];
  idempotentReplay: true;
  trainingLessonWrote: false;
  trainingLessonPendingAdminReview: false;
  trainingLessonAlertEmailed: false;
}

function plannedSet(ids: string[]): Set<string> {
  return new Set(ids.filter((id) => id.trim().length > 0));
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

function livePlannedIds(live: Record<string, unknown>): string[] {
  if (!Array.isArray(live.plannedStagingLocationIds)) return [];
  return live.plannedStagingLocationIds.filter(
    (id): id is string => typeof id === "string" && id.trim().length > 0,
  );
}

function replayStagingSkipped(
  importDoc: VendorInvoiceImportDoc,
  live: Record<string, unknown>,
): boolean {
  const fulfillment =
    typeof live.invoiceFulfillmentMethod === "string"
      ? live.invoiceFulfillmentMethod
      : undefined;
  return isInvoiceShellNoShopStaging({
    createdFromInvoiceImport: live.createdFromInvoiceImport === true,
    invoiceImportStatus:
      typeof live.invoiceImportStatus === "string"
        ? live.invoiceImportStatus
        : importDoc.importStatus,
    invoiceFulfillmentMethod: fulfillment as
      | "delivery"
      | "will_call_pickup"
      | "unknown"
      | undefined,
    invoiceDeliverToSite: live.invoiceDeliverToSite === true,
  });
}

/**
 * When reviewStatus is already approved, validate retry params and return replay
 * payload without writes — or throw failed-precondition on mismatch.
 */
export function resolveApproveIdempotentReplay(
  input: ApproveIdempotentReplayInput,
): ApproveIdempotentReplaySuccess {
  const linkedId = input.importDoc.linkedDeliveryOrderId?.trim() ?? "";
  const shellId = shellDeliveryIdForImport(input.importId);

  if (!linkedId) {
    throw new HttpsError("failed-precondition", "Import already approved.");
  }

  if (
    input.clientDeliveryOrderId &&
    input.clientDeliveryOrderId !== linkedId
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Import was concurrently approved to a different delivery — reload and retry.",
    );
  }

  if (!input.deliveryExists || !input.liveDelivery) {
    throw new HttpsError(
      "failed-precondition",
      "Matched delivery no longer exists. Refresh and try again.",
    );
  }

  const live = input.liveDelivery;
  const liveFulfillment =
    typeof live.invoiceFulfillmentMethod === "string"
      ? live.invoiceFulfillmentMethod
      : undefined;

  if (
    input.fulfillmentDecision !== undefined &&
    liveFulfillment &&
    (liveFulfillment === "delivery" || liveFulfillment === "will_call_pickup") &&
    liveFulfillment !== input.fulfillmentDecision
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Import was already approved with a different fulfillment decision — reload and retry.",
    );
  }

  const stagingSkipped = replayStagingSkipped(input.importDoc, live);
  if (!stagingSkipped && input.requestedPlannedIds.length > 0) {
    const requested = plannedSet(input.requestedPlannedIds);
    const liveSet = plannedSet(livePlannedIds(live));
    if (!setsEqual(requested, liveSet)) {
      throw new HttpsError(
        "failed-precondition",
        "Import was already approved with different staging locations — reload and retry.",
      );
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

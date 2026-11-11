/**
 * Jobless unplanned (walk-in) delivery eligibility — dispatcher-only pickup/clear.
 * Mirrors functions/src/unplannedWillCallEligibility.ts.
 */

export type JoblessUnplannedDeliveryFields = {
  unplanned?: boolean;
  jobId?: string;
  status?: string;
};

export function hasAssignedJobId(delivery: { jobId?: string }): boolean {
  return String(delivery.jobId ?? "").trim().length > 0;
}

/** Vendor unplanned shell with no dispatcher job/PO match yet. */
export function isJoblessUnplannedDelivery(
  delivery: JoblessUnplannedDeliveryFields,
): boolean {
  return delivery.unplanned === true && !hasAssignedJobId(delivery);
}

export function isPickupLockedStatus(status: string | undefined): boolean {
  return status === "picked_up" || status === "installed";
}

export function isCancelledStatus(status: string | undefined): boolean {
  return status === "cancelled";
}

export function isJoblessUnplannedPickupEligible(
  delivery: JoblessUnplannedDeliveryFields,
): boolean {
  if (!isJoblessUnplannedDelivery(delivery)) return false;
  if (isPickupLockedStatus(delivery.status)) return false;
  if (isCancelledStatus(delivery.status)) return false;
  return true;
}

export function isJoblessUnplannedClearEligible(
  delivery: JoblessUnplannedDeliveryFields,
): boolean {
  return isJoblessUnplannedPickupEligible(delivery);
}

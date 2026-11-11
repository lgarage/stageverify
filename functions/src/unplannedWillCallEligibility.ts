/**
 * Jobless unplanned (walk-in) delivery eligibility — dispatcher-only pickup/clear.
 * Do not fabricate a jobId. Technician / pickup-token doors stay job-linked.
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

/** Occupancy / receive must treat these as finished — spot is free. */
export function isOccupancyClearedStatus(status: string | undefined): boolean {
  return (
    status === "complete" ||
    status === "picked_up" ||
    status === "installed" ||
    status === "cancelled"
  );
}

import type { DeliveryStatus } from "../deliveryReadiness";

/** Map import-domain status to delivery workflow status — never sets ready_for_pickup/staging. */
export function deliveryStatusFromImportStatus(importStatus: string): DeliveryStatus {
  switch (importStatus) {
    case "closed_picked_up":
      return "picked_up";
    case "pickup_at_vendor":
      return "complete";
    case "partial":
      return "partial";
    case "issue":
      return "issue";
    case "ready_for_pickup":
      return "complete";
    case "pending":
    default:
      return "pending";
  }
}

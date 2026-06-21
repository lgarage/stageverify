import type { DeliveryOrder, Item } from "../models";
import type { ParsedEmailContent } from "./types";

/** Returns conflict reason when auto-apply must not proceed; null when safe. */
export function hasVendorOrderCompleteApplyConflict(
  delivery: Pick<
    DeliveryOrder,
    "vendorPhysicalDropoffConfirmed" | "vendorOrderComplete" | "vendorOrderCompleteSource"
  >,
  items: Item[],
  parsed: ParsedEmailContent,
): string | null {
  if (items.some((item) => item.qtyBackordered > 0)) {
    return "unresolved_backorder_on_items";
  }
  if (items.some((item) => item.qtyDamaged > 0)) {
    return "unresolved_damage_on_items";
  }
  if (items.some((item) => item.qtyMissing > 0)) {
    return "unresolved_missing_on_items";
  }

  if (
    parsed.classification === "backordered" ||
    parsed.classification === "partially_backordered" ||
    parsed.classification === "partially_shipped" ||
    parsed.classification === "partially_delivered"
  ) {
    return "partial_or_backorder_classification";
  }

  if (delivery.vendorPhysicalDropoffConfirmed === true) {
    const outstanding = items.some(
      (item) =>
        item.qtyReceived < item.qtyOrdered ||
        item.qtyBackordered > 0 ||
        item.qtyMissing > 0,
    );
    if (outstanding && parsed.vendorOrderCompleteClaim) {
      return "conflicting_physical_evidence";
    }
  }

  if (
    delivery.vendorOrderComplete === true &&
    delivery.vendorOrderCompleteSource &&
    delivery.vendorOrderCompleteSource !== "vendor_email"
  ) {
    return "existing_vendor_order_complete_from_other_source";
  }

  return null;
}

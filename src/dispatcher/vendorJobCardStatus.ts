/**
 * Vendor mobile order-fulfillment display.
 *
 * Mirrors dispatcher `deliveryReadinessDisplayLabel` Partial rule
 * (`received > 0 && received < ordered`) plus authoritative backordered lines
 * (`qtyBackordered > 0` / item status `backordered`).
 *
 * Physical drop-off (`vendorPhysicalDropoffConfirmed`) is a separate fact.
 * This helper never treats drop-off confirmation as full order completion
 * when fulfillment quantities are present.
 *
 * Does not change readiness / readyForPickup / sort semantics.
 */

export type VendorOrderFulfillmentLabel =
  | "Delivered"
  | "Partial"
  | "Incomplete";

export type VendorItemLineStatus =
  | "Backordered"
  | "Not Delivered"
  | "Partial Delivery"
  | "Delivered";

export interface VendorFulfillmentItemInput {
  id?: string;
  description?: string;
  qtyOrdered?: number | null;
  qtyReceived?: number | null;
  qtyBackordered?: number | null;
  status?: string | null;
}

export function vendorItemsHaveFulfillmentQty(
  items: readonly VendorFulfillmentItemInput[] | undefined,
): boolean {
  if (!items || items.length === 0) return false;
  return items.some((item) => typeof item.qtyReceived === "number");
}

function asQty(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function itemHasBackorder(item: VendorFulfillmentItemInput): boolean {
  if (asQty(item.qtyBackordered) > 0) return true;
  return String(item.status ?? "").toLowerCase() === "backordered";
}

/**
 * Authoritative vendor card fulfillment label.
 *
 * When line quantities are present, uses the same Partial math as dispatcher
 * list/drawer status. When quantities are absent (legacy DTO), falls back to
 * persisted `delivery.status === "partial"`, then legacy physical-dropoff
 * Delivered so existing mocks keep working.
 */
export function deriveVendorOrderFulfillmentLabel(input: {
  items?: readonly VendorFulfillmentItemInput[];
  deliveryStatus?: string | null;
  vendorPhysicalDropoffConfirmed?: boolean | null;
}): VendorOrderFulfillmentLabel {
  const items = input.items ?? [];
  if (vendorItemsHaveFulfillmentQty(items)) {
    const ordered = items.reduce((sum, item) => sum + asQty(item.qtyOrdered), 0);
    const received = items.reduce(
      (sum, item) => sum + asQty(item.qtyReceived),
      0,
    );
    const hasBackorder = items.some(itemHasBackorder);
    if (hasBackorder || (received > 0 && received < ordered)) {
      return "Partial";
    }
    if (received > 0 && received >= ordered) {
      return "Delivered";
    }
    return "Incomplete";
  }

  if (String(input.deliveryStatus ?? "").toLowerCase() === "partial") {
    return "Partial";
  }
  if (input.vendorPhysicalDropoffConfirmed === true) {
    return "Delivered";
  }
  return "Incomplete";
}

/** Mirrors dispatcher `deriveItemIssueDisplayStatus` for vendor line badges. */
export function deriveVendorItemLineStatus(
  item: VendorFulfillmentItemInput,
): VendorItemLineStatus | null {
  if (itemHasBackorder(item)) {
    return "Backordered";
  }
  if (typeof item.qtyReceived !== "number") {
    const status = String(item.status ?? "").toLowerCase();
    if (status === "received") return "Delivered";
    if (status === "partial") return "Partial Delivery";
    if (status === "missing" || status === "pending") return "Not Delivered";
    return null;
  }
  const qtyReceived = asQty(item.qtyReceived);
  const qtyOrdered = asQty(item.qtyOrdered);
  if (qtyReceived > 0 && qtyReceived >= qtyOrdered) {
    return "Delivered";
  }
  if (qtyReceived === 0) {
    return "Not Delivered";
  }
  if (qtyReceived > 0 && qtyReceived < qtyOrdered) {
    return "Partial Delivery";
  }
  return null;
}

export function vendorFulfillmentTone(
  label: VendorOrderFulfillmentLabel,
): "delivered" | "partial" | "incomplete" {
  if (label === "Delivered") return "delivered";
  if (label === "Partial") return "partial";
  return "incomplete";
}

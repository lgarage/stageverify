import type { VendorInvoiceImportStatus } from "./types";

/** Dispatcher-facing labels — never show raw import enum in UI (spec §7). */
export const VENDOR_INVOICE_IMPORT_STATUS_LABEL: Record<VendorInvoiceImportStatus, string> = {
  pending: "Pending Delivery",
  partial: "Partial",
  ready_for_pickup: "Ready for Pickup",
  pickup_at_vendor: "Will-Call / Pickup.",
  closed_picked_up: "Closed / Picked Up.",
  issue: "Issue / Action Needed",
};

export function vendorInvoiceImportDisplayLabel(status: VendorInvoiceImportStatus): string {
  return VENDOR_INVOICE_IMPORT_STATUS_LABEL[status];
}

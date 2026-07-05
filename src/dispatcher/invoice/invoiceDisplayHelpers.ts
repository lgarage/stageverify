import type { VendorInvoiceImportStatus } from "./types";

function deliverToSiteLabelFromNotes(orderNotes: readonly string[]): string | undefined {
  for (const note of orderNotes) {
    const match = note.match(/DELIVER\s+TO\s*:\s*(.+)/i);
    const label = match?.[1]?.trim();
    if (label) return label;
  }
  return undefined;
}

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

/** Import modal label — pending + DELIVER TO notes reads as site delivery, not shop drop-off. */
export function vendorInvoiceImportDisplayLabelForRow(
  status: VendorInvoiceImportStatus,
  orderNotes?: readonly string[],
): string {
  if (status === "pending" && deliverToSiteLabelFromNotes(orderNotes ?? [])) {
    return "Deliver to Site";
  }
  return vendorInvoiceImportDisplayLabel(status);
}

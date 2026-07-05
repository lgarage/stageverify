import type { InvoiceFulfillmentMethod } from "./types";

type ShellDeliveryStatus =
  | "pending"
  | "shipped"
  | "arrived"
  | "partial"
  | "ready_for_pickup"
  | "complete"
  | "issue"
  | "picked_up"
  | "installed";

export type InvoiceShellStagingFields = {
  id?: string;
  vendorInvoiceImportId?: string;
  invoiceImportStatus?: string;
  invoiceFulfillmentMethod?: InvoiceFulfillmentMethod;
  invoiceDeliverToSite?: boolean;
  createdFromInvoiceImport?: boolean;
  status?: ShellDeliveryStatus;
};

const SHELL_DELIVERY_ID_PREFIX = "delivery-vii-";

function isVerifiedInvoiceShell(delivery: InvoiceShellStagingFields): boolean {
  if (delivery.createdFromInvoiceImport === true) return true;
  const id = delivery.id?.trim();
  if (id?.startsWith(SHELL_DELIVERY_ID_PREFIX)) return true;
  const importId = delivery.vendorInvoiceImportId?.trim();
  if (importId && id === `${SHELL_DELIVERY_ID_PREFIX}${importId}`) return true;
  return false;
}

/** Extract job-site destination from parsed order notes (e.g. DELIVER TO: Planet Fitness Hartford). */
export function extractDeliverToSiteLabel(
  orderNotes: readonly string[],
): string | undefined {
  for (const note of orderNotes) {
    const match = note.match(/DELIVER\s+TO\s*:\s*(.+)/i);
    const label = match?.[1]?.trim();
    if (label) return label;
  }
  return undefined;
}

function titleCaseWords(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function jobNameFromInvoicePo(customerPoOrReference: string): string {
  return titleCaseWords(customerPoOrReference);
}

/** Prefer DELIVER TO / ship-to over raw customer P/O tokens for auto-created jobs. */
export function jobNameFromInvoiceContext(
  customerPoOrReference: string,
  orderNotes: readonly string[],
  shipToName?: string,
): string {
  const deliverTo = extractDeliverToSiteLabel(orderNotes);
  if (deliverTo) return titleCaseWords(deliverTo);

  const shipTo = shipToName?.trim();
  if (shipTo) return titleCaseWords(shipTo);

  return jobNameFromInvoicePo(customerPoOrReference);
}

/** Invoice shells that never receive material at the shop — no staging zone assignment. */
export function isInvoiceShellNoShopStaging(
  delivery: InvoiceShellStagingFields,
): boolean {
  if (!isVerifiedInvoiceShell(delivery)) return false;
  if (delivery.invoiceImportStatus === "pickup_at_vendor") return true;
  if (delivery.invoiceImportStatus === "closed_picked_up") return true;
  if (delivery.invoiceFulfillmentMethod === "will_call_pickup") return true;
  if (delivery.invoiceDeliverToSite === true) return true;
  return false;
}

export function resolveShellDeliveryStatus(
  importStatus: string,
  _fulfillmentMethod: InvoiceFulfillmentMethod,
  deliverToSite: boolean,
): ShellDeliveryStatus {
  if (deliverToSite && importStatus === "pending") {
    return "complete";
  }
  if (importStatus === "closed_picked_up") return "picked_up";
  if (importStatus === "pickup_at_vendor") return "complete";
  if (importStatus === "partial") return "partial";
  if (importStatus === "issue") return "issue";
  if (importStatus === "ready_for_pickup") return "complete";
  return "pending";
}

import type { InvoiceFulfillmentMethod } from "./types";

export type InvoiceShellStagingFields = {
  id?: string;
  vendorInvoiceImportId?: string;
  invoiceImportStatus?: string;
  invoiceFulfillmentMethod?: InvoiceFulfillmentMethod;
  invoiceDeliverToSite?: boolean;
  createdFromInvoiceImport?: boolean;
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

export function isInvoiceShellNoShopStaging(
  delivery: InvoiceShellStagingFields,
): boolean {
  if (!isVerifiedInvoiceShell(delivery)) return false;
  // Explicit Vendor Drop-Off wins over a stale will-call import status (drawer toggle).
  if (delivery.invoiceFulfillmentMethod === "delivery") {
    if (delivery.invoiceImportStatus === "closed_picked_up") return true;
    if (delivery.invoiceDeliverToSite === true) return true;
    return false;
  }
  if (delivery.invoiceImportStatus === "pickup_at_vendor") return true;
  if (delivery.invoiceImportStatus === "closed_picked_up") return true;
  if (delivery.invoiceFulfillmentMethod === "will_call_pickup") return true;
  if (delivery.invoiceDeliverToSite === true) return true;
  return false;
}

export function skipsShopStaging(delivery: InvoiceShellStagingFields): boolean {
  if (isInvoiceShellNoShopStaging(delivery)) return true;
  // Branch-B (non-shell) fallback — Drop-Off still wins over stale will-call signals.
  if (delivery.invoiceFulfillmentMethod === "delivery") return false;
  return (
    delivery.invoiceImportStatus === "pickup_at_vendor" ||
    delivery.invoiceFulfillmentMethod === "will_call_pickup"
  );
}

/** Extract job-site destination from parsed order notes (e.g. DELIVER TO: Planet Fitness Hartford). */
export function extractDeliverToSiteLabel(
  orderNotes: readonly string[],
): string | undefined {
  for (let index = 0; index < orderNotes.length; index += 1) {
    const note = orderNotes[index] ?? "";
    const match = note.match(/DELIVER\s+TO\s*:\s*(.*)/i);
    if (!match) continue;

    let label = match[1]?.trim() ?? "";
    const next = orderNotes[index + 1]?.trim() ?? "";
    if (
      label &&
      next &&
      /^[A-Za-z]/.test(next) &&
      !/^(DATE|ATTN|PHONE|SHIP|SPECIAL)\b/i.test(next)
    ) {
      label = `${label} ${next}`.trim();
    }
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

export function resolveShellDeliveryStatus(
  importStatus: string,
  fulfillmentMethod: InvoiceFulfillmentMethod,
  deliverToSite: boolean,
): string {
  if (deliverToSite && importStatus === "pending") {
    return "complete";
  }
  switch (importStatus) {
    case "closed_picked_up":
      return "picked_up";
    case "pickup_at_vendor":
      // delivery.status reflects Vendor Drop-Off workflow, not raw parser importStatus
      return fulfillmentMethod === "delivery" ? "pending" : "ready_for_pickup";
    case "ready_for_pickup":
      return "complete";
    case "partial":
      return "partial";
    case "issue":
      return "issue";
    default:
      return "pending";
  }
}

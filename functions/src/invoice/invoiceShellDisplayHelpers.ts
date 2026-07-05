import type { InvoiceFulfillmentMethod } from "./types";

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

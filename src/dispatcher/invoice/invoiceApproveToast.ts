import type { ApproveVendorInvoiceImportResult } from "../models";

export type InvoiceApproveOptions = {
  plannedStagingLocationIds?: string[];
  fulfillmentDecision?: "delivery" | "will_call_pickup";
};

/** Result-driven approve toast copy (Drop-Off + Will-Call; idempotentReplay = success). */
export function buildInvoiceApproveToastMessage(
  result: ApproveVendorInvoiceImportResult,
  fulfillmentDecision?: "delivery" | "will_call_pickup",
): string {
  if (result.importDismissed) {
    return "Credit/return import dismissed from queue.";
  }

  if (fulfillmentDecision === "will_call_pickup") {
    return "Approved — Will-Call / Pickup from Vendor.";
  }

  const code =
    result.plannedStagingLocationCodes?.[0]?.trim() ||
    result.plannedStagingLocationCodes?.find((c) => c?.trim())?.trim();
  const codeSuffix = code ? ` and assigned to ${code}.` : ".";

  if (result.deliveryMatched) {
    return `Approved — existing delivery updated${codeSuffix}`;
  }

  return `Approved — delivery created${codeSuffix}`;
}

export const INVOICE_APPROVE_FLOW_STORAGE_KEY = "stageverify-invoice-approve-flow";

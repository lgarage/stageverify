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

/** Carry Drop-Off map-confirm success toast across navigate → Dispatcher. */
export const INVOICE_APPROVE_SUCCESS_TOAST_KEY =
  "stageverify-invoice-approve-success-toast";

export function stashInvoiceApproveSuccessToast(message: string): void {
  const trimmed = message.trim();
  if (!trimmed) return;
  try {
    sessionStorage.setItem(INVOICE_APPROVE_SUCCESS_TOAST_KEY, trimmed);
  } catch {
    /* ignore quota / private mode */
  }
}

export function consumeInvoiceApproveSuccessToast(): string | null {
  try {
    const value = sessionStorage.getItem(INVOICE_APPROVE_SUCCESS_TOAST_KEY);
    sessionStorage.removeItem(INVOICE_APPROVE_SUCCESS_TOAST_KEY);
    const trimmed = value?.trim() ?? "";
    return trimmed || null;
  } catch {
    return null;
  }
}

/** After authoritative Drop-Off Confirm, hide this import from pending until portal refresh applies. */
export const INVOICE_APPROVE_DISMISSED_ID_KEY =
  "stageverify-invoice-approve-dismissed-id";

export function stashInvoiceApproveDismissedImportId(importId: string): void {
  const trimmed = importId.trim();
  if (!trimmed) return;
  try {
    sessionStorage.setItem(INVOICE_APPROVE_DISMISSED_ID_KEY, trimmed);
  } catch {
    /* ignore quota / private mode */
  }
}

export function consumeInvoiceApproveDismissedImportId(): string | null {
  try {
    const value = sessionStorage.getItem(INVOICE_APPROVE_DISMISSED_ID_KEY);
    sessionStorage.removeItem(INVOICE_APPROVE_DISMISSED_ID_KEY);
    const trimmed = value?.trim() ?? "";
    return trimmed || null;
  } catch {
    return null;
  }
}

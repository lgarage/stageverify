import type { InvoiceMatchResult } from "../models";
import { shellDeliveryIdForImport } from "./invoiceShellDisplayHelpers";

/**
 * Display-only mirror of server isEligibleMatchedDeliveryTarget (D-67).
 * Never gates Approve — server independently resolves the target.
 */
export function isEligibleMatchedDeliveryTargetClient(
  match: InvoiceMatchResult | null | undefined,
  importId: string,
): boolean {
  if (!match) return false;
  if (match.humanReviewRequired) return false;
  if (match.candidates.length !== 1) return false;
  const deliveryOrderId = match.deliveryOrderId?.trim();
  if (!deliveryOrderId) return false;
  if (match.candidates[0]?.deliveryId !== deliveryOrderId) return false;
  // Client cannot see foreign ownership stamps — server still excludes those.
  // Avoid treating this import's own shell id as "matched existing".
  if (deliveryOrderId === shellDeliveryIdForImport(importId)) return false;
  return true;
}

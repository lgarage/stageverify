import type { VendorInvoiceImportParsedLine } from "../inboundEmail/types";

export interface ExpectedItemWrite {
  id: string;
  deliveryOrderId: string;
  jobId: string;
  sku: string;
  description: string;
  qtyOrdered: number;
  qtyReceived: number;
  qtyMissing: number;
  qtyDamaged: number;
  qtyBackordered: number;
  status: "pending";
}

/** Build expected line items from sanitized invoice lines — no qtyReceived/staging. */
export function buildExpectedItemsFromImport(
  importId: string,
  deliveryOrderId: string,
  jobId: string,
  lines: VendorInvoiceImportParsedLine[],
): ExpectedItemWrite[] {
  return lines
    .filter((line) => !line.excludeFromExpectedItems && line.lineType === "product")
    .map((line) => ({
      id: `item-vii-${importId}-ln-${line.lineNumber}`,
      deliveryOrderId,
      jobId,
      sku: line.vendorProductNumber,
      description: line.description,
      qtyOrdered: line.quantityOrdered,
      qtyReceived: 0,
      qtyMissing: 0,
      qtyDamaged: 0,
      qtyBackordered: line.quantityBackordered,
      status: "pending" as const,
    }));
}

const RECEIVE_PROGRESS_FIELDS = [
  "qtyReceived",
  "qtyMissing",
  "qtyDamaged",
  "status",
] as const;

/**
 * Resend line refresh must not zero receive or pickup progress already on the line.
 * New lines still start at qtyReceived 0.
 */
export function itemWritePreservingReceiveProgress(
  item: ExpectedItemWrite,
  existing: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!existing) return { ...item };
  const write: Record<string, unknown> = { ...item };
  for (const field of RECEIVE_PROGRESS_FIELDS) {
    if (existing[field] !== undefined) {
      delete write[field];
    }
  }
  return write;
}

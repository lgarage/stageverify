/**
 * D-90 Slice 1 — pure item-quantity truth for exception-oriented vendor Delivered.
 * Invariant: qtyReceived + qtyBackordered + qtyMissing + qtyDamaged === qtyOrdered
 */

export type VendorDeliveredItemStatus =
  | "pending"
  | "partial"
  | "received"
  | "missing"
  | "damaged"
  | "backordered"
  | "installed";

export interface LineExceptionInput {
  itemId: string;
  qtyReceived: number;
  qtyBackordered: number;
  qtyDamaged: number;
}

export interface ItemQtyTruth {
  qtyOrdered: number;
  qtyReceived: number;
  qtyMissing: number;
  qtyDamaged: number;
  qtyBackordered: number;
  status: VendorDeliveredItemStatus;
}

export class VendorDeliveredItemTruthError extends Error {
  readonly code: "invalid-argument";
  constructor(message: string) {
    super(message);
    this.name = "VendorDeliveredItemTruthError";
    this.code = "invalid-argument";
  }
}

function asNonNegInt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 9999) {
    throw new VendorDeliveredItemTruthError(`Invalid ${label}.`);
  }
  return value;
}

export function computeVendorDeliveredItemStatus(truth: {
  qtyOrdered: number;
  qtyReceived: number;
  qtyMissing: number;
  qtyDamaged: number;
  qtyBackordered: number;
}): VendorDeliveredItemStatus {
  if (truth.qtyBackordered > 0 && truth.qtyReceived === 0 && truth.qtyDamaged === 0) {
    return "backordered";
  }
  if (truth.qtyReceived === truth.qtyOrdered) return "received";
  if (truth.qtyReceived > 0) return "partial";
  if (truth.qtyDamaged > 0) return "damaged";
  if (truth.qtyMissing > 0) return "missing";
  if (truth.qtyBackordered > 0) return "backordered";
  return "pending";
}

/** Complete-all: preserve prior explicit BO; never invent BO from shortfall. */
export function computeCompleteAllItemTruth(prior: {
  qtyOrdered: number;
  qtyBackordered?: number;
}): ItemQtyTruth {
  const qtyOrdered = asNonNegInt(prior.qtyOrdered, "qtyOrdered");
  const priorBO = Math.max(0, Math.floor(Number(prior.qtyBackordered ?? 0)));
  const qtyBackordered = Math.min(priorBO, qtyOrdered);
  const qtyReceived = qtyOrdered - qtyBackordered;
  const truth: ItemQtyTruth = {
    qtyOrdered,
    qtyReceived,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered,
    status: "pending",
  };
  truth.status = computeVendorDeliveredItemStatus(truth);
  return truth;
}

/** Exception line: server derives qtyMissing; no double-count. */
export function computeExceptionItemTruth(
  qtyOrderedRaw: number,
  exception: Pick<LineExceptionInput, "qtyReceived" | "qtyBackordered" | "qtyDamaged">,
): ItemQtyTruth {
  const qtyOrdered = asNonNegInt(qtyOrderedRaw, "qtyOrdered");
  const qtyReceived = asNonNegInt(exception.qtyReceived, "qtyReceived");
  const qtyBackordered = asNonNegInt(exception.qtyBackordered, "qtyBackordered");
  const qtyDamaged = asNonNegInt(exception.qtyDamaged, "qtyDamaged");
  const accounted = qtyReceived + qtyBackordered + qtyDamaged;
  if (accounted > qtyOrdered) {
    throw new VendorDeliveredItemTruthError(
      "Received + backordered + damaged exceeds ordered quantity.",
    );
  }
  const qtyMissing = qtyOrdered - accounted;
  const truth: ItemQtyTruth = {
    qtyOrdered,
    qtyReceived,
    qtyMissing,
    qtyDamaged,
    qtyBackordered,
    status: "pending",
  };
  truth.status = computeVendorDeliveredItemStatus(truth);
  return truth;
}

export function parseLineExceptions(value: unknown): LineExceptionInput[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 500) return null;
  const out: LineExceptionInput[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const row = entry as Record<string, unknown>;
    if (typeof row.itemId !== "string" || !row.itemId.trim()) return null;
    const itemId = row.itemId.trim();
    if (seen.has(itemId)) return null;
    // All three qty fields required together (reject partial objects).
    if (
      !("qtyReceived" in row) ||
      !("qtyBackordered" in row) ||
      !("qtyDamaged" in row)
    ) {
      return null;
    }
    try {
      out.push({
        itemId,
        qtyReceived: asNonNegInt(row.qtyReceived, "qtyReceived"),
        qtyBackordered: asNonNegInt(row.qtyBackordered, "qtyBackordered"),
        qtyDamaged: asNonNegInt(row.qtyDamaged, "qtyDamaged"),
      });
    } catch {
      return null;
    }
    seen.add(itemId);
  }
  return out;
}

export function itemTruthChanged(
  prior: {
    qtyReceived?: number;
    qtyMissing?: number;
    qtyDamaged?: number;
    qtyBackordered?: number;
    status?: string;
  },
  next: ItemQtyTruth,
): boolean {
  return (
    Number(prior.qtyReceived ?? 0) !== next.qtyReceived ||
    Number(prior.qtyMissing ?? 0) !== next.qtyMissing ||
    Number(prior.qtyDamaged ?? 0) !== next.qtyDamaged ||
    Number(prior.qtyBackordered ?? 0) !== next.qtyBackordered ||
    String(prior.status ?? "") !== next.status
  );
}

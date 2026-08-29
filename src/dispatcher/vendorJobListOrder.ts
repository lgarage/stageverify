/**
 * Vendor mobile job-list ordering.
 *
 * Reuses the same delivered check the compact cards already render
 * (`vendorPhysicalDropoffConfirmed === true`). Does not interpret
 * `vendorPhysicalDropoffConfirmedAt`, partial receive, exceptions, or
 * dispatcher readiness.
 */

import {
  deriveVendorOrderFulfillmentLabel,
  type VendorFulfillmentItemInput,
  vendorItemsHaveFulfillmentQty,
} from "./vendorJobCardStatus";
import type { VendorRunDeliverySummary } from "./models";

export const VENDOR_COMPLETED_MS_24H = 24 * 60 * 60 * 1000;
export const VENDOR_COMPLETED_MS_72H = 72 * 60 * 60 * 1000;

export function isVendorJobCardDelivered(row: {
  vendorPhysicalDropoffConfirmed?: boolean | null;
}): boolean {
  return row.vendorPhysicalDropoffConfirmed === true;
}

/**
 * Stable partition: unfinished/active first, delivered/completed last.
 * Relative order within each group is preserved. Does not mutate `rows`.
 */
export function orderVendorJobsDeliveredLast<
  T extends { vendorPhysicalDropoffConfirmed?: boolean | null },
>(rows: readonly T[]): T[] {
  const unfinished: T[] = [];
  const delivered: T[] = [];
  for (const row of rows) {
    if (isVendorJobCardDelivered(row)) delivered.push(row);
    else unfinished.push(row);
  }
  return unfinished.concat(delivered);
}

export type VendorRunListPartitionGroup =
  | "partial"
  | "open"
  | "recentCompleted"
  | "completedSection"
  | "hidden";

export interface VendorRunListPartitionRow {
  vendorPhysicalDropoffConfirmed?: boolean | null;
  vendorPhysicalDropoffConfirmedAt?: string | null;
  status?: string | null;
  items?: readonly VendorFulfillmentItemInput[];
}

export function deriveVendorRunFulfillmentForPartition(
  row: VendorRunListPartitionRow,
): ReturnType<typeof deriveVendorOrderFulfillmentLabel> {
  return deriveVendorOrderFulfillmentLabel({
    items: row.items,
    deliveryStatus: row.status,
    vendorPhysicalDropoffConfirmed: vendorItemsHaveFulfillmentQty(row.items)
      ? row.vendorPhysicalDropoffConfirmed
      : false,
  });
}

export function isVendorRunFullyCompleted(
  row: VendorRunListPartitionRow,
): boolean {
  return (
    deriveVendorRunFulfillmentForPartition(row) === "Delivered" &&
    row.vendorPhysicalDropoffConfirmed === true
  );
}

export function classifyVendorRunDeliveryRow<T extends VendorRunListPartitionRow>(
  row: T,
  nowMs: number,
): VendorRunListPartitionGroup {
  const fulfillmentLabel = deriveVendorRunFulfillmentForPartition(row);

  if (fulfillmentLabel === "Partial") {
    return "partial";
  }

  if (isVendorRunFullyCompleted(row)) {
    const raw = row.vendorPhysicalDropoffConfirmedAt;
    const parsed =
      typeof raw === "string" && raw.length > 0 ? Date.parse(raw) : Number.NaN;
    if (Number.isNaN(parsed)) {
      return "recentCompleted";
    }
    const ageMs = nowMs - parsed;
    if (ageMs < VENDOR_COMPLETED_MS_24H) {
      return "recentCompleted";
    }
    if (ageMs <= VENDOR_COMPLETED_MS_72H) {
      return "completedSection";
    }
    return "hidden";
  }

  return "open";
}

export interface VendorRunListPartition<T> {
  mainList: T[];
  completedDeliveries: T[];
}

/**
 * Company-run vendor list: Partial → open → recent fully completed on main;
 * 24–72h fully completed in collapsed section; >72h hidden.
 * Preserves source order within each group.
 */
export function partitionVendorRunDeliveries<
  T extends VendorRunListPartitionRow,
>(rows: readonly T[], nowMs: number = Date.now()): VendorRunListPartition<T> {
  const partial: T[] = [];
  const open: T[] = [];
  const recentCompleted: T[] = [];
  const completedDeliveries: T[] = [];

  for (const row of rows) {
    switch (classifyVendorRunDeliveryRow(row, nowMs)) {
      case "partial":
        partial.push(row);
        break;
      case "open":
        open.push(row);
        break;
      case "recentCompleted":
        recentCompleted.push(row);
        break;
      case "completedSection":
        completedDeliveries.push(row);
        break;
      case "hidden":
        break;
      default:
        break;
    }
  }

  return {
    mainList: partial.concat(open, recentCompleted),
    completedDeliveries,
  };
}

function vendorRunRowId(row: VendorRunListPartitionRow & { deliveryId?: string; id?: string }): string | undefined {
  return row.deliveryId ?? row.id;
}

/**
 * Re-attach locally-known completed-visible rows omitted by the server list
 * (e.g. after readiness promotes ready_for_pickup and CF filters active-only).
 * Server rows win on id collision; recovered rows append in source order.
 */
export function mergeVendorVisibleCompletedRows<
  T extends VendorRunListPartitionRow & { deliveryId?: string; id?: string },
>(serverRows: readonly T[], previousRows: readonly T[], nowMs: number = Date.now()): T[] {
  const serverIds = new Set(
    serverRows
      .map((row) => vendorRunRowId(row))
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  const recovered: T[] = [];
  const recoveredIds = new Set<string>();

  for (const row of previousRows) {
    const id = vendorRunRowId(row);
    if (!id || serverIds.has(id) || recoveredIds.has(id)) {
      continue;
    }
    const group = classifyVendorRunDeliveryRow(row, nowMs);
    if (group === "recentCompleted" || group === "completedSection") {
      recovered.push(row);
      recoveredIds.add(id);
    }
  }

  return serverRows.concat(recovered);
}

/**
 * Optimistic patch after vendor Complete write: set physical drop-off flags.
 * When fulfillment qty is already on the list DTO and the order is Partial,
 * items are left unchanged (backorder lines keep qtyReceived: 0). Otherwise
 * qtyReceived is synthesized from qtyOrdered so merge can classify recentCompleted.
 */
export function patchVendorRunCompleteRows(
  rows: readonly VendorRunDeliverySummary[],
  deliveredIds: ReadonlySet<string>,
  nowMs: number = Date.now(),
): VendorRunDeliverySummary[] {
  const nowIso = new Date(nowMs).toISOString();
  return rows.map((row) => {
    if (!deliveredIds.has(row.deliveryId)) {
      return row;
    }
    const hasFulfillmentQty = vendorItemsHaveFulfillmentQty(row.items);
    const isPartialOrder =
      hasFulfillmentQty &&
      deriveVendorOrderFulfillmentLabel({
        items: row.items,
        deliveryStatus: row.status,
        vendorPhysicalDropoffConfirmed: false,
      }) === "Partial";
    return {
      ...row,
      vendorPhysicalDropoffConfirmed: true,
      vendorPhysicalDropoffConfirmedAt:
        row.vendorPhysicalDropoffConfirmedAt ?? nowIso,
      items: isPartialOrder
        ? row.items
        : row.items.map((item) => ({
            ...item,
            qtyReceived: item.qtyOrdered ?? item.qtyReceived ?? 0,
          })),
    };
  });
}

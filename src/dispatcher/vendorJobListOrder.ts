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

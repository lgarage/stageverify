/**
 * Vendor mobile job-list ordering.
 *
 * Reuses the same delivered check the compact cards already render
 * (`vendorPhysicalDropoffConfirmed === true`). Does not interpret
 * `vendorPhysicalDropoffConfirmedAt`, partial receive, exceptions, or
 * dispatcher readiness.
 */

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

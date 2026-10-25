/** Fields matched by vendor run / job delivery list search (client-side only). */
export interface VendorRunListSearchableRow {
  vendorInvoiceNumber?: string;
  poNumber?: string;
  jobName?: string;
  orderNumber?: string;
}

function searchableFieldValues(row: VendorRunListSearchableRow): string[] {
  const values: string[] = [];
  if (row.vendorInvoiceNumber) values.push(row.vendorInvoiceNumber);
  if (row.poNumber) values.push(row.poNumber);
  if (row.jobName) values.push(row.jobName);
  if (row.orderNumber) values.push(row.orderNumber);
  return values;
}

/**
 * Client-side filter for vendor delivery lists already scoped by session.
 * Empty or whitespace-only query returns all rows in original order.
 * Case-insensitive substring match; PO and other text are literal (no regex).
 */
export function filterVendorRunDeliveriesBySearch<
  T extends VendorRunListSearchableRow,
>(rows: readonly T[], query: string): T[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return rows.slice();
  }
  const needle = trimmed.toLowerCase();
  return rows.filter((row) =>
    searchableFieldValues(row).some((value) =>
      value.toLowerCase().includes(needle),
    ),
  );
}

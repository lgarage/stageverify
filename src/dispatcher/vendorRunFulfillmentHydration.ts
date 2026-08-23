import type { VendorRunDeliverySummary } from "./models";
import { vendorItemsHaveFulfillmentQty } from "./vendorJobCardStatus";

export type VendorRunHydratedItems = VendorRunDeliverySummary["items"];

export type VendorReceiveDetailsFetcher = (input: {
  deliveryId: string;
  sessionToken: string;
}) => Promise<{
  items?: ReadonlyArray<{
    id?: unknown;
    description?: unknown;
    qtyOrdered?: unknown;
    qtyReceived?: unknown;
    qtyBackordered?: unknown;
    status?: unknown;
  }>;
}>;

function cacheKey(sessionToken: string, deliveryId: string): string {
  return `${sessionToken}:${deliveryId}`;
}

function toHydratedItems(
  items: ReadonlyArray<{
    id?: unknown;
    description?: unknown;
    qtyOrdered?: unknown;
    qtyReceived?: unknown;
    qtyBackordered?: unknown;
    status?: unknown;
  }>,
): VendorRunHydratedItems {
  return items.map((item) => ({
    id: String(item.id ?? ""),
    description:
      typeof item.description === "string" ? item.description : "Item",
    qtyOrdered: typeof item.qtyOrdered === "number" ? item.qtyOrdered : 0,
    qtyReceived:
      typeof item.qtyReceived === "number" ? item.qtyReceived : undefined,
    qtyBackordered:
      typeof item.qtyBackordered === "number" ? item.qtyBackordered : undefined,
    status: typeof item.status === "string" ? item.status : undefined,
  }));
}

/**
 * Session-scoped cache for company-run item qty hydration.
 * Safe for qty/backorder (immutable for a session) — physical drop-off
 * still comes from the list DTO refresh.
 */
export function createVendorRunDetailsCache(): Map<string, VendorRunHydratedItems> {
  return new Map();
}

export function mergeVendorRunHydratedItems(
  rows: VendorRunDeliverySummary[],
  byId: Map<string, VendorRunHydratedItems>,
): VendorRunDeliverySummary[] {
  if (byId.size === 0) return rows;
  return rows.map((row) => {
    const items = byId.get(row.deliveryId);
    return items ? { ...row, items } : row;
  });
}

/**
 * Hydrate qty/backorder via getVendorReceiveDetails only when the list DTO
 * lacks qtyReceived. Reuses session cache. Never replaces list items with
 * an empty details payload.
 */
export async function enrichVendorRunFulfillment(
  rows: VendorRunDeliverySummary[],
  sessionToken: string,
  fetchDetails: VendorReceiveDetailsFetcher,
  cache: Map<string, VendorRunHydratedItems> = createVendorRunDetailsCache(),
): Promise<VendorRunDeliverySummary[]> {
  const byId = new Map<string, VendorRunHydratedItems>();

  for (const row of rows) {
    if (vendorItemsHaveFulfillmentQty(row.items)) continue;
    const cached = cache.get(cacheKey(sessionToken, row.deliveryId));
    if (cached && vendorItemsHaveFulfillmentQty(cached)) {
      byId.set(row.deliveryId, cached);
    }
  }

  const missing = rows.filter((row) => {
    if (vendorItemsHaveFulfillmentQty(row.items)) return false;
    return !byId.has(row.deliveryId);
  });

  await Promise.all(
    missing.map(async (row) => {
      try {
        const details = await fetchDetails({
          deliveryId: row.deliveryId,
          sessionToken,
        });
        const rawItems = Array.isArray(details.items) ? details.items : [];
        if (rawItems.length === 0) return;
        const items = toHydratedItems(rawItems);
        if (!vendorItemsHaveFulfillmentQty(items)) return;
        cache.set(cacheKey(sessionToken, row.deliveryId), items);
        byId.set(row.deliveryId, items);
      } catch {
        // Keep list DTO when details are unavailable (legacy CF / mocks).
      }
    }),
  );

  return mergeVendorRunHydratedItems(rows, byId);
}

/**
 * Until qty hydration arrives, do not treat physical drop-off as
 * order-level Delivered. Prevents a false Delivered flash on Partial jobs.
 */
export function vendorRunFulfillmentUsesPhysicalFallback(
  items: VendorRunDeliverySummary["items"] | undefined,
): boolean {
  return vendorItemsHaveFulfillmentQty(items);
}

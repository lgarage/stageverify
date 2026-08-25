import type { VendorRunDeliverySummary } from "./models";
import { vendorItemsHaveFulfillmentQty } from "./vendorJobCardStatus";
import { markVendorPinDebug } from "../vendorPinDebugTimeline";

/** Max parallel getVendorReceiveDetails calls during company-run hydration. */
export const VENDOR_RUN_DETAILS_CONCURRENCY = 3;

/**
 * Yield until after the next paint so list DTO can commit before detail fetches.
 * Uses double rAF; falls back to setTimeout(0) when rAF is unavailable.
 */
export function yieldToNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    const win =
      typeof globalThis !== "undefined"
        ? (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame })
        : undefined;
    if (typeof win?.requestAnimationFrame === "function") {
      win.requestAnimationFrame(() => {
        win.requestAnimationFrame!(() => resolve());
      });
    } else {
      setTimeout(() => resolve(), 0);
    }
  });
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      await fn(items[index]!);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

export type VendorRunHydratedItems = VendorRunDeliverySummary["items"];

export type VendorRunDetailsCacheEntry = {
  items: VendorRunHydratedItems;
  vendorPhysicalDropoffConfirmedAt?: string;
};

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
  delivery?: {
    vendorPhysicalDropoffConfirmedAt?: unknown;
  };
  vendorPhysicalDropoffConfirmedAt?: unknown;
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

function extractVendorPhysicalDropoffConfirmedAt(
  details: Awaited<ReturnType<VendorReceiveDetailsFetcher>>,
): string | undefined {
  const nested = details.delivery?.vendorPhysicalDropoffConfirmedAt;
  if (typeof nested === "string" && nested.length > 0) {
    return nested;
  }
  if (
    typeof details.vendorPhysicalDropoffConfirmedAt === "string" &&
    details.vendorPhysicalDropoffConfirmedAt.length > 0
  ) {
    return details.vendorPhysicalDropoffConfirmedAt;
  }
  return undefined;
}

/**
 * Session-scoped cache for company-run item qty hydration.
 * Safe for qty/backorder (immutable for a session) — physical drop-off
 * timestamp is merged when present on details responses.
 */
export function createVendorRunDetailsCache(): Map<
  string,
  VendorRunDetailsCacheEntry
> {
  return new Map();
}

export function invalidateVendorRunDetailsCache(
  cache: Map<string, VendorRunDetailsCacheEntry>,
  sessionToken: string,
  deliveryId: string,
): void {
  cache.delete(cacheKey(sessionToken, deliveryId));
}

export function mergeVendorRunHydratedItems(
  rows: VendorRunDeliverySummary[],
  byId: Map<string, VendorRunDetailsCacheEntry>,
): VendorRunDeliverySummary[] {
  if (byId.size === 0) return rows;
  return rows.map((row) => {
    const entry = byId.get(row.deliveryId);
    if (!entry) return row;
    return {
      ...row,
      items: entry.items,
      vendorPhysicalDropoffConfirmedAt:
        row.vendorPhysicalDropoffConfirmedAt ??
        entry.vendorPhysicalDropoffConfirmedAt,
    };
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
  cache: Map<string, VendorRunDetailsCacheEntry> = createVendorRunDetailsCache(),
): Promise<VendorRunDeliverySummary[]> {
  const byId = new Map<string, VendorRunDetailsCacheEntry>();

  for (const row of rows) {
    if (vendorItemsHaveFulfillmentQty(row.items)) continue;
    const cached = cache.get(cacheKey(sessionToken, row.deliveryId));
    if (cached && vendorItemsHaveFulfillmentQty(cached.items)) {
      byId.set(row.deliveryId, cached);
    }
  }

  const missing = rows.filter((row) => {
    if (vendorItemsHaveFulfillmentQty(row.items)) return false;
    return !byId.has(row.deliveryId);
  });

  if (missing.length > 0) {
    markVendorPinDebug(
      "DETAIL_HYDRATION_START",
      `${missing.length} deliveries need details`,
    );
  }

  await mapWithConcurrency(
    missing,
    VENDOR_RUN_DETAILS_CONCURRENCY,
    async (row) => {
      try {
        const details = await fetchDetails({
          deliveryId: row.deliveryId,
          sessionToken,
        });
        const rawItems = Array.isArray(details.items) ? details.items : [];
        if (rawItems.length === 0) return;
        const items = toHydratedItems(rawItems);
        if (!vendorItemsHaveFulfillmentQty(items)) return;
        const key = cacheKey(sessionToken, row.deliveryId);
        const prev = cache.get(key);
        const vendorPhysicalDropoffConfirmedAt =
          extractVendorPhysicalDropoffConfirmedAt(details) ??
          prev?.vendorPhysicalDropoffConfirmedAt;
        const entry: VendorRunDetailsCacheEntry = {
          items,
          ...(vendorPhysicalDropoffConfirmedAt
            ? { vendorPhysicalDropoffConfirmedAt }
            : {}),
        };
        cache.set(key, entry);
        byId.set(row.deliveryId, entry);
      } catch {
        // Keep list DTO when details are unavailable (legacy CF / mocks).
      }
    },
  );

  if (missing.length > 0) {
    markVendorPinDebug("DETAIL_HYDRATION_DONE");
  }

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

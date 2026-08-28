import type {
  VendorRunDeliveryItem,
  VendorRunDeliverySummary,
} from "./dispatcher/models";

const CACHE_KEY_PREFIX = "stageverify_vendor_run_list_";
/** Display-only cache — never used to authorize writes. */
const TTL_MS = 24 * 60 * 60 * 1000;

/** Last vendor with a successful cache write — returning-device fallback. */
export const LAST_VENDOR_KEY = "stageverify_vendor_run_last_vendor_id";

const PIN_ALIAS_PREFIX = "stageverify_vendor_run_pin_";

export interface VendorRunDeliveriesCacheEntry {
  deliveries: VendorRunDeliverySummary[];
  scannedStagingLocationCode: string;
  vendorName?: string;
  cachedAt: number;
}

export interface VendorRunDeliveriesCacheReadResult
  extends Omit<VendorRunDeliveriesCacheEntry, "cachedAt"> {
  vendorId: string;
}

function storageKey(vendorId: string): string {
  return `${CACHE_KEY_PREFIX}${vendorId}`;
}

function pinAliasKey(fingerprint: string): string {
  return `${PIN_ALIAS_PREFIX}${fingerprint}`;
}

function slimItem(item: VendorRunDeliveryItem): VendorRunDeliveryItem {
  const slim: VendorRunDeliveryItem = {
    id: item.id,
    description: item.description,
    qtyOrdered: item.qtyOrdered,
  };
  if (item.qtyReceived !== undefined) slim.qtyReceived = item.qtyReceived;
  if (item.qtyBackordered !== undefined) slim.qtyBackordered = item.qtyBackordered;
  if (item.status !== undefined) slim.status = item.status;
  return slim;
}

function slimDelivery(
  delivery: VendorRunDeliverySummary,
): VendorRunDeliverySummary {
  const slim: VendorRunDeliverySummary = {
    deliveryId: delivery.deliveryId,
    jobId: delivery.jobId,
    jobName: delivery.jobName,
    orderNumber: delivery.orderNumber,
    stagingLocationCodes: delivery.stagingLocationCodes,
    hasAssignableSpot: delivery.hasAssignableSpot,
    vendorPhysicalDropoffConfirmed: delivery.vendorPhysicalDropoffConfirmed,
    items: (delivery.items ?? []).map(slimItem),
  };
  if (delivery.vendorInvoiceNumber !== undefined) {
    slim.vendorInvoiceNumber = delivery.vendorInvoiceNumber;
  }
  if (delivery.poNumber !== undefined) slim.poNumber = delivery.poNumber;
  if (delivery.vendorPhysicalDropoffConfirmedAt !== undefined) {
    slim.vendorPhysicalDropoffConfirmedAt =
      delivery.vendorPhysicalDropoffConfirmedAt;
  }
  if (delivery.status !== undefined) slim.status = delivery.status;
  return slim;
}

function isValidDelivery(
  delivery: unknown,
): delivery is VendorRunDeliverySummary {
  if (!delivery || typeof delivery !== "object") return false;
  const row = delivery as VendorRunDeliverySummary;
  return (
    typeof row.deliveryId === "string" &&
    row.deliveryId.length > 0 &&
    typeof row.jobName === "string" &&
    row.jobName.length > 0 &&
    Array.isArray(row.items)
  );
}

function parseEntry(raw: string): VendorRunDeliveriesCacheEntry | null {
  const parsed = JSON.parse(raw) as VendorRunDeliveriesCacheEntry;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray(parsed.deliveries) ||
    typeof parsed.scannedStagingLocationCode !== "string" ||
    typeof parsed.cachedAt !== "number"
  ) {
    return null;
  }
  if (!parsed.deliveries.every(isValidDelivery)) {
    return null;
  }
  return parsed;
}

function tryWritePayload(vendorId: string, payload: VendorRunDeliveriesCacheEntry): boolean {
  localStorage.setItem(storageKey(vendorId), JSON.stringify(payload));
  return true;
}

function readCacheForVendorId(
  vendorId: string,
): Omit<VendorRunDeliveriesCacheEntry, "cachedAt"> | null {
  try {
    const raw = localStorage.getItem(storageKey(vendorId));
    if (!raw) return null;
    const parsed = parseEntry(raw);
    if (!parsed) {
      localStorage.removeItem(storageKey(vendorId));
      return null;
    }
    if (Date.now() - parsed.cachedAt > TTL_MS) {
      localStorage.removeItem(storageKey(vendorId));
      return null;
    }
    return {
      deliveries: parsed.deliveries,
      scannedStagingLocationCode: parsed.scannedStagingLocationCode,
      vendorName: parsed.vendorName,
    };
  } catch {
    return null;
  }
}

export async function fingerprintVendorRunPin(
  pin: string,
  stagingLocationCode: string,
): Promise<string> {
  const data = new TextEncoder().encode(`${pin}\n${stagingLocationCode}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function linkVendorRunDeliveriesCachePin(
  fingerprint: string,
  vendorId: string,
): void {
  try {
    localStorage.setItem(pinAliasKey(fingerprint), vendorId);
  } catch {
    // ignore quota / private mode
  }
}

export function readVendorRunDeliveriesCache(
  vendorId: string,
): Omit<VendorRunDeliveriesCacheEntry, "cachedAt"> | null {
  return readCacheForVendorId(vendorId);
}

export function readLastVendorRunDeliveriesCache(): VendorRunDeliveriesCacheReadResult | null {
  try {
    const vendorId = localStorage.getItem(LAST_VENDOR_KEY);
    if (!vendorId) return null;
    const cached = readCacheForVendorId(vendorId);
    if (!cached || cached.deliveries.length === 0) return null;
    return { ...cached, vendorId };
  } catch {
    return null;
  }
}

export async function readVendorRunDeliveriesCacheForSubmit(opts: {
  pin: string;
  stagingLocationCode: string;
}): Promise<VendorRunDeliveriesCacheReadResult | null> {
  const fingerprint = await fingerprintVendorRunPin(
    opts.pin,
    opts.stagingLocationCode,
  );

  try {
    const aliasVendorId = localStorage.getItem(pinAliasKey(fingerprint));
    if (aliasVendorId) {
      const aliasCache = readCacheForVendorId(aliasVendorId);
      if (aliasCache && aliasCache.deliveries.length > 0) {
        return { ...aliasCache, vendorId: aliasVendorId };
      }
    }
  } catch {
    // ignore
  }

  return readLastVendorRunDeliveriesCache();
}

export function writeVendorRunDeliveriesCache(
  vendorId: string,
  entry: {
    deliveries: VendorRunDeliverySummary[];
    scannedStagingLocationCode: string;
    vendorName?: string;
  },
): boolean {
  const cachedAt = Date.now();
  const base = {
    scannedStagingLocationCode: entry.scannedStagingLocationCode,
    vendorName: entry.vendorName,
    cachedAt,
  };

  try {
    localStorage.setItem(LAST_VENDOR_KEY, vendorId);
  } catch {
    // ignore — list payload write may still succeed
  }

  try {
    return tryWritePayload(vendorId, {
      ...base,
      deliveries: entry.deliveries.map(slimDelivery),
    });
  } catch {
    try {
      return tryWritePayload(vendorId, {
        ...base,
        deliveries: entry.deliveries.map((delivery) => ({
          ...slimDelivery(delivery),
          items: [],
        })),
      });
    } catch {
      return false;
    }
  }
}

export function clearVendorRunDeliveriesCache(vendorId: string): void {
  try {
    localStorage.removeItem(storageKey(vendorId));
  } catch {
    // ignore
  }
}

/** @internal test hook — storage API name used by this module. */
export const VENDOR_RUN_DELIVERIES_CACHE_STORAGE = "localStorage" as const;

/** @internal test hook — TTL in milliseconds. */
export const VENDOR_RUN_DELIVERIES_CACHE_TTL_MS = TTL_MS;

/** @internal test hook — pin alias key prefix. */
export const VENDOR_RUN_DELIVERIES_PIN_ALIAS_PREFIX = PIN_ALIAS_PREFIX;

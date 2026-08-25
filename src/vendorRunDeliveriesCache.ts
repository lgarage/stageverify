import type { VendorRunDeliverySummary } from "./dispatcher/models";

const CACHE_KEY_PREFIX = "stageverify_vendor_run_list_";
/** Display-only cache — never used to authorize writes. */
const TTL_MS = 10 * 60_000;

export interface VendorRunDeliveriesCacheEntry {
  deliveries: VendorRunDeliverySummary[];
  scannedStagingLocationCode: string;
  vendorName?: string;
  cachedAt: number;
}

function storageKey(vendorId: string): string {
  return `${CACHE_KEY_PREFIX}${vendorId}`;
}

export function readVendorRunDeliveriesCache(
  vendorId: string,
): Omit<VendorRunDeliveriesCacheEntry, "cachedAt"> | null {
  try {
    const raw = sessionStorage.getItem(storageKey(vendorId));
    if (!raw) return null;
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
    if (Date.now() - parsed.cachedAt > TTL_MS) {
      sessionStorage.removeItem(storageKey(vendorId));
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

export function writeVendorRunDeliveriesCache(
  vendorId: string,
  entry: {
    deliveries: VendorRunDeliverySummary[];
    scannedStagingLocationCode: string;
    vendorName?: string;
  },
): void {
  try {
    const payload: VendorRunDeliveriesCacheEntry = {
      ...entry,
      cachedAt: Date.now(),
    };
    sessionStorage.setItem(storageKey(vendorId), JSON.stringify(payload));
  } catch {
    // sessionStorage full or unavailable — ignore
  }
}

export function clearVendorRunDeliveriesCache(vendorId: string): void {
  try {
    sessionStorage.removeItem(storageKey(vendorId));
  } catch {
    // ignore
  }
}

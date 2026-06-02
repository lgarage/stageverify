/**
 * Receive deep links encoded on Minew e-ink ESL tags (not paper labels).
 * See PROJECT_STATUS/ESL_INTEGRATION_PLAN.md — QR routing on zone tags.
 */
const PROD_RECEIVE_BASE = "https://lgarage.github.io/stageverify/#/receive";

export type ZoneEslOccupancy = {
  deliveryId: string;
  orderNumber: string;
  vendorName: string;
};

/** Deep link for a Minew zone tag: job URL when occupied, zone URL when empty. */
export function buildZoneEslQrUrl(
  zoneCode: string,
  occupancy: ZoneEslOccupancy | null | undefined,
): string {
  if (occupancy?.deliveryId) {
    return `${PROD_RECEIVE_BASE}?id=${encodeURIComponent(occupancy.deliveryId)}`;
  }
  return `${PROD_RECEIVE_BASE}?zone=${encodeURIComponent(zoneCode)}`;
}

/** Dynamic line shown on the e-ink tag below the zone code. */
export function formatZoneEslStatusLine(
  occupancy: ZoneEslOccupancy | null | undefined,
): string {
  if (!occupancy) return "AVAILABLE";
  return `${occupancy.orderNumber} — ${occupancy.vendorName}`;
}

/** @deprecated Prefer buildZoneEslQrUrl — kept for non-zone receive links */
export function buildReceiveDeepLink(options: {
  deliveryId?: string | null;
  zoneCode?: string | null;
}): string {
  if (options.deliveryId) {
    return `${PROD_RECEIVE_BASE}?id=${encodeURIComponent(options.deliveryId)}`;
  }
  if (options.zoneCode) {
    return `${PROD_RECEIVE_BASE}?zone=${encodeURIComponent(options.zoneCode)}`;
  }
  return PROD_RECEIVE_BASE;
}

/** Fix `#receive?…` → `#/receive?…` so HashRouter and search params work. */
export function normalizeReceiveHash(): void {
  const hash = window.location.hash;
  if (hash.startsWith("#receive") && !hash.startsWith("#/receive")) {
    window.location.hash = hash.replace("#receive", "#/receive");
  }
}

export function readReceiveParams(
  searchParams: URLSearchParams,
): { id: string | null; zone: string | null } {
  const id = searchParams.get("id");
  const zone = searchParams.get("zone");
  if (id || zone) return { id, zone };

  const hash = window.location.hash;
  const qs = hash.indexOf("?");
  if (qs === -1) return { id: null, zone: null };
  const fromHash = new URLSearchParams(hash.slice(qs + 1));
  return { id: fromHash.get("id"), zone: fromHash.get("zone") };
}

export function hasReceiveDeepLink(): boolean {
  normalizeReceiveHash();
  const hash = window.location.hash;
  const qs = hash.indexOf("?");
  if (qs === -1) return false;
  const p = new URLSearchParams(hash.slice(qs + 1));
  return Boolean(p.get("id") || p.get("zone"));
}

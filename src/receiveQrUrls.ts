/** Production receive URLs printed on zone labels (GitHub Pages). */
const PROD_RECEIVE_BASE = "https://lgarage.github.io/stageverify/#/receive";

/** Deep link that opens a delivery directly (bypasses scanner). Prefer id when known. */
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

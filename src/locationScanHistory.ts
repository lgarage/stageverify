/**
 * Meaningful location-scan history (PIN → deliveries → order).
 * Printed QR stays `#/s?loc=`; later screens push `view=` on the same route.
 */

export type LocationScanHistoryView =
  | { kind: "pin" }
  | { kind: "deliveries" }
  | { kind: "delivery"; deliveryId: string }
  | { kind: "unplanned" }
  | { kind: "tech" }
  | { kind: "mgmt" }
  | { kind: "mgmt-hub" };

export function readLocationScanHistoryView(
  searchParams: URLSearchParams,
): LocationScanHistoryView {
  const view = (searchParams.get("view") ?? "").trim();
  const deliveryId = (
    searchParams.get("d") ??
    searchParams.get("delivery") ??
    ""
  ).trim();
  if (view === "delivery" && deliveryId) {
    return { kind: "delivery", deliveryId };
  }
  if (view === "deliveries") return { kind: "deliveries" };
  if (view === "unplanned") return { kind: "unplanned" };
  if (view === "tech") return { kind: "tech" };
  if (view === "mgmt-hub") return { kind: "mgmt-hub" };
  if (view === "mgmt") return { kind: "mgmt" };
  return { kind: "pin" };
}

export function locationScanHistoryPath(
  locationCode: string,
  view: LocationScanHistoryView,
): string {
  const params = new URLSearchParams();
  params.set("loc", locationCode.trim());
  switch (view.kind) {
    case "pin":
      break;
    case "deliveries":
      params.set("view", "deliveries");
      break;
    case "delivery":
      params.set("view", "delivery");
      params.set("d", view.deliveryId);
      break;
    case "unplanned":
      params.set("view", "unplanned");
      break;
    case "tech":
      params.set("view", "tech");
      break;
    case "mgmt":
      params.set("view", "mgmt");
      break;
    case "mgmt-hub":
      params.set("view", "mgmt-hub");
      break;
  }
  return `/s?${params.toString()}`;
}

export function locationScanHistoryHash(
  locationCode: string,
  view: LocationScanHistoryView,
): string {
  return `#${locationScanHistoryPath(locationCode, view)}`;
}

export function locationScanHistoryViewsEqual(
  a: LocationScanHistoryView,
  b: LocationScanHistoryView,
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "delivery" && b.kind === "delivery") {
    return a.deliveryId === b.deliveryId;
  }
  return true;
}

/** Bare `#/receive` recovery — not a meaningful vendor history step. */
export function isLeftoverReceiveHash(hash: string): boolean {
  const raw = (hash.startsWith("#") ? hash.slice(1) : hash).trim();
  const [pathPart, query = ""] = raw.split("?");
  const path = `/${pathPart.replace(/^\/+/, "").replace(/\/+$/, "")}`.replace(
    /\/+/g,
    "/",
  );
  if (path !== "/receive") return false;
  const params = new URLSearchParams(query);
  const id = (params.get("id") ?? params.get("i") ?? "").trim();
  const token = (params.get("t") ?? params.get("code") ?? "").trim();
  const zone = (params.get("zone") ?? params.get("z") ?? "").trim();
  return !id && !token && !zone;
}

/** QR entry should replace leftover recovery instead of stacking it. */
export function shouldCollapseLeftoverReceiveToLocationScan(
  oldHash: string,
  newHash: string,
): boolean {
  return (
    isLeftoverReceiveHash(oldHash) && canonicalLocationScanHash(newHash) !== null
  );
}

/** Canonical `#/s?loc=` hash that preserves history `view` / delivery params. */
export function canonicalLocationScanHash(hash: string): string | null {
  if (!/^#\/?s(\?|$)/i.test(hash)) return null;
  const qsStart = hash.indexOf("?");
  const params =
    qsStart === -1
      ? new URLSearchParams()
      : new URLSearchParams(hash.slice(qsStart + 1));
  const loc = (params.get("loc") ?? params.get("l") ?? "").trim();
  if (!loc) return null;
  return locationScanHistoryHash(loc, readLocationScanHistoryView(params));
}

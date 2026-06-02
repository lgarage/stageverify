/**
 * QR URL builders and parsers. Routing logic lives in scanRouting.ts.
 * See PROJECT_STATUS/MODEL_DOSSIER.md tag: qr-routing
 */
import {
  shouldRouteScanToPickup,
  type DeliveryStatus,
} from "./dispatcher/models";

const PROD_APP_BASE = "https://lgarage.github.io/stageverify";

function appBaseUrl(): string {
  if (typeof window !== "undefined" && window.location.origin) {
    return `${window.location.origin}${window.location.pathname}`.replace(/\/$/, "");
  }
  return PROD_APP_BASE;
}

export type ZoneEslOccupancy = {
  deliveryId: string;
  orderNumber: string;
  vendorName: string;
  jobId: string;
  status: DeliveryStatus;
};

/** Deep link for a zone tag: pickup when staged, receive when in vendor flow, zone when empty. */
export function buildZoneEslQrUrl(
  zoneCode: string,
  occupancy: ZoneEslOccupancy | null | undefined,
): string {
  const base = appBaseUrl();
  if (occupancy?.deliveryId) {
    if (shouldRouteScanToPickup(occupancy.status)) {
      return buildPickupDeepLink({
        jobId: occupancy.jobId,
        deliveryId: occupancy.deliveryId,
      });
    }
    return `${base}#/receive?id=${encodeURIComponent(occupancy.deliveryId)}`;
  }
  return `${base}#/receive?zone=${encodeURIComponent(zoneCode)}`;
}

export function buildPickupDeepLink(options: {
  jobId: string;
  deliveryId?: string | null;
  zoneCode?: string | null;
}): string {
  const base = appBaseUrl();
  const params = new URLSearchParams({ job: options.jobId });
  if (options.deliveryId) {
    params.set("delivery", options.deliveryId);
  }
  if (options.zoneCode) {
    params.set("zone", options.zoneCode);
  }
  return `${base}#/pickup?${params.toString()}`;
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
  const base = appBaseUrl();
  if (options.deliveryId) {
    return `${base}#/receive?id=${encodeURIComponent(options.deliveryId)}`;
  }
  if (options.zoneCode) {
    return `${base}#/receive?zone=${encodeURIComponent(options.zoneCode)}`;
  }
  return `${base}#/receive`;
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

export type ParsedQrScan =
  | { kind: "receive-id"; deliveryId: string }
  | { kind: "receive-zone"; zoneCode: string }
  | { kind: "pickup"; jobId: string | null; deliveryId: string | null; zoneCode: string | null }
  | { kind: "raw"; value: string };

/** Parse a scanned QR payload (URL or raw zone code). */
export function parseScannedQr(raw: string): ParsedQrScan {
  const trimmed = raw.trim();
  if (trimmed.startsWith("http")) {
    try {
      const url = new URL(trimmed);
      const hash = url.hash;
      const path = hash.split("?")[0] ?? "";
      const qsStart = hash.indexOf("?");
      const params =
        qsStart !== -1
          ? new URLSearchParams(hash.slice(qsStart + 1))
          : new URLSearchParams();

      if (path.includes("/pickup")) {
        return {
          kind: "pickup",
          jobId: params.get("job"),
          deliveryId: params.get("delivery"),
          zoneCode: params.get("zone"),
        };
      }

      const checkinMatch = path.match(/\/checkin\/([^/?]+)/);
      if (checkinMatch) {
        return { kind: "receive-id", deliveryId: decodeURIComponent(checkinMatch[1]) };
      }

      if (path.includes("/receive")) {
        const id = params.get("id");
        const zone = params.get("zone");
        if (id) return { kind: "receive-id", deliveryId: id };
        if (zone) return { kind: "receive-zone", zoneCode: zone };
      }
    } catch {
      // fall through
    }
  }

  return { kind: "raw", value: trimmed };
}

export function pickupPath(jobId: string, deliveryId?: string | null): string {
  const params = new URLSearchParams({ job: jobId });
  if (deliveryId) params.set("delivery", deliveryId);
  return `/pickup?${params.toString()}`;
}

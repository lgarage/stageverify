/**
 * QR URL builders and parsers. Routing logic lives in scanRouting.ts.
 * See PROJECT_STATUS/MODEL_DOSSIER.md tag: qr-routing
 *
 * Printed / Camera QRs use **long** hashes (`#/receive?id=`, `#/pickup?job=`) — reliable on
 * iOS Safari cold load. Compact `#/r?i=` still parses for older labels.
 */
import {
  shouldRouteScanToPickup,
  type DeliveryStatus,
} from "./dispatcher/models";

const PROD_APP_BASE = "https://lgarage.github.io/stageverify";

/** Easier for phone cameras — not lowest EC (L), not highest (H). */
export const ESL_QR_RENDER_PROPS = {
  level: "M" as const,
  marginSize: 2,
};

export const ESL_QR_SIZE_PREVIEW = 96;
export const ESL_QR_SIZE_PRINT = 200;

/** Printed tags always encode prod gh-pages so native camera opens the live app. */
export type EslQrOptions = { forPrint?: boolean };

function appBaseUrl(): string {
  if (typeof window !== "undefined" && window.location.origin) {
    return `${window.location.origin}${window.location.pathname}`.replace(/\/$/, "");
  }
  return PROD_APP_BASE;
}

function qrBaseUrl(options?: EslQrOptions): string {
  if (options?.forPrint) return PROD_APP_BASE;
  return appBaseUrl();
}

/** gh-pages + iOS Camera: `${base}/#/route` (slash before hash). */
export function joinBaseAndHash(base: string, hash: string): string {
  const cleanBase = base.replace(/\/$/, "");
  const stripped = hash.startsWith("#") ? hash.slice(1) : hash;
  const path = stripped.startsWith("/") ? stripped : `/${stripped}`;
  return `${cleanBase}/#${path}`;
}

export type ZoneEslOccupancy = {
  deliveryId: string;
  orderNumber: string;
  vendorName: string;
  jobId: string;
  status: DeliveryStatus;
};

export function buildPickupDeepLink(
  options: {
    jobId: string;
    deliveryId?: string | null;
    zoneCode?: string | null;
  },
  eslOptions?: EslQrOptions,
): string {
  const base = qrBaseUrl(eslOptions);
  const params = new URLSearchParams({ j: options.jobId });
  if (options.deliveryId) {
    params.set("d", options.deliveryId);
  }
  if (options.zoneCode) {
    params.set("z", options.zoneCode);
  }
  return joinBaseAndHash(base, `#/p?${params.toString()}`);
}

function buildZoneEslQrUrlAtBase(
  base: string,
  zoneCode: string,
  occupancy: ZoneEslOccupancy | null | undefined,
): string {
  if (occupancy?.deliveryId) {
    if (shouldRouteScanToPickup(occupancy.status)) {
      return buildPickupPortalUrlAtBase(base, occupancy.jobId, occupancy.deliveryId);
    }
    return joinBaseAndHash(
      base,
      `#/receive?id=${encodeURIComponent(occupancy.deliveryId)}`,
    );
  }
  return joinBaseAndHash(
    base,
    `#/receive?zone=${encodeURIComponent(zoneCode)}`,
  );
}

function buildPickupPortalUrlAtBase(
  base: string,
  jobId: string,
  deliveryId?: string | null,
): string {
  const params = new URLSearchParams({ job: jobId });
  if (deliveryId) params.set("delivery", deliveryId);
  return joinBaseAndHash(base, `#/pickup?${params.toString()}`);
}

/** Long receive URL for native Camera / gh-pages cold load (same pattern as pickup portal). */
export function buildReceivePortalUrl(
  options: {
    deliveryId?: string | null;
    zoneCode?: string | null;
  },
  eslOptions?: EslQrOptions,
): string {
  const base = qrBaseUrl(eslOptions);
  const params = new URLSearchParams();
  if (options.deliveryId) params.set("id", options.deliveryId);
  if (options.zoneCode) params.set("zone", options.zoneCode);
  const hash = params.toString() ? `#/receive?${params.toString()}` : "#/receive";
  return joinBaseAndHash(base, hash);
}

/** Deep link for a zone e-tag sign: pickup when staged, receive when in vendor flow, zone when empty. */
export function buildZoneEslQrUrl(
  zoneCode: string,
  occupancy: ZoneEslOccupancy | null | undefined,
  eslOptions?: EslQrOptions,
): string {
  return buildZoneEslQrUrlAtBase(
    qrBaseUrl(eslOptions),
    zoneCode,
    occupancy,
  );
}

/**
 * Single builder for zone e-tags and dispatcher print labels.
 * When a staging spot is assigned, payload matches the zone sign (`#/receive?zone=G2` when empty).
 */
export function buildEslTagQrUrl(input: {
  zoneCode?: string | null;
  occupancy?: ZoneEslOccupancy | null;
  deliveryId?: string | null;
  jobId?: string;
  status?: DeliveryStatus;
  options?: EslQrOptions;
}): string {
  const zone = input.zoneCode?.trim();
  if (zone) {
    const occupancy =
      input.occupancy ??
      (input.deliveryId && input.jobId && input.status
        ? {
            deliveryId: input.deliveryId,
            orderNumber: "",
            vendorName: "",
            jobId: input.jobId,
            status: input.status,
          }
        : null);
    return buildZoneEslQrUrlAtBase(qrBaseUrl(input.options), zone, occupancy);
  }
  if (input.deliveryId) {
    return buildReceivePortalUrl(
      { deliveryId: input.deliveryId },
      input.options,
    );
  }
  return buildReceivePortalUrl({}, input.options);
}

/** Dynamic line shown on the e-ink tag below the zone code. */
export function formatZoneEslStatusLine(
  occupancy: ZoneEslOccupancy | null | undefined,
): string {
  if (!occupancy) return "AVAILABLE";
  return `${occupancy.orderNumber} — ${occupancy.vendorName}`;
}

export function buildReceiveDeepLink(
  options: {
    deliveryId?: string | null;
    zoneCode?: string | null;
  },
  eslOptions?: EslQrOptions,
): string {
  return buildEslTagQrUrl({
    zoneCode: options.zoneCode,
    deliveryId: options.deliveryId,
    options: eslOptions,
  });
}

/** @deprecated Use buildEslTagQrUrl — kept for callers that only pass deliveryId */
export function buildDeliveryLabelQrUrl(deliveryId: string): string {
  return buildEslTagQrUrl({ deliveryId, options: { forPrint: true } });
}

/** Fix legacy and compact hashes so HashRouter routes match. */
export function normalizeReceiveHash(): void {
  const hash = window.location.hash;

  if (/^#\/?r(\?|$)/i.test(hash) && !hash.includes("receive")) {
    const qsStart = hash.indexOf("?");
    const params =
      qsStart !== -1
        ? new URLSearchParams(hash.slice(qsStart + 1))
        : new URLSearchParams();
    const canonical = new URLSearchParams();
    const id = params.get("i") ?? params.get("id");
    const zone = params.get("z") ?? params.get("zone");
    if (id) canonical.set("id", id);
    if (zone) canonical.set("zone", zone);
    window.location.hash = canonical.toString()
      ? `#/receive?${canonical.toString()}`
      : "#/receive";
    return;
  }

  if (hash.startsWith("#receive") && !hash.startsWith("#/receive")) {
    window.location.hash = hash.replace("#receive", "#/receive");
  }
}

/** Fix legacy hashes missing the slash after `#` (Safari / shared links). */
export function normalizeLegacyAppHash(): void {
  let hash = window.location.hash;
  if (!hash || hash === "#") return;

  const checkinMatch = hash.match(/^#\/checkin\/([^/?]+)/);
  if (checkinMatch) {
    window.location.hash = `#/receive?id=${encodeURIComponent(
      decodeURIComponent(checkinMatch[1]),
    )}`;
    return;
  }

  if (hash.startsWith("#pickup") && !hash.startsWith("#/pickup")) {
    hash = hash.replace("#pickup", "#/pickup");
  } else if (hash.startsWith("#receive") && !hash.startsWith("#/receive")) {
    hash = hash.replace("#receive", "#/receive");
  } else if (/^#[^/]/.test(hash)) {
    hash = `#/${hash.slice(1)}`;
  }

  if (hash !== window.location.hash) {
    window.location.hash = hash;
  }
}

/** Compact #/p?j= → #/pickup?job= for pickup portal. */
export function normalizePickupHash(): void {
  const hash = window.location.hash;
  if (!/^#\/?p(\?|$)/i.test(hash) || hash.includes("pickup")) {
    return;
  }
  const qsStart = hash.indexOf("?");
  const params =
    qsStart !== -1
      ? new URLSearchParams(hash.slice(qsStart + 1))
      : new URLSearchParams();
  const canonical = new URLSearchParams();
  const job = params.get("j") ?? params.get("job");
  const delivery = params.get("d") ?? params.get("delivery");
  const zone = params.get("z") ?? params.get("zone");
  if (job) canonical.set("job", job);
  if (delivery) canonical.set("delivery", delivery);
  if (zone) canonical.set("zone", zone);
  if (!canonical.toString()) {
    window.location.hash = "#/pickup";
    return;
  }
  window.location.hash = `#/pickup?${canonical.toString()}`;
}

export function readReceiveParams(
  searchParams: URLSearchParams,
): { id: string | null; zone: string | null } {
  const id = searchParams.get("id") ?? searchParams.get("i");
  const zone = searchParams.get("zone") ?? searchParams.get("z");
  if (id || zone) return { id, zone };

  const hash = window.location.hash;
  const qs = hash.indexOf("?");
  if (qs === -1) return { id: null, zone: null };
  const fromHash = new URLSearchParams(hash.slice(qs + 1));
  return {
    id: fromHash.get("id") ?? fromHash.get("i"),
    zone: fromHash.get("zone") ?? fromHash.get("z"),
  };
}

export function hasReceiveDeepLink(): boolean {
  normalizeReceiveHash();
  const hash = window.location.hash;
  const qs = hash.indexOf("?");
  if (qs === -1) return false;
  const p = new URLSearchParams(hash.slice(qs + 1));
  return Boolean(
    p.get("id") || p.get("i") || p.get("zone") || p.get("z"),
  );
}

export type ParsedQrScan =
  | { kind: "receive-id"; deliveryId: string }
  | { kind: "receive-zone"; zoneCode: string }
  | { kind: "pickup"; jobId: string | null; deliveryId: string | null; zoneCode: string | null }
  | { kind: "raw"; value: string };

/** `#receive?…` → `#/receive?…`; leaves compact routes as-is for parseHashRoute. */
export function normalizeAppHash(hash: string): string {
  if (!hash.startsWith("#")) return hash;
  if (hash.startsWith("#receive") && !hash.startsWith("#/receive")) {
    return hash.replace("#receive", "#/receive");
  }
  if (hash.startsWith("#pickup") && !hash.startsWith("#/pickup")) {
    return hash.replace("#pickup", "#/pickup");
  }
  return hash;
}

function parseHashRoute(
  hash: string,
  params: URLSearchParams,
): ParsedQrScan | null {
  const path = hash.split("?")[0] ?? "";

  if (
    /\/p($|\?)/i.test(path) ||
    path.endsWith("/pickup") ||
    path.includes("/pickup")
  ) {
    return {
      kind: "pickup",
      jobId: params.get("j") ?? params.get("job"),
      deliveryId: params.get("d") ?? params.get("delivery"),
      zoneCode: params.get("z") ?? params.get("zone"),
    };
  }

  const checkinMatch = path.match(/\/checkin\/([^/?]+)/);
  if (checkinMatch) {
    return {
      kind: "receive-id",
      deliveryId: decodeURIComponent(checkinMatch[1]),
    };
  }

  if (/\/r($|\?)/i.test(path) && !path.includes("receive")) {
    const id = params.get("i") ?? params.get("id");
    const zone = params.get("z") ?? params.get("zone");
    if (id) return { kind: "receive-id", deliveryId: id };
    if (zone) return { kind: "receive-zone", zoneCode: zone };
  }

  if (path.includes("/receive") || path.includes("receive")) {
    const id = params.get("id") ?? params.get("i");
    const zone = params.get("zone") ?? params.get("z");
    if (id) return { kind: "receive-id", deliveryId: id };
    if (zone) return { kind: "receive-zone", zoneCode: zone };
  }

  return null;
}

function parseSvCompactToken(trimmed: string): ParsedQrScan | null {
  const match = /^SV:([zrp]):(.+)$/i.exec(trimmed);
  if (!match) return null;
  const type = match[1].toLowerCase();
  const rest = match[2].trim();
  if (!rest) return null;

  switch (type) {
    case "z":
      return { kind: "receive-zone", zoneCode: rest };
    case "r":
      return { kind: "receive-id", deliveryId: rest };
    case "p": {
      const [jobId, deliveryId] = rest.split("|");
      if (!jobId) return null;
      return {
        kind: "pickup",
        jobId,
        deliveryId: deliveryId ?? null,
        zoneCode: null,
      };
    }
    default:
      return null;
  }
}

export function canonicalHashFromParsed(parsed: ParsedQrScan): string | null {
  switch (parsed.kind) {
    case "receive-id":
      return `#/receive?id=${encodeURIComponent(parsed.deliveryId)}`;
    case "receive-zone":
      return `#/receive?zone=${encodeURIComponent(parsed.zoneCode)}`;
    case "pickup": {
      if (!parsed.jobId) return null;
      const params = new URLSearchParams({ job: parsed.jobId });
      if (parsed.deliveryId) params.set("delivery", parsed.deliveryId);
      if (parsed.zoneCode) params.set("zone", parsed.zoneCode);
      return `#/pickup?${params.toString()}`;
    }
    default:
      return null;
  }
}

/** Parse a scanned QR payload (URL, compact token, or raw zone code). */
export function parseScannedQr(raw: string): ParsedQrScan {
  const trimmed = raw.trim();

  const svParsed = parseSvCompactToken(trimmed);
  if (svParsed) return svParsed;

  if (trimmed.startsWith("http")) {
    try {
      const url = new URL(trimmed);
      const hash = normalizeAppHash(url.hash);
      const qsStart = hash.indexOf("?");
      const params =
        qsStart !== -1
          ? new URLSearchParams(hash.slice(qsStart + 1))
          : new URLSearchParams();
      const fromHash = parseHashRoute(hash, params);
      if (fromHash) return fromHash;
    } catch {
      // fall through
    }
  }

  return { kind: "raw", value: trimmed };
}

/** Canonical app hash for HashRouter after scanning a URL or token. */
export function hashFromScannedQrUrl(raw: string): string | null {
  const parsed = parseScannedQr(raw);
  return canonicalHashFromParsed(parsed);
}

/** Navigate to the scanned QR destination (canonical hash) on confirm. */
export function applyHashFromScannedQr(raw: string): boolean {
  const hash = hashFromScannedQrUrl(raw);
  if (!hash) return false;
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
  return true;
}

export function pickupPath(jobId: string, deliveryId?: string | null): string {
  const params = new URLSearchParams({ job: jobId });
  if (deliveryId) params.set("delivery", deliveryId);
  return `/pickup?${params.toString()}`;
}

/** Permanent location QR URL — locked Phase 1 contract (never change after print). */
export function buildPermanentLocationUrl(
  locationCode: string,
  eslOptions?: EslQrOptions,
): string {
  const base = qrBaseUrl(eslOptions);
  return joinBaseAndHash(
    base,
    `#/s?loc=${encodeURIComponent(locationCode.trim())}`,
  );
}

/** Fix compact / legacy location scan hashes for HashRouter. */
export function normalizeLocationScanHash(): void {
  const hash = window.location.hash;
  if (!/^#\/?s(\?|$)/i.test(hash)) return;
  const qsStart = hash.indexOf("?");
  const params =
    qsStart !== -1
      ? new URLSearchParams(hash.slice(qsStart + 1))
      : new URLSearchParams();
  const loc = params.get("loc") ?? params.get("l");
  if (!loc) return;
  window.location.hash = `#/s?loc=${encodeURIComponent(loc)}`;
}

export function readLocationScanParams(
  searchParams: URLSearchParams,
): { loc: string | null } {
  const loc = searchParams.get("loc") ?? searchParams.get("l");
  if (loc) return { loc };

  const hash = window.location.hash;
  const qs = hash.indexOf("?");
  if (qs === -1) return { loc: null };
  const fromHash = new URLSearchParams(hash.slice(qs + 1));
  return { loc: fromHash.get("loc") ?? fromHash.get("l") };
}

/** Read pickup deep-link params from router search or hash (mobile Safari fallback). */
export function readPickupParams(
  searchParams: URLSearchParams,
): {
  job: string | null;
  delivery: string | null;
  zone: string | null;
  token: string | null;
} {
  const token = searchParams.get("t");
  const job = searchParams.get("job") ?? searchParams.get("j");
  const delivery = searchParams.get("delivery") ?? searchParams.get("d");
  const zone = searchParams.get("zone") ?? searchParams.get("z");
  if (token || job || delivery || zone) {
    return { job, delivery, zone, token };
  }

  const hash = window.location.hash;
  const qs = hash.indexOf("?");
  if (qs === -1) return { job: null, delivery: null, zone: null, token: null };
  const fromHash = new URLSearchParams(hash.slice(qs + 1));
  return {
    job: fromHash.get("job") ?? fromHash.get("j"),
    delivery: fromHash.get("delivery") ?? fromHash.get("d"),
    zone: fromHash.get("zone") ?? fromHash.get("z"),
    token: fromHash.get("t"),
  };
}

/** Full gh-pages pickup URL using long `#/pickup?` form (reliable on cold load). */
export function buildPickupPortalUrl(
  jobId: string,
  deliveryId?: string | null,
  eslOptions?: EslQrOptions,
): string {
  return buildPickupPortalUrlAtBase(qrBaseUrl(eslOptions), jobId, deliveryId);
}

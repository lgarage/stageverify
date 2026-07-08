/**
 * Single QR scan router — all entry points (URL deep link, camera, manual) call here.
 * See PROJECT_STATUS/MODEL_DOSSIER.md tag: qr-routing
 */
import { resolveReceiveZoneLookupClient } from "./phase2CallableClients";
import {
  parseScannedQr,
  pickupPath,
  type ParsedQrScan,
} from "./receiveQrUrls";

/** Vendor check-in has a single UI: `ReceivingPage` at `/#/receive`. */
export type ScanHandlerTarget = "receive-page";

export type SyncScanIntent =
  | { kind: "navigate"; path: string }
  | { kind: "resolve-delivery"; deliveryId: string }
  | { kind: "resolve-zone"; zoneCode: string }
  | { kind: "unrecognized" };

export type ScanHandleResult =
  | { action: "navigate"; path: string }
  | { action: "load-receive"; deliveryId: string }
  | { action: "not-found" };

export function zoneCodeFromParsed(parsed: ParsedQrScan): string | null {
  if (parsed.kind === "receive-zone") return parsed.zoneCode;
  if (parsed.kind === "pickup" && parsed.zoneCode) return parsed.zoneCode;
  if (parsed.kind === "raw") {
    const trimmed = parsed.value.trim();
    return trimmed || null;
  }
  return null;
}

export function syncScanIntent(parsed: ParsedQrScan): SyncScanIntent {
  if (parsed.kind === "pickup" && parsed.jobId) {
    return {
      kind: "navigate",
      path: pickupPath(parsed.jobId, parsed.deliveryId),
    };
  }
  if (parsed.kind === "receive-id") {
    return { kind: "resolve-delivery", deliveryId: parsed.deliveryId };
  }
  const zoneCode = zoneCodeFromParsed(parsed);
  if (zoneCode) return { kind: "resolve-zone", zoneCode };
  return { kind: "unrecognized" };
}

export async function resolveSyncScanIntent(
  intent: SyncScanIntent,
  _target: ScanHandlerTarget,
): Promise<ScanHandleResult> {
  if (intent.kind === "navigate") {
    return { action: "navigate", path: intent.path };
  }
  if (intent.kind === "resolve-delivery") {
    return { action: "load-receive", deliveryId: intent.deliveryId };
  }
  if (intent.kind === "resolve-zone") {
    const lookup = await resolveReceiveZoneLookupClient(intent.zoneCode);
    if (!lookup.found) return { action: "not-found" };
    if (lookup.kind === "pickup") {
      return {
        action: "navigate",
        path: pickupPath(lookup.jobId, lookup.deliveryId),
      };
    }
    return { action: "load-receive", deliveryId: lookup.deliveryId };
  }
  return { action: "not-found" };
}

/** Parse raw QR text and resolve to a handler action for the given page. */
export async function handleScannedQr(
  raw: string,
  target: ScanHandlerTarget,
): Promise<ScanHandleResult> {
  return resolveSyncScanIntent(syncScanIntent(parseScannedQr(raw)), target);
}

export type ZoneScanDisposition =
  | { kind: "pickup"; jobId: string; deliveryId: string }
  | { kind: "receive"; deliveryId: string }
  | null;

/** Zone code → pickup or receive (PickupPortal deep links + walk-up). */
export async function resolveZoneScanDisposition(
  zoneCode: string,
): Promise<ZoneScanDisposition> {
  const lookup = await resolveReceiveZoneLookupClient(zoneCode);
  if (!lookup.found) return null;
  if (lookup.kind === "pickup") {
    return {
      kind: "pickup",
      jobId: lookup.jobId,
      deliveryId: lookup.deliveryId,
    };
  }
  return { kind: "receive", deliveryId: lookup.deliveryId };
}

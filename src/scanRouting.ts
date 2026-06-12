/**
 * Single QR scan router — all entry points (URL deep link, camera, manual) call here.
 * See PROJECT_STATUS/MODEL_DOSSIER.md tag: qr-routing
 */
import {
  getDeliveryDetailsByStagingCode,
  getDeliveryDetailsPublic,
} from "./dispatcher/firestoreService";
import type { DeliveryDetails } from "./dispatcher/models";
import { shouldRouteScanToPickup } from "./dispatcher/models";
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

function deliveryToScanResult(details: DeliveryDetails): ScanHandleResult {
  if (shouldRouteScanToPickup(details.delivery.status)) {
    return { action: "not-found" };
  }
  return { action: "load-receive", deliveryId: details.delivery.id };
}

export async function resolveSyncScanIntent(
  intent: SyncScanIntent,
  _target: ScanHandlerTarget,
): Promise<ScanHandleResult> {
  if (intent.kind === "navigate") {
    return { action: "navigate", path: intent.path };
  }
  if (intent.kind === "resolve-delivery") {
    const details = await getDeliveryDetailsPublic(intent.deliveryId);
    if (!details) return { action: "not-found" };
    return deliveryToScanResult(details);
  }
  if (intent.kind === "resolve-zone") {
    const details = await getDeliveryDetailsByStagingCode(intent.zoneCode);
    if (!details) return { action: "not-found" };
    return deliveryToScanResult(details);
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
  const details = await getDeliveryDetailsByStagingCode(zoneCode);
  if (!details) return null;
  if (shouldRouteScanToPickup(details.delivery.status)) {
    return {
      kind: "pickup",
      jobId: details.delivery.jobId,
      deliveryId: details.delivery.id,
    };
  }
  return { kind: "receive", deliveryId: details.delivery.id };
}

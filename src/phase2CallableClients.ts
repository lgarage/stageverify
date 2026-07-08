import type { DeliveryDetails, StagingLocation } from "./dispatcher/models";
import type { StagingLocationOccupant } from "./dispatcher/firestoreService";

const CF_BASE =
  "https://us-central1-stageverify-db.cloudfunctions.net";

const CALLABLE_TIMEOUT_MS = 20_000;

type CallableBody<T> = {
  result?: T;
  error?: { message?: string };
};

async function callCallable<T>(
  functionName: string,
  data: Record<string, unknown>,
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), CALLABLE_TIMEOUT_MS);
  try {
    const response = await fetch(`${CF_BASE}/${functionName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
      signal: controller.signal,
    });
    let body: CallableBody<T>;
    try {
      body = (await response.json()) as CallableBody<T>;
    } catch {
      throw new Error("Request failed. Check your connection and try again.");
    }
    if (body.error?.message) {
      throw new Error(body.error.message);
    }
    if (body.result === undefined) {
      throw new Error("Request failed. Check your connection and try again.");
    }
    return body.result;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Request timed out. Check your connection and try again.");
    }
    if (err instanceof Error) throw err;
    throw new Error("Request failed. Check your connection and try again.");
  } finally {
    window.clearTimeout(timer);
  }
}

export async function getVendorReceiveDetailsClient(input: {
  deliveryId: string;
  sessionToken: string;
}): Promise<DeliveryDetails> {
  return callCallable<DeliveryDetails>("getVendorReceiveDetails", input);
}

export type ZoneLookupResult =
  | { found: false }
  | { found: true; kind: "receive"; deliveryId: string }
  | { found: true; kind: "pickup"; jobId: string; deliveryId: string };

export async function resolveReceiveZoneLookupClient(
  zoneCode: string,
): Promise<ZoneLookupResult> {
  return callCallable<ZoneLookupResult>("resolveReceiveZoneLookup", {
    zoneCode,
  });
}

export async function getPickupPortalDataClient(input: {
  token: string;
  jobId: string;
  includeDeliveryId?: string;
}): Promise<{
  deliveries: DeliveryDetails[];
  stagingLocations: StagingLocation[];
}> {
  return callCallable("getPickupPortalData", input);
}

export async function getVendorStagingOccupancyClient(input: {
  deliveryId: string;
  sessionToken: string;
  excludeDeliveryId?: string;
}): Promise<{ occupancy: Record<string, StagingLocationOccupant> }> {
  return callCallable("getVendorStagingOccupancy", input);
}

export async function submitVendorCheckinClient(input: {
  deliveryId: string;
  sessionToken: string;
  driverName: string;
  itemUpdates: Array<{
    id: string;
    qtyReceived: number;
    qtyMissing: number;
    qtyDamaged: number;
  }>;
}): Promise<{ details: DeliveryDetails | null }> {
  return callCallable("submitVendorCheckin", input);
}

export async function updateVendorItemQtyClient(input: {
  deliveryId: string;
  sessionToken: string;
  itemId: string;
  qtyOrdered: number;
  qtyReceived: number;
  qtyMissing: number;
}): Promise<{ ok: boolean }> {
  return callCallable("updateVendorItemQty", input);
}

export async function updateVendorDeliveryStatusClient(input: {
  deliveryId: string;
  sessionToken: string;
  toStatus?: string;
  action?: "revert" | "update";
  vendorRevertWindowMinutes?: number;
  actorName?: string;
}): Promise<{ details: DeliveryDetails | null }> {
  return callCallable("updateVendorDeliveryStatus", input);
}

export async function markPickupDeliveryInstalledClient(input: {
  deliveryId: string;
  jobId: string;
  pickupToken: string;
}): Promise<{ details: DeliveryDetails | null }> {
  return callCallable("markPickupDeliveryInstalled", input);
}

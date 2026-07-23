import type { DeliveryDetails, StagingLocation } from "./dispatcher/models";
import type { StagingLocationOccupant } from "./dispatcher/firestoreService";
import { auth } from "./firebase";

const CF_BASE =
  "https://us-central1-stageverify-db.cloudfunctions.net";

const CALLABLE_TIMEOUT_MS = 20_000;

type CallableBody<T> = {
  result?: T;
  error?: { message?: string };
};

async function callCallableAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const user = auth.currentUser;
  if (user) {
    const token = await user.getIdToken();
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function callCallable<T>(
  functionName: string,
  data: Record<string, unknown>,
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), CALLABLE_TIMEOUT_MS);
  try {
    const headers = await callCallableAuthHeaders();
    const response = await fetch(`${CF_BASE}/${functionName}`, {
      method: "POST",
      headers,
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
  token?: string;
  technicianSessionToken?: string;
  jobId: string;
  includeDeliveryId?: string;
}): Promise<{
  deliveries: DeliveryDetails[];
  stagingLocations: StagingLocation[];
}> {
  return callCallable("getPickupPortalData", input);
}

export async function getTechnicianReleasedJobsClient(input: {
  sessionToken: string;
}): Promise<{
  jobs: import("./dispatcher/models").TechnicianReleasedJobSummary[];
  releaseDate: string;
  scannedStagingLocationCode: string | null;
  technicianName: string;
}> {
  return callCallable("getTechnicianReleasedJobs", input);
}

export async function releaseJobsToTechnicianClient(input: {
  technicianId: string;
  jobIds: string[];
  releaseDate?: string;
  replace?: boolean;
}): Promise<{
  success: boolean;
  technicianId: string;
  releaseDate: string;
  jobIds: string[];
}> {
  return callCallable("releaseJobsToTechnician", input);
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
  pickupToken?: string;
  technicianSessionToken?: string;
}): Promise<{ details: DeliveryDetails | null }> {
  return callCallable("markPickupDeliveryInstalled", input);
}

export async function getLocationPublicBrandingClient(
  locationCode: string,
): Promise<
  | { found: false }
  | {
      found: true;
      locationId: string;
      code: string;
      label: string;
      type: string;
      parcelIntakeEnabled?: boolean;
      isCatchAllParcelIntake?: boolean;
    }
> {
  return callCallable("getLocationPublicBranding", { locationCode });
}

export async function setManagementPinClient(input: {
  pin: string;
}): Promise<{ success: boolean }> {
  return callCallable("setManagementPin", input);
}

export async function getManagementWaitingPartsClient(input: {
  sessionToken: string;
}): Promise<{
  jobs: import("./dispatcher/models").ManagementWaitingPartsJobSummary[];
}> {
  return callCallable("getManagementWaitingParts", input);
}

export async function markCatchAllDeliveryReceivedClient(input: {
  sessionToken: string;
  deliveryId: string;
}): Promise<{
  deliveryId: string;
  status: string;
  idempotent?: boolean;
}> {
  return callCallable("markCatchAllDeliveryReceived", input);
}

export async function captureUnidentifiableParcelClient(input: {
  sessionToken: string;
  vendorDescription: string;
  parcelDescription: string;
  jobId?: string;
}): Promise<{
  deliveryId: string;
  orderNumber: string;
  reviewFlagged: boolean;
}> {
  return callCallable("captureUnidentifiableParcel", input);
}

export async function getJobVendorDeliveriesClient(input: {
  jobId: string;
  sessionToken: string;
}): Promise<{
  jobId: string;
  scannedStagingLocationCode: string | null;
  deliveries: import("./dispatcher/models").JobVendorDeliverySummary[];
}> {
  return callCallable("getJobVendorDeliveries", input);
}

export async function recordVendorLocationScanClient(input: {
  deliveryId: string;
  sessionToken: string;
}): Promise<{ ok: boolean; recorded: boolean }> {
  return callCallable("recordVendorLocationScan", input);
}

export async function getVendorRunDeliveriesClient(input: {
  sessionToken: string;
}): Promise<{
  vendorId: string;
  scannedStagingLocationCode: string | null;
  deliveries: import("./dispatcher/models").VendorRunDeliverySummary[];
}> {
  return callCallable("getVendorRunDeliveries", input);
}

export async function markVendorDeliveriesBulkClient(input: {
  sessionToken: string;
  deliveryIds: string[];
  actorName?: string;
}): Promise<{
  results: Array<{
    deliveryId: string;
    success: boolean;
    error?: string;
    status?: string;
    vendorPhysicalDropoffConfirmed?: boolean;
    idempotent?: boolean;
  }>;
}> {
  return callCallable("markVendorDeliveriesBulk", input);
}

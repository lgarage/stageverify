import type { DeliveryDetails, StagingLocation } from "./dispatcher/models";
import type { StagingLocationOccupant } from "./dispatcher/firestoreService";
import { auth } from "./firebase";
import { markVendorPinDebug } from "./vendorPinDebugTimeline";

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

export async function callCallable<T>(
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

export async function recordTechnicianJobOpenClient(
  sessionToken: string,
  jobId: string,
  clientOpenId: string,
  source?: "location_scan" | "pickup_deep_link",
): Promise<{ duplicate: boolean }> {
  return callCallable<{ duplicate: boolean }>("recordTechnicianJobOpen", {
    sessionToken,
    jobId,
    clientOpenId,
    ...(source ? { source } : {}),
  });
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
  sessionToken?: string;
}): Promise<{ success: boolean }> {
  return callCallable("setManagementPin", input);
}

export async function listManagementPinsClient(): Promise<{
  pins: import("./dispatcher/models").ManagementPinPublic[];
}> {
  return callCallable("listManagementPins", {});
}

export async function upsertManagementPinClient(input: {
  id?: string;
  label?: string;
  pin?: string;
  active?: boolean;
  permissions?: import("./dispatcher/models").ManagementPinPermissions;
  sessionToken?: string;
}): Promise<{ success: boolean; id: string }> {
  return callCallable("upsertManagementPin", input);
}

export async function deactivateManagementPinClient(input: {
  id: string;
}): Promise<{ success: boolean }> {
  return callCallable("deactivateManagementPin", input);
}

export async function listDispatchersClient(): Promise<{
  dispatchers: import("./dispatcher/models").DispatcherAccountSummary[];
}> {
  return callCallable("listDispatchers", {});
}

export async function provisionDispatcherClient(input: {
  email: string;
  temporaryPassword?: string;
  manager?: boolean;
  role?: import("./dispatcher/models").DispatcherAccessRole;
  fullName: string;
  adminPin?: string;
}): Promise<{
  success: boolean;
  uid: string;
  email: string;
  fullName: string;
  temporaryPassword: string;
  manager: boolean;
  role: import("./dispatcher/models").DispatcherAccessRole;
}> {
  return callCallable("provisionDispatcher", input);
}

export async function updateDispatcherAccessClient(
  input: import("./dispatcher/models").UpdateDispatcherAccessRequest,
): Promise<import("./dispatcher/models").UpdateDispatcherAccessResult> {
  return callCallable("updateDispatcherAccess", { ...input });
}

export async function setAdminPinClient(
  input: import("./dispatcher/models").SetAdminPinRequest,
): Promise<import("./dispatcher/models").SetAdminPinResult> {
  return callCallable("setAdminPin", { ...input });
}

export async function bootstrapFirstAdminClient(input: {
  uid?: string;
  fullName: string;
  adminPin: string;
}): Promise<{
  success: true;
  uid: string;
  fullName: string;
  role: "admin";
}> {
  return callCallable("bootstrapFirstAdmin", { ...input });
}

export async function deactivateDispatcherClient(input: {
  uid: string;
}): Promise<{ success: boolean }> {
  return callCallable("deactivateDispatcher", input);
}

export async function removeDispatcherClient(input: {
  uid: string;
}): Promise<{ success: boolean; uid: string }> {
  return callCallable("removeDispatcher", input);
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
  markVendorPinDebug("LIST_REQUEST_START");
  try {
    const result = await callCallable<{
      vendorId: string;
      scannedStagingLocationCode: string | null;
      deliveries: import("./dispatcher/models").VendorRunDeliverySummary[];
    }>("getVendorRunDeliveries", input);
    markVendorPinDebug(
      "LIST_REQUEST_DONE",
      `${result.deliveries.length} deliveries`,
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "list request failed";
    markVendorPinDebug("ERROR:LIST_REQUEST", message);
    throw err;
  }
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

export async function matchUnplannedVendorDeliveryClient(input: {
  sessionToken: string;
  reference: string;
}): Promise<import("./dispatcher/models").MatchUnplannedVendorDeliveryResult> {
  return callCallable("matchUnplannedVendorDelivery", input);
}

export async function createUnplannedVendorDeliveryClient(input: {
  sessionToken: string;
  reference: string;
  spaceTier: import("./dispatcher/models").UnplannedSpaceTier;
  packageCount?: number;
}): Promise<import("./dispatcher/models").CreateUnplannedVendorDeliveryResult> {
  return callCallable("createUnplannedVendorDelivery", input);
}

export async function confirmUnplannedVendorDeliveryMatchClient(input: {
  sessionToken: string;
  reference: string;
  deliveryId: string;
  spaceTier?: import("./dispatcher/models").UnplannedSpaceTier;
  packageCount?: number;
}): Promise<import("./dispatcher/models").UnplannedVendorDeliverySuccessResult> {
  return callCallable("confirmUnplannedVendorDeliveryMatch", input);
}

export async function startAdminAccessSessionClient(input: {
  targetType: import("./dispatcher/models").AccessPinTargetType;
  targetId: string;
  adminPin: string;
}): Promise<import("./dispatcher/models").StartAdminAccessSessionResult> {
  return callCallable("startAdminAccessSession", input);
}

export async function revokeAdminAccessSessionClient(input: {
  sessionToken: string;
  targetType?: import("./dispatcher/models").AccessPinTargetType;
  targetId?: string;
}): Promise<import("./dispatcher/models").RevokeAdminAccessSessionResult> {
  return callCallable("revokeAdminAccessSession", input);
}

export async function revealAccessPinClient(input: {
  targetType: import("./dispatcher/models").AccessPinTargetType;
  targetId: string;
  sessionToken: string;
}): Promise<import("./dispatcher/models").RevealAccessPinResult> {
  return callCallable("revealAccessPin", input);
}

export async function setAccessPinClient(input: {
  targetType: import("./dispatcher/models").AccessPinTargetType;
  targetId: string;
  pin: string;
  sessionToken?: string;
}): Promise<import("./dispatcher/models").SetAccessPinResult> {
  return callCallable("setAccessPin", input);
}

export async function migrateAccessPinsClient(input?: {
  dryRun?: boolean;
  limit?: number;
}): Promise<import("./dispatcher/models").MigrateAccessPinsResult> {
  return callCallable("migrateAccessPins", input ?? {});
}

export async function listPinAccessAuditClient(input?: {
  limit?: number;
  startAfterCreatedAt?: string;
}): Promise<import("./dispatcher/models").ListPinAccessAuditResult> {
  return callCallable("listPinAccessAudit", input ?? {});
}

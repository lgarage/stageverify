import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  firestoreDataService,
  getAppSettings,
  getDeliveryDetailsPublicForVendorReceive,
} from "./dispatcher/firestoreService";
import {
  normalizeLocationScanHash,
  readLocationScanParams,
} from "./receiveQrUrls";
import {
  getJobVendorDeliveriesClient,
  getLocationPublicBrandingClient,
  getVendorRunDeliveriesClient,
  markVendorDeliveriesBulkClient,
  recordVendorLocationScanClient,
} from "./phase2CallableClients";
import type {
  DeliveryDetails,
  JobVendorDeliverySummary,
  VendorRunDeliverySummary,
} from "./dispatcher/models";
import { VendorPinGate } from "./VendorPinGate";
import { TechnicianPinGate } from "./TechnicianPinGate";
import {
  bindTechnicianSessionToJob,
  clearTechnicianPinSession,
  getTechnicianSessionToken,
  isTechnicianPinSessionValid,
  touchTechnicianPinSession,
} from "./technicianPinSession";
import { getTechnicianReleasedJobsClient } from "./phase2CallableClients";
import type { TechnicianReleasedJobSummary } from "./dispatcher/models";
import { VendorDeliveredHub } from "./VendorDeliveredHub";
import {
  bridgeJobSessionToDelivery,
  clearJobPinSession,
  clearVendorRunPinSession,
  getJobPinSession,
  getJobSessionToken,
  getVendorRunPinSession,
  getVendorRunSessionToken,
  isJobPinSessionValid,
  isVendorRunPinSessionValid,
  touchVendorRunPinSession,
} from "./vendorPinSession";
import { isVendorSessionError } from "./vendorSessionErrors";
import { useVendorPinActivity } from "./useVendorPinActivity";
import { PublicNetworkErrorPanel } from "./PublicNetworkErrorPanel";
import { isOutsideShopGeofence } from "./geofence";

type Step =
  | "loading"
  | "missing"
  | "pin"
  | "list"
  | "vendor-list"
  | "tech-list"
  | "hub"
  | "done";
type SessionScope = "job" | "vendor" | null;
type PinRole = "vendor" | "technician";

interface LocationBranding {
  code: string;
  label: string;
  type: string;
}

function formatSpotLine(row: VendorRunDeliverySummary): string {
  const spot =
    row.stagingLocationCodes.length > 0
      ? row.stagingLocationCodes.join(", ")
      : "—";
  const inv = row.vendorInvoiceNumber ?? row.orderNumber;
  const po = row.poNumber ?? "—";
  const line = `${spot} · Inv ${inv} · PO ${po}`;
  return line.length > 72 ? `${line.slice(0, 69)}…` : line;
}

export function LocationScanPage() {
  const [searchParams] = useSearchParams();
  normalizeLocationScanHash();

  const { loc: locationCode } = readLocationScanParams(searchParams);

  const [step, setStep] = useState<Step>("loading");
  const [branding, setBranding] = useState<LocationBranding | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [sessionScope, setSessionScope] = useState<SessionScope>(null);
  const [deliveries, setDeliveries] = useState<JobVendorDeliverySummary[]>([]);
  const [vendorRunDeliveries, setVendorRunDeliveries] = useState<
    VendorRunDeliverySummary[]
  >([]);
  const [checkedDeliveryIds, setCheckedDeliveryIds] = useState<Set<string>>(
    new Set(),
  );
  const [expandedDeliveryIds, setExpandedDeliveryIds] = useState<Set<string>>(
    new Set(),
  );
  const [confirmBulkOpen, setConfirmBulkOpen] = useState(false);
  const [scannedCode, setScannedCode] = useState<string | null>(null);
  const [deliveryDetails, setDeliveryDetails] =
    useState<DeliveryDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outsideGeofence, setOutsideGeofence] = useState<boolean | null>(null);
  const [vendorGeofenceEnforce, setVendorGeofenceEnforce] = useState(false);
  const [revertWindowMinutes, setRevertWindowMinutes] = useState(60);
  const [reverting, setReverting] = useState(false);
  const [pinRole, setPinRole] = useState<PinRole>("vendor");
  const [technicianId, setTechnicianId] = useState<string | null>(null);
  const [technicianName, setTechnicianName] = useState<string | null>(null);
  const [releasedJobs, setReleasedJobs] = useState<TechnicianReleasedJobSummary[]>(
    [],
  );

  const activeVendorRun = useMemo(() => {
    return vendorRunDeliveries.filter((d) => !d.vendorPhysicalDropoffConfirmed);
  }, [vendorRunDeliveries]);

  const deliveredVendorRun = useMemo(() => {
    return vendorRunDeliveries.filter((d) => d.vendorPhysicalDropoffConfirmed);
  }, [vendorRunDeliveries]);

  const loadBranding = useCallback(async () => {
    if (!locationCode) {
      setStep("missing");
      return;
    }
    setStep("loading");
    try {
      const result = await getLocationPublicBrandingClient(locationCode);
      if (!result.found) {
        setStep("missing");
        return;
      }
      setBranding({
        code: result.code,
        label: result.label,
        type: result.type,
      });
      setStep("pin");
    } catch {
      setError("Could not load location. Check your connection.");
      setStep("missing");
    }
  }, [locationCode]);

  useEffect(() => {
    void loadBranding();
  }, [loadBranding]);

  useEffect(() => {
    void getAppSettings().then((settings) => {
      setVendorGeofenceEnforce(settings.vendorGeofenceEnforce === true);
      setRevertWindowMinutes(settings.vendorRevertWindowMinutes);
      const lat = settings.shopLatitude;
      const lng = settings.shopLongitude;
      const radius = settings.shopGeofenceRadiusMeters;
      if (
        typeof lat !== "number" ||
        typeof lng !== "number" ||
        typeof radius !== "number" ||
        radius <= 0 ||
        !navigator.geolocation
      ) {
        setOutsideGeofence(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setOutsideGeofence(
            isOutsideShopGeofence(
              pos.coords.latitude,
              pos.coords.longitude,
              lat,
              lng,
              radius,
            ),
          );
        },
        () => setOutsideGeofence(null),
        { enableHighAccuracy: false, timeout: 12_000, maximumAge: 60_000 },
      );
    });
  }, []);

  const openDelivery = useCallback(
    async (resolvedJobId: string, deliveryId: string) => {
      setLoading(true);
      setError(null);
      try {
        bridgeJobSessionToDelivery(resolvedJobId, deliveryId);
        const token = getJobSessionToken(resolvedJobId);
        if (token) {
          await recordVendorLocationScanClient({
            deliveryId,
            sessionToken: token,
          });
        }
        const details = await getDeliveryDetailsPublicForVendorReceive(deliveryId);
        if (!details) {
          setError("Could not open delivery.");
          setStep("list");
          return;
        }
        setDeliveryDetails(details);
        setJobId(resolvedJobId);
        if (details.delivery.submittedAt) {
          setStep("done");
        } else {
          setStep("hub");
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not open delivery.",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const loadJobDeliveries = useCallback(
    async (resolvedJobId: string) => {
      const token = getJobSessionToken(resolvedJobId);
      if (!token) {
        setStep("pin");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await getJobVendorDeliveriesClient({
          jobId: resolvedJobId,
          sessionToken: token,
        });
        setJobId(resolvedJobId);
        setSessionScope("job");
        setDeliveries(result.deliveries);
        setScannedCode(result.scannedStagingLocationCode);
        if (result.deliveries.length === 1) {
          await openDelivery(resolvedJobId, result.deliveries[0].deliveryId);
          return;
        }
        setStep("list");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not load job deliveries.",
        );
        clearJobPinSession(resolvedJobId);
        setStep("pin");
      } finally {
        setLoading(false);
      }
    },
    [openDelivery],
  );

  const loadVendorRunDeliveries = useCallback(async (resolvedVendorId: string) => {
    const token = getVendorRunSessionToken(resolvedVendorId);
    if (!token) {
      setStep("pin");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await getVendorRunDeliveriesClient({ sessionToken: token });
      setVendorId(resolvedVendorId);
      setSessionScope("vendor");
      setVendorRunDeliveries(result.deliveries);
      setScannedCode(result.scannedStagingLocationCode);
      setCheckedDeliveryIds(new Set());
      setExpandedDeliveryIds(new Set());
      setStep("vendor-list");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load vendor deliveries.",
      );
      clearVendorRunPinSession(resolvedVendorId);
      setStep("pin");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (step !== "pin" || !jobId || !isJobPinSessionValid(jobId)) return;
    void loadJobDeliveries(jobId);
  }, [step, jobId, loadJobDeliveries]);

  useEffect(() => {
    if (step !== "pin" || !vendorId || !isVendorRunPinSessionValid(vendorId)) {
      return;
    }
    void loadVendorRunDeliveries(vendorId);
  }, [step, vendorId, loadVendorRunDeliveries]);

  const handlePinVerified = useCallback(
    (payload: {
      jobId?: string;
      vendorId?: string;
      sessionScope?: "job" | "delivery" | "vendor";
    }) => {
      if (payload.sessionScope === "vendor" && payload.vendorId) {
        setVendorId(payload.vendorId);
        setJobId(null);
        void loadVendorRunDeliveries(payload.vendorId);
        return;
      }
      if (!payload.jobId) {
        setError("Invalid session.");
        return;
      }
      setJobId(payload.jobId);
      setVendorId(null);
      void loadJobDeliveries(payload.jobId);
    },
    [loadJobDeliveries, loadVendorRunDeliveries],
  );

  const loadTechnicianReleasedJobs = useCallback(
    async (resolvedTechnicianId: string) => {
      const token = getTechnicianSessionToken(resolvedTechnicianId);
      if (!token) {
        setStep("pin");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await getTechnicianReleasedJobsClient({
          sessionToken: token,
        });
        setTechnicianId(resolvedTechnicianId);
        setTechnicianName(result.technicianName);
        setReleasedJobs(result.jobs);
        setScannedCode(result.scannedStagingLocationCode);
        setStep("tech-list");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not load released jobs.",
        );
        clearTechnicianPinSession(resolvedTechnicianId);
        setStep("pin");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const handleTechnicianPinVerified = useCallback(
    (payload: { technicianId: string; technicianName: string }) => {
      setTechnicianId(payload.technicianId);
      setTechnicianName(payload.technicianName);
      void loadTechnicianReleasedJobs(payload.technicianId);
    },
    [loadTechnicianReleasedJobs],
  );

  const openTechnicianJobPickup = useCallback((jobId: string) => {
    if (!technicianId) return;
    bindTechnicianSessionToJob(jobId);
    window.location.hash = `#/pickup?job=${encodeURIComponent(jobId)}&door=tech`;
  }, [technicianId]);

  const handlePinSessionExpired = useCallback(() => {
    setDeliveryDetails(null);
    setDeliveries([]);
    setVendorRunDeliveries([]);
    setCheckedDeliveryIds(new Set());
    if (jobId) clearJobPinSession(jobId);
    if (vendorId) clearVendorRunPinSession(vendorId);
    if (technicianId) clearTechnicianPinSession(technicianId);
    setJobId(null);
    setVendorId(null);
    setTechnicianId(null);
    setTechnicianName(null);
    setReleasedJobs([]);
    setSessionScope(null);
    setStep("pin");
  }, [jobId, vendorId, technicianId]);

  const activityKey =
    deliveryDetails?.delivery.id ?? jobId ?? vendorId ?? locationCode;

  useVendorPinActivity(
    typeof activityKey === "string" ? activityKey : null,
    handlePinSessionExpired,
  );

  useEffect(() => {
    if (!vendorId) return;
    const interval = window.setInterval(() => {
      if (isVendorRunPinSessionValid(vendorId)) {
        touchVendorRunPinSession(vendorId);
      }
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [vendorId]);

  useEffect(() => {
    if (!technicianId) return;
    const interval = window.setInterval(() => {
      if (isTechnicianPinSessionValid(technicianId)) {
        touchTechnicianPinSession(technicianId);
      }
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [technicianId]);

  const toggleChecked = (deliveryId: string, enabled: boolean) => {
    if (!enabled) return;
    setCheckedDeliveryIds((prev) => {
      const next = new Set(prev);
      if (next.has(deliveryId)) next.delete(deliveryId);
      else next.add(deliveryId);
      return next;
    });
  };

  const toggleExpanded = (deliveryId: string) => {
    setExpandedDeliveryIds((prev) => {
      const next = new Set(prev);
      if (next.has(deliveryId)) next.delete(deliveryId);
      else next.add(deliveryId);
      return next;
    });
  };

  const distinctJobsForChecked = useMemo(() => {
    const names = new Set<string>();
    for (const row of activeVendorRun) {
      if (checkedDeliveryIds.has(row.deliveryId)) {
        names.add(row.jobName);
      }
    }
    return [...names].sort();
  }, [activeVendorRun, checkedDeliveryIds]);

  const handleBulkDeliver = async () => {
    if (!vendorId || checkedDeliveryIds.size === 0) return;
    if (vendorGeofenceEnforce && outsideGeofence) {
      setError("You must be at the shop to confirm delivery.");
      return;
    }
    const token = getVendorRunSessionToken(vendorId);
    if (!token) {
      handlePinSessionExpired();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const deliveryIds = [...checkedDeliveryIds];
      const result = await markVendorDeliveriesBulkClient({
        sessionToken: token,
        deliveryIds,
      });
      const failed = result.results.filter((r) => !r.success);
      if (failed.length > 0) {
        setError(
          failed.map((f) => `${f.deliveryId}: ${f.error ?? "failed"}`).join("; "),
        );
      }
      await loadVendorRunDeliveries(vendorId);
      setConfirmBulkOpen(false);
      setCheckedDeliveryIds(new Set());
    } catch (err) {
      if (isVendorSessionError(err)) {
        handlePinSessionExpired();
        return;
      }
      setError(err instanceof Error ? err.message : "Bulk deliver failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleMarkDelivered = async (): Promise<boolean> => {
    if (!deliveryDetails) return false;
    if (vendorGeofenceEnforce && outsideGeofence) {
      setError("You must be at the shop to confirm delivery.");
      return false;
    }
    setLoading(true);
    setError(null);
    try {
      const updated = await firestoreDataService.markVendorDelivered(
        deliveryDetails.delivery.id,
      );
      if (updated) {
        setDeliveryDetails(updated);
        return true;
      }
      return false;
    } catch (err) {
      if (isVendorSessionError(err)) {
        handlePinSessionExpired();
        return false;
      }
      setError("Failed to confirm delivery");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleRevertDelivered = async (): Promise<boolean> => {
    if (!deliveryDetails) return false;
    setReverting(true);
    setError(null);
    try {
      const updated = await firestoreDataService.revertDeliveryStatus(
        deliveryDetails.delivery.id,
        "vendor",
        revertWindowMinutes,
      );
      if (updated) {
        setDeliveryDetails(updated);
        return true;
      }
      return false;
    } catch (err) {
      if (isVendorSessionError(err)) {
        handlePinSessionExpired();
        return false;
      }
      setError("Failed to undo delivery");
      return false;
    } finally {
      setReverting(false);
    }
  };

  const resetFlow = () => {
    if (jobId) clearJobPinSession(jobId);
    if (vendorId) clearVendorRunPinSession(vendorId);
    if (technicianId) clearTechnicianPinSession(technicianId);
    setJobId(null);
    setVendorId(null);
    setTechnicianId(null);
    setTechnicianName(null);
    setReleasedJobs([]);
    setSessionScope(null);
    setDeliveries([]);
    setVendorRunDeliveries([]);
    setCheckedDeliveryIds(new Set());
    setExpandedDeliveryIds(new Set());
    setDeliveryDetails(null);
    setError(null);
    setStep("pin");
  };

  if (step === "loading") {
    return (
      <div className="app-container flex flex-col h-screen h-dvh bg-bg-primary items-center justify-center px-6">
        <p className="text-sm text-text-secondary">Loading location…</p>
      </div>
    );
  }

  if (step === "missing") {
    return (
      <div className="app-container flex flex-col h-screen h-dvh bg-bg-primary px-6 py-8">
        <h1 className="text-xl font-bold text-text-primary mb-2">
          Location not found
        </h1>
        <p className="text-sm text-text-secondary mb-6">
          {locationCode
            ? `No staging location matches “${locationCode}”.`
            : "Scan a valid location QR code."}
        </p>
        {error && (
          <PublicNetworkErrorPanel message={error} onRetry={() => void loadBranding()} />
        )}
      </div>
    );
  }

  if (step === "pin" && branding && locationCode) {
    return (
      <div className="flex flex-col h-screen h-dvh">
        <div className="shrink-0 px-6 py-5 border-b border-border bg-bg-surface text-center">
          <p className="text-xs uppercase tracking-widest text-text-secondary mb-1">
            Staging location
          </p>
          <p className="text-3xl font-bold font-mono text-text-primary">
            {branding.code}
          </p>
          <p className="text-sm text-text-secondary mt-1">{branding.label}</p>
          <div className="mt-4 inline-flex rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              className={`px-4 py-2 text-sm font-medium ${
                pinRole === "vendor"
                  ? "bg-accent-blue text-white"
                  : "bg-bg-card text-text-secondary"
              }`}
              onClick={() => setPinRole("vendor")}
            >
              Vendor
            </button>
            <button
              type="button"
              className={`px-4 py-2 text-sm font-medium ${
                pinRole === "technician"
                  ? "bg-accent-blue text-white"
                  : "bg-bg-card text-text-secondary"
              }`}
              onClick={() => setPinRole("technician")}
            >
              Technician
            </button>
          </div>
        </div>
        {pinRole === "vendor" ? (
          <VendorPinGate
            stagingLocationCode={locationCode}
            title="Enter Job or Company PIN"
            subtitle="Job PIN for one job, or company PIN when dispatch enabled multi-site run."
            onVerified={handlePinVerified}
          />
        ) : (
          <TechnicianPinGate
            stagingLocationCode={locationCode}
            technicianIdForActivity={technicianId ?? undefined}
            onVerified={handleTechnicianPinVerified}
            onBack={() => setPinRole("vendor")}
          />
        )}
      </div>
    );
  }

  if (step === "tech-list" && branding) {
    return (
      <div
        className="app-container flex flex-col h-screen h-dvh bg-bg-primary overflow-hidden"
        data-testid="technician-released-jobs"
      >
        <div className="shrink-0 px-6 py-4 border-b border-border bg-bg-surface">
          <p className="text-xs uppercase tracking-widest text-text-secondary">
            {scannedCode ? `You're at ${scannedCode}` : `Scanned ${branding.code}`}
            {technicianName ? ` · ${technicianName}` : ""}
          </p>
          <h1 className="text-lg font-bold text-text-primary mt-1">
            Pick up today
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Jobs dispatch released for you — tap to open pickup.
          </p>
        </div>

        {error && (
          <p className="px-6 py-2 text-sm text-accent-red" role="alert">
            {error}
          </p>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {releasedJobs.map((row) => (
            <button
              key={row.jobId}
              type="button"
              disabled={loading}
              onClick={() => openTechnicianJobPickup(row.jobId)}
              className="w-full text-left rounded-xl border border-border bg-bg-surface p-4 active:scale-[0.99] transition-transform"
              data-testid={`tech-released-job-${row.jobId}`}
            >
              <p className="font-semibold text-text-primary">{row.jobName}</p>
              <p className="text-sm text-text-secondary mt-1">
                Go to:{" "}
                {row.stagingLocationCodes.length > 0
                  ? row.stagingLocationCodes.join(", ")
                  : "Spots not assigned yet"}
              </p>
              <p className="text-xs text-text-secondary mt-1">
                {row.readyForPickupCount} ready · {row.deliveryCount} deliveries
              </p>
            </button>
          ))}
          {releasedJobs.length === 0 && (
            <p
              className="text-sm text-text-secondary text-center py-8"
              data-testid="technician-empty-released"
            >
              Nothing released for you yet
            </p>
          )}
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-border">
          <button
            type="button"
            onClick={resetFlow}
            className="action-btn action-btn-secondary w-full"
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  if (step === "vendor-list" && branding) {
    const runSession = vendorId ? getVendorRunPinSession(vendorId) : null;
    return (
      <div className="app-container flex flex-col h-screen h-dvh bg-bg-primary overflow-hidden">
        <div className="shrink-0 px-6 py-4 border-b border-border bg-bg-surface">
          <p className="text-xs uppercase tracking-widest text-text-secondary">
            Scanned {branding.code}
            {runSession?.vendorName ? ` · ${runSession.vendorName}` : ""}
          </p>
          <h1 className="text-lg font-bold text-text-primary mt-1">
            Your open deliveries
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Check each order you delivered, then tap Delivered.
          </p>
        </div>

        {error && (
          <p className="px-6 py-2 text-sm text-accent-red" role="alert">
            {error}
          </p>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {activeVendorRun.map((row) => {
            const canCheck = row.hasAssignableSpot;
            const expanded = expandedDeliveryIds.has(row.deliveryId);
            return (
              <div
                key={row.deliveryId}
                className="rounded-xl border border-border bg-bg-surface p-4"
                data-testid={`vendor-run-row-${row.deliveryId}`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 size-5 shrink-0"
                    checked={checkedDeliveryIds.has(row.deliveryId)}
                    disabled={!canCheck || loading}
                    aria-label={`Select ${row.jobName}`}
                    onChange={() => toggleChecked(row.deliveryId, canCheck)}
                  />
                  <button
                    type="button"
                    className="flex-1 text-left min-w-0"
                    onClick={() => toggleExpanded(row.deliveryId)}
                  >
                    <p className="font-semibold text-text-primary truncate">
                      {row.jobName}
                    </p>
                    <p className="text-sm text-text-secondary mt-0.5 truncate">
                      {formatSpotLine(row)}
                    </p>
                    {!canCheck && (
                      <p className="text-xs text-accent-red mt-1">
                        No spot — ask dispatch
                      </p>
                    )}
                  </button>
                </div>
                {expanded && (
                  <ul className="mt-3 ml-8 text-sm text-text-secondary space-y-1 border-t border-border pt-2">
                    {row.items.map((item) => (
                      <li key={item.id}>
                        {item.description} × {item.qtyOrdered}
                      </li>
                    ))}
                    {row.items.length === 0 && <li>No line items</li>}
                  </ul>
                )}
              </div>
            );
          })}
          {activeVendorRun.length === 0 && (
            <p className="text-sm text-text-secondary text-center py-8">
              No active deliveries to confirm.
            </p>
          )}

          {deliveredVendorRun.length > 0 && (
            <div className="pt-4 border-t border-border">
              <h2 className="text-sm font-semibold text-text-secondary mb-3">
                Delivered
              </h2>
              {deliveredVendorRun.map((row) => {
                const expanded = expandedDeliveryIds.has(row.deliveryId);
                return (
                  <div
                    key={row.deliveryId}
                    className="rounded-xl border border-border bg-bg-card p-4 mb-2 opacity-80"
                  >
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => toggleExpanded(row.deliveryId)}
                    >
                      <p className="font-semibold text-text-primary truncate">
                        {row.jobName}
                      </p>
                      <p className="text-sm text-text-secondary mt-0.5 truncate">
                        {formatSpotLine(row)}
                      </p>
                    </button>
                    {expanded && (
                      <ul className="mt-3 text-sm text-text-secondary space-y-1 border-t border-border pt-2">
                        {row.items.map((item) => (
                          <li key={item.id}>
                            {item.description} × {item.qtyOrdered}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-border space-y-3">
          <button
            type="button"
            disabled={loading || checkedDeliveryIds.size === 0}
            onClick={() => setConfirmBulkOpen(true)}
            className="action-btn action-btn-delivered w-full disabled:opacity-40"
            data-testid="vendor-run-bulk-deliver"
          >
            Delivered
            {checkedDeliveryIds.size > 0
              ? ` (${checkedDeliveryIds.size})`
              : ""}
          </button>
          <button
            type="button"
            onClick={resetFlow}
            className="action-btn action-btn-secondary w-full"
          >
            ← Back
          </button>
        </div>

        {confirmBulkOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 px-4 pb-6">
            <div className="w-full max-w-sm rounded-2xl bg-bg-surface p-6 shadow-xl">
              <h2 className="text-lg font-bold text-text-primary mb-2">
                Confirm delivered
              </h2>
              <p className="text-sm text-text-secondary mb-3">
                Jobs in this batch:
              </p>
              <ul className="text-sm text-text-primary mb-6 list-disc pl-5 space-y-1">
                {distinctJobsForChecked.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="action-btn action-btn-secondary flex-1"
                  onClick={() => setConfirmBulkOpen(false)}
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="action-btn action-btn-delivered flex-1"
                  onClick={() => void handleBulkDeliver()}
                  disabled={loading}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        {runSession && (
          <p className="sr-only" data-testid="vendor-run-session-active">
            vendor-run-session
          </p>
        )}
      </div>
    );
  }

  if (step === "list" && branding) {
    const jobSession = jobId ? getJobPinSession(jobId) : null;
    return (
      <div className="app-container flex flex-col h-screen h-dvh bg-bg-primary overflow-hidden">
        <div className="shrink-0 px-6 py-4 border-b border-border bg-bg-surface">
          <p className="text-xs uppercase tracking-widest text-text-secondary">
            Scanned {branding.code}
            {scannedCode && scannedCode !== branding.code
              ? ` · PIN job spots below`
              : ""}
          </p>
          <h1 className="text-lg font-bold text-text-primary mt-1">
            This job&apos;s deliveries
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Select your order to confirm delivery.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {deliveries.map((row) => (
            <button
              key={row.deliveryId}
              type="button"
              disabled={loading}
              onClick={() => {
                if (!jobId) return;
                void openDelivery(jobId, row.deliveryId);
              }}
              className="w-full text-left rounded-xl border border-border bg-bg-surface p-4 active:scale-[0.99] transition-transform"
            >
              <p className="font-semibold text-text-primary">
                Order {row.orderNumber}
              </p>
              {row.poNumber && (
                <p className="text-sm text-text-secondary mt-1">
                  PO {row.poNumber}
                </p>
              )}
              <p className="text-sm text-text-secondary mt-1">
                Spots:{" "}
                {row.stagingLocationCodes.length > 0
                  ? row.stagingLocationCodes.join(", ")
                  : "Not assigned yet"}
              </p>
            </button>
          ))}
          {deliveries.length === 0 && (
            <p className="text-sm text-text-secondary text-center py-8">
              No active deliveries for this job.
            </p>
          )}
        </div>
        <div className="shrink-0 px-6 py-4 border-t border-border">
          <button
            type="button"
            onClick={resetFlow}
            className="action-btn action-btn-secondary w-full"
          >
            ← Back
          </button>
        </div>
        {jobSession && (
          <p className="sr-only" data-testid="job-session-active">
            job-session
          </p>
        )}
      </div>
    );
  }

  if (step === "hub" && deliveryDetails) {
    return (
      <div className="app-container vendor-mobile-shell bg-bg-primary">
        {branding && (
          <div className="shrink-0 px-6 py-3 border-b border-border bg-bg-surface text-center">
            <p className="text-xs text-text-secondary">
              Location {branding.code}
            </p>
          </div>
        )}
        <div className="flex flex-1 min-h-0 flex-col">
          <VendorDeliveredHub
            deliveryDetails={deliveryDetails}
            loading={loading}
            error={error}
            reverting={reverting}
            geofenceOutside={outsideGeofence === true}
            geofenceEnforce={vendorGeofenceEnforce}
            onDeliveryUpdated={(updated) => {
              setDeliveryDetails((prev) =>
                prev ? { ...prev, delivery: updated } : prev,
              );
            }}
            onDelivered={() => handleMarkDelivered()}
            onUndoDelivered={() => handleRevertDelivered()}
            onBack={() => {
              if (sessionScope === "vendor" && vendorId) {
                void loadVendorRunDeliveries(vendorId);
                return;
              }
              if (deliveries.length > 1) setStep("list");
              else resetFlow();
            }}
          />
        </div>
      </div>
    );
  }

  if (step === "done" && deliveryDetails) {
    return (
      <div className="app-container flex flex-col h-screen h-dvh bg-bg-primary items-center justify-center px-6 text-center">
        <h2 className="text-2xl font-bold text-text-primary mb-4">
          Delivery Confirmed
        </h2>
        <p className="text-sm text-text-secondary mb-8">
          {deliveryDetails.delivery.orderNumber} ·{" "}
          {deliveryDetails.job?.jobName ?? "Job"}
        </p>
        <button
          type="button"
          onClick={resetFlow}
          className="action-btn action-btn-delivered w-full max-w-sm"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="app-container flex flex-col h-screen h-dvh bg-bg-primary items-center justify-center px-6">
      <p className="text-sm text-text-secondary">
        {loading ? "Loading…" : "Select vendor or technician to continue."}
      </p>
    </div>
  );
}

import {
  useCallback,
  useEffect,
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
  recordVendorLocationScanClient,
} from "./phase2CallableClients";
import type {
  DeliveryDetails,
  JobVendorDeliverySummary,
} from "./dispatcher/models";
import { VendorPinGate } from "./VendorPinGate";
import { VendorDeliveredHub } from "./VendorDeliveredHub";
import {
  bridgeJobSessionToDelivery,
  clearJobPinSession,
  getJobPinSession,
  getJobSessionToken,
  isJobPinSessionValid,
} from "./vendorPinSession";
import { isVendorSessionError } from "./vendorSessionErrors";
import { useVendorPinActivity } from "./useVendorPinActivity";
import { PublicNetworkErrorPanel } from "./PublicNetworkErrorPanel";
import { isOutsideShopGeofence } from "./geofence";

type Step = "loading" | "missing" | "pin" | "list" | "hub" | "done";

interface LocationBranding {
  code: string;
  label: string;
  type: string;
}

export function LocationScanPage() {
  const [searchParams] = useSearchParams();
  normalizeLocationScanHash();

  const { loc: locationCode } = readLocationScanParams(searchParams);

  const [step, setStep] = useState<Step>("loading");
  const [branding, setBranding] = useState<LocationBranding | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<JobVendorDeliverySummary[]>([]);
  const [scannedCode, setScannedCode] = useState<string | null>(null);
  const [deliveryDetails, setDeliveryDetails] =
    useState<DeliveryDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outsideGeofence, setOutsideGeofence] = useState<boolean | null>(null);
  const [vendorGeofenceEnforce, setVendorGeofenceEnforce] = useState(false);
  const [revertWindowMinutes, setRevertWindowMinutes] = useState(60);
  const [reverting, setReverting] = useState(false);

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

  useEffect(() => {
    if (step !== "pin" || !jobId || !isJobPinSessionValid(jobId)) return;
    void loadJobDeliveries(jobId);
  }, [step, jobId, loadJobDeliveries]);

  const handlePinVerified = useCallback(
    (payload: { jobId?: string }) => {
      if (!payload.jobId) {
        setError("Invalid session.");
        return;
      }
      setJobId(payload.jobId);
      void loadJobDeliveries(payload.jobId);
    },
    [loadJobDeliveries],
  );

  const handlePinSessionExpired = useCallback(() => {
    setDeliveryDetails(null);
    setDeliveries([]);
    if (jobId) clearJobPinSession(jobId);
    setJobId(null);
    setStep("pin");
  }, [jobId]);

  useVendorPinActivity(
    deliveryDetails?.delivery.id ?? jobId,
    handlePinSessionExpired,
  );

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
    setJobId(null);
    setDeliveries([]);
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
        </div>
        <VendorPinGate
          stagingLocationCode={locationCode}
          title="Enter Job PIN"
          subtitle="Enter the 4-digit PIN from your delivery email for this job."
          onVerified={handlePinVerified}
        />
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
        {loading ? "Loading…" : "Technician and management tiers coming soon."}
      </p>
    </div>
  );
}

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
  recordTechnicianJobOpenClient,
  recordVendorLocationScanClient,
} from "./phase2CallableClients";
import type {
  DeliveryDetails,
  JobVendorDeliverySummary,
  VendorRunDeliverySummary,
} from "./dispatcher/models";
import {
  LocationScanPinGate,
  type LocationScanPinVerifiedPayload,
} from "./LocationScanPinGate";
import { ManagementCatchAllHub } from "./ManagementCatchAllHub";
import {
  bindTechnicianSessionToJob,
  clearTechnicianPinSession,
  getActiveTechnicianSession,
  getTechnicianSessionToken,
  isTechnicianPinSessionValid,
} from "./technicianPinSession";
import {
  clearManagementPinSession,
  getManagementSessionPermissions,
  isManagementPinSessionValid,
} from "./managementPinSession";
import { getTechnicianReleasedJobsClient } from "./phase2CallableClients";
import type { TechnicianReleasedJobSummary } from "./dispatcher/models";
import {
  readReleasedJobsCache,
  writeReleasedJobsCache,
} from "./technicianReleasedJobsCache";
import { stashTechnicianJobShell } from "./technicianJobShell";
import { VendorDeliveredHub } from "./VendorDeliveredHub";
import {
  VendorUnplannedDeliveryFlow,
  type VendorUnplannedCompletePayload,
} from "./VendorUnplannedDeliveryFlow";
import { deliveryDetailsFromVendorPinBootstrap } from "./dispatcher/vendorPinBootstrap";
import {
  bridgeJobSessionToDelivery,
  bridgeVendorRunSessionToDelivery,
  clearJobPinSession,
  clearVendorRunPinSession,
  clearVendorUnplannedPinSession,
  getJobPinSession,
  getJobSessionToken,
  getVendorRunPinSession,
  getVendorRunSessionToken,
  getVendorUnplannedPinSession,
  getVendorUnplannedSessionToken,
  isJobPinSessionValid,
  isVendorRunPinSessionValid,
  isVendorUnplannedPinSessionValid,
  setVendorRunPinSession,
  setVendorUnplannedPinSession,
} from "./vendorPinSession";
import { isVendorSessionError } from "./vendorSessionErrors";
import { PublicNetworkErrorPanel } from "./PublicNetworkErrorPanel";
import { isOutsideShopGeofence } from "./geofence";

type Step =
  | "loading"
  | "missing"
  | "pin"
  | "list"
  | "vendor-list"
  | "unplanned"
  | "tech-list"
  | "mgmt-landing"
  | "mgmt-hub"
  | "hub"
  | "done";
type SessionScope = "job" | "vendor" | "vendor_unplanned" | null;

interface LocationBranding {
  code: string;
  label: string;
  type: string;
}

interface VendorRunExpansionUpdate {
  preserveExpandedIds: Set<string>;
  collapseDeliveryIds: Set<string>;
}

export function LocationScanPage() {
  const navigate = useNavigate();
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
  const [vendorRunRevertingId, setVendorRunRevertingId] = useState<string | null>(
    null,
  );
  const [technicianId, setTechnicianId] = useState<string | null>(null);
  const [technicianName, setTechnicianName] = useState<string | null>(null);
  const [releasedJobs, setReleasedJobs] = useState<TechnicianReleasedJobSummary[]>(
    [],
  );
  const [jobsRevalidating, setJobsRevalidating] = useState(false);
  const [isCatchAllParcelIntake, setIsCatchAllParcelIntake] = useState(false);

  const activeVendorRun = useMemo(() => {
    return vendorRunDeliveries.filter((d) => !d.vendorPhysicalDropoffConfirmed);
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
      const settings = await getAppSettings().catch(() => null);
      const intakeEnabled =
        result.parcelIntakeEnabled === true ||
        settings?.parcelIntakeEnabled === true;
      setIsCatchAllParcelIntake(result.isCatchAllParcelIntake === true);
      if (intakeEnabled && isManagementPinSessionValid()) {
        setStep("mgmt-landing");
      } else {
        // PIN step: same-shop tech resume handled by effect when session exists.
        setStep("pin");
      }
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

  const loadVendorRunDeliveries = useCallback(async (
    resolvedVendorId: string,
    expansionUpdate?: VendorRunExpansionUpdate,
  ) => {
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
      setExpandedDeliveryIds(() => {
        if (expansionUpdate) {
          const next = new Set(expansionUpdate.preserveExpandedIds);
          for (const deliveryId of expansionUpdate.collapseDeliveryIds) {
            next.delete(deliveryId);
          }
          return next;
        }
        return new Set(
          result.deliveries
            .filter((delivery) => !delivery.vendorPhysicalDropoffConfirmed)
            .map((delivery) => delivery.deliveryId),
        );
      });
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
      vendorName?: string;
      sessionScope?: "job" | "delivery" | "vendor" | "vendor_unplanned";
      noExpectedDelivery?: boolean;
      sessionToken?: string;
      expiresAt?: string;
      scannedStagingLocationCode?: string;
    }) => {
      if (
        payload.sessionScope === "vendor_unplanned" ||
        payload.noExpectedDelivery
      ) {
        if (!payload.vendorId || !payload.vendorName) {
          setError("Invalid session.");
          return;
        }
        setVendorId(payload.vendorId);
        setJobId(null);
        setSessionScope("vendor_unplanned");
        if (payload.sessionToken && payload.expiresAt) {
          setVendorUnplannedPinSession(payload.vendorId, payload.vendorName, {
            sessionToken: payload.sessionToken,
            expiresAt: payload.expiresAt,
            scannedStagingLocationCode: payload.scannedStagingLocationCode,
          });
        }
        setStep("unplanned");
        return;
      }
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

  const resolveUnplannedSessionToken = useCallback(
    (resolvedVendorId: string): string | null => {
      return (
        getVendorUnplannedSessionToken(resolvedVendorId) ??
        getVendorRunSessionToken(resolvedVendorId)
      );
    },
    [],
  );

  const openUnplannedFromVendorList = useCallback(() => {
    if (!vendorId) return;
    const runSession = getVendorRunPinSession(vendorId);
    const unplannedSession = getVendorUnplannedPinSession(vendorId);
    if (!runSession && !unplannedSession) {
      setStep("pin");
      return;
    }
    setSessionScope(
      unplannedSession ? "vendor_unplanned" : "vendor",
    );
    setStep("unplanned");
  }, [vendorId]);

  const handleUnplannedComplete = useCallback(
    async (payload: VendorUnplannedCompletePayload) => {
      setVendorRunPinSession(
        payload.vendorId,
        payload.vendorName,
        payload.deliveryId,
        {
          sessionToken: payload.sessionToken,
          expiresAt: payload.expiresAt,
          scannedStagingLocationCode: scannedCode ?? undefined,
        },
      );
      clearVendorUnplannedPinSession(payload.vendorId);
      bridgeVendorRunSessionToDelivery(payload.vendorId, payload.deliveryId);
      setVendorId(payload.vendorId);
      setSessionScope("vendor");
      setLoading(true);
      setError(null);
      try {
        if (payload.bootstrap) {
          setDeliveryDetails(
            deliveryDetailsFromVendorPinBootstrap(payload.bootstrap),
          );
          setStep("hub");
          void getDeliveryDetailsPublicForVendorReceive(payload.deliveryId).then(
            (full) => {
              if (full) setDeliveryDetails(full);
            },
          );
          return;
        }
        const details = await getDeliveryDetailsPublicForVendorReceive(
          payload.deliveryId,
        );
        if (!details) {
          setError("Could not open delivery.");
          await loadVendorRunDeliveries(payload.vendorId);
          return;
        }
        setDeliveryDetails(details);
        setStep("hub");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not open delivery.",
        );
        await loadVendorRunDeliveries(payload.vendorId);
      } finally {
        setLoading(false);
      }
    },
    [loadVendorRunDeliveries, scannedCode],
  );

  const loadTechnicianReleasedJobs = useCallback(
    async (resolvedTechnicianId: string) => {
      const token = getTechnicianSessionToken(resolvedTechnicianId);
      if (!token) {
        setStep("pin");
        return;
      }
      setTechnicianId(resolvedTechnicianId);
      setStep("tech-list");
      setError(null);

      const cached = readReleasedJobsCache(resolvedTechnicianId, token);
      if (cached) {
        setTechnicianName(cached.technicianName);
        setReleasedJobs(cached.jobs);
        setLoading(false);
        setJobsRevalidating(true);
      } else {
        setLoading(true);
      }

      try {
        const result = await getTechnicianReleasedJobsClient({
          sessionToken: token,
        });
        setTechnicianId(resolvedTechnicianId);
        setTechnicianName(result.technicianName);
        setReleasedJobs(result.jobs);
        writeReleasedJobsCache(resolvedTechnicianId, token, {
          jobs: result.jobs,
          technicianName: result.technicianName,
          releaseDate: result.releaseDate,
        });
        setStep("tech-list");
      } catch (err) {
        if (!cached) {
          setError(
            err instanceof Error ? err.message : "Could not load released jobs.",
          );
          clearTechnicianPinSession(resolvedTechnicianId);
          setStep("pin");
        } else {
          setError(
            err instanceof Error
              ? err.message
              : "Could not refresh job list — showing cached list.",
          );
        }
      } finally {
        setLoading(false);
        setJobsRevalidating(false);
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

  const openTechnicianJobPickup = useCallback(
    (job: TechnicianReleasedJobSummary) => {
      if (!technicianId) return;
      stashTechnicianJobShell({
        jobId: job.jobId,
        jobName: job.jobName,
        stagingLocationCodes: job.stagingLocationCodes,
        deliveryCount: job.deliveryCount,
        readyForPickupCount: job.readyForPickupCount,
      });
      const clientOpenId = crypto.randomUUID();
      sessionStorage.setItem(
        `stageverify_tech_job_opened_${job.jobId}`,
        clientOpenId,
      );
      const sessionToken = getTechnicianSessionToken(technicianId);
      if (sessionToken) {
        void recordTechnicianJobOpenClient(
          sessionToken,
          job.jobId,
          clientOpenId,
          "location_scan",
        ).catch(() => {});
      }
      bindTechnicianSessionToJob(job.jobId);
      // SPA navigate (HashRouter) — avoid full remount so job shell paints immediately.
      navigate(
        `/pickup?job=${encodeURIComponent(job.jobId)}&door=tech`,
      );
    },
    [technicianId, navigate],
  );

  useEffect(() => {
    if (step !== "pin") return;
    const active = getActiveTechnicianSession();
    if (!active) return;
    void loadTechnicianReleasedJobs(active.technicianId);
  }, [step, loadTechnicianReleasedJobs]);

  const handleLocationScanPinVerified = useCallback(
    (payload: LocationScanPinVerifiedPayload) => {
      if (payload.accessType === "technician") {
        handleTechnicianPinVerified({
          technicianId: payload.technicianId,
          technicianName: payload.technicianName,
        });
        return;
      }
      if (payload.accessType === "management") {
        setStep("mgmt-landing");
        return;
      }
      handlePinVerified({
        jobId: payload.jobId,
        vendorId: payload.vendorId,
        vendorName: payload.vendorName,
        sessionScope: payload.sessionScope,
        noExpectedDelivery: payload.noExpectedDelivery,
        sessionToken: payload.sessionToken,
        expiresAt: payload.expiresAt,
        scannedStagingLocationCode: payload.scannedStagingLocationCode,
      });
    },
    [handlePinVerified, handleTechnicianPinVerified],
  );

  const handlePinSessionExpired = useCallback(() => {
    setDeliveryDetails(null);
    setDeliveries([]);
    setVendorRunDeliveries([]);
    setCheckedDeliveryIds(new Set());
    if (jobId) clearJobPinSession(jobId);
    if (vendorId) clearVendorRunPinSession(vendorId);
    if (vendorId) clearVendorUnplannedPinSession(vendorId);
    if (technicianId) clearTechnicianPinSession(technicianId);
    clearManagementPinSession();
    setJobId(null);
    setVendorId(null);
    setTechnicianId(null);
    setTechnicianName(null);
    setReleasedJobs([]);
    setSessionScope(null);
    setStep("pin");
  }, [jobId, vendorId, technicianId]);

  const handleManagementSessionExpired = useCallback(() => {
    clearManagementPinSession();
    setStep("pin");
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (jobId && !isJobPinSessionValid(jobId)) {
        handlePinSessionExpired();
        return;
      }
      if (vendorId && !isVendorRunPinSessionValid(vendorId)) {
        const unplannedOk = isVendorUnplannedPinSessionValid(vendorId);
        if (!unplannedOk) {
          handlePinSessionExpired();
          return;
        }
      }
      if (technicianId && !isTechnicianPinSessionValid(technicianId)) {
        handlePinSessionExpired();
      }
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [jobId, vendorId, technicianId, handlePinSessionExpired]);

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
      const deliveredIds = new Set(
        result.results
          .filter((row) => row.success)
          .map((row) => row.deliveryId),
      );
      if (failed.length > 0) {
        setError(
          failed.map((f) => `${f.deliveryId}: ${f.error ?? "failed"}`).join("; "),
        );
      }
      await loadVendorRunDeliveries(vendorId, {
        preserveExpandedIds: new Set(expandedDeliveryIds),
        collapseDeliveryIds: deliveredIds,
      });
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

  const handleVendorRunUndo = async (deliveryId: string) => {
    if (!vendorId || vendorRunRevertingId) return;
    if (!bridgeVendorRunSessionToDelivery(vendorId, deliveryId)) {
      handlePinSessionExpired();
      return;
    }
    setVendorRunRevertingId(deliveryId);
    setError(null);
    try {
      const updated = await firestoreDataService.revertDeliveryStatus(
        deliveryId,
        "vendor",
        revertWindowMinutes,
      );
      if (!updated || updated.delivery.vendorPhysicalDropoffConfirmed) {
        setError("This delivery can no longer be undone.");
        return;
      }
      const preserveExpandedIds = new Set(expandedDeliveryIds);
      preserveExpandedIds.add(deliveryId);
      await loadVendorRunDeliveries(vendorId, {
        preserveExpandedIds,
        collapseDeliveryIds: new Set(),
      });
    } catch (err) {
      if (isVendorSessionError(err)) {
        handlePinSessionExpired();
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to undo delivery.");
    } finally {
      setVendorRunRevertingId(null);
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
    if (vendorId) clearVendorUnplannedPinSession(vendorId);
    if (technicianId) clearTechnicianPinSession(technicianId);
    clearManagementPinSession();
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

  if (step === "mgmt-landing" && branding && locationCode) {
    const mgmtCaps = getManagementSessionPermissions();
    const canCatchAllCheckIn = mgmtCaps?.catchAllCheckIn === true;
    return (
      <div className="flex flex-col h-screen h-dvh">
        <div className="shrink-0 px-6 py-5 border-b border-border bg-bg-surface text-center">
          <p className="text-xs uppercase tracking-widest text-text-secondary mb-1">
            {isCatchAllParcelIntake ? "Catch-all intake" : "Staging location"}
          </p>
          <p className="text-3xl font-bold font-mono text-text-primary">
            {branding.code}
          </p>
          <p className="text-sm text-text-secondary mt-1">{branding.label}</p>
        </div>
        <div className="flex flex-1 flex-col px-6 py-8">
          {canCatchAllCheckIn ? (
            <>
              <button
                type="button"
                data-testid="mgmt-catch-all-checkin-cta"
                onClick={() => setStep("mgmt-hub")}
                className="action-btn action-btn-delivered w-full text-lg py-5 mb-4"
              >
                Catch-all check-in
              </button>
              <p className="text-sm text-text-secondary text-center mb-8">
                Match packing slips to jobs waiting for parts. Walk parcels to the
                assigned spots after check-in.
              </p>
            </>
          ) : (
            <p
              className="text-sm text-text-secondary text-center mb-8"
              data-testid="mgmt-no-catch-all-capability"
            >
              This PIN can open the office door but does not include catch-all
              check-in. Ask dispatch to update PIN capabilities in Settings.
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              clearManagementPinSession();
              setStep("pin");
            }}
            className="action-btn action-btn-secondary w-full mt-auto"
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  if (step === "mgmt-hub" && branding && locationCode) {
    return (
      <ManagementCatchAllHub
        locationCode={branding.code}
        locationLabel={branding.label}
        onSessionExpired={handleManagementSessionExpired}
        onBack={() => setStep("mgmt-landing")}
      />
    );
  }

  if (step === "pin" && branding && locationCode) {
    return (
      <div className="app-container flex h-[100svh] max-h-[100dvh] min-h-[100svh] flex-col bg-bg-primary">
        <div
          className="shrink-0 border-b border-border bg-bg-surface px-3 text-center"
          style={{ paddingBlock: "clamp(0.25rem, 0.9svh, 0.5rem)" }}
          data-testid="location-scan-pin-header"
        >
          <p className="text-[10px] font-semibold uppercase leading-3 tracking-[0.18em] text-text-secondary [@media(max-height:600px)]:hidden">
            Staging location
          </p>
          <p
            className="font-mono text-2xl font-bold leading-none text-text-primary"
            style={{ marginTop: "clamp(2px, 0.4svh, 4px)" }}
          >
            {branding.code}
          </p>
          <p
            className="text-xs leading-4 text-text-secondary"
            style={{ marginTop: "clamp(2px, 0.4svh, 4px)" }}
          >
            {branding.label}
          </p>
        </div>
        <LocationScanPinGate
          stagingLocationCode={locationCode}
          onVerified={handleLocationScanPinVerified}
        />
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
            {`You're at ${branding.code}`}
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

        {jobsRevalidating && releasedJobs.length > 0 && (
          <p
            className="px-6 py-1 text-xs text-text-secondary text-center"
            data-testid="technician-jobs-revalidating"
          >
            Updating…
          </p>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {loading && releasedJobs.length === 0 && (
            <p
              className="text-sm text-text-secondary text-center py-8"
              data-testid="technician-jobs-loading"
            >
              Loading your pickups…
            </p>
          )}
          {releasedJobs.map((row) => (
            <button
              key={row.jobId}
              type="button"
              disabled={loading && releasedJobs.length === 0}
              onClick={() => openTechnicianJobPickup(row)}
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
          {releasedJobs.length === 0 && !loading && (
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

  if (step === "unplanned" && branding && vendorId) {
    const unplannedSession = getVendorUnplannedPinSession(vendorId);
    const runSession = getVendorRunPinSession(vendorId);
    const vendorName =
      unplannedSession?.vendorName ?? runSession?.vendorName ?? "Vendor";
    const sessionToken = resolveUnplannedSessionToken(vendorId);
    if (!sessionToken) {
      setStep("pin");
      return null;
    }
    return (
      <div className="app-container h-screen h-dvh overflow-hidden bg-bg-primary">
        <VendorUnplannedDeliveryFlow
          vendorId={vendorId}
          vendorName={vendorName}
          sessionToken={sessionToken}
          locationCode={branding.code}
          onComplete={(payload) => void handleUnplannedComplete(payload)}
          onSessionExpired={handlePinSessionExpired}
          onCancel={() => {
            if (sessionScope === "vendor_unplanned" && !runSession) {
              resetFlow();
              return;
            }
            setStep("vendor-list");
          }}
        />
      </div>
    );
  }

  if (step === "vendor-list" && branding) {
    const runSession = vendorId ? getVendorRunPinSession(vendorId) : null;
    return (
      <div className="app-container vendor-mobile-shell bg-bg-primary">
        <div
          className="vendor-hub-layout h-full min-h-0"
          data-testid="vendor-run-layout"
        >
        <header className="vendor-hub-header px-4 py-3 border-b border-border bg-bg-surface">
          <p className="text-xs uppercase tracking-widest text-text-secondary">
            Scanned {branding.code}
            {runSession?.vendorName ? ` · ${runSession.vendorName}` : ""}
          </p>
          <h1 className="text-lg font-bold text-text-primary mt-1">
            Your deliveries
          </h1>
          <p
            className="text-sm text-[#cbd5e1] mt-1"
            data-testid="vendor-run-helper"
          >
            Check each order you delivered, then tap Delivered.
          </p>
        </header>

        <main className="vendor-hub-scroll px-4 py-4">
          {error && (
            <p className="mb-3 text-sm text-accent-red" role="alert">
              {error}
            </p>
          )}
          <div
            className="flex flex-col gap-4"
            data-testid="vendor-run-card-list"
          >
            {vendorRunDeliveries.map((row) => {
            const canCheck = row.hasAssignableSpot;
            const expanded = expandedDeliveryIds.has(row.deliveryId);
            const delivered = row.vendorPhysicalDropoffConfirmed;
            const locationIdentity =
              row.stagingLocationCodes.length > 0
                ? row.stagingLocationCodes.join(", ")
                : "—";
            return (
              <div
                key={row.deliveryId}
                className={`overflow-hidden rounded-2xl border shadow-md shadow-black/10 ${
                  delivered
                    ? "border-[#059669] bg-[#047857]"
                    : "border-border bg-bg-surface"
                }`}
                data-testid={`vendor-run-row-${row.deliveryId}`}
                data-delivered={delivered ? "true" : "false"}
              >
                <div
                  className={`flex min-h-16 items-center gap-3 px-3 py-2.5 ${
                    delivered ? "bg-[#047857]" : "bg-bg-surface"
                  }`}
                  data-testid={
                    delivered
                      ? `vendor-run-delivered-summary-${row.deliveryId}`
                      : undefined
                  }
                >
                  {!delivered && (
                    <input
                      type="checkbox"
                      className="size-6 shrink-0 accent-[#047857]"
                      checked={checkedDeliveryIds.has(row.deliveryId)}
                      disabled={!canCheck || loading}
                      aria-label={`Select ${row.jobName}`}
                      onChange={() => toggleChecked(row.deliveryId, canCheck)}
                    />
                  )}
                  <button
                    type="button"
                    className="flex min-h-12 flex-1 items-center gap-3 text-left min-w-0"
                    onClick={() => toggleExpanded(row.deliveryId)}
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "Collapse" : "Expand"} ${row.jobName} delivery details`}
                    data-testid={`vendor-run-toggle-${row.deliveryId}`}
                  >
                    <span
                      className={`flex size-11 shrink-0 items-center justify-center rounded-xl font-mono text-sm font-semibold ${
                        delivered
                          ? "bg-white/15 text-white"
                          : "bg-accent/15 text-accent"
                      }`}
                      data-testid={
                        delivered
                          ? `vendor-run-delivered-location-tile-${row.deliveryId}`
                          : undefined
                      }
                    >
                      {locationIdentity}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-base font-semibold ${
                          delivered ? "text-white" : "text-text-primary"
                        }`}
                        data-testid={
                          delivered
                            ? `vendor-run-delivered-location-${row.deliveryId}`
                            : `vendor-run-location-${row.deliveryId}`
                        }
                      >
                        Location: {locationIdentity}
                      </span>
                      <span
                        className={`mt-0.5 block truncate text-xs ${
                          delivered
                            ? "font-bold tracking-[0.14em] text-white"
                            : "text-[#cbd5e1]"
                        }`}
                        data-testid={
                          delivered
                            ? `vendor-run-delivered-status-${row.deliveryId}`
                            : `vendor-run-job-${row.deliveryId}`
                        }
                      >
                        {delivered ? "DELIVERED" : row.jobName}
                      </span>
                      {!delivered && !canCheck && (
                        <span className="mt-1 block text-xs text-accent-red">
                          No spot — ask dispatch
                        </span>
                      )}
                    </span>
                    <span
                      className={`shrink-0 transition-transform duration-200 ${
                        delivered ? "text-white" : "text-[#cbd5e1]"
                      }`}
                      aria-hidden
                      style={{
                        transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
                      }}
                    >
                      <svg
                        width="19"
                        height="19"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </span>
                  </button>
                </div>
                {expanded && (
                  <div
                    className="border-t border-border bg-bg-surface"
                    data-testid={`vendor-run-details-${row.deliveryId}`}
                  >
                    <div className="space-y-1.5 p-3">
                    {[
                      { label: "Job / Site", value: row.jobName, mono: false },
                      { label: "Order #", value: row.orderNumber, mono: true },
                      {
                        label: "Invoice #",
                        value: row.vendorInvoiceNumber ?? "—",
                        mono: true,
                      },
                      { label: "PO #", value: row.poNumber ?? "—", mono: true },
                      { label: "Location", value: locationIdentity, mono: false },
                    ].map(({ label, value, mono }) => (
                      <div
                        key={label}
                        className="flex min-w-0 items-center justify-between gap-3 text-sm"
                      >
                        <span
                          className="shrink-0 text-[#cbd5e1]"
                          data-testid="vendor-run-details-label"
                        >
                          {label}
                        </span>
                        <span
                          className={`min-w-0 text-right font-medium text-text-primary ${
                            mono ? "max-w-[55%]" : ""
                          }`}
                          data-testid="vendor-run-details-value"
                        >
                          {mono ? (
                            <span className="inline-block max-w-full truncate rounded bg-bg-secondary px-2 py-0.5 font-mono text-xs">
                              {value}
                            </span>
                          ) : (
                            value
                          )}
                        </span>
                      </div>
                    ))}
                    </div>
                    <div className="border-t border-border px-3 py-2.5">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-[#cbd5e1]">Expected items</span>
                        <span className="font-medium text-text-primary">
                          {row.items.length}
                        </span>
                      </div>
                    </div>
                    <ul className="space-y-2 border-t border-border bg-bg-secondary/40 px-3 py-2.5">
                      {row.items.map((item) => (
                        <li
                          key={item.id}
                          className="rounded-lg border border-border bg-bg-primary px-3 py-2"
                        >
                          <p className="text-sm font-medium leading-snug text-text-primary">
                            {item.description}
                          </p>
                          <p className="mt-1 text-xs text-[#cbd5e1]">
                            Qty {item.qtyOrdered}
                          </p>
                        </li>
                      ))}
                      {row.items.length === 0 && (
                        <li className="text-sm text-[#cbd5e1]">
                          No item details available.
                        </li>
                      )}
                    </ul>
                    {delivered && (
                      <div className="border-t border-border p-3">
                        <button
                          type="button"
                          disabled={vendorRunRevertingId !== null}
                          onClick={() => void handleVendorRunUndo(row.deliveryId)}
                          className="action-btn action-btn-secondary w-full disabled:opacity-50"
                          data-testid={`vendor-run-undo-${row.deliveryId}`}
                        >
                          {vendorRunRevertingId === row.deliveryId
                            ? "Reverting…"
                            : "Undo Delivery"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
            })}
          {vendorRunDeliveries.length === 0 && (
            <div
              className="rounded-2xl border border-white/10 bg-bg-secondary px-5 py-6 text-center shadow-lg shadow-black/15"
              data-testid="vendor-unplanned-empty-state"
            >
              <div className="mx-auto flex size-12 items-center justify-center rounded-xl border border-[#6ee7b7]/30 bg-[#34d399]/10 text-[#6ee7b7]">
                <svg
                  className="size-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M20 7 12 3 4 7m16 0-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                  />
                </svg>
              </div>
              <h2 className="mt-4 text-xl font-bold tracking-tight text-text-primary">
                Don&apos;t see this delivery?
              </h2>
              <p className="mt-2 text-sm leading-6 text-text-secondary">
                {runSession?.vendorName ?? "Your company"} can add an invoice,
                PO, or order that isn&apos;t listed.
              </p>
              <button
                type="button"
                className="tap-target mt-5 min-h-12 w-full rounded-xl bg-[#047857] px-4 py-3 text-base font-bold text-white shadow-md shadow-black/20 transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6ee7b7] focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary"
                data-testid="vendor-unplanned-entry-cta"
                onClick={openUnplannedFromVendorList}
              >
                Add unplanned delivery
              </button>
            </div>
          )}
          </div>
        </main>

        <footer
          className="vendor-hub-footer border-t border-border bg-bg-primary px-4 pt-3 space-y-2"
          data-testid="vendor-run-footer"
        >
          <button
            type="button"
            onClick={resetFlow}
            className="action-btn action-btn-secondary w-full"
            data-testid="vendor-run-back"
          >
            ← Back
          </button>
          <button
            type="button"
            disabled={loading || checkedDeliveryIds.size === 0}
            onClick={() => setConfirmBulkOpen(true)}
            className="action-btn action-btn-delivered w-full disabled:opacity-40"
            style={{ backgroundColor: "#047857" }}
            data-testid="vendor-run-bulk-deliver"
          >
            Delivered
            {checkedDeliveryIds.size > 0
              ? ` (${checkedDeliveryIds.size})`
              : ""}
          </button>
        </footer>

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

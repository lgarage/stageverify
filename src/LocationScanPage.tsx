import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
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
  getActiveJobPinSession,
  getActiveVendorRunSession,
  getActiveVendorUnplannedSession,
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
import {
  locationScanHistoryPath,
  locationScanHistoryViewsEqual,
  readLocationScanHistoryView,
  type LocationScanHistoryView,
} from "./locationScanHistory";
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
  const location = useLocation();
  const [searchParams] = useSearchParams();
  normalizeLocationScanHash();

  const { loc: locationCode } = readLocationScanParams(searchParams);
  const historyView = readLocationScanHistoryView(searchParams);
  const initialPinResumeRef = useRef(false);
  const appliedDeliveryIdRef = useRef<string | null>(null);

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

  const goToHistoryView = useCallback(
    (view: LocationScanHistoryView, options?: { replace?: boolean }) => {
      if (!locationCode) return;
      const path = locationScanHistoryPath(locationCode, view);
      const current = `${location.pathname}${location.search}`;
      if (current === path) return;
      if (locationScanHistoryViewsEqual(historyView, view)) return;
      navigate(path, { replace: options?.replace === true });
    },
    [historyView, location.pathname, location.search, locationCode, navigate],
  );

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
          goToHistoryView({ kind: "deliveries" }, { replace: true });
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
    [goToHistoryView],
  );

  const loadJobDeliveries = useCallback(
    async (resolvedJobId: string) => {
      const token = getJobSessionToken(resolvedJobId);
      if (!token) {
        goToHistoryView({ kind: "pin" }, { replace: true });
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
          goToHistoryView(
            {
              kind: "delivery",
              deliveryId: result.deliveries[0].deliveryId,
            },
            { replace: true },
          );
          return;
        }
        setStep("list");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not load job deliveries.",
        );
        clearJobPinSession(resolvedJobId);
        goToHistoryView({ kind: "pin" }, { replace: true });
      } finally {
        setLoading(false);
      }
    },
    [goToHistoryView],
  );

  const openVendorRunDelivery = useCallback(
    async (resolvedVendorId: string, deliveryId: string) => {
      setLoading(true);
      setError(null);
      try {
        if (!bridgeVendorRunSessionToDelivery(resolvedVendorId, deliveryId)) {
          goToHistoryView({ kind: "pin" }, { replace: true });
          return;
        }
        const details =
          await getDeliveryDetailsPublicForVendorReceive(deliveryId);
        if (!details) {
          setError("Could not open delivery.");
          goToHistoryView({ kind: "deliveries" }, { replace: true });
          return;
        }
        setDeliveryDetails(details);
        setVendorId(resolvedVendorId);
        setSessionScope("vendor");
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
    [goToHistoryView],
  );

  const loadVendorRunDeliveries = useCallback(async (
    resolvedVendorId: string,
    expansionUpdate?: VendorRunExpansionUpdate,
  ) => {
    const token = getVendorRunSessionToken(resolvedVendorId);
    if (!token) {
      goToHistoryView({ kind: "pin" }, { replace: true });
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
      goToHistoryView({ kind: "pin" }, { replace: true });
    } finally {
      setLoading(false);
    }
  }, [goToHistoryView]);

  useEffect(() => {
    initialPinResumeRef.current = false;
  }, [locationCode]);

  useEffect(() => {
    if (historyView.kind !== "pin") return;
    if (initialPinResumeRef.current) return;
    initialPinResumeRef.current = true;
    const tech = getActiveTechnicianSession();
    if (tech) {
      goToHistoryView({ kind: "tech" }, { replace: true });
      return;
    }
    if (isManagementPinSessionValid()) {
      goToHistoryView({ kind: "mgmt" }, { replace: true });
      return;
    }
    const run = getActiveVendorRunSession();
    if (run) {
      setVendorId(run.vendorId);
      goToHistoryView({ kind: "deliveries" }, { replace: true });
      return;
    }
    const job = getActiveJobPinSession();
    if (job) {
      setJobId(job.jobId);
      goToHistoryView({ kind: "deliveries" }, { replace: true });
    }
  }, [goToHistoryView, historyView.kind, locationCode]);

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
        goToHistoryView({ kind: "unplanned" });
        return;
      }
      if (payload.sessionScope === "vendor" && payload.vendorId) {
        setVendorId(payload.vendorId);
        setJobId(null);
        goToHistoryView({ kind: "deliveries" });
        return;
      }
      if (!payload.jobId) {
        setError("Invalid session.");
        return;
      }
      setJobId(payload.jobId);
      setVendorId(null);
      goToHistoryView({ kind: "deliveries" });
    },
    [goToHistoryView],
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
      goToHistoryView({ kind: "pin" }, { replace: true });
      return;
    }
    setSessionScope(
      unplannedSession ? "vendor_unplanned" : "vendor",
    );
    goToHistoryView({ kind: "unplanned" });
  }, [goToHistoryView, vendorId]);

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
          goToHistoryView({
            kind: "delivery",
            deliveryId: payload.deliveryId,
          });
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
          goToHistoryView({ kind: "deliveries" }, { replace: true });
          return;
        }
        setDeliveryDetails(details);
        goToHistoryView({
          kind: "delivery",
          deliveryId: payload.deliveryId,
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not open delivery.",
        );
        await loadVendorRunDeliveries(payload.vendorId);
      } finally {
        setLoading(false);
      }
    },
    [goToHistoryView, loadVendorRunDeliveries, scannedCode],
  );

  const loadTechnicianReleasedJobs = useCallback(
    async (resolvedTechnicianId: string) => {
      const token = getTechnicianSessionToken(resolvedTechnicianId);
      if (!token) {
        goToHistoryView({ kind: "pin" }, { replace: true });
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
          goToHistoryView({ kind: "pin" }, { replace: true });
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
    [goToHistoryView],
  );

  const handleTechnicianPinVerified = useCallback(
    (payload: { technicianId: string; technicianName: string }) => {
      setTechnicianId(payload.technicianId);
      setTechnicianName(payload.technicianName);
      goToHistoryView({ kind: "tech" });
    },
    [goToHistoryView],
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
    if (!locationCode) return;

    if (historyView.kind === "pin") {
      appliedDeliveryIdRef.current = null;
      setStep("pin");
      return;
    }

    if (historyView.kind === "deliveries") {
      appliedDeliveryIdRef.current = null;
      const runId = vendorId ?? getActiveVendorRunSession()?.vendorId ?? null;
      const job = jobId ?? getActiveJobPinSession()?.jobId ?? null;
      if (runId && isVendorRunPinSessionValid(runId)) {
        if (vendorId !== runId) setVendorId(runId);
        void loadVendorRunDeliveries(runId);
        return;
      }
      if (job && isJobPinSessionValid(job)) {
        if (jobId !== job) setJobId(job);
        void loadJobDeliveries(job);
        return;
      }
      goToHistoryView({ kind: "pin" }, { replace: true });
      return;
    }

    if (historyView.kind === "delivery") {
      if (appliedDeliveryIdRef.current === historyView.deliveryId) {
        return;
      }
      appliedDeliveryIdRef.current = historyView.deliveryId;
      const runId = vendorId ?? getActiveVendorRunSession()?.vendorId ?? null;
      const job = jobId ?? getActiveJobPinSession()?.jobId ?? null;
      if (job && isJobPinSessionValid(job)) {
        if (jobId !== job) setJobId(job);
        void openDelivery(job, historyView.deliveryId);
        return;
      }
      if (runId && isVendorRunPinSessionValid(runId)) {
        if (vendorId !== runId) setVendorId(runId);
        void openVendorRunDelivery(runId, historyView.deliveryId);
        return;
      }
      goToHistoryView({ kind: "pin" }, { replace: true });
      return;
    }

    if (historyView.kind === "unplanned") {
      const runId =
        vendorId ??
        getActiveVendorUnplannedSession()?.vendorId ??
        getActiveVendorRunSession()?.vendorId ??
        null;
      if (!runId) {
        goToHistoryView({ kind: "pin" }, { replace: true });
        return;
      }
      if (vendorId !== runId) setVendorId(runId);
      setStep("unplanned");
      return;
    }

    if (historyView.kind === "tech") {
      const active = technicianId
        ? { technicianId }
        : getActiveTechnicianSession();
      if (!active || !isTechnicianPinSessionValid(active.technicianId)) {
        goToHistoryView({ kind: "pin" }, { replace: true });
        return;
      }
      void loadTechnicianReleasedJobs(active.technicianId);
      return;
    }

    if (historyView.kind === "mgmt") {
      if (!isManagementPinSessionValid()) {
        goToHistoryView({ kind: "pin" }, { replace: true });
        return;
      }
      setStep("mgmt-landing");
      return;
    }

    if (historyView.kind === "mgmt-hub") {
      if (!isManagementPinSessionValid()) {
        goToHistoryView({ kind: "pin" }, { replace: true });
        return;
      }
      setStep("mgmt-hub");
    }
  }, [
    goToHistoryView,
    historyView,
    jobId,
    loadJobDeliveries,
    loadTechnicianReleasedJobs,
    loadVendorRunDeliveries,
    locationCode,
    openDelivery,
    openVendorRunDelivery,
    technicianId,
    vendorId,
  ]);

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
        goToHistoryView({ kind: "mgmt" });
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
    [goToHistoryView, handlePinVerified, handleTechnicianPinVerified],
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
    goToHistoryView({ kind: "pin" }, { replace: true });
  }, [goToHistoryView, jobId, technicianId, vendorId]);

  const handleManagementSessionExpired = useCallback(() => {
    clearManagementPinSession();
    goToHistoryView({ kind: "pin" }, { replace: true });
  }, [goToHistoryView]);

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

  const handleMarkDelivered = async (
    lineExceptions?: Array<{
      itemId: string;
      qtyReceived: number;
      qtyBackordered: number;
      qtyDamaged: number;
    }>,
  ): Promise<boolean> => {
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
        "Vendor Driver",
        lineExceptions,
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
      setError(
        err instanceof Error ? err.message : "Failed to confirm delivery",
      );
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
    goToHistoryView({ kind: "pin" }, { replace: true });
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
                onClick={() => goToHistoryView({ kind: "mgmt-hub" })}
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
              goToHistoryView({ kind: "pin" }, { replace: true });
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
        onBack={() => goToHistoryView({ kind: "mgmt" }, { replace: true })}
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
    const techContextParts = [branding.code, technicianName].filter(
      (part): part is string => Boolean(part),
    );
    const techContextLabel = techContextParts.join(" · ");

    return (
      <div
        className="app-container vendor-mobile-shell tech-released-jobs bg-bg-primary"
        data-testid="technician-released-jobs"
      >
        <div className="vendor-hub-layout h-full min-h-0">
          <header
            className="vendor-hub-header px-4 pb-4"
            style={{
              paddingTop: "max(env(safe-area-inset-top, 0px), 16px)",
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={resetFlow}
                className="tap-target -ml-2 flex min-h-11 min-w-11 shrink-0 items-center px-2 text-sm font-semibold text-[#cbd5e1]"
              >
                ← Back
              </button>
              {techContextLabel ? (
                <p className="min-w-0 truncate text-right text-[11px] font-semibold uppercase tracking-[0.16em] text-text-secondary">
                  {techContextLabel}
                </p>
              ) : null}
            </div>
            <h1 className="tech-released-jobs-title mt-3 text-2xl leading-7 font-bold tracking-tight text-text-primary">
              Pick up today
            </h1>
            <p className="mt-1 text-sm leading-5 text-[#cbd5e1]">
              Tap a released job to open its pickup.
            </p>
          </header>

          <main
            className="vendor-hub-scroll px-4 pt-4"
            style={{
              paddingBottom: "max(env(safe-area-inset-bottom, 0px), 24px)",
            }}
          >
            {error && (
              <div
                className="mb-4 rounded-xl border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-sm text-accent-red"
                role="alert"
              >
                {error}
              </div>
            )}

            <div className="tech-released-jobs-section-label mb-4 flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-secondary">
                Released jobs
              </p>
              {jobsRevalidating && releasedJobs.length > 0 && (
                <span
                  className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary"
                  data-testid="technician-jobs-revalidating"
                >
                  Updating…
                </span>
              )}
            </div>

            <div className="tech-released-jobs-card-list flex flex-col gap-4">
              {loading && releasedJobs.length === 0 && (
                <div data-testid="technician-jobs-loading">
                  <div
                    className="min-h-[136px] w-full animate-pulse rounded-2xl border border-white/10 bg-bg-secondary"
                    aria-hidden
                  />
                  <p className="mt-3 text-center text-sm text-text-secondary">
                    Loading your pickups…
                  </p>
                </div>
              )}

              {releasedJobs.map((row) => (
                <button
                  key={row.jobId}
                  type="button"
                  disabled={loading && releasedJobs.length === 0}
                  onClick={() => openTechnicianJobPickup(row)}
                  className="min-h-[136px] w-full rounded-2xl border border-white/10 bg-bg-secondary p-4 text-left shadow-lg shadow-black/20 touch-manipulation transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  data-testid={`tech-released-job-${row.jobId}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
                        Pickup job
                      </p>
                      <p className="tech-released-jobs-job-name mt-1 text-lg leading-6 font-bold text-text-primary">
                        {row.jobName}
                      </p>
                    </div>
                    <span
                      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent"
                      aria-hidden
                    >
                      <svg
                        width="18"
                        height="18"
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
                  </div>

                  <div className="tech-released-jobs-go-to mt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
                      Go to
                    </p>
                    <div className="tech-released-jobs-chip-row mt-1.5 flex flex-wrap gap-1.5">
                      {row.stagingLocationCodes.length > 0 ? (
                        row.stagingLocationCodes.map((code) => (
                          <span
                            key={code}
                            className="rounded-lg bg-accent/15 px-2.5 py-1 font-mono text-sm font-semibold text-accent"
                          >
                            {code}
                          </span>
                        ))
                      ) : (
                        <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-sm text-[#cbd5e1]">
                          Awaiting staging spot
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="tech-released-jobs-card-footer mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
                    <p
                      className={`text-sm font-semibold ${
                        row.readyForPickupCount > 0
                          ? "text-[#6ee7b7]"
                          : "text-text-secondary"
                      }`}
                    >
                      {row.readyForPickupCount > 0
                        ? `${row.readyForPickupCount} ready for pickup`
                        : "No deliveries ready yet"}
                    </p>
                    <p className="shrink-0 text-sm font-semibold text-text-primary">
                      {row.deliveryCount}{" "}
                      {row.deliveryCount === 1 ? "delivery" : "deliveries"}
                    </p>
                  </div>
                </button>
              ))}

              {releasedJobs.length === 0 && !loading && (
                <div
                  className="rounded-2xl border border-white/10 bg-bg-secondary px-5 py-7 text-center"
                  data-testid="technician-empty-released"
                >
                  <h2 className="text-lg font-bold text-text-primary">
                    Nothing released yet
                  </h2>
                  <p className="mt-2 text-sm leading-5 text-text-secondary">
                    When dispatch releases a pickup job, it&apos;ll appear here.
                  </p>
                </div>
              )}
            </div>
          </main>
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
      goToHistoryView({ kind: "pin" }, { replace: true });
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
            goToHistoryView({ kind: "deliveries" }, { replace: true });
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
          {/*
            Unplanned fallback is a reusable escape hatch (D-73): prior listed
            deliveries (expected or unplanned) must not hide "Add unplanned delivery".
          */}
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
          {vendorRunDeliveries.length === 0 ? (
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
          ) : (
            <div
              className="rounded-2xl border border-white/10 bg-bg-secondary px-5 py-5 text-center shadow-lg shadow-black/15"
              data-testid="vendor-unplanned-fallback"
            >
              <h2 className="text-lg font-bold tracking-tight text-text-primary">
                Don&apos;t see this delivery?
              </h2>
              <p className="mt-1.5 text-sm leading-6 text-text-secondary">
                Add another invoice, PO, or order that isn&apos;t listed yet.
              </p>
              <button
                type="button"
                className="tap-target mt-4 min-h-12 w-full rounded-xl bg-[#047857] px-4 py-3 text-base font-bold text-white shadow-md shadow-black/20 transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6ee7b7] focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary"
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
      <div
        className="app-container vendor-mobile-shell bg-bg-primary"
        data-testid="vendor-job-deliveries"
      >
        <div className="vendor-hub-layout h-full min-h-0">
          <header className="vendor-hub-header vendor-job-deliveries-header border-b border-border bg-bg-surface px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-secondary">
              Scanned {branding.code}
              {scannedCode && scannedCode !== branding.code
                ? ` · PIN job spots below`
                : ""}
            </p>
            <h1 className="vendor-job-deliveries-title mt-2 text-2xl font-bold leading-7 tracking-tight text-text-primary">
              This job&apos;s deliveries
            </h1>
            <p className="vendor-job-deliveries-helper mt-1 text-sm leading-5 text-[#cbd5e1]">
              Select an order to confirm delivery
            </p>
          </header>

          <main className="vendor-hub-scroll vendor-job-deliveries-scroll px-4 py-4">
            <div className="vendor-job-deliveries-card-list flex flex-col gap-4">
              {deliveries.map((row) => {
                const displayPo = row.poNumber
                  ? /^po/i.test(row.poNumber)
                    ? row.poNumber
                    : `PO ${row.poNumber}`
                  : null;

                return (
                  <button
                    key={row.deliveryId}
                    type="button"
                    disabled={loading}
              onClick={() => {
                goToHistoryView({
                  kind: "delivery",
                  deliveryId: row.deliveryId,
                });
              }}
                    className="min-h-11 w-full rounded-2xl border border-white/10 bg-bg-secondary p-4 text-left shadow-lg shadow-black/20 touch-manipulation transition active:scale-[0.99] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    data-testid={`vendor-job-delivery-${row.deliveryId}`}
                  >
                    <div className="vendor-job-delivery-order-row flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="vendor-job-delivery-order break-words text-lg font-bold leading-6 text-text-primary [overflow-wrap:anywhere]">
                          {row.orderNumber}
                        </p>
                        {displayPo && (
                          <p className="vendor-job-delivery-po mt-1.5 break-words text-sm leading-5 text-[#cbd5e1] [overflow-wrap:anywhere]">
                            {displayPo}
                          </p>
                        )}
                      </div>
                      <span
                        className="mt-0.5 shrink-0 text-text-secondary"
                        aria-hidden
                      >
                        <svg
                          width="18"
                          height="18"
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
                    </div>

                    <div className="vendor-job-delivery-staging mt-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
                        Staging locations
                      </p>
                      <div className="vendor-job-delivery-staging-values mt-1.5 flex flex-wrap gap-1.5">
                        {row.stagingLocationCodes.length > 0 ? (
                          row.stagingLocationCodes.map((code) => (
                            <span
                              key={code}
                              className="rounded-lg bg-accent/15 px-2.5 py-1 font-mono text-sm font-semibold text-accent"
                            >
                              {code}
                            </span>
                          ))
                        ) : (
                          <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-sm text-[#cbd5e1]">
                            Not assigned yet
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}

              {deliveries.length === 0 && (
                <div className="vendor-job-deliveries-empty rounded-2xl border border-white/10 bg-bg-secondary px-5 py-7 text-center shadow-lg shadow-black/15">
                  <p className="text-sm leading-5 text-[#cbd5e1]">
                    No active deliveries for this job.
                  </p>
                </div>
              )}
            </div>
          </main>

          <footer className="vendor-hub-footer vendor-job-deliveries-footer border-t border-border bg-bg-primary px-4 pt-3">
            <button
              type="button"
              onClick={resetFlow}
              className="action-btn action-btn-secondary w-full"
            >
              ← Back
            </button>
          </footer>

          {jobSession && (
            <p className="sr-only" data-testid="job-session-active">
              job-session
            </p>
          )}
        </div>
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
            onDelivered={(lineExceptions) =>
              handleMarkDelivered(lineExceptions)
            }
            onUndoDelivered={() => handleRevertDelivered()}
            onBack={() => {
              if (sessionScope === "vendor" && vendorId) {
                goToHistoryView({ kind: "deliveries" }, { replace: true });
                return;
              }
              if (deliveries.length > 1) {
                goToHistoryView({ kind: "deliveries" }, { replace: true });
                return;
              }
              resetFlow();
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

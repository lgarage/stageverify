import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
  getVendorReceiveDetailsClient,
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
  VendorIssueModal,
  type VendorIssueTarget,
} from "./VendorIssueModal";
import { VendorItemDisplayLines } from "./VendorItemDisplayLines";
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
  readLocationScanHistoryView,
  type LocationScanHistoryView,
} from "./locationScanHistory";
import { requestLeftoverReceiveCollapse } from "./locationScanHistoryCollapse";
import { isVendorSessionError } from "./vendorSessionErrors";
import { PublicNetworkErrorPanel } from "./PublicNetworkErrorPanel";
import { isOutsideShopGeofence } from "./geofence";
import { VendorDeliveriesLanding } from "./VendorDeliveriesLanding";
import { VendorCompactDeliveryCard } from "./VendorCompactDeliveryCard";
import {
  deriveVendorItemLineStatus,
  deriveVendorOrderFulfillmentLabel,
  vendorFulfillmentTone,
  vendorItemsHaveFulfillmentQty,
} from "./dispatcher/vendorJobCardStatus";
import { orderVendorJobsDeliveredLast } from "./dispatcher/vendorJobListOrder";

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

async function enrichVendorRunFulfillment(
  rows: VendorRunDeliverySummary[],
  sessionToken: string,
): Promise<VendorRunDeliverySummary[]> {
  const missing = rows.filter(
    (row) => !vendorItemsHaveFulfillmentQty(row.items),
  );
  if (missing.length === 0) return rows;
  const byId = new Map<string, VendorRunDeliverySummary["items"]>();
  await Promise.all(
    missing.map(async (row) => {
      try {
        const details = await getVendorReceiveDetailsClient({
          deliveryId: row.deliveryId,
          sessionToken,
        });
        byId.set(
          row.deliveryId,
          details.items.map((item) => ({
            id: item.id,
            description: item.description,
            qtyOrdered: item.qtyOrdered,
            qtyReceived: item.qtyReceived,
            qtyBackordered: item.qtyBackordered,
            status: item.status,
          })),
        );
      } catch {
        // Keep list DTO when details are unavailable (legacy CF / mocks).
      }
    }),
  );
  if (byId.size === 0) return rows;
  return rows.map((row) => {
    const items = byId.get(row.deliveryId);
    return items ? { ...row, items } : row;
  });
}

export function LocationScanPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  normalizeLocationScanHash();

  const { loc: locationCode } = readLocationScanParams(searchParams);
  const [hashSearch, setHashSearch] = useState(() =>
    typeof window === "undefined" ? "" : window.location.hash,
  );
  const historyView = useMemo(() => {
    const raw = hashSearch.includes("?")
      ? hashSearch.slice(hashSearch.indexOf("?") + 1)
      : location.search.startsWith("?")
        ? location.search.slice(1)
        : location.search;
    return readLocationScanHistoryView(new URLSearchParams(raw));
  }, [hashSearch, location.search]);
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
  const [expandedDeliveryIds, setExpandedDeliveryIds] = useState<Set<string>>(
    new Set(),
  );
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
  const [vendorRunIssueTarget, setVendorRunIssueTarget] =
    useState<VendorIssueTarget | null>(null);
  const [vendorRunIssueReportedIds, setVendorRunIssueReportedIds] = useState<
    Set<string>
  >(new Set());
  const [technicianId, setTechnicianId] = useState<string | null>(null);
  const [technicianName, setTechnicianName] = useState<string | null>(null);
  const [releasedJobs, setReleasedJobs] = useState<TechnicianReleasedJobSummary[]>(
    [],
  );
  const [jobsRevalidating, setJobsRevalidating] = useState(false);
  const [isCatchAllParcelIntake, setIsCatchAllParcelIntake] = useState(false);

  const jobDeliveriesForList = useMemo(
    () => orderVendorJobsDeliveredLast(deliveries),
    [deliveries],
  );
  const vendorRunDeliveriesForList = useMemo(
    () => orderVendorJobsDeliveredLast(vendorRunDeliveries),
    [vendorRunDeliveries],
  );

  const historyViewKey =
    historyView.kind === "delivery"
      ? `delivery:${historyView.deliveryId}`
      : historyView.kind;

  useEffect(() => {
    const syncHash = () => setHashSearch(window.location.hash);
    window.addEventListener("hashchange", syncHash);
    window.addEventListener("popstate", syncHash);
    return () => {
      window.removeEventListener("hashchange", syncHash);
      window.removeEventListener("popstate", syncHash);
    };
  }, []);

  const goToHistoryView = useCallback(
    (view: LocationScanHistoryView, options?: { replace?: boolean }) => {
      if (!locationCode) return;
      const path = locationScanHistoryPath(locationCode, view);
      const current = `${location.pathname}${location.search}`;
      if (current === path && historyViewKey === (
        view.kind === "delivery" ? `delivery:${view.deliveryId}` : view.kind
      )) {
        return;
      }
      navigate(path, { replace: options?.replace === true });
      setHashSearch(
        path.startsWith("#") ? path : `#${path.startsWith("/") ? path : `/${path}`}`,
      );
    },
    [historyViewKey, location.pathname, location.search, locationCode, navigate],
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

  useLayoutEffect(() => {
    requestLeftoverReceiveCollapse();
  }, [locationCode]);

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
      const deliveries = await enrichVendorRunFulfillment(
        result.deliveries,
        token,
      );
      setVendorId(resolvedVendorId);
      setSessionScope("vendor");
      setVendorRunDeliveries(deliveries);
      setScannedCode(result.scannedStagingLocationCode);
      setExpandedDeliveryIds(() => {
        if (expansionUpdate) {
          const next = new Set(expansionUpdate.preserveExpandedIds);
          for (const deliveryId of expansionUpdate.collapseDeliveryIds) {
            next.delete(deliveryId);
          }
          return next;
        }
        return new Set();
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
    historyViewKey,
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

  const toggleExpanded = (deliveryId: string) => {
    setExpandedDeliveryIds((prev) =>
      prev.has(deliveryId) ? new Set() : new Set([deliveryId]),
    );
  };

  const handleVendorRunComplete = async (deliveryId: string) => {
    if (!vendorId) return;
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
      const result = await markVendorDeliveriesBulkClient({
        sessionToken: token,
        deliveryIds: [deliveryId],
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
    } catch (err) {
      if (isVendorSessionError(err)) {
        handlePinSessionExpired();
        return;
      }
      setError(err instanceof Error ? err.message : "Delivery could not be completed.");
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
    setExpandedDeliveryIds(new Set());
    setVendorRunIssueTarget(null);
    setVendorRunIssueReportedIds(new Set());
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

  // URL is SoT: Safari Back to `#/s?loc=` must paint PIN immediately.
  // Do not wait for step===pin — list/hub step stays stale across popstate.
  if (historyView.kind === "pin" && branding && locationCode) {
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

  if (step === "tech-list" && branding && historyView.kind === "tech") {
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

  if (step === "vendor-list" && branding && historyView.kind === "deliveries") {
    const runSession = vendorId ? getVendorRunPinSession(vendorId) : null;
    return (
      <VendorDeliveriesLanding
        rootTestId="vendor-run-layout"
        vendorName={runSession?.vendorName}
        scannedContext={
          <>
            Scanned {branding.code}
            {runSession?.vendorName ? ` · ${runSession.vendorName}` : ""}
          </>
        }
        helper="Tap a job to review and complete delivery."
        helperTestId="vendor-run-helper"
        footer={
          <div data-testid="vendor-run-footer">
            <button
              type="button"
              onClick={resetFlow}
              className="action-btn action-btn-secondary w-full"
              data-testid="vendor-run-back"
            >
              ← Back
            </button>
          </div>
        }
        overlay={
          <>
            {runSession && (
              <p className="sr-only" data-testid="vendor-run-session-active">
                vendor-run-session
              </p>
            )}
            {vendorRunIssueTarget && (
              <VendorIssueModal
                target={vendorRunIssueTarget}
                onClose={() => setVendorRunIssueTarget(null)}
                onSubmitted={() =>
                  setVendorRunIssueReportedIds((previous) => {
                    const next = new Set(previous);
                    next.add(vendorRunIssueTarget.deliveryId);
                    return next;
                  })
                }
              />
            )}
          </>
        }
      >
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
            {vendorRunDeliveriesForList.map((row) => {
            const canComplete = row.hasAssignableSpot;
            const expanded = expandedDeliveryIds.has(row.deliveryId);
            const delivered = row.vendorPhysicalDropoffConfirmed;
            const fulfillmentLabel = deriveVendorOrderFulfillmentLabel({
              items: row.items,
              deliveryStatus: row.status,
              vendorPhysicalDropoffConfirmed:
                row.vendorPhysicalDropoffConfirmed,
            });
            const fulfillmentTone = vendorFulfillmentTone(fulfillmentLabel);
            const locationIdentity =
              row.stagingLocationCodes.length > 0
                ? row.stagingLocationCodes.join(", ")
                : "—";
            return (
              <div
                key={row.deliveryId}
                className={`vendor-compact-card overflow-hidden rounded-2xl border bg-bg-secondary shadow-lg shadow-black/20 ${
                  fulfillmentTone === "delivered"
                    ? "vendor-compact-card-delivered"
                    : fulfillmentTone === "partial"
                      ? "vendor-compact-card-partial"
                      : "border-white/10"
                }`}
                data-testid={`vendor-run-row-${row.deliveryId}`}
                data-delivered={delivered ? "true" : "false"}
                data-fulfillment={fulfillmentTone}
              >
                <div
                  className="vendor-compact-card-action-row"
                >
                  <button
                    type="button"
                    className="vendor-compact-card-toggle w-full min-w-0 text-left"
                    onClick={() => toggleExpanded(row.deliveryId)}
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "Collapse" : "Expand"} ${row.jobName} delivery details`}
                    data-testid={`vendor-run-toggle-${row.deliveryId}`}
                  >
                    <VendorCompactDeliveryCard
                      deliveryId={row.deliveryId}
                      variant="vendor-run"
                      jobName={row.jobName}
                      orderNumber={row.orderNumber}
                      vendorInvoiceNumber={row.vendorInvoiceNumber}
                      poNumber={row.poNumber}
                      stagingLocationCodes={row.stagingLocationCodes}
                      delivered={delivered}
                      fulfillment={fulfillmentTone}
                      expanded={expanded}
                      warning={
                        !delivered && !canComplete
                          ? "No spot — ask dispatch"
                          : undefined
                      }
                    />
                  </button>
                </div>
                {expanded && (
                  <div
                    className="border-t border-border bg-bg-surface"
                    data-testid={`vendor-run-details-${row.deliveryId}`}
                  >
                    <div className="space-y-2.5 px-4 py-3.5">
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
                    <div className="border-t border-border px-4 py-3">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-[#cbd5e1]">Expected items</span>
                        <span className="font-medium text-text-primary">
                          {row.items.length}
                        </span>
                      </div>
                    </div>
                    <ul className="space-y-2.5 border-t border-border bg-bg-secondary/40 px-4 py-3">
                      {row.items.map((item) => (
                        <li
                          key={item.id}
                          className="rounded-lg border border-border bg-bg-primary px-3 py-2"
                          data-testid={`vendor-run-item-${item.id}`}
                        >
                          <VendorItemDisplayLines
                            description={item.description}
                            qtyOrdered={item.qtyOrdered}
                            lineStatus={deriveVendorItemLineStatus(item)}
                          />
                        </li>
                      ))}
                      {row.items.length === 0 && (
                        <li className="text-sm text-[#cbd5e1]">
                          No item details available.
                        </li>
                      )}
                    </ul>
                    {vendorRunIssueReportedIds.has(row.deliveryId) && (
                      <p
                        className="border-t border-[#34d399]/30 bg-[#34d399]/10 px-4 py-3 text-center text-sm font-semibold text-[#6ee7b7]"
                        role="status"
                        data-testid={`vendor-run-issue-reported-${row.deliveryId}`}
                      >
                        Issue reported — dispatcher notified.
                      </p>
                    )}
                    {!delivered && (
                      <div className="space-y-2.5 border-t border-border bg-bg-surface p-3">
                        <div className="flex gap-3">
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => setExpandedDeliveryIds(new Set())}
                            className="action-btn action-btn-secondary flex-1 disabled:opacity-50"
                            data-testid={`vendor-run-cancel-${row.deliveryId}`}
                          >
                            Cancel / Back
                          </button>
                          <button
                            type="button"
                            disabled={!canComplete || loading}
                            onClick={() =>
                              void handleVendorRunComplete(row.deliveryId)
                            }
                            className="action-btn action-btn-delivered flex-1 disabled:opacity-40"
                            style={{ backgroundColor: "#047857" }}
                            data-testid={`vendor-run-complete-${row.deliveryId}`}
                          >
                            {loading ? "Completing…" : "Complete delivery"}
                          </button>
                        </div>
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() =>
                            setVendorRunIssueTarget({
                              deliveryId: row.deliveryId,
                              jobId: row.jobId,
                              orderNumber: row.orderNumber,
                              vendorName: runSession?.vendorName ?? "Vendor",
                            })
                          }
                          className="min-h-11 w-full rounded-xl border border-[#fbbf24]/60 bg-[#fbbf24]/10 px-4 py-2.5 text-sm font-bold text-[#fde68a] transition active:scale-[0.99] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#fbbf24]"
                          data-testid={`vendor-run-report-issue-${row.deliveryId}`}
                        >
                          Report an issue
                        </button>
                      </div>
                    )}
                    {delivered && (
                      <div className="space-y-3 border-t border-border bg-bg-surface p-3">
                        {fulfillmentLabel === "Partial" && (
                          <p
                            className="text-center text-sm font-semibold"
                            style={{ color: "var(--admin-purple-text)" }}
                            data-testid={`vendor-run-order-status-${row.deliveryId}`}
                          >
                            Order status: Partial
                          </p>
                        )}
                        <p
                          className="text-center text-sm font-semibold text-[#6ee7b7]"
                          data-testid={`vendor-run-complete-status-${row.deliveryId}`}
                        >
                          Physical drop-off complete
                        </p>
                        <button
                          type="button"
                          disabled={vendorRunRevertingId !== null}
                          onClick={() =>
                            setVendorRunIssueTarget({
                              deliveryId: row.deliveryId,
                              jobId: row.jobId,
                              orderNumber: row.orderNumber,
                              vendorName: runSession?.vendorName ?? "Vendor",
                            })
                          }
                          className="min-h-11 w-full rounded-xl border border-[#fbbf24]/60 bg-[#fbbf24]/10 px-4 py-2.5 text-sm font-bold text-[#fde68a] transition active:scale-[0.99] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#fbbf24]"
                          data-testid={`vendor-run-report-issue-${row.deliveryId}`}
                        >
                          Report an issue
                        </button>
                        <button
                          type="button"
                          disabled={vendorRunRevertingId !== null}
                          onClick={() => void handleVendorRunUndo(row.deliveryId)}
                          className="action-btn action-btn-secondary w-full disabled:opacity-50"
                          data-testid={`vendor-run-undo-${row.deliveryId}`}
                        >
                          {vendorRunRevertingId === row.deliveryId
                            ? "Reverting…"
                            : "Undo drop-off"}
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
              className="vendor-deliveries-empty-card rounded-2xl border border-white/10 bg-bg-secondary px-5 py-6 text-center shadow-lg shadow-black/15"
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
              className="vendor-deliveries-empty-card rounded-2xl border border-white/10 bg-bg-secondary px-5 py-5 text-center shadow-lg shadow-black/15"
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
      </VendorDeliveriesLanding>
    );
  }

  if (
    historyView.kind === "delivery" &&
    branding &&
    step !== "hub" &&
    step !== "done" &&
    step !== "pin"
  ) {
    return (
      <div className="app-container flex flex-col h-screen h-dvh bg-bg-primary items-center justify-center px-6">
        <p className="text-sm text-text-secondary">Opening delivery…</p>
      </div>
    );
  }

  if (step === "list" && branding && historyView.kind === "deliveries") {
    const jobSession = jobId ? getJobPinSession(jobId) : null;
    const headingVendorName =
      jobSession?.vendorName ?? deliveries[0]?.vendorName;
    return (
      <VendorDeliveriesLanding
        rootTestId="vendor-job-deliveries"
        vendorName={headingVendorName}
        scannedContext={
          <>
            Scanned {branding.code}
            {scannedCode && scannedCode !== branding.code
              ? ` · PIN job spots below`
              : ""}
          </>
        }
        helper="Select an order to confirm delivery"
        footer={
          <button
            type="button"
            onClick={resetFlow}
            className="action-btn action-btn-secondary w-full"
          >
            ← Back
          </button>
        }
        overlay={
          jobSession ? (
            <p className="sr-only" data-testid="job-session-active">
              job-session
            </p>
          ) : null
        }
      >
            <div className="vendor-deliveries-card-list-inner flex flex-col gap-4">
              {jobDeliveriesForList.map((row) => {
                const fulfillmentTone = vendorFulfillmentTone(
                  deriveVendorOrderFulfillmentLabel({
                    deliveryStatus: row.status,
                    vendorPhysicalDropoffConfirmed:
                      row.vendorPhysicalDropoffConfirmed,
                  }),
                );
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
                    className={`vendor-compact-card min-h-11 w-full overflow-hidden rounded-2xl border bg-bg-secondary text-left shadow-lg shadow-black/20 touch-manipulation transition active:scale-[0.99] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      fulfillmentTone === "delivered"
                        ? "vendor-compact-card-delivered"
                        : fulfillmentTone === "partial"
                          ? "vendor-compact-card-partial"
                          : "border-white/10"
                    }`}
                    data-testid={`vendor-job-delivery-${row.deliveryId}`}
                    data-delivered={
                      row.vendorPhysicalDropoffConfirmed ? "true" : "false"
                    }
                    data-fulfillment={fulfillmentTone}
                  >
                    <VendorCompactDeliveryCard
                      deliveryId={row.deliveryId}
                      variant="vendor-job"
                      jobName={row.jobName}
                      orderNumber={row.orderNumber}
                      vendorInvoiceNumber={row.vendorInvoiceNumber}
                      poNumber={row.poNumber}
                      stagingLocationCodes={row.stagingLocationCodes}
                      delivered={row.vendorPhysicalDropoffConfirmed === true}
                      fulfillment={fulfillmentTone}
                    />
                  </button>
                );
              })}

              {deliveries.length === 0 && (
                <div className="vendor-deliveries-empty-card rounded-2xl border border-white/10 bg-bg-secondary px-5 py-7 text-center shadow-lg shadow-black/15">
                  <p className="text-sm leading-5 text-[#cbd5e1]">
                    No active deliveries for this job.
                  </p>
                </div>
              )}
            </div>
      </VendorDeliveriesLanding>
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
        Loading…
      </p>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ManagementWaitingPartsJobSummary } from "./dispatcher/models";
import {
  captureUnidentifiableParcelClient,
  getManagementWaitingPartsClient,
  markCatchAllDeliveryReceivedClient,
} from "./phase2CallableClients";
import {
  clearManagementPinSession,
  getManagementSessionToken,
  isManagementPinSessionValid,
  touchManagementPinSession,
} from "./managementPinSession";

interface ManagementCatchAllHubProps {
  locationCode: string;
  locationLabel: string;
  onSessionExpired: () => void;
  onBack: () => void;
}

function formatSpotLine(codes: string[] | undefined): string {
  if (!codes || codes.length === 0) return "Spot not assigned — ask dispatch";
  return codes.join(", ");
}

function jobMatchesQuery(
  job: ManagementWaitingPartsJobSummary,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) return true;
  const haystacks = [
    job.jobName,
    job.jobNumber,
    job.jobId,
    ...job.deliveries.flatMap((d) => [
      d.orderNumber,
      d.poNumber,
      d.vendorInvoiceNumber,
      d.vendorName,
    ]),
  ];
  return haystacks.some(
    (value) =>
      typeof value === "string" &&
      value.trim().toLowerCase().includes(normalizedQuery),
  );
}

export function ManagementCatchAllHub({
  locationCode,
  locationLabel,
  onSessionExpired,
  onBack,
}: ManagementCatchAllHubProps) {
  const [jobs, setJobs] = useState<ManagementWaitingPartsJobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [showUnidentForm, setShowUnidentForm] = useState(false);
  const [vendorDescription, setVendorDescription] = useState("");
  const [parcelDescription, setParcelDescription] = useState("");
  const [submittingUnident, setSubmittingUnident] = useState(false);
  const [unidentSuccess, setUnidentSuccess] = useState<string | null>(null);

  const loadWaitingParts = useCallback(async () => {
    const token = getManagementSessionToken();
    if (!token || !isManagementPinSessionValid()) {
      onSessionExpired();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await getManagementWaitingPartsClient({
        sessionToken: token,
      });
      setJobs(result.jobs);
      setExpandedJobs(new Set(result.jobs.map((j) => j.jobId)));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load waiting parts.",
      );
    } finally {
      setLoading(false);
    }
  }, [onSessionExpired]);

  useEffect(() => {
    void loadWaitingParts();
  }, [loadWaitingParts]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!isManagementPinSessionValid()) {
        onSessionExpired();
        return;
      }
      touchManagementPinSession();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [onSessionExpired]);

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredJobs = useMemo(
    () => jobs.filter((job) => jobMatchesQuery(job, normalizedQuery)),
    [jobs, normalizedQuery],
  );

  const handleMarkReceived = async (deliveryId: string) => {
    const token = getManagementSessionToken();
    if (!token) {
      onSessionExpired();
      return;
    }
    setMarkingId(deliveryId);
    setError(null);
    try {
      await markCatchAllDeliveryReceivedClient({
        sessionToken: token,
        deliveryId,
      });
      setJobs((prev) =>
        prev
          .map((job) => {
            const deliveries = job.deliveries.filter(
              (d) => d.deliveryId !== deliveryId,
            );
            if (deliveries.length === 0) return null;
            const stagingLocationCodes = [
              ...new Set(
                deliveries.flatMap((d) => d.stagingLocationCodes ?? []),
              ),
            ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
            return { ...job, deliveries, stagingLocationCodes };
          })
          .filter((job): job is ManagementWaitingPartsJobSummary => job !== null),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not mark part arrived.",
      );
    } finally {
      setMarkingId(null);
    }
  };

  const handleCaptureUnidentifiable = async () => {
    const token = getManagementSessionToken();
    if (!token) {
      onSessionExpired();
      return;
    }
    const vendor = vendorDescription.trim();
    const parcel = parcelDescription.trim();
    if (!vendor || !parcel) {
      setError("Vendor and parcel description are required.");
      return;
    }
    setSubmittingUnident(true);
    setError(null);
    try {
      const result = await captureUnidentifiableParcelClient({
        sessionToken: token,
        vendorDescription: vendor,
        parcelDescription: parcel,
      });
      setUnidentSuccess(`Flagged shell created (${result.orderNumber}).`);
      setVendorDescription("");
      setParcelDescription("");
      setShowUnidentForm(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not capture parcel.",
      );
    } finally {
      setSubmittingUnident(false);
    }
  };

  const toggleJob = (jobId: string) => {
    setExpandedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  return (
    <div
      className="app-container flex flex-col h-screen h-dvh bg-bg-primary overflow-hidden"
      data-testid="management-catch-all-hub"
    >
      <div className="shrink-0 px-6 py-4 border-b border-border bg-bg-surface">
        <p className="text-xs uppercase tracking-widest text-text-secondary">
          Catch-all · {locationCode}
        </p>
        <h1 className="text-lg font-bold text-text-primary mt-1">
          Match slip → put at spot
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          {locationLabel} — find the job on your packing slip, walk the part to
          its spot, then mark arrived.
        </p>
        <label className="block mt-4">
          <span className="sr-only">Search waiting jobs</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Job name, job #, PO, or invoice on slip"
            className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-[#333] text-sm"
            data-testid="mgmt-waiting-search"
          />
        </label>
      </div>

      {error && (
        <p className="px-6 py-2 text-sm text-accent-red" role="alert">
          {error}
        </p>
      )}
      {unidentSuccess && (
        <p className="px-6 py-2 text-sm text-accent-green" role="status">
          {unidentSuccess}
        </p>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {loading && (
          <p className="text-sm text-text-secondary text-center py-8">
            Loading expected jobs…
          </p>
        )}
        {!loading &&
          filteredJobs.map((job) => (
            <div
              key={job.jobId}
              className="rounded-xl border border-border bg-bg-surface overflow-hidden"
              data-testid={`mgmt-waiting-job-${job.jobId}`}
            >
              <button
                type="button"
                onClick={() => toggleJob(job.jobId)}
                className="w-full text-left px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-text-primary truncate">
                      {job.jobName}
                    </p>
                    {job.jobNumber && (
                      <p className="text-xs text-text-secondary mt-0.5">
                        Job #{job.jobNumber}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-text-secondary shrink-0">
                    {job.deliveries.length} expected
                  </span>
                </div>
                <p
                  className="text-sm font-semibold text-accent-blue mt-2"
                  data-testid={`mgmt-job-spots-${job.jobId}`}
                >
                  Put at: {formatSpotLine(job.stagingLocationCodes)}
                </p>
              </button>
              {expandedJobs.has(job.jobId) && (
                <ul className="border-t border-border divide-y divide-border">
                  {job.deliveries.map((row) => (
                    <li
                      key={row.deliveryId}
                      className="px-4 py-3 flex items-start gap-3"
                      data-testid={`mgmt-waiting-delivery-${row.deliveryId}`}
                    >
                      <button
                        type="button"
                        disabled={markingId === row.deliveryId}
                        onClick={() => void handleMarkReceived(row.deliveryId)}
                        className="shrink-0 min-w-[4.5rem] px-2 py-2 rounded-lg border-2 border-accent-green text-accent-green flex flex-col items-center justify-center gap-0.5 active:scale-95 disabled:opacity-40"
                        aria-label={`Mark ${row.orderNumber} part arrived`}
                        data-testid={`mgmt-mark-received-${row.deliveryId}`}
                      >
                        <span className="text-lg leading-none">
                          {markingId === row.deliveryId ? "…" : "✓"}
                        </span>
                        <span className="text-[10px] font-semibold uppercase tracking-wide">
                          Arrived
                        </span>
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-text-primary truncate">
                          {row.vendorName}
                        </p>
                        <p className="text-sm text-text-secondary truncate">
                          Inv {row.vendorInvoiceNumber ?? row.orderNumber}
                          {row.poNumber ? ` · PO ${row.poNumber}` : ""}
                        </p>
                        <p
                          className="text-xs font-medium text-accent-blue mt-1"
                          data-testid={`mgmt-delivery-spots-${row.deliveryId}`}
                        >
                          Walk to: {formatSpotLine(row.stagingLocationCodes)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        {!loading && jobs.length === 0 && (
          <p
            className="text-sm text-text-secondary text-center py-8"
            data-testid="mgmt-waiting-empty"
          >
            No jobs waiting for parts right now
          </p>
        )}
        {!loading && jobs.length > 0 && filteredJobs.length === 0 && (
          <p
            className="text-sm text-text-secondary text-center py-8"
            data-testid="mgmt-waiting-no-match"
          >
            No match for that slip — check spelling or flag an unidentifiable
            parcel below.
          </p>
        )}
      </div>

      <div className="shrink-0 px-6 py-4 border-t border-border space-y-3 bg-bg-surface">
        {showUnidentForm ? (
          <div className="space-y-2" data-testid="mgmt-unident-form">
            <input
              type="text"
              placeholder="Vendor / carrier name"
              value={vendorDescription}
              onChange={(e) => setVendorDescription(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-white text-[#333] text-sm"
            />
            <textarea
              placeholder="What's on the packing slip?"
              value={parcelDescription}
              onChange={(e) => setParcelDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-border bg-white text-[#333] text-sm resize-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={submittingUnident}
                onClick={() => void handleCaptureUnidentifiable()}
                className="action-btn action-btn-primary flex-1"
                data-testid="mgmt-unident-submit"
              >
                Flag unidentifiable parcel
              </button>
              <button
                type="button"
                onClick={() => setShowUnidentForm(false)}
                className="action-btn action-btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setUnidentSuccess(null);
              setShowUnidentForm(true);
            }}
            className="action-btn action-btn-secondary w-full"
            data-testid="mgmt-unident-open"
          >
            Can't identify this parcel
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            clearManagementPinSession();
            onBack();
          }}
          className="action-btn action-btn-secondary w-full"
        >
          ← Sign out
        </button>
      </div>
    </div>
  );
}

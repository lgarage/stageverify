import { useCallback, useRef, useState } from "react";
import {
  confirmUnplannedVendorDeliveryMatchClient,
  createUnplannedVendorDeliveryClient,
  matchUnplannedVendorDeliveryClient,
} from "./phase2CallableClients";
import {
  type MatchUnplannedVendorDeliveryResult,
  type StagingLocation,
  type UnplannedMatchCandidateSummary,
  type UnplannedSpaceTier,
  type UnplannedVendorDeliverySuccessResult,
  type VendorPinBootstrap,
} from "./dispatcher/models";
import {
  firestoreDataService,
  getAppSettings,
  listGloballyAssignedStagingLocationIdsForDelivery,
  mapOccupancyByLocationId,
} from "./dispatcher/firestoreService";
import { pickNearestAvailableStagingSpot } from "./dispatcher/shopMapProximity";
import { normalizeStagingCodeKey } from "./dispatcher/stagingCode";
import {
  bridgeVendorRunSessionToDelivery,
  clearVendorUnplannedPinSession,
  setVendorRunPinSession,
} from "./vendorPinSession";
import { isVendorSessionError } from "./vendorSessionErrors";

type FlowStep =
  | "form"
  | "matching"
  | "review"
  | "confirm"
  | "creating"
  | "success";

const SPACE_TIER_OPTIONS: Array<{
  value: UnplannedSpaceTier;
  label: string;
  hint: string;
}> = [
  { value: "shelf", label: "Shelf", hint: "Boxes or small parts" },
  { value: "ground", label: "Ground", hint: "Cartons or a standard pallet" },
  {
    value: "large",
    label: "Large / Oversize",
    hint: "Long, bulky, or oversized freight",
  },
];

export interface VendorUnplannedCompletePayload {
  vendorId: string;
  vendorName: string;
  deliveryId: string;
  sessionToken: string;
  expiresAt: string;
  bootstrap?: VendorPinBootstrap;
  needMoreSpace?: boolean;
  stagingLocationCode?: string;
}

interface VendorUnplannedDeliveryFlowProps {
  sessionToken: string;
  vendorId: string;
  vendorName: string;
  locationCode?: string;
  onComplete: (payload: VendorUnplannedCompletePayload) => void;
  onCancel: () => void;
  onSessionExpired?: () => void;
}

export function VendorUnplannedDeliveryFlow({
  sessionToken,
  vendorId,
  vendorName,
  locationCode,
  onComplete,
  onCancel,
  onSessionExpired,
}: VendorUnplannedDeliveryFlowProps) {
  const [step, setStep] = useState<FlowStep>("form");
  const [reference, setReference] = useState("");
  const [spaceTier, setSpaceTier] = useState<UnplannedSpaceTier | null>(null);
  const [matchResult, setMatchResult] =
    useState<MatchUnplannedVendorDeliveryResult | null>(null);
  const [successPayload, setSuccessPayload] =
    useState<UnplannedVendorDeliverySuccessResult | null>(null);
  const [suggestedLocation, setSuggestedLocation] =
    useState<StagingLocation | null>(null);
  const [suggestionStatus, setSuggestionStatus] = useState<
    "idle" | "loading" | "ready" | "none"
  >("idle");
  const [suggestionConfirmed, setSuggestionConfirmed] = useState(false);
  const [confirmingLocation, setConfirmingLocation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tierCardRefs = useRef<
    Record<UnplannedSpaceTier, HTMLDivElement | null>
  >({
    shelf: null,
    ground: null,
    large: null,
  });

  const handleSessionError = useCallback(
    (err: unknown) => {
      if (isVendorSessionError(err)) {
        (onSessionExpired ?? onCancel)();
        return true;
      }
      return false;
    },
    [onCancel, onSessionExpired],
  );

  const finishSuccess = useCallback(
    async (payload: UnplannedVendorDeliverySuccessResult) => {
      setVendorRunPinSession(payload.vendorId, payload.vendorName, payload.deliveryId, {
        sessionToken: payload.sessionToken,
        expiresAt: payload.expiresAt,
        scannedStagingLocationCode: locationCode,
      });
      clearVendorUnplannedPinSession(payload.vendorId);
      bridgeVendorRunSessionToDelivery(payload.vendorId, payload.deliveryId);

      setSuccessPayload(payload);
      setStep("success");
      setSuggestedLocation(null);
      setSuggestionConfirmed(false);
      setSuggestionStatus("loading");
      const requestedSpaceTier = spaceTier;
      if (!requestedSpaceTier) {
        setSuggestionStatus("none");
        return;
      }

      try {
        const [settings, locations, occupancy, globallyAssignedIds] =
          await Promise.all([
            getAppSettings(),
            firestoreDataService.listStagingLocations(),
            mapOccupancyByLocationId(payload.deliveryId),
            listGloballyAssignedStagingLocationIdsForDelivery(payload.deliveryId),
          ]);
        const blockedIds = new Set([
          ...Object.keys(occupancy),
          ...globallyAssignedIds,
        ]);
        const suggestion = pickNearestAvailableStagingSpot({
          originCode: locationCode ?? "",
          spaceTier: requestedSpaceTier,
          locations,
          extras: settings.shopMapLayoutExtras,
          blockedIds,
        });
        if (!suggestion) {
          setSuggestionStatus("none");
          return;
        }
        setSuggestedLocation(suggestion);
        setSuggestionConfirmed(
          normalizeStagingCodeKey(payload.stagingLocationCode ?? "") ===
            normalizeStagingCodeKey(suggestion.code),
        );
        setSuggestionStatus("ready");
      } catch (err: unknown) {
        if (handleSessionError(err)) return;
        setSuggestionStatus("none");
      }
    },
    [handleSessionError, locationCode, spaceTier],
  );

  const confirmSuggestedLocation = useCallback(async () => {
    if (!successPayload || !suggestedLocation || suggestionConfirmed) return;
    setConfirmingLocation(true);
    setError(null);
    try {
      await firestoreDataService.updateStagingLocation(
        successPayload.deliveryId,
        suggestedLocation.id,
      );
      setSuccessPayload((current) =>
        current
          ? {
              ...current,
              needMoreSpace: false,
              stagingLocationCode: suggestedLocation.code,
            }
          : current,
      );
      setSuggestionConfirmed(true);
    } catch (err: unknown) {
      if (handleSessionError(err)) return;
      setError(
        err instanceof Error
          ? err.message
          : "Could not plan this staging spot. Try again.",
      );
    } finally {
      setConfirmingLocation(false);
    }
  }, [
    handleSessionError,
    successPayload,
    suggestedLocation,
    suggestionConfirmed,
  ]);

  const runCreate = useCallback(
    async (ref: string, tier: UnplannedSpaceTier | null) => {
      if (!tier) {
        setError("Choose the space this delivery needs.");
        setStep("form");
        return;
      }
      setStep("creating");
      setError(null);
      try {
        const result = await createUnplannedVendorDeliveryClient({
          sessionToken,
          reference: ref,
          spaceTier: tier,
        });
        if (result.outcome === "strong_match_found" && result.candidate) {
          setMatchResult({
            outcome: "strong_match",
            candidate: result.candidate,
          });
          setStep("confirm");
          setError("We found a match — please confirm before continuing.");
          return;
        }
        if (result.success && result.sessionToken && result.deliveryId) {
          await finishSuccess(result as UnplannedVendorDeliverySuccessResult);
          return;
        }
        setError("Could not register this delivery. Try again.");
        setStep("form");
      } catch (err) {
        if (handleSessionError(err)) return;
        setError(
          err instanceof Error ? err.message : "Could not register delivery.",
        );
        setStep("form");
      }
    },
    [sessionToken, finishSuccess, handleSessionError],
  );

  const runMatch = useCallback(async () => {
    const ref = reference.trim();
    if (!spaceTier) {
      setError("Choose the space this delivery needs.");
      return;
    }
    if (!ref) {
      setError("Enter an invoice #, PO #, or order reference.");
      return;
    }
    setStep("matching");
    setError(null);
    try {
      const result = await matchUnplannedVendorDeliveryClient({
        sessionToken,
        reference: ref,
      });
      setMatchResult(result);
      if (result.outcome === "strong_match" && result.candidate) {
        setStep("confirm");
        return;
      }
      setStep("review");
    } catch (err) {
      if (handleSessionError(err)) return;
      setError(err instanceof Error ? err.message : "Match failed.");
      setStep("form");
    }
  }, [
    reference,
    spaceTier,
    sessionToken,
    handleSessionError,
  ]);

  const runConfirm = useCallback(
    async (candidate: UnplannedMatchCandidateSummary) => {
      if (!spaceTier) {
        setError("Choose the space this delivery needs.");
        setStep("form");
        return;
      }
      setStep("creating");
      setError(null);
      try {
        const result = await confirmUnplannedVendorDeliveryMatchClient({
          sessionToken,
          reference: reference.trim(),
          deliveryId: candidate.deliveryId,
          spaceTier,
        });
        await finishSuccess(result);
      } catch (err) {
        if (handleSessionError(err)) return;
        setError(
          err instanceof Error
            ? err.message
            : "Could not confirm this match.",
        );
        setStep("confirm");
      }
    },
    [
      sessionToken,
      reference,
      spaceTier,
      finishSuccess,
      handleSessionError,
    ],
  );

  const continueFromPlanning = useCallback(() => {
    if (!successPayload) return;
    onComplete({
      vendorId: successPayload.vendorId,
      vendorName: successPayload.vendorName,
      deliveryId: successPayload.deliveryId,
      sessionToken: successPayload.sessionToken,
      expiresAt: successPayload.expiresAt,
      bootstrap: successPayload.bootstrap,
      needMoreSpace: successPayload.needMoreSpace,
      stagingLocationCode: successPayload.stagingLocationCode,
    });
  }, [onComplete, successPayload]);

  const busy = step === "matching" || step === "creating";

  if (step === "matching" || step === "creating") {
    const creating = step === "creating";
    return (
      <div
        className="app-container flex h-full min-h-0 flex-col items-center justify-center bg-bg-primary px-6 text-center"
        data-testid="vendor-unplanned-loading"
        data-vendor-id={vendorId}
        role="status"
        aria-live="polite"
      >
        <div className="relative mb-5 size-14">
          <span className="absolute inset-0 rounded-full border-2 border-white/10" />
          <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-[#6ee7b7]" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
          Vendor drop-off
        </p>
        <h2 className="mt-2 text-xl font-bold text-text-primary">
          {creating ? "Adding delivery…" : "Looking for a match…"}
        </h2>
        <p className="mt-2 max-w-xs text-sm leading-6 text-text-secondary">
          {creating
            ? "We’re registering the delivery and finding the right staging space."
            : "Checking your invoice, PO, and order number against expected deliveries."}
        </p>
      </div>
    );
  }

  if (
    step === "review" &&
    matchResult &&
    (matchResult.outcome === "ambiguous" || matchResult.outcome === "no_match")
  ) {
    const ambiguous = matchResult.outcome === "ambiguous";
    return (
      <div
        className="app-container flex h-full min-h-0 flex-col bg-bg-primary px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] pt-6"
        data-testid="vendor-unplanned-review"
        data-vendor-id={vendorId}
      >
        <button
          type="button"
          className="mb-5 inline-flex min-h-11 w-fit items-center gap-2 rounded-lg px-1 text-sm font-semibold text-text-secondary transition hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          onClick={() => {
            setMatchResult(null);
            setStep("form");
            setError(null);
          }}
        >
          <span aria-hidden="true">←</span> Edit details
        </button>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col">
          <div className="flex size-12 items-center justify-center rounded-xl border border-[#fbbf24]/35 bg-[#fbbf24]/10 text-[#fbbf24]">
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
                d="M8.25 9a3.75 3.75 0 117.5 0c0 2.25-3.75 2.25-3.75 4.5m0 3.5h.01"
              />
            </svg>
          </div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-[#fbbf24]">
            {ambiguous ? "Needs dispatch review" : "No expected delivery found"}
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-text-primary">
            {ambiguous ? "No automatic match" : "Add this delivery?"}
          </h2>
          <p
            className="mt-3 text-sm leading-6 text-text-secondary"
            data-testid={
              ambiguous ? "vendor-unplanned-ambiguous-note" : undefined
            }
          >
            {ambiguous
              ? "We found more than one possible delivery, so nothing will be linked automatically."
              : "We couldn’t find a matching delivery. Dispatch can review and link it after you add it."}
          </p>

          <div className="mt-5 rounded-2xl border border-white/10 bg-bg-secondary px-4 py-4">
            <dl className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <dt className="text-sm text-text-secondary">
                  Invoice, PO, or order #
                </dt>
                <dd className="max-w-[55%] break-all text-right font-mono text-sm font-semibold text-text-primary">
                  {reference.trim()}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-sm text-text-secondary">Space</dt>
                <dd className="text-right text-sm font-semibold text-text-primary">
                  {SPACE_TIER_OPTIONS.find((option) => option.value === spaceTier)
                    ?.label ?? "Not selected"}
                </dd>
              </div>
            </dl>
          </div>

          <button
            type="button"
            className="tap-target mt-auto min-h-12 w-full rounded-xl bg-[#065f46] px-4 py-3 text-base font-bold text-[#f8fafc] shadow-lg shadow-black/20 transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6ee7b7] focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary"
            data-testid="vendor-unplanned-add-new"
            onClick={() => void runCreate(reference.trim(), spaceTier)}
          >
            Add unplanned delivery
          </button>
        </div>
      </div>
    );
  }

  if (step === "confirm" && matchResult?.candidate) {
    const candidate = matchResult.candidate;
    return (
      <div
        className="app-container flex h-full min-h-0 flex-col bg-bg-primary px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] pt-6"
        data-testid="vendor-unplanned-confirm"
        data-vendor-id={vendorId}
      >
        <button
          type="button"
          disabled={busy}
          className="mb-5 inline-flex min-h-11 w-fit items-center gap-2 rounded-lg px-1 text-sm font-semibold text-text-secondary transition hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
          onClick={() => {
            setMatchResult(null);
            setStep("form");
            setError(null);
          }}
        >
          <span aria-hidden="true">←</span> Edit details
        </button>

        <div className="mx-auto w-full max-w-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6ee7b7]">
            Strong match found
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-text-primary">
            Is this your delivery?
          </h2>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            We matched &ldquo;{reference.trim()}&rdquo; to this expected
            delivery.
          </p>

          <div className="mt-5 overflow-hidden rounded-2xl border border-[#34d399]/35 bg-bg-secondary shadow-lg shadow-black/15">
            <div className="border-b border-white/10 bg-[#34d399]/10 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#a7f3d0]">
                Order
              </p>
              <p className="mt-1 break-words font-mono text-lg font-bold text-text-primary">
                {candidate.orderNumber}
              </p>
            </div>
            <dl className="divide-y divide-white/10 px-4">
              {candidate.jobName ? (
                <div className="flex items-start justify-between gap-4 py-3">
                  <dt className="text-sm text-text-secondary">Job / Site</dt>
                  <dd className="text-right text-sm font-semibold text-text-primary">
                    {candidate.jobName}
                  </dd>
                </div>
              ) : null}
              {candidate.poNumber ? (
                <div className="flex items-start justify-between gap-4 py-3">
                  <dt className="text-sm text-text-secondary">PO #</dt>
                  <dd className="break-all text-right font-mono text-sm font-semibold text-text-primary">
                    {candidate.poNumber}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>

          {error ? (
            <p
              className="mt-4 rounded-xl border border-[#f87171]/35 bg-[#f87171]/10 px-4 py-3 text-sm leading-5 text-[#fecaca]"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="mx-auto mt-auto w-full max-w-sm space-y-3 pt-6">
          <button
            type="button"
            disabled={busy}
            className="tap-target min-h-12 w-full rounded-xl bg-[#065f46] px-4 py-3 text-base font-bold text-[#f8fafc] shadow-lg shadow-black/20 transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6ee7b7] focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary disabled:cursor-not-allowed disabled:bg-[#1e3a36] disabled:text-[#d1fae5] disabled:shadow-none"
            data-testid="vendor-unplanned-confirm-yes"
            onClick={() => void runConfirm(candidate)}
          >
            {busy ? "Confirming…" : "Yes, that's it"}
          </button>
          <button
            type="button"
            disabled={busy}
            className="tap-target min-h-12 w-full rounded-xl border border-white/15 bg-bg-surface px-4 py-3 text-base font-bold text-text-primary transition hover:bg-bg-secondary active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
            data-testid="vendor-unplanned-confirm-no"
            onClick={() => void runCreate(reference.trim(), spaceTier)}
          >
            No, add as new
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="app-container flex h-full min-h-0 flex-col overflow-hidden bg-bg-primary"
      data-testid="vendor-unplanned-form"
      data-vendor-id={vendorId}
    >
      <header className="shrink-0 border-b border-white/10 bg-bg-secondary/70 px-5 pb-5 pt-4">
        <div className="mx-auto flex w-full max-w-sm items-center justify-between gap-4">
          <button
            type="button"
            className="tap-target -ml-2 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-text-secondary transition hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={onCancel}
          >
            <span aria-hidden="true">←</span> Back
          </button>
          {locationCode ? (
            <span className="rounded-full border border-white/10 bg-bg-primary/70 px-3 py-1.5 font-mono text-xs font-semibold text-text-primary">
              {locationCode}
            </span>
          ) : null}
        </div>
        <div className="mx-auto mt-3 w-full max-w-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6ee7b7]">
            Vendor drop-off
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-text-primary">
            Don&apos;t see this delivery?
          </h2>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            {vendorName}, choose Shelf, Ground, or Large / Oversize first, then
            enter any identifying number from your paperwork.
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto w-full max-w-sm">
          <fieldset disabled={busy || Boolean(successPayload)}>
            <legend className="text-sm font-semibold text-text-primary">
              Choose the space you need
            </legend>
            <div className="mt-2 grid gap-2.5">
              {SPACE_TIER_OPTIONS.map((opt) => {
                const selected = spaceTier === opt.value;
                const expanded = selected && !successPayload;
                return (
                  <div
                    key={opt.value}
                    ref={(element) => {
                      tierCardRefs.current[opt.value] = element;
                    }}
                    className={`min-w-0 overflow-hidden rounded-xl border transition ${
                      selected
                        ? "border-[#60a5fa] bg-[#3b82f6]/10 shadow-[0_0_0_1px_rgba(96,165,250,0.25)]"
                        : "border-white/10 bg-bg-secondary hover:border-white/20"
                    }`}
                    data-testid={`vendor-unplanned-tier-${opt.value}`}
                    data-expanded={expanded ? "true" : "false"}
                  >
                    <button
                      type="button"
                      className="flex min-h-16 w-full min-w-0 items-center gap-3 px-3.5 py-3 text-left active:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#60a5fa]"
                      aria-expanded={expanded}
                      onClick={() => {
                        setSpaceTier(opt.value);
                        setError(null);
                        requestAnimationFrame(() => {
                          tierCardRefs.current[opt.value]?.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
                          });
                        });
                      }}
                    >
                      <span
                        className={`flex size-10 shrink-0 items-center justify-center rounded-lg border text-sm font-bold ${
                          selected
                            ? "border-[#60a5fa]/60 bg-[#2563eb] text-white"
                            : "border-white/10 bg-bg-primary text-text-secondary"
                        }`}
                        aria-hidden="true"
                      >
                        {opt.value === "shelf"
                          ? "S"
                          : opt.value === "ground"
                            ? "G"
                            : "XL"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words font-semibold text-text-primary">
                          {opt.label}
                        </span>
                        <span className="mt-0.5 block break-words text-sm leading-5 text-text-secondary">
                          {opt.hint}
                        </span>
                      </span>
                      <span
                        className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${
                          selected
                            ? "border-[#60a5fa] bg-[#2563eb] text-white"
                            : "border-[#64748b] text-text-secondary"
                        }`}
                        aria-hidden="true"
                      >
                        {expanded ? "−" : selected ? "✓" : "+"}
                      </span>
                    </button>

                    {expanded ? (
                      <div className="border-t border-[#60a5fa]/30 px-3.5 pb-4 pt-3">
                        <label className="block min-w-0">
                          <span className="block text-sm font-semibold text-[#fde68a]">
                            Identifying number from your paperwork
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-text-secondary">
                            Enter whichever number you have: Job #, PO #, invoice
                            #, or order #.
                          </span>
                          <input
                            type="text"
                            value={reference}
                            disabled={busy}
                            autoComplete="off"
                            autoCapitalize="characters"
                            inputMode="text"
                            data-testid="vendor-unplanned-reference"
                            placeholder="Job #, PO #, invoice #, or order #"
                            className="mt-2 min-h-12 w-full min-w-0 rounded-xl border-2 border-[#fbbf24] bg-bg-primary px-3 py-3 font-mono text-base text-text-primary outline-none placeholder:font-sans placeholder:text-[#94a3b8] focus:border-[#fcd34d] focus:ring-2 focus:ring-[#fbbf24]/30 disabled:opacity-50"
                            onFocus={() => {
                              requestAnimationFrame(() => {
                                tierCardRefs.current[
                                  opt.value
                                ]?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "center",
                                });
                              });
                            }}
                            onChange={(e) => {
                              setReference(e.target.value);
                              setError(null);
                            }}
                          />
                        </label>
                        <div className="mt-3 grid grid-cols-2 gap-3 pb-[max(env(safe-area-inset-bottom),0.25rem)]">
                          <button
                            type="button"
                            className="tap-target min-h-12 rounded-xl border border-white/25 bg-transparent px-3 py-3 font-bold text-[#f8fafc] transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#94a3b8]"
                            data-testid="vendor-unplanned-cancel"
                            onClick={() => {
                              setReference("");
                              setSpaceTier(null);
                              setMatchResult(null);
                              setError(null);
                              setStep("form");
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={busy || !reference.trim()}
                            className="tap-target min-h-12 rounded-xl bg-[#1d4ed8] px-3 py-3 font-bold text-white shadow-lg shadow-black/20 transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#60a5fa] disabled:cursor-not-allowed disabled:bg-[#1e293b] disabled:text-[#94a3b8] disabled:shadow-none"
                            data-testid="vendor-unplanned-submit"
                            onClick={() => void runMatch()}
                          >
                            Submit
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </fieldset>

          {successPayload ? (
            <div
              className="mt-4 rounded-2xl border border-[#60a5fa]/40 bg-[#1d4ed8]/10 px-4 py-4"
              data-testid="vendor-unplanned-success"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#93c5fd]">
                Staging plan
              </p>
              <p className="mt-1 font-semibold text-[#f8fafc]">
                Delivery identified
              </p>

              <div
                className="mt-3 rounded-xl border border-white/15 bg-bg-secondary px-4 py-4"
                data-testid="vendor-unplanned-suggest"
              >
                {suggestionStatus === "loading" ? (
                  <p className="text-sm leading-5 text-text-secondary">
                    Finding the nearest available staging spot…
                  </p>
                ) : suggestionStatus === "ready" && suggestedLocation ? (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#93c5fd]">
                      Suggested location
                    </p>
                    <p
                      className="mt-1 break-words font-mono text-3xl font-bold text-[#f8fafc]"
                      data-testid="vendor-unplanned-suggest-code"
                    >
                      {suggestedLocation.code}
                    </p>
                    <p className="mt-2 text-sm leading-5 text-text-secondary">
                      Nearest available {spaceTier} spot from{" "}
                      <span className="font-mono text-text-primary">
                        {locationCode}
                      </span>
                      .
                    </p>
                    {suggestionConfirmed ? (
                      <p className="mt-3 rounded-lg border border-[#34d399]/35 bg-[#34d399]/10 px-3 py-2 text-sm font-semibold text-[#a7f3d0]">
                        Staging spot planned
                      </p>
                    ) : (
                      <button
                        type="button"
                        disabled={confirmingLocation}
                        className="tap-target mt-3 min-h-12 w-full rounded-xl bg-[#1d4ed8] px-4 py-3 font-bold text-white shadow-lg shadow-black/20 transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#60a5fa] disabled:cursor-not-allowed disabled:bg-[#1e293b] disabled:text-[#94a3b8]"
                        data-testid="vendor-unplanned-confirm-location"
                        onClick={() => void confirmSuggestedLocation()}
                      >
                        {confirmingLocation
                          ? "Confirming…"
                          : `Confirm ${suggestedLocation.code}`}
                      </button>
                    )}
                  </>
                ) : (
                  <div data-testid="vendor-unplanned-need-space">
                    <p className="font-semibold text-[#fde68a]">
                      Need more staging space
                    </p>
                    <p className="mt-1 text-sm leading-5 text-text-primary">
                      No available {spaceTier} spot could be planned from this
                      scanned location. Dispatch can choose a spot in the
                      Staging Map.
                    </p>
                  </div>
                )}
              </div>

              {suggestionConfirmed || suggestionStatus === "none" ? (
                <button
                  type="button"
                  className="tap-target mt-4 min-h-12 w-full rounded-xl bg-[#065f46] px-4 py-3 text-base font-bold text-[#f8fafc] shadow-lg shadow-black/20 transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6ee7b7]"
                  onClick={continueFromPlanning}
                >
                  Continue
                </button>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p
              className="mt-4 rounded-xl border border-[#f87171]/35 bg-[#f87171]/10 px-4 py-3 text-sm leading-5 text-[#fecaca]"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

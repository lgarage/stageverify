import { useCallback, useState } from "react";
import {
  confirmUnplannedVendorDeliveryMatchClient,
  createUnplannedVendorDeliveryClient,
  matchUnplannedVendorDeliveryClient,
} from "./phase2CallableClients";
import type {
  MatchUnplannedVendorDeliveryResult,
  UnplannedMatchCandidateSummary,
  UnplannedSpaceTier,
  UnplannedVendorDeliverySuccessResult,
  VendorPinBootstrap,
} from "./dispatcher/models";
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
  const [spaceTier, setSpaceTier] = useState<UnplannedSpaceTier>("ground");
  const [matchResult, setMatchResult] =
    useState<MatchUnplannedVendorDeliveryResult | null>(null);
  const [successPayload, setSuccessPayload] =
    useState<UnplannedVendorDeliverySuccessResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    (payload: UnplannedVendorDeliverySuccessResult) => {
      setSuccessPayload(payload);
      setStep("success");
    },
    [],
  );

  const runCreate = useCallback(
    async (ref: string, tier: UnplannedSpaceTier) => {
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
          finishSuccess(result as UnplannedVendorDeliverySuccessResult);
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
    sessionToken,
    handleSessionError,
  ]);

  const runConfirm = useCallback(
    async (candidate: UnplannedMatchCandidateSummary) => {
      setStep("creating");
      setError(null);
      try {
        const result = await confirmUnplannedVendorDeliveryMatchClient({
          sessionToken,
          reference: reference.trim(),
          deliveryId: candidate.deliveryId,
          spaceTier,
        });
        finishSuccess(result);
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

  const busy = step === "matching" || step === "creating";

  if (step === "success" && successPayload) {
    const waitingForSpace = successPayload.needMoreSpace === true;
    return (
      <div
        className="app-container flex h-full min-h-0 flex-col bg-bg-primary px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] pt-6"
        data-testid="vendor-unplanned-success"
        data-vendor-id={vendorId}
      >
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center text-center">
          <div
            className={`mb-5 flex size-16 items-center justify-center rounded-2xl border ${
              waitingForSpace
                ? "border-[#fbbf24]/40 bg-[#fbbf24]/10 text-[#fbbf24]"
                : "border-[#34d399]/40 bg-[#34d399]/10 text-[#6ee7b7]"
            }`}
            aria-hidden="true"
          >
            {waitingForSpace ? (
              <svg
                className="size-8"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M12 8v4m0 4h.01M4.9 19h14.2a2 2 0 001.73-3L13.73 4a2 2 0 00-3.46 0L3.17 16a2 2 0 001.73 3z"
                />
              </svg>
            ) : (
              <svg
                className="size-8"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.2}
                  d="m5 12 4 4L19 6"
                />
              </svg>
            )}
          </div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
            {vendorName}
          </p>
          <h2 className="text-2xl font-bold tracking-tight text-text-primary">
            {waitingForSpace ? "Need More Space" : "Delivery ready"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            {successPayload.bootstrap?.orderNumber ?? successPayload.deliveryId}
          </p>

          {waitingForSpace ? (
            <div
              className="mt-6 w-full rounded-2xl border border-[#fbbf24]/35 bg-[#fbbf24]/10 px-4 py-4 text-left"
              data-testid="vendor-unplanned-need-space"
              role="status"
            >
              <p className="font-semibold text-[#fde68a]">
                Dispatch has been notified.
              </p>
              <p className="mt-1 text-sm leading-5 text-text-primary">
                Please wait for a staging location.
              </p>
            </div>
          ) : successPayload.stagingLocationCode ? (
            <div
              className="mt-6 w-full rounded-2xl border border-[#34d399]/35 bg-[#34d399]/10 px-4 py-4"
              data-testid="vendor-unplanned-spot"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#a7f3d0]">
                Take delivery to
              </p>
              <p className="mt-1 font-mono text-3xl font-bold text-text-primary">
                {successPayload.stagingLocationCode}
              </p>
            </div>
          ) : (
            <p className="mt-5 text-sm leading-6 text-text-secondary">
              Dispatch will review the delivery details.
            </p>
          )}
        </div>
        <button
          type="button"
          className="tap-target mt-6 min-h-12 w-full rounded-xl bg-[#047857] px-4 py-3 text-base font-bold text-white shadow-lg shadow-black/20 transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6ee7b7] focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary"
          data-testid="vendor-unplanned-continue"
          onClick={() =>
            onComplete({
              vendorId: successPayload.vendorId,
              vendorName: successPayload.vendorName,
              deliveryId: successPayload.deliveryId,
              sessionToken: successPayload.sessionToken,
              expiresAt: successPayload.expiresAt,
              bootstrap: successPayload.bootstrap,
              needMoreSpace: successPayload.needMoreSpace,
              stagingLocationCode: successPayload.stagingLocationCode,
            })
          }
        >
          {waitingForSpace ? "Done" : "Continue to delivery"}
        </button>
      </div>
    );
  }

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
                    ?.label ?? "Ground"}
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
            {vendorName}, enter the number from your paperwork and choose the
            space you need.
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto w-full max-w-sm">
          <label className="block">
            <span className="text-sm font-semibold text-text-primary">
              Invoice, PO, or order #
            </span>
            <input
              type="text"
              value={reference}
              disabled={busy}
              autoComplete="off"
              autoCapitalize="characters"
              inputMode="text"
              data-testid="vendor-unplanned-reference"
              placeholder="Enter number"
              className="mt-2 min-h-12 w-full rounded-xl border border-white/15 bg-bg-secondary px-4 py-3 font-mono text-base text-text-primary outline-none placeholder:font-sans placeholder:text-[#64748b] focus:border-[#6ee7b7] focus:ring-2 focus:ring-[#6ee7b7]/25 disabled:opacity-50"
              onChange={(e) => {
                setReference(e.target.value);
                setError(null);
              }}
            />
          </label>

          <fieldset className="mt-6" disabled={busy}>
            <legend className="text-sm font-semibold text-text-primary">
              Space
            </legend>
            <div className="mt-2 grid gap-2.5">
              {SPACE_TIER_OPTIONS.map((opt) => {
                const selected = spaceTier === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={`flex min-h-[4.5rem] cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition active:scale-[0.99] ${
                      selected
                        ? "border-[#6ee7b7] bg-[#34d399]/10 shadow-[0_0_0_1px_rgba(110,231,183,0.2)]"
                        : "border-white/10 bg-bg-secondary hover:border-white/20"
                    }`}
                    data-testid={`vendor-unplanned-tier-${opt.value}`}
                  >
                    <input
                      type="radio"
                      name="unplanned-space-tier"
                      value={opt.value}
                      checked={selected}
                      className="sr-only"
                      onChange={() => setSpaceTier(opt.value)}
                    />
                    <span
                      className={`flex size-10 shrink-0 items-center justify-center rounded-lg border text-sm font-bold ${
                        selected
                          ? "border-[#6ee7b7]/50 bg-[#047857] text-white"
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
                      <span className="block font-semibold text-text-primary">
                        {opt.label}
                      </span>
                      <span className="mt-0.5 block text-sm leading-5 text-text-secondary">
                        {opt.hint}
                      </span>
                    </span>
                    <span
                      className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${
                        selected
                          ? "border-[#6ee7b7] bg-[#6ee7b7]"
                          : "border-[#64748b]"
                      }`}
                      aria-hidden="true"
                    >
                      {selected ? (
                        <span className="size-2 rounded-full bg-[#064e3b]" />
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

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

      <footer className="shrink-0 border-t border-white/10 bg-bg-primary px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3">
        <button
          type="button"
          disabled={busy || !reference.trim()}
          className="tap-target mx-auto min-h-12 w-full max-w-sm rounded-xl bg-[#065f46] px-4 py-3 text-base font-bold text-[#f8fafc] shadow-lg shadow-black/20 transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6ee7b7] focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary disabled:cursor-not-allowed disabled:bg-[#1e3a36] disabled:text-[#d1fae5] disabled:shadow-none"
          data-testid="vendor-unplanned-submit"
          onClick={() => void runMatch()}
        >
          Check for delivery
        </button>
      </footer>
    </div>
  );
}

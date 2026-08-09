import { useCallback, useEffect, useState } from "react";
import { getAppSettings } from "./dispatcher/firestoreService";
import { verifyVendorPin } from "./verifyVendorPinClient";
import type {
  VerifyVendorPinInput,
  VendorPinBootstrap,
} from "./dispatcher/models";
import {
  setPinSession,
  setJobPinSession,
  setVendorRunPinSession,
} from "./vendorPinSession";

const KEYPAD = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["", "0", "back"],
] as const;

const MAX_PIN_LENGTH = 6;
const MIN_PIN_LENGTH = 4;

export interface VendorPinVerifiedPayload {
  vendorId: string;
  vendorName: string;
  deliveryId?: string;
  jobId?: string;
  sessionScope?: "job" | "delivery" | "vendor";
  /** Present only after successful PIN when CF returns hub bootstrap. */
  bootstrap?: VendorPinBootstrap;
}

interface VendorPinGateProps {
  /** Legacy receive deep link. */
  deliveryId?: string;
  /** Location-first permanent QR (Phase 3). */
  stagingLocationCode?: string;
  jobId?: string;
  title?: string;
  subtitle?: string;
  onVerified: (payload: VendorPinVerifiedPayload) => void;
  onCancel?: () => void;
}

function pinVerifyErrorMessage(err: unknown): string {
  if (
    err &&
    typeof err === "object" &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    const message = (err as { message: string }).message.trim();
    if (message.length > 0) return message;
  }
  return "Unable to verify PIN. Try again.";
}

export function VendorPinGate({
  deliveryId,
  stagingLocationCode,
  jobId,
  title = "Enter Vendor PIN",
  subtitle,
  onVerified,
  onCancel,
}: VendorPinGateProps) {
  const [digits, setDigits] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [verified, setVerified] = useState(false);

  const defaultSubtitle =
    stagingLocationCode && !deliveryId
      ? "Enter your job PIN, or your company PIN if dispatch enabled multi-site run."
      : "Enter the 4–6 digit PIN for this delivery.";

  const submitPin = useCallback(
    async (pin: string) => {
      if (pin.length < MIN_PIN_LENGTH || pin.length > MAX_PIN_LENGTH) return;
      setSubmitting(true);
      setError(null);
      try {
        const input: VerifyVendorPinInput = { pin };
        if (deliveryId) input.deliveryId = deliveryId;
        if (stagingLocationCode) input.stagingLocationCode = stagingLocationCode;
        if (jobId) input.jobId = jobId;

        const result = await verifyVendorPin(input);
        if (!result.success) {
          setDigits([]);
          setError(result.message ?? "Invalid code.");
          return;
        }
        if (!result.vendorId || !result.vendorName) {
          setDigits([]);
          setError("Invalid code.");
          return;
        }
        setVerified(true);
        const settings = await getAppSettings().catch(() => ({
          vendorSessionMinutes: 15,
        }));
        const sessionMinutes = settings.vendorSessionMinutes ?? 15;
        const sessionOpts = {
          sessionToken: result.sessionToken,
          expiresAt: result.expiresAt,
          sessionMinutes,
        };

        if (result.sessionScope === "job" && result.jobId) {
          setJobPinSession(
            result.jobId,
            result.vendorId,
            result.vendorName,
            {
              ...sessionOpts,
              scannedStagingLocationCode: result.scannedStagingLocationCode,
            },
          );
        }

        if (
          result.sessionScope === "vendor" &&
          result.vendorId &&
          result.deliveryId
        ) {
          setVendorRunPinSession(
            result.vendorId,
            result.vendorName,
            result.deliveryId,
            {
              ...sessionOpts,
              scannedStagingLocationCode: result.scannedStagingLocationCode,
            },
          );
        }

        if (result.deliveryId) {
          setPinSession(result.deliveryId, result.vendorId, result.vendorName, sessionOpts);
        }

        onVerified({
          vendorId: result.vendorId,
          vendorName: result.vendorName,
          deliveryId: result.deliveryId,
          jobId: result.jobId,
          sessionScope: result.sessionScope,
          bootstrap: result.bootstrap,
        });
      } catch (err) {
        setDigits([]);
        setError(pinVerifyErrorMessage(err));
      } finally {
        setSubmitting(false);
      }
    },
    [deliveryId, stagingLocationCode, jobId, onVerified],
  );

  // Auto-submit only at public max length (6). Shorter valid PINs (4–5) use
  // Verify / Enter — avoids guessing secret length and false early submits.
  useEffect(() => {
    if (digits.length !== MAX_PIN_LENGTH || submitting || verified) return;
    void submitPin(digits.join(""));
  }, [digits, submitting, verified, submitPin]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || submitting || verified) return;
      const pin = digits.join("");
      if (pin.length >= MIN_PIN_LENGTH && pin.length <= MAX_PIN_LENGTH) {
        event.preventDefault();
        void submitPin(pin);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [digits, submitting, verified, submitPin]);

  const locked = submitting || verified;
  const pinLength = digits.length;
  const canVerify =
    pinLength >= MIN_PIN_LENGTH && pinLength <= MAX_PIN_LENGTH && !locked;

  const pushDigit = (digit: string) => {
    if (locked || digits.length >= MAX_PIN_LENGTH) return;
    setError(null);
    setDigits((prev) => [...prev, digit]);
  };

  const backspace = () => {
    if (locked) return;
    setError(null);
    setDigits((prev) => prev.slice(0, -1));
  };

  const clearAll = () => {
    if (locked) return;
    setError(null);
    setDigits([]);
  };

  return (
    <div className="app-container min-h-screen min-h-[100svh] bg-bg-primary">
      <div
        className="flex min-h-screen min-h-[100svh] flex-col items-center justify-center overflow-y-auto"
        style={{ padding: "0.75rem 1rem" }}
      >
        <div
          className="w-full max-w-[22rem] rounded-3xl border border-white/10 bg-bg-secondary shadow-xl shadow-black/20"
          style={{ padding: "clamp(0.875rem, 2.6svh, 1.5rem)" }}
        >
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
              Vendor Portal
            </p>
            <h1
              className="text-[clamp(1.35rem,3.2svh,1.75rem)] font-bold tracking-tight text-text-primary"
              style={{ marginTop: "0.25rem" }}
            >
              {title}
            </h1>
            <p
              className="max-w-[18rem] text-sm leading-5 text-text-secondary"
              style={{ margin: "0.25rem auto 0" }}
            >
              {subtitle ?? defaultSubtitle}
            </p>
          </div>

          <div
            className="relative flex min-h-8 items-center justify-center"
            style={{ marginTop: "clamp(0.75rem, 2.1svh, 1.25rem)" }}
            aria-label={`PIN entry: ${pinLength} ${
              pinLength === 1 ? "digit" : "digits"
            } entered`}
          >
            <div className="inline-flex h-8 items-center gap-2 rounded-full border border-white/10 bg-bg-primary/55 px-3 text-xs font-medium text-text-primary">
              {pinLength === 0 ? (
                <svg
                  className="size-3.5 text-text-secondary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M7.5 10V7.5a4.5 4.5 0 019 0V10m-10 0h11a1.5 1.5 0 011.5 1.5v7A1.5 1.5 0 0117.5 20h-11A1.5 1.5 0 015 18.5v-7A1.5 1.5 0 016.5 10z"
                  />
                </svg>
              ) : (
                <span
                  className="flex items-center gap-1"
                  aria-hidden="true"
                >
                  {Array.from({ length: pinLength }).map((_, index) => (
                    <span
                      key={index}
                      className="size-1.5 rounded-full bg-accent-green"
                    />
                  ))}
                </span>
              )}
              <span>
                {pinLength === 0
                  ? "PIN not entered"
                  : `${pinLength} ${pinLength === 1 ? "digit" : "digits"} entered`}
              </span>
            </div>
          </div>

          <div
            className="flex min-h-5 items-center justify-center"
            style={{ marginTop: "0.375rem", paddingInline: "0.5rem" }}
          >
            {error ? (
              <p
                className="text-center text-sm leading-5 text-accent-red"
                role="alert"
              >
                {error}
              </p>
            ) : locked ? (
              <p
                className="text-center text-sm font-medium leading-5 text-text-primary"
                data-testid="vendor-pin-verifying"
                role="status"
              >
                {verified ? "Opening delivery…" : "Verifying PIN…"}
              </p>
            ) : canVerify ? (
              <div className="flex items-center justify-center gap-2 text-sm leading-5">
                <p
                  className="text-center font-medium text-[#93c5fd]"
                  data-testid="vendor-pin-verify-hint"
                >
                  Tap Verify to continue
                </p>
                <span className="text-text-secondary" aria-hidden="true">
                  ·
                </span>
                <button
                  type="button"
                  onClick={clearAll}
                  className="rounded text-xs font-semibold text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Clear
                </button>
              </div>
            ) : pinLength > 0 ? (
              <div className="flex items-center justify-center gap-2 text-xs leading-5">
                <p className="text-center text-text-secondary">
                  PIN stays hidden
                </p>
                <span className="text-text-secondary" aria-hidden="true">
                  ·
                </span>
                <button
                  type="button"
                  onClick={clearAll}
                  className="rounded font-semibold text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Clear
                </button>
              </div>
            ) : (
              <p className="text-center text-xs leading-5 text-text-secondary">
                Your PIN stays hidden
              </p>
            )}
          </div>

          <div
            className="w-full max-w-[17.5rem]"
            style={{
              margin: "clamp(0.625rem, 1.8svh, 1rem) auto 0",
            }}
          >
            <div className="grid grid-cols-3 place-items-center gap-[clamp(0.5rem,1.4svh,0.75rem)]">
              {KEYPAD.slice(0, 3)
                .flat()
                .map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => pushDigit(key)}
                    disabled={locked || digits.length >= MAX_PIN_LENGTH}
                    className="tap-target mx-auto flex size-[clamp(3.25rem,8svh,4.25rem)] items-center justify-center rounded-full border border-white/10 bg-bg-surface/70 text-2xl font-medium tabular-nums text-text-primary shadow-sm transition-[background-color,border-color,transform] hover:border-white/20 hover:bg-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary active:scale-95 disabled:opacity-40"
                  >
                    {key}
                  </button>
                ))}
            </div>
            <div
              className="flex items-center justify-center gap-[clamp(0.875rem,2.5svh,1.25rem)]"
              style={{
                marginTop: "clamp(0.5rem, 1.4svh, 0.75rem)",
              }}
            >
              <button
                type="button"
                onClick={() => pushDigit("0")}
                disabled={locked || digits.length >= MAX_PIN_LENGTH}
                className="tap-target flex size-[clamp(3.25rem,8svh,4.25rem)] items-center justify-center rounded-full border border-white/10 bg-bg-surface/70 text-2xl font-medium tabular-nums text-text-primary shadow-sm transition-[background-color,border-color,transform] hover:border-white/20 hover:bg-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary active:scale-95 disabled:opacity-40"
              >
                0
              </button>
              <button
                type="button"
                onClick={backspace}
                disabled={locked || digits.length === 0}
                className={`tap-target flex size-[clamp(3.25rem,8svh,4.25rem)] items-center justify-center rounded-full border border-white/10 bg-bg-surface/70 text-text-primary shadow-sm transition-[background-color,border-color,transform] hover:border-white/20 hover:bg-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary active:scale-95 ${
                  locked
                    ? "opacity-40"
                    : digits.length === 0
                      ? "text-text-secondary"
                      : ""
                }`}
                aria-label="Backspace"
              >
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
                    d="M9.5 7h9A2.5 2.5 0 0121 9.5v5a2.5 2.5 0 01-2.5 2.5h-9L3 12l6.5-5zm3.5 3l4 4m0-4l-4 4"
                  />
                </svg>
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void submitPin(digits.join(""))}
            disabled={!canVerify}
            data-testid="vendor-pin-verify"
            className="tap-target flex min-h-11 w-full items-center justify-center rounded-xl border border-transparent text-base font-bold text-white shadow-sm transition-[background-color,border-color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-green focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary active:scale-[0.99]"
            style={{
              marginTop: "clamp(0.75rem, 2svh, 1.125rem)",
              padding: "0.625rem 1rem",
              backgroundColor:
                canVerify || submitting ? "#047857" : "#334155",
              color: "#f8fafc",
            }}
          >
            {submitting ? "Verifying…" : "Verify"}
          </button>

          <p
            className="text-center text-xs leading-5 text-text-secondary"
            style={{ marginTop: "0.5rem" }}
          >
            Need help? Call dispatch.
          </p>
        </div>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={locked}
            className="rounded-lg text-sm font-medium text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
            style={{ marginTop: "0.5rem", padding: "0.5rem 1rem" }}
          >
            Back
          </button>
        )}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import type { ResolveLocationScanPinResult } from "./dispatcher/models";
import { resolveLocationScanPin } from "./resolveLocationScanPinClient";
import {
  getTechnicianPinSession,
  setTechnicianPinSession,
} from "./technicianPinSession";
import { setManagementPinSession } from "./managementPinSession";
import {
  setJobPinSession,
  setVendorRunPinSession,
  setVendorUnplannedPinSession,
} from "./vendorPinSession";

const KEYPAD = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["", "0", "back"],
] as const;

const MAX_PIN_LENGTH = 6;
const MIN_PIN_LENGTH = 4;

const KEY_BTN =
  "tap-target mx-auto flex size-[clamp(3.25rem,8svh,4.25rem)] [@media(min-height:800px)]:size-[clamp(4.05rem,8svh,4.25rem)] items-center justify-center rounded-full border border-white/10 bg-bg-surface/70 text-2xl font-medium tabular-nums text-text-primary shadow-sm transition-[background-color,border-color,transform] hover:border-white/20 hover:bg-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary active:scale-95 disabled:opacity-40";

export type LocationScanPinVerifiedPayload = Extract<
  ResolveLocationScanPinResult,
  { success: true }
>;

interface LocationScanPinGateProps {
  stagingLocationCode: string;
  onVerified: (payload: LocationScanPinVerifiedPayload) => void;
  onSubmitStart?: () => void;
  onSubmitError?: (message?: string) => void;
}

function sessionMinutesFromExpiresAt(expiresAt: string, fallback = 15): number {
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) return fallback;
  const minutes = Math.ceil((expiresMs - Date.now()) / 60_000);
  return minutes > 0 ? minutes : fallback;
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

export function LocationScanPinGate({
  stagingLocationCode,
  onVerified,
  onSubmitStart,
  onSubmitError,
}: LocationScanPinGateProps) {
  const [digits, setDigits] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [verified, setVerified] = useState(false);

  const submitPin = useCallback(
    async (pin: string) => {
      if (pin.length < MIN_PIN_LENGTH || pin.length > MAX_PIN_LENGTH) return;
      onSubmitStart?.();
      setSubmitting(true);
      setError(null);
      try {
        const result = await resolveLocationScanPin({
          pin,
          stagingLocationCode,
        });
        if (!result.success) {
          setDigits([]);
          setError(result.message ?? "Invalid code.");
          onSubmitError?.(result.message ?? "Invalid code.");
          return;
        }
        if (!result.sessionToken || !result.expiresAt) {
          setDigits([]);
          setError("Invalid code.");
          onSubmitError?.("Invalid code.");
          return;
        }

        setVerified(true);
        const sessionMinutes = sessionMinutesFromExpiresAt(result.expiresAt);
        const sessionOpts = {
          sessionToken: result.sessionToken,
          expiresAt: result.expiresAt,
          sessionMinutes,
          scannedStagingLocationCode: result.scannedStagingLocationCode,
        };

        if (result.accessType === "technician") {
          setTechnicianPinSession(
            result.technicianId,
            result.technicianName,
            sessionOpts,
          );
          onVerified(result);
          void import("./dispatcher/firestoreService")
            .then(({ getAppSettings }) => getAppSettings())
            .then((settings) => {
              const configured = settings.technicianSessionMinutes ?? 15;
              const existing = getTechnicianPinSession(result.technicianId);
              if (!existing) return;
              setTechnicianPinSession(
                result.technicianId,
                result.technicianName,
                {
                  sessionToken: existing.sessionToken,
                  expiresAt: existing.expiresAt,
                  sessionMinutes: configured,
                  scannedStagingLocationCode:
                    existing.scannedStagingLocationCode,
                },
              );
            })
            .catch(() => {});
          return;
        }

        if (result.accessType === "management") {
          const { getAppSettings } = await import("./dispatcher/firestoreService");
          const settings = await getAppSettings().catch(() => ({
            managementSessionMinutes: 30,
          }));
          setManagementPinSession({
            sessionToken: result.sessionToken,
            expiresAt: result.expiresAt,
            sessionMinutes: settings.managementSessionMinutes ?? 30,
            scannedStagingLocationCode: result.scannedStagingLocationCode,
            pinId: result.pinId,
            permissions: result.permissions,
          });
          onVerified(result);
          return;
        }

        // vendor — TTL is CF expiresAt; sessionMinutes is informational only.
        const vendorSessionOpts = {
          sessionToken: result.sessionToken,
          expiresAt: result.expiresAt,
          sessionMinutes,
          scannedStagingLocationCode: result.scannedStagingLocationCode,
        };

        if (
          result.sessionScope === "vendor_unplanned" ||
          result.noExpectedDelivery
        ) {
          setVendorUnplannedPinSession(
            result.vendorId,
            result.vendorName,
            vendorSessionOpts,
          );
        } else if (result.sessionScope === "job" && result.jobId) {
          setJobPinSession(
            result.jobId,
            result.vendorId,
            result.vendorName,
            vendorSessionOpts,
          );
        } else if (result.sessionScope === "vendor" && result.deliveryId) {
          setVendorRunPinSession(
            result.vendorId,
            result.vendorName,
            result.deliveryId,
            vendorSessionOpts,
          );
        }

        onVerified(result);
        void import("./dispatcher/firestoreService")
          .then(({ getAppSettings }) => getAppSettings())
          .then((settings) => {
            const configured = settings.vendorSessionMinutes ?? 15;
            const refreshSession = (
              writer: (
                vendorId: string,
                vendorName: string,
                opts: typeof vendorSessionOpts,
              ) => void,
            ) => {
              writer(result.vendorId, result.vendorName, {
                sessionToken: result.sessionToken,
                expiresAt: result.expiresAt,
                sessionMinutes: configured,
                scannedStagingLocationCode: result.scannedStagingLocationCode,
              });
            };
            if (
              result.sessionScope === "vendor_unplanned" ||
              result.noExpectedDelivery
            ) {
              refreshSession(setVendorUnplannedPinSession);
            } else if (result.sessionScope === "job" && result.jobId) {
              setJobPinSession(result.jobId, result.vendorId, result.vendorName, {
                sessionToken: result.sessionToken,
                expiresAt: result.expiresAt,
                sessionMinutes: configured,
                scannedStagingLocationCode: result.scannedStagingLocationCode,
              });
            } else if (result.sessionScope === "vendor" && result.deliveryId) {
              setVendorRunPinSession(
                result.vendorId,
                result.vendorName,
                result.deliveryId,
                {
                  sessionToken: result.sessionToken,
                  expiresAt: result.expiresAt,
                  sessionMinutes: configured,
                  scannedStagingLocationCode: result.scannedStagingLocationCode,
                },
              );
            }
          })
          .catch(() => {});
      } catch (err) {
        const message = pinVerifyErrorMessage(err);
        setDigits([]);
        setError(message);
        onSubmitError?.(message);
      } finally {
        setSubmitting(false);
      }
    },
    [stagingLocationCode, onVerified, onSubmitStart, onSubmitError],
  );

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
    <div
      className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-3"
      data-testid="location-scan-pin-shell"
      style={{
        paddingTop: "clamp(0.75rem, 3.4svh, 2.25rem)",
        paddingBottom:
          "max(env(safe-area-inset-bottom, 0px), clamp(0.75rem, 2svh, 1.5rem))",
      }}
    >
      <div
        className="w-full max-w-[22rem] rounded-3xl border border-white/10 bg-bg-secondary shadow-xl shadow-black/20"
        style={{ padding: "clamp(0.625rem, 1.9svh, 1.375rem)" }}
        data-testid="location-scan-pin-card"
      >
        <div className="text-center" data-testid="location-scan-pin-gate">
          <h1
            className="text-[clamp(1.25rem,3svh,1.6rem)] font-bold leading-tight tracking-tight text-text-primary"
            style={{ marginTop: "0.125rem" }}
          >
            Enter PIN
          </h1>
          <p
            className="mx-auto max-w-[18rem] text-[13px] leading-[1.125rem] text-[#cbd5e1]"
            style={{ marginTop: "0.125rem" }}
          >
            Enter your 4–6 digit PIN to continue.
          </p>
        </div>

        <div
          className="flex min-h-7 items-center justify-center"
          style={{ marginTop: "clamp(0.5rem, 1.4svh, 1rem)" }}
          aria-label={`PIN entry: ${pinLength} ${
            pinLength === 1 ? "digit" : "digits"
          } entered`}
          aria-live="polite"
          role="status"
        >
          <div
            className="inline-flex h-7 items-center gap-2 rounded-full border border-white/10 bg-bg-primary/55 px-3 text-xs font-medium text-text-primary"
            data-testid="location-scan-pin-status"
          >
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
              <span className="flex items-center gap-1" aria-hidden="true">
                {Array.from({ length: pinLength }).map((_, index) => (
                  <span
                    key={index}
                    className="size-1.5 rounded-full bg-accent-green"
                  />
                ))}
              </span>
            )}
            <span>
              {verified
                ? "Opening…"
                : submitting
                  ? "Verifying PIN…"
                  : canVerify
                    ? "Ready to verify"
                    : pinLength === 0
                      ? "PIN not entered"
                      : `${pinLength} ${
                          pinLength === 1 ? "digit" : "digits"
                        } entered`}
            </span>
          </div>
        </div>

        <div
          className="flex min-h-5 items-center justify-center"
          style={{ marginTop: "0.25rem", paddingInline: "0.5rem" }}
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
              data-testid="location-scan-pin-verifying"
            >
              {verified ? "Continuing…" : "Checking your PIN securely…"}
            </p>
          ) : pinLength > 0 ? (
            <div className="flex items-center justify-center gap-2 text-xs leading-5">
              <p className="text-center text-[#cbd5e1]">PIN stays hidden</p>
              <span className="text-text-secondary" aria-hidden="true">
                ·
              </span>
              <button
                type="button"
                onClick={clearAll}
                className="rounded font-semibold text-[#cbd5e1] transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Clear
              </button>
            </div>
          ) : (
            <p className="text-center text-xs leading-5 text-[#cbd5e1]">
              Enter your 4–6 digit PIN
            </p>
          )}
        </div>

        <div
          className="w-full max-w-[17.5rem]"
          data-testid="location-scan-pin-keypad"
          style={{ margin: "clamp(0.5rem, 1.4svh, 0.875rem) auto 0" }}
        >
          <div className="grid grid-cols-3 place-items-center gap-[clamp(0.375rem,1.2svh,0.75rem)]">
            {KEYPAD.slice(0, 3)
              .flat()
              .map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => pushDigit(key)}
                  disabled={locked || digits.length >= MAX_PIN_LENGTH}
                  className={KEY_BTN}
                >
                  {key}
                </button>
              ))}
          </div>
          <div
            className="flex items-center justify-center gap-[clamp(0.75rem,2svh,1.25rem)]"
            style={{ marginTop: "clamp(0.375rem, 1.2svh, 0.75rem)" }}
          >
            <button
              type="button"
              onClick={() => pushDigit("0")}
              disabled={locked || digits.length >= MAX_PIN_LENGTH}
              className={KEY_BTN}
            >
              0
            </button>
            <button
              type="button"
              onClick={backspace}
              disabled={locked || digits.length === 0}
              className={`${KEY_BTN} text-text-primary`}
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
          data-testid="location-scan-pin-verify"
          className="tap-target flex min-h-11 w-full items-center justify-center rounded-xl border border-transparent text-base font-bold text-white shadow-sm transition-[background-color,border-color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-green focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary active:scale-[0.99]"
          style={{
            marginTop: "clamp(0.5rem, 1.4svh, 0.875rem)",
            padding: "0.5rem 1rem",
            backgroundColor: canVerify || submitting ? "#047857" : "#334155",
            color: "#f8fafc",
          }}
        >
          {submitting ? "Verifying…" : "Verify"}
        </button>

        <p
          className="hidden text-center text-xs leading-4 text-[#cbd5e1] [@media(min-height:601px)]:block"
          style={{ marginTop: "0.25rem" }}
        >
          Need help? Call dispatch.
        </p>
      </div>
    </div>
  );
}

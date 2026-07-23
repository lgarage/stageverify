import { useCallback, useEffect, useState } from "react";
import { getAppSettings } from "./dispatcher/firestoreService";
import { verifyManagementPin } from "./verifyManagementPinClient";
import {
  setManagementPinSession,
  touchManagementPinSession,
} from "./managementPinSession";

const KEYPAD = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["", "0", "back"],
] as const;

interface ManagementPinGateProps {
  stagingLocationCode: string;
  onVerified: (payload: { scannedStagingLocationCode?: string }) => void;
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

export function ManagementPinGate({
  stagingLocationCode,
  onVerified,
}: ManagementPinGateProps) {
  const [digits, setDigits] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [verified, setVerified] = useState(false);

  const submitPin = useCallback(
    async (pin: string) => {
      setSubmitting(true);
      setError(null);
      try {
        const result = await verifyManagementPin({
          pin,
          stagingLocationCode,
        });
        if (!result.success || !result.sessionToken || !result.expiresAt) {
          setDigits([]);
          setError(result.message ?? "Invalid code.");
          return;
        }
        setVerified(true);
        const settings = await getAppSettings().catch(() => ({
          managementSessionMinutes: 30,
        }));
        const sessionMinutes = settings.managementSessionMinutes ?? 30;
        setManagementPinSession({
          sessionToken: result.sessionToken,
          expiresAt: result.expiresAt,
          sessionMinutes,
          scannedStagingLocationCode: result.scannedStagingLocationCode,
        });
        onVerified({
          scannedStagingLocationCode: result.scannedStagingLocationCode,
        });
      } catch (err) {
        setDigits([]);
        setError(pinVerifyErrorMessage(err));
      } finally {
        setSubmitting(false);
      }
    },
    [stagingLocationCode, onVerified],
  );

  useEffect(() => {
    if (digits.length !== 4 || submitting || verified) return;
    void submitPin(digits.join(""));
  }, [digits, submitting, verified, submitPin]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      touchManagementPinSession();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const locked = submitting || verified;

  const pushDigit = (digit: string) => {
    if (locked || digits.length >= 4) return;
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
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-8">
      <p className="text-center text-text-secondary text-sm mb-6">
        Office parcel intake
      </p>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-bg-surface p-6 shadow-lg">
        <h1 className="text-xl font-bold text-center text-text-primary mb-2">
          Enter Management PIN
        </h1>
        <p className="text-sm text-center text-text-secondary mb-8">
          Shared shop PIN — scan any location QR, then open catch-all check-in.
        </p>

        <div
          className="flex items-center justify-center gap-4 mb-6"
          aria-label={`PIN entry: ${digits.length} of 4 digits`}
        >
          {Array.from({ length: 4 }).map((_, index) => (
            <span
              key={index}
              className={`size-4 rounded-full border-2 transition-colors ${
                index < digits.length
                  ? "border-accent-green bg-accent-green"
                  : "border-border bg-transparent"
              }`}
            />
          ))}
        </div>

        {error && (
          <p className="text-sm text-center text-accent-red mb-4" role="alert">
            {error}
          </p>
        )}

        {locked && !error && (
          <p className="text-sm text-center text-text-secondary mb-4">
            {verified ? "Loading waiting parts…" : "Verifying PIN…"}
          </p>
        )}

        <div className="grid grid-cols-3 gap-3 mb-4">
          {KEYPAD.flat().map((key, index) => {
            if (key === "") {
              return <div key={`spacer-${index}`} />;
            }
            if (key === "back") {
              return (
                <button
                  key="back"
                  type="button"
                  onClick={backspace}
                  disabled={locked || digits.length === 0}
                  className="tap-target size-16 mx-auto rounded-full border border-border bg-bg-card text-text-primary flex items-center justify-center active:scale-95 disabled:opacity-40"
                  aria-label="Backspace"
                >
                  <svg
                    className="size-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12h6m6 0h6"
                    />
                  </svg>
                </button>
              );
            }
            return (
              <button
                key={key}
                type="button"
                onClick={() => pushDigit(key)}
                disabled={locked || digits.length >= 4}
                className="tap-target size-16 mx-auto rounded-full border border-border bg-bg-card text-2xl font-medium text-text-primary active:scale-95 disabled:opacity-40"
              >
                {key}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-center text-sm mb-6">
          <button
            type="button"
            onClick={clearAll}
            disabled={locked || digits.length === 0}
            className="text-text-secondary font-medium disabled:opacity-40"
          >
            Clear
          </button>
        </div>

        <p className="text-xs text-center text-text-secondary">
          Match packing slips to expected deliveries, or flag unidentifiable parcels.
        </p>
      </div>
    </div>
  );
}

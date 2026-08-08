import { useCallback, useEffect, useState } from "react";
import { getAppSettings } from "./dispatcher/firestoreService";
import { verifyTechnicianPin } from "./verifyTechnicianPinClient";
import { setTechnicianPinSession } from "./technicianPinSession";

const KEYPAD = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["", "0", "back"],
] as const;

const MAX_PIN_LENGTH = 6;
const MIN_PIN_LENGTH = 4;

export interface TechnicianPinVerifiedPayload {
  technicianId: string;
  technicianName: string;
  scannedStagingLocationCode?: string;
}

interface TechnicianPinGateProps {
  stagingLocationCode: string;
  onVerified: (payload: TechnicianPinVerifiedPayload) => void;
  onBack?: () => void;
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

export function TechnicianPinGate({
  stagingLocationCode,
  onVerified,
  onBack,
}: TechnicianPinGateProps) {
  const [digits, setDigits] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [verified, setVerified] = useState(false);

  const submitPin = useCallback(
    async (pin: string) => {
      if (pin.length < MIN_PIN_LENGTH || pin.length > MAX_PIN_LENGTH) return;
      setSubmitting(true);
      setError(null);
      try {
        const result = await verifyTechnicianPin({
          pin,
          stagingLocationCode,
        });
        if (!result.success || !result.technicianId || !result.technicianName) {
          setDigits([]);
          setError(result.message ?? "Invalid code.");
          return;
        }
        if (!result.sessionToken || !result.expiresAt) {
          setDigits([]);
          setError("Invalid code.");
          return;
        }
        setVerified(true);
        const settings = await getAppSettings().catch(() => ({
          technicianSessionMinutes: 15,
        }));
        const sessionMinutes = settings.technicianSessionMinutes ?? 15;
        setTechnicianPinSession(result.technicianId, result.technicianName, {
          sessionToken: result.sessionToken,
          expiresAt: result.expiresAt,
          sessionMinutes,
          scannedStagingLocationCode: result.scannedStagingLocationCode,
        });
        onVerified({
          technicianId: result.technicianId,
          technicianName: result.technicianName,
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
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-8">
      <p className="text-center text-text-secondary text-sm mb-6">
        Technician Pickup
      </p>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-bg-surface p-6 shadow-lg">
        <h1 className="text-xl font-bold text-center text-text-primary mb-2">
          Enter Technician PIN
        </h1>
        <p className="text-sm text-center text-text-secondary mb-8">
          Your personal PIN unlocks jobs dispatch released for you today.
        </p>

        <div
          className="flex items-center justify-center gap-3 mb-6"
          aria-label={`PIN entry: ${pinLength} of 6 digits`}
        >
          {Array.from({ length: MAX_PIN_LENGTH }).map((_, index) => (
            <span
              key={index}
              className={`size-4 rounded-full border-2 transition-colors ${
                index < pinLength
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
            {verified ? "Loading your pickups…" : "Verifying PIN…"}
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
                disabled={locked || digits.length >= MAX_PIN_LENGTH}
                className="tap-target size-16 mx-auto rounded-full border border-border bg-bg-card text-2xl font-medium text-text-primary active:scale-95 disabled:opacity-40"
              >
                {key}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between text-sm mb-4">
          <button
            type="button"
            onClick={clearAll}
            disabled={locked || digits.length === 0}
            className="text-text-secondary font-medium disabled:opacity-40"
          >
            Clear
          </button>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              disabled={locked}
              className="text-text-secondary font-medium"
            >
              Vendor PIN
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => void submitPin(digits.join(""))}
          disabled={!canVerify}
          className="tap-target w-full rounded-xl bg-accent-green py-3 text-base font-bold text-white mb-6 disabled:opacity-40"
        >
          Verify
        </button>

        <p className="text-xs text-center text-text-secondary">
          Need help? Call dispatch.
        </p>
      </div>
    </div>
  );
}

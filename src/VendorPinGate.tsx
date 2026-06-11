import { useCallback, useEffect, useState } from "react";
import { verifyVendorPin } from "./dispatcher/firestoreService";
import {
  setPinSession,
  touchPinSession,
  VENDOR_PIN_SESSION_MS,
} from "./vendorPinSession";

const KEYPAD = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["", "0", "back"],
] as const;

interface VendorPinGateProps {
  deliveryId: string;
  onVerified: (vendorId: string, vendorName: string) => void;
  onCancel?: () => void;
}

export function VendorPinGate({
  deliveryId,
  onVerified,
  onCancel,
}: VendorPinGateProps) {
  const [digits, setDigits] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submitPin = useCallback(
    async (pin: string) => {
      setSubmitting(true);
      setError(null);
      try {
        const result = await verifyVendorPin({ deliveryId, pin });
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
        setPinSession(deliveryId, result.vendorId, result.vendorName);
        onVerified(result.vendorId, result.vendorName);
      } catch {
        setDigits([]);
        setError("Unable to verify PIN. Try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [deliveryId, onVerified],
  );

  useEffect(() => {
    if (digits.length !== 4 || submitting) return;
    void submitPin(digits.join(""));
  }, [digits, submitting, submitPin]);

  useEffect(() => {
    const resetOnInactivity = () => {
      touchPinSession(deliveryId);
    };
    const interval = window.setInterval(() => {
      touchPinSession(deliveryId);
    }, VENDOR_PIN_SESSION_MS / 2);
    window.addEventListener("pointerdown", resetOnInactivity);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pointerdown", resetOnInactivity);
    };
  }, [deliveryId]);

  const pushDigit = (digit: string) => {
    if (submitting || digits.length >= 4) return;
    setError(null);
    setDigits((prev) => [...prev, digit]);
  };

  const backspace = () => {
    if (submitting) return;
    setError(null);
    setDigits((prev) => prev.slice(0, -1));
  };

  const clearAll = () => {
    if (submitting) return;
    setError(null);
    setDigits([]);
  };

  return (
    <div className="min-h-screen min-h-dvh bg-bg-primary flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-bg-surface p-6 shadow-lg">
        <h1 className="text-xl font-semibold text-center text-text-primary mb-2">
          Enter Vendor PIN
        </h1>
        <p className="text-sm text-center text-text-secondary mb-8">
          Enter the 4-digit PIN for this delivery.
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
                  ? "border-accent bg-accent"
                  : "border-border bg-transparent"
              }`}
            />
          ))}
        </div>

        {error && (
          <p
            className="text-sm text-center text-accent-red mb-4"
            role="alert"
          >
            {error}
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
                  disabled={submitting || digits.length === 0}
                  className="tap-target size-16 mx-auto rounded-full border border-border bg-bg-surface text-text-primary flex items-center justify-center active:scale-95 disabled:opacity-40"
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
                disabled={submitting || digits.length >= 4}
                className="tap-target size-16 mx-auto rounded-full border border-border bg-bg-surface text-2xl font-medium text-text-primary active:scale-95 disabled:opacity-40"
              >
                {key}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between text-sm mb-6">
          <button
            type="button"
            onClick={clearAll}
            disabled={submitting || digits.length === 0}
            className="text-text-secondary font-medium disabled:opacity-40"
          >
            Clear
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="text-text-secondary font-medium"
            >
              Back
            </button>
          )}
        </div>

        <p className="text-xs text-center text-text-secondary">
          Need help? Call dispatch.
        </p>
      </div>
    </div>
  );
}

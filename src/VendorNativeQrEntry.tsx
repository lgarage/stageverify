interface VendorNativeQrEntryProps {
  title?: string;
  manualId?: string;
  onManualIdChange?: (value: string) => void;
  onManualSubmit?: () => void;
  manualLoading?: boolean;
  manualError?: string | null;
}

/** Vendor entry when no delivery deep link — scan with the phone Camera app only. */
export function VendorNativeQrEntry({
  title = "Receive Delivery",
  manualId,
  onManualIdChange,
  onManualSubmit,
  manualLoading = false,
  manualError = null,
}: VendorNativeQrEntryProps) {
  const showManual =
    manualId !== undefined &&
    onManualIdChange !== undefined &&
    onManualSubmit !== undefined;

  return (
    <div className="flex flex-1 flex-col px-6 py-8">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-text-primary mb-2">{title}</h1>
        <p className="text-sm text-text-secondary">
          Use your phone&apos;s <strong className="text-text-primary">Camera</strong>{" "}
          app to scan the QR on your package or staging tag.
        </p>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-bg-surface p-6 text-center">
          <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-accent/10 text-accent">
            <svg
              className="size-10"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
          <ol className="space-y-3 text-left text-sm text-text-secondary">
            <li>Open the Camera app on your phone.</li>
            <li>Point it at the delivery or zone QR code.</li>
            <li>Tap the link banner — the receive page opens automatically.</li>
          </ol>
        </div>
      </div>

      {showManual && (
        <div className="mt-8 pt-6 border-t border-border">
          <p className="text-xs text-text-secondary mb-2 uppercase tracking-widest">
            Or enter delivery ID manually
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              maxLength={64}
              value={manualId}
              onChange={(e) => onManualIdChange(e.target.value)}
              placeholder="Delivery ID"
              className="flex-1 min-h-[44px] rounded-xl border border-border bg-bg-surface px-4 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
            />
            <button
              type="button"
              disabled={manualLoading || !manualId.trim()}
              onClick={onManualSubmit}
              className="min-h-[44px] px-5 rounded-xl bg-accent text-bg-primary font-medium disabled:opacity-50"
            >
              Go
            </button>
          </div>
          {manualError && (
            <p className="text-xs text-accent-red mt-2">{manualError}</p>
          )}
        </div>
      )}
    </div>
  );
}

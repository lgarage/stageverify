/**
 * Bare `/#/receive` (no delivery deep link) — recovery path to location-first entry.
 * Replaces obsolete VendorNativeQrEntry ("Receive Delivery" + manual Delivery ID).
 */
export function ReceiveEntryRecovery() {
  return (
    <div
      className="flex flex-1 flex-col px-6 py-8"
      data-testid="receive-entry-recovery"
    >
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-text-primary mb-2">
          Scan a location QR
        </h1>
        <p className="text-sm text-text-secondary">
          Use your phone&apos;s <strong className="text-text-primary">Camera</strong>{" "}
          app to scan a staging location QR. Enter your PIN to continue as vendor,
          technician, or office.
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
          <ol className="space-y-3 text-left text-sm text-text-primary">
            <li>Open the Camera app on your phone.</li>
            <li>Point it at a staging location QR code.</li>
            <li>Tap the link banner — StageVerify opens the PIN screen.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

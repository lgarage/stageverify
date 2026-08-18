import type { ReactNode } from "react";

interface VendorDeliveriesLandingProps {
  rootTestId: "vendor-run-layout" | "vendor-job-deliveries";
  vendorName?: string;
  scannedContext: ReactNode;
  helper: ReactNode;
  helperTestId?: string;
  children: ReactNode;
  footer: ReactNode;
  overlay?: ReactNode;
}

export function vendorDeliveriesHeading(
  vendorName: string | undefined,
): string {
  const cleaned = (vendorName ?? "").trim().replace(/\s+/g, " ");
  if (!cleaned) return "DELIVERIES";
  return `${cleaned.toUpperCase()} DELIVERIES`;
}

export function VendorDeliveriesLanding({
  rootTestId,
  vendorName,
  scannedContext,
  helper,
  helperTestId,
  children,
  footer,
  overlay,
}: VendorDeliveriesLandingProps) {
  return (
    <div
      className="app-container vendor-mobile-shell vendor-deliveries-landing bg-bg-primary"
      data-testid={rootTestId}
    >
      <div className="vendor-hub-layout h-full min-h-0">
        <header className="vendor-hub-header vendor-deliveries-header border-b border-border bg-bg-surface px-4 py-3">
          <p className="vendor-deliveries-context text-[11px] font-semibold uppercase tracking-[0.16em] text-text-secondary">
            {scannedContext}
          </p>
          <h1
            className="vendor-deliveries-title mt-2 break-words text-2xl font-bold leading-7 tracking-tight text-text-primary [overflow-wrap:anywhere]"
            data-testid="vendor-deliveries-heading"
          >
            {vendorDeliveriesHeading(vendorName)}
          </h1>
          <p
            className="vendor-deliveries-helper vendor-job-deliveries-helper mt-1 text-sm leading-5 text-[#cbd5e1]"
            data-testid={helperTestId}
          >
            {helper}
          </p>
        </header>

        <main className="vendor-hub-scroll vendor-deliveries-scroll px-4 py-4">
          <div className="vendor-deliveries-card-list flex flex-col gap-4">
            {children}
          </div>
        </main>

        <footer className="vendor-hub-footer vendor-deliveries-footer border-t border-border bg-bg-primary px-4 pt-3">
          {footer}
        </footer>

        {overlay}
      </div>
    </div>
  );
}

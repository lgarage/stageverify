import { Link } from "react-router-dom";
import { buildPickupPortalUrl, pickupPath } from "./receiveQrUrls";
import { EslQrCode } from "./EslQrCode";

const DEMO_JOB_ID = "job-3";
const DEMO_DELIVERY_ID = "delivery-3";
const DEMO_ORDER = "ORD-004";

const pickupUrl = buildPickupPortalUrl(DEMO_JOB_ID, DEMO_DELIVERY_ID, {
  forPrint: true,
});

/** Scannable QR + tap link for technician pickup testing (ORD-004). */
export function PickupDemoScanPage() {
  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center p-4">
      <main className="w-full max-w-md rounded-2xl border border-border bg-bg-card p-6 text-center shadow-lg">
        <h1 className="text-xl font-bold text-text-primary mb-1">
          Technician pickup demo
        </h1>
        <p className="text-sm text-text-secondary mb-6">
          Scan with iPhone Camera, or tap Open Pickup Portal below
        </p>
        <div className="inline-block rounded-xl border-2 border-border bg-white p-4 mb-6">
          <EslQrCode value={pickupUrl} variant="print" />
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm text-left mb-6">
          <dt className="font-semibold text-text-secondary">Order</dt>
          <dd>{DEMO_ORDER}</dd>
          <dt className="font-semibold text-text-secondary">Job</dt>
          <dd>{DEMO_JOB_ID}</dd>
          <dt className="font-semibold text-text-secondary">Flow</dt>
          <dd>Check each line → Done — All Picked Up</dd>
        </dl>
        <Link
          to={pickupPath(DEMO_JOB_ID, DEMO_DELIVERY_ID)}
          className="action-btn action-btn-primary w-full mb-4 inline-flex justify-center"
        >
          Open Pickup Portal on this phone
        </Link>
        <p className="text-xs text-text-secondary break-all">{pickupUrl}</p>
      </main>
    </div>
  );
}

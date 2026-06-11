import { buildEslTagQrUrl } from "./receiveQrUrls";
import { EslQrCode } from "./EslQrCode";

const DEMO_DELIVERY_ID = "delivery-demo-vendor-1";
const DEMO_PIN = "1234";

const receiveQrUrl = buildEslTagQrUrl({
  deliveryId: DEMO_DELIVERY_ID,
  options: { forPrint: true },
});

/** Large scannable QR for iPhone vendor-flow testing (ORD-005 demo). */
export function VendorDemoScanPage() {
  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center p-4">
      <main className="w-full max-w-md rounded-2xl border border-border bg-bg-card p-6 text-center shadow-lg">
        <h1 className="text-xl font-bold text-text-primary mb-1">
          Vendor receive demo
        </h1>
        <p className="text-sm text-text-secondary mb-6">
          Scan with iPhone Camera — same payload as a zone e-tag
        </p>
        <div className="inline-block rounded-xl border-2 border-border bg-white p-4 mb-6">
          <EslQrCode value={receiveQrUrl} variant="print" />
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm text-left mb-6">
          <dt className="font-semibold text-text-secondary">Order</dt>
          <dd>ORD-005 (Johnstone Supply)</dd>
          <dt className="font-semibold text-text-secondary">PIN</dt>
          <dd className="text-accent-red font-bold tracking-widest">{DEMO_PIN}</dd>
          <dt className="font-semibold text-text-secondary">After scan</dt>
          <dd>Check items → zone → Submit Check-in</dd>
        </dl>
        <ol className="text-left text-sm text-text-secondary space-y-2 list-decimal list-inside">
          <li>Open iPhone Camera and point at this QR.</li>
          <li>Tap the banner → Safari opens Vendor Portal.</li>
          <li>
            Enter PIN <strong className="text-text-primary">{DEMO_PIN}</strong> on
            the keypad.
          </li>
        </ol>
        <p className="mt-6 text-xs text-text-secondary break-all">{receiveQrUrl}</p>
      </main>
    </div>
  );
}

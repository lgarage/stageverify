# Production verify environment variables

Scripts-only reference for `:prod` Playwright verifies against live gh-pages
(`https://lgarage.github.io/stageverify`) and live Firebase `stageverify-db`.

## Always required (dispatcher / protected routes)

| Variable | Purpose |
|----------|---------|
| `STAGEVERIFY_TEST_EMAIL` | Firebase login for Playwright auth |
| `STAGEVERIFY_TEST_PASSWORD` | Firebase login for Playwright auth |

Set in `.env.local` (local) or Cursor Environments UI (cloud). Run
`node scripts/playwright-auth-setup.mjs` while `npm run dev` is up if auth
expires (~1 hour).

## Canonical vendor receive prod verify

**Script:** `npm run verify:vendor-delivered:prod`  
**Source:** `scripts/verify-vendor-delivered.mjs`

Requires **real parsed/approved ingest** — no demo defaults. The script opens
`/#/receive?id=<deliveryId>`, enters the vendor PIN, exercises the exception-only
Delivered hub (Mark Delivered, Need More Space, undo), and asserts order/job/PO
copy on the hub.

| Variable | Expected value |
|----------|----------------|
| `STAGEVERIFY_RECEIVE_DELIVERY` | Firestore **document id** in `deliveries/` (e.g. `delivery-abc123`), **not** order number or invoice number |
| `STAGEVERIFY_VENDOR_ORDER` | Vendor order number shown on the hub after PIN unlock (matches delivery's `vendorOrderNumber`) |
| `STAGEVERIFY_VENDOR_PIN` | 4-digit vendor PIN configured for that delivery's vendor |
| `STAGEVERIFY_VENDOR_JOB` | Job/site name text asserted on the hub (matches delivery's job display) |
| `STAGEVERIFY_VENDOR_PO` | PO number text asserted on the hub |

### Where to obtain a safe prod delivery id

1. **Dispatcher → Delivery Overview** — search a real invoice/order (e.g.
   `4046362` or `P411190` per `verify:dispatcher-nav` defaults), open the drawer,
   copy the Firestore delivery id from the URL hash or network tab (`deliveries/<id>`).
2. **Firebase console** — `stageverify-db` → Firestore → `deliveries` → pick an
   approved, non-demo row with vendor PIN configured.
3. **Settings → Vendors** — confirm the vendor has a PIN; the delivery must belong
   to that vendor.

**Do not use for prod canonical verify:**

- `delivery-demo-vendor-1` — local/demo seed only (`verify-receive.mjs` local
  default, `reset-vendor-demo-fixture.mjs` reset target). Hidden from prod
  dispatcher list (`hideSeedDemoRows`). Not intended for
  `verify:vendor-delivered:prod`.
- Hard-coded invoice shells without a live vendor PIN + approved ingest.

### Optional reset before repeat runs

`node scripts/reset-vendor-demo-fixture.mjs` resets delivery status/items when
`STAGEVERIFY_RECEIVE_DELIVERY` is set — **only on deliveries you own for testing**;
never on customer production jobs without explicit intent.

## Pickup prod verify

**Script:** `npm run verify:pickup:prod`

Uses fixture `delivery-3` / `job-3` by default (`STAGEVERIFY_PICKUP_DELIVERY`,
`STAGEVERIFY_PICKUP_JOB` optional). Resets via `reset-pickup-verify-fixture.mjs`
and seeds readiness via trusted CF — no extra env beyond test credentials.

**UI copy asserted (v0.0.221+):** submit button `Complete Pickup`; success screen
`Picked Up` (not legacy `Order Pickup Complete` / `All Items Picked Up!`).

## Dispatcher nav prod verify

**Script:** `npm run verify:dispatcher-nav:prod`

Sidebar version is read from root `package.json` `version` and must match live
deploy (currently **v0.0.221**). No bundle hash assertion in script.

Optional: `STAGEVERIFY_VERIFY_ORDER` — single search term (defaults try
`4046362`, `P411190`, `INV-P411190`).

## Deprecated vendor scripts

`verify:vendor-demo:prod` and `verify:vendor-demo:webkit:prod` exit with
DEPRECATED — use `verify:vendor-delivered:prod` with the env table above.

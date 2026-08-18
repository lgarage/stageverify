/**
 * Isolated authenticated dispatcher reload timings (prod or local).
 * Assumes STAGEVERIFY_TEST_EMAIL / PASSWORD.
 */
import { chromium, devices } from "playwright";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { loadEnvLocal, ensureAuthenticated } from "./dispatcherVerifyHelpers.mjs";

loadEnvLocal();
const appBase = resolveAppBase(
  process.env.STAGEVERIFY_BASE_URL ?? "https://lgarage.github.io/stageverify",
);

function classify(url) {
  const u = url.toLowerCase();
  if (u.includes("listvendorinvoiceimports")) return "cf:listVendorInvoiceImports";
  if (u.includes("approvevendorinvoiceimport")) return "cf:approveVendorInvoiceImport";
  if (u.includes("cloudfunctions.net")) return "cf:other";
  if (u.includes("firestore.googleapis.com")) return "firestore";
  if (u.includes("identitytoolkit") || u.includes("securetoken")) return "auth";
  if (u.includes("lgarage.github.io") || u.includes("localhost")) return "static";
  return "other";
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ...devices["iPhone 14"] });
const page = await context.newPage();

await ensureAuthenticated(page, appBase);

const counts = {};
const finishes = [];
page.on("response", (res) => {
  const cls = classify(res.url());
  counts[cls] = (counts[cls] ?? 0) + 1;
  if (cls.startsWith("cf:")) {
    finishes.push({ cls, status: res.status(), url: res.url().split("?")[0] });
  }
});

const t0 = Date.now();
await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });

let dashboardUsableMs = null;
await page.waitForFunction(
  () => {
    const table = document.querySelector(
      '[data-testid="dispatcher-deliveries-table"]',
    );
    if (!table) return false;
    const section = table.closest(".admin-section") ?? table.parentElement;
    const loading = Boolean(
      section &&
        [...section.querySelectorAll("span")].some((s) => s.textContent === "Loading…"),
    );
    const empty = document.body.innerText.includes("No deliveries");
    return (
      !loading &&
      (empty || document.querySelector('[data-testid^="dispatcher-delivery-row-"]'))
    );
  },
  { timeout: 60_000 },
);
dashboardUsableMs = Date.now() - t0;

let invoiceReadyMs = null;
try {
  await page.waitForFunction(
    () => {
      const heading = document.querySelector(
        '[data-testid="needs-review-invoice-heading"]',
      );
      if (!heading) return false;
      const block = document.querySelector(
        '[data-testid="needs-review-invoice-block"]',
      );
      const text = block?.innerText ?? "";
      return (
        text.length > 80 &&
        !text.includes("Loading invoice") &&
        !/Loading…\s*$/.test(text)
      );
    },
    { timeout: 30_000 },
  );
  invoiceReadyMs = Date.now() - t0;
} catch {
  invoiceReadyMs = null;
}

const rowCount = await page
  .locator('[data-testid^="dispatcher-delivery-row-"]')
  .count();

const report = {
  measuredAt: new Date().toISOString(),
  appBase,
  liveBundle: await page.evaluate(() => {
    const s = document.querySelector('script[src*="assets/index-"]');
    return s ? s.getAttribute("src") : null;
  }),
  dashboardUsableMs,
  invoiceReadyMs,
  visibleRowCount: rowCount,
  requestCounts: counts,
  cfCalls: finishes,
};
console.log(JSON.stringify(report, null, 2));
await browser.close();

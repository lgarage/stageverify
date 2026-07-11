/**
 * DEPRECATED — legacy full_checkin vendor flow. Use verify-vendor-delivered.mjs instead.
 *
 * Required env: STAGEVERIFY_RECEIVE_DELIVERY, STAGEVERIFY_VENDOR_ORDER, STAGEVERIFY_VENDOR_PIN
 *
 * Usage:
 *   node scripts/verify-vendor-demo.mjs
 */

import { chromium, webkit } from "playwright";

console.error(
  "DEPRECATED: verify-vendor-demo.mjs — use verify-vendor-delivered.mjs with STAGEVERIFY_* env.",
);
process.exit(1);

import { mkdirSync } from "fs";
import { resolve } from "path";

function requireEnv(name) {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing required env: ${name}`);
    console.error("verify:vendor-demo is DEPRECATED — use verify:vendor-delivered with real ingest env.");
    process.exit(1);
  }
  return val;
}

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const browserFlag = args.find((a) => a.startsWith("--browser="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const browserName =
  (browserFlag ? browserFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BROWSER ??
  "chromium";

const deliveryId = requireEnv("STAGEVERIFY_RECEIVE_DELIVERY");
const orderNumber = requireEnv("STAGEVERIFY_VENDOR_ORDER");
const correctPin = requireEnv("STAGEVERIFY_VENDOR_PIN");

const outDir = resolve(process.cwd(), "screenshots", "vendor-demo");
mkdirSync(outDir, { recursive: true });

async function shot(page, name) {
  const path = resolve(outDir, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(`  screenshot: ${path}`);
}

(async () => {
  const launcher = browserName === "webkit" ? webkit : chromium;
  const browser = await launcher.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    isIOS: browserName === "webkit",
    userAgent:
      browserName === "webkit"
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        : undefined,
  });
  const page = await context.newPage();

  const url = `${baseUrl.replace(/\/$/, "")}/#/receive?id=${deliveryId}`;
  console.log(`Browser: ${browserName}`);
  console.log(`Opening ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });

  await page.waitForSelector("text=Enter Vendor PIN", { timeout: 30_000 });
  for (const digit of correctPin) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.waitForSelector(`text=${orderNumber}`, { timeout: 30_000 });
  await page.waitForSelector("text=Filter rack", { timeout: 15_000 });
  await shot(page, "01-items-loaded");

  await page
    .getByRole("button", { name: "Toggle Air handler 3-ton horizontal" })
    .click();
  await page
    .getByRole("button", { name: "Toggle Filter rack 16x25 MERV 11" })
    .click();
  await page.waitForSelector("text=Delivered: 6 / 6", { timeout: 10_000 });
  await shot(page, "02-items-checked-off");

  const filterAdjust = page
    .locator("text=Filter rack 16x25 MERV 11")
    .locator("xpath=ancestor::div[contains(@class,'rounded-xl')]")
    .getByRole("button", { name: "Adjust" });
  await filterAdjust.click();
  await page.waitForSelector("text=Adjust Quantity", { timeout: 10_000 });
  const minusBtn = page.locator(".stepper-btn").first();
  await minusBtn.click();
  await minusBtn.click();
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForSelector("text=Partial Delivery", { timeout: 10_000 });
  await page.waitForSelector("text=Partial order", { timeout: 10_000 });
  await shot(page, "03-partial-after-adjust");

  await page.getByRole("button", { name: "Next: Assign Zone" }).click();
  await page.waitForSelector("text=Assign Staging Zone", { timeout: 10_000 });
  await shot(page, "04-zone-step");

  console.log("PASS: Vendor demo check-off + adjust + zone step verified.");
  await browser.close();
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

/**
 * LEGACY full_checkin vendor flow — NOT the canonical prod test.
 *
 * Exercises item checkoff, qty adjust, and zone step (vendorDeliveryMode=full_checkin).
 * For exception-only Delivered hub on prod, use verify-vendor-delivered.mjs instead:
 *   npm run verify:vendor-delivered:prod
 *
 * Usage:
 *   npm run dev   (local)
 *   node scripts/verify-vendor-demo.mjs
 *   node scripts/verify-vendor-demo.mjs --base-url=https://lgarage.github.io/stageverify
 */

import { chromium, webkit } from "playwright";
import { mkdirSync } from "fs";
import { resolve } from "path";

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

const deliveryId =
  process.env.STAGEVERIFY_RECEIVE_DELIVERY ?? "delivery-demo-vendor-1";

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
  for (const digit of "1234") {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.waitForSelector("text=ORD-005", { timeout: 30_000 });
  await page.waitForSelector("text=ORD-005", { timeout: 30_000 });
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

/**
 * Playwright: vendor PIN gate on /receive — WebKit + iPhone Safari UA (prod gate).
 * Mirrors verify-vendor-pin.mjs but uses WebKit engine + iOS user agent.
 */

import { webkit } from "playwright";
import { mkdirSync } from "fs";
import { resolve } from "path";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const deliveryId =
  process.env.STAGEVERIFY_RECEIVE_DELIVERY ?? "delivery-demo-vendor-1";
const correctPin = process.env.STAGEVERIFY_VENDOR_PIN ?? "1234";
const wrongPin = "0000";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const outDir = resolve(process.cwd(), "screenshots", "vendor-pin-webkit");
mkdirSync(outDir, { recursive: true });

async function enterPin(page, digits) {
  for (const digit of digits) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
}

(async () => {
  const browser = await webkit.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    isIOS: true,
    userAgent: IPHONE_UA,
  });
  const page = await context.newPage();

  const pinToItemsMs = [];
  const url = `${baseUrl.replace(/\/$/, "")}/#/receive?id=${deliveryId}`;
  console.log(`WebKit + iPhone UA: ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForSelector("text=Enter Vendor PIN", { timeout: 30_000 });

  await enterPin(page, wrongPin);
  await page.waitForSelector("text=Invalid code", { timeout: 15_000 });

  const t0 = Date.now();
  await enterPin(page, correctPin);
  await page.waitForSelector("text=ORD-005", { timeout: 15_000 });
  const elapsed = Date.now() - t0;
  pinToItemsMs.push(elapsed);
  console.log(`  PIN → ORD-005: ${elapsed}ms`);

  await page.waitForSelector("text=Filter rack", { timeout: 10_000 });

  if (elapsed > 8000) {
    throw new Error(
      `Post-PIN load too slow for iPhone gate: ${elapsed}ms (max 8000ms)`,
    );
  }

  console.log("PASS: Vendor PIN WebKit iPhone UA verified.");
  await browser.close();
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

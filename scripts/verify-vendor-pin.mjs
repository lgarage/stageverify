/**
 * Playwright: vendor PIN gate on /receive deep link.
 *
 * Required env: STAGEVERIFY_RECEIVE_DELIVERY, STAGEVERIFY_VENDOR_PIN, STAGEVERIFY_VENDOR_ORDER
 *
 * Usage:
 *   npm run dev
 *   node scripts/verify-vendor-pin.mjs
 */

import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { resolve } from "path";
import { loadEnvLocal } from "./dispatcherVerifyHelpers.mjs";

loadEnvLocal();

function requireEnv(name) {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return val;
}

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const deliveryId = requireEnv("STAGEVERIFY_RECEIVE_DELIVERY");
const orderNumber = requireEnv("STAGEVERIFY_VENDOR_ORDER");
const correctPin = requireEnv("STAGEVERIFY_VENDOR_PIN");
const itemLabel = process.env.STAGEVERIFY_VENDOR_ITEM_LABEL;
const wrongPin = "0000";

const outDir = resolve(process.cwd(), "screenshots", "vendor-pin");
mkdirSync(outDir, { recursive: true });

async function enterPin(page, digits) {
  for (const digit of digits) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
}

async function shot(page, name) {
  const path = resolve(outDir, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(`  screenshot: ${path}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const page = await context.newPage();

  const url = `${baseUrl.replace(/\/$/, "")}/#/receive?id=${deliveryId}`;
  console.log(`Opening ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });

  await page.waitForSelector("text=Enter Vendor PIN", { timeout: 30_000 });
  await shot(page, "01-pin-gate");

  await enterPin(page, wrongPin);
  await page.waitForSelector("text=Invalid code", { timeout: 15_000 });
  await shot(page, "02-wrong-pin");

  await page.waitForTimeout(1000);
  await enterPin(page, correctPin);
  await page.waitForSelector(`text=${orderNumber}`, { timeout: 30_000 });
  if (itemLabel) {
    await page.waitForSelector(`text=${itemLabel}`, { timeout: 15_000 });
  }
  await shot(page, "03-unlocked");

  console.log("PASS: Vendor PIN gate verified.");
  await browser.close();
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

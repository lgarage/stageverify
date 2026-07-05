/**
 * Playwright E2E: vendor receive check-in — adjust qty, assert partial badge.
 *
 * Usage:
 *   npm run dev   (in another terminal, for local)
 *   node scripts/verify-receive.mjs
 *   node scripts/verify-receive.mjs --base-url=https://lgarage.github.io/stageverify
 *
 * Env (optional): STAGEVERIFY_BASE_URL, STAGEVERIFY_RECEIVE_DELIVERY=delivery-3
 */

import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { mkdirSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);

const deliveryId = process.env.STAGEVERIFY_RECEIVE_DELIVERY ?? "delivery-3";

const outDir = resolve(process.cwd(), "screenshots");
mkdirSync(outDir, { recursive: true });

(async () => {
  try {
    execSync("node scripts/seed-vendor-pin-data.mjs", { stdio: "pipe" });
  } catch {
    console.warn("SKIP vendor PIN seed (ADC unavailable)");
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const page = await context.newPage();

  const url = `${appBase}/#/receive?id=${deliveryId}`;
  console.log(`Opening ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });

  const pinHeading = page.getByText("Enter Vendor PIN").first();
  if (await pinHeading.isVisible().catch(() => false)) {
    for (const digit of "1234") {
      await page.getByRole("button", { name: digit, exact: true }).click();
    }
    await page.waitForTimeout(2000);
  }

  await page
    .getByText(/Receive Delivery|Check off items as delivered/)
    .first()
    .waitFor({ state: "visible", timeout: 45_000 });
  await page.screenshot({
    path: resolve(outDir, "receive-verify-loaded.png"),
    fullPage: true,
  });

  const adjustButtons = page.getByRole("button", { name: "Adjust" });
  await adjustButtons.nth(1).click();

  await page.waitForSelector("text=Adjust Quantity", { timeout: 10_000 });

  const minusBtn = page.locator(".stepper-btn").first();
  await minusBtn.click();

  await page.getByRole("button", { name: "Save" }).click();

  await page.waitForSelector("text=Partial Delivery", { timeout: 10_000 });
  await page.waitForSelector("text=Partial order", { timeout: 10_000 });

  await page.screenshot({
    path: resolve(outDir, "receive-verify-partial.png"),
    fullPage: true,
  });

  console.log("PASS: Receive check-in adjust + partial order UI verified.");
  await browser.close();
})().catch(async (err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

/**
 * Playwright: public receive/pickup routes show network-failure UX with retry.
 *
 * Usage:
 *   npm run dev
 *   npm run verify:public-network-error
 */

import { chromium } from "playwright";
import { resolveAppBase } from "./resolveAppBase.mjs";

const baseUrl = process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);

const FIRESTORE_HOST = /firestore\.googleapis\.com/;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });

  let blockFirestore = true;
  await context.route(FIRESTORE_HOST, async (route) => {
    if (blockFirestore) {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  const page = await context.newPage();

  console.log("Pickup: simulate Firestore network failure…");
  await page.goto(`${appBase}/#/pickup?job=job-3`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.getByTestId("public-network-error").waitFor({ timeout: 20_000 });
  console.log("PASS: pickup shows public-network-error panel.");

  blockFirestore = false;
  await page.getByTestId("public-network-retry").click();
  await page.waitForTimeout(3000);
  const pickupRecovered =
    (await page.getByText(/Loading pickup list|Order Pickup Complete|No pickup-ready/).count()) >
    0;
  if (!pickupRecovered) {
    throw new Error("Pickup retry did not recover from network failure.");
  }
  console.log("PASS: pickup retry recovers after network restored.");

  const receivePage = await context.newPage();
  blockFirestore = true;
  console.log("Receive: simulate Firestore network failure on PIN load…");
  await receivePage.goto(`${appBase}/#/receive?id=delivery-demo-vendor-1`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await receivePage.waitForTimeout(1500);

  const pinHeading = receivePage.getByRole("heading", { name: "Enter Vendor PIN" });
  if (await pinHeading.isVisible().catch(() => false)) {
    for (const digit of "1234") {
      await receivePage.locator("button", { hasText: digit }).first().click();
      await receivePage.waitForTimeout(200);
    }
    await receivePage.getByTestId("public-network-error").waitFor({ timeout: 25_000 });
  } else {
    await receivePage.getByTestId("public-network-error").waitFor({ timeout: 15_000 });
  }

  console.log("PASS: receive shows public-network-error panel.");
  blockFirestore = false;
  await receivePage.getByTestId("public-network-retry").click();
  await receivePage.waitForTimeout(2500);
  console.log("PASS: receive retry clicked after network restored.");

  await browser.close();
  console.log("verify:public-network-error PASS");
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

/**
 * §14 steps 23–24 — dispatcher pickup readback after e2e pickup completion.
 *
 * Local: ORD-004 in deliveries table (demo visible).
 * Prod: deep-link drawer for delivery-3 (seed demos hidden on gh-pages).
 *
 * Usage:
 *   npm run dev
 *   node scripts/verify-phase14-pickup-readback.mjs
 *   STAGEVERIFY_BASE_URL=https://lgarage.github.io/stageverify node scripts/verify-phase14-pickup-readback.mjs
 */

import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  ensureAuthenticated,
  loadEnvLocal,
  assertDeliveryDrawerOpen,
  openDeliveryDrawerByDeepLink,
} from "./dispatcherVerifyHelpers.mjs";

const baseUrl = process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const isProd = /lgarage\.github\.io\/stageverify/i.test(baseUrl);
const orderNumber =
  process.env.STAGEVERIFY_PHASE14_READBACK_ORDER ?? "ORD-004";
const deliveryId =
  process.env.STAGEVERIFY_PICKUP_DELIVERY ?? "delivery-3";

loadEnvLocal();

const screenshotDir = resolve(
  process.cwd(),
  "screenshots/phase14-pickup-readback",
);
mkdirSync(screenshotDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

async function assertPickedUpReadback() {
  const summaryLines = page.getByTestId("issue-summary-lines");
  await summaryLines.waitFor({ state: "visible", timeout: 15_000 });
  const lineTexts = await summaryLines.locator("li").allInnerTexts();
  const deliveryStatusLine = lineTexts.find((line) =>
    line.startsWith("Delivery Status:"),
  );
  const drawerStatus =
    deliveryStatusLine?.replace("Delivery Status:", "").trim() ?? "";
  if (drawerStatus !== "Picked Up") {
    throw new Error(
      `§14 readback FAIL: drawer status "${drawerStatus}" !== Picked Up`,
    );
  }
  console.log("PASS: drawer delivery status matches Picked Up");

  const heading = (
    await page.getByTestId("drawer-action-banner-heading").innerText()
  ).trim();
  const headingNorm = heading.toLowerCase();
  if (headingNorm === "waiting on delivery") {
    throw new Error(
      "§14 readback FAIL: post-pickup drawer still shows Waiting on Delivery",
    );
  }
  console.log(`PASS: drawer banner "${heading}" (post-pickup, not waiting)`);

  const activityToggle = page.getByRole("button", {
    name: /Activity History/i,
  });
  if (await activityToggle.isVisible().catch(() => false)) {
    await activityToggle.click();
    await page.waitForTimeout(400);
  }
  const activityText = await page.locator("body").innerText();
  if (!/Pickup completed/i.test(activityText)) {
    throw new Error(
      "§14 readback FAIL: Activity History missing Pickup completed event",
    );
  }
  console.log("PASS: Activity History includes Pickup completed");
}

try {
  await ensureAuthenticated(page, appBase);

  if (isProd) {
    console.log(
      `Prod readback: deep-link drawer for ${deliveryId} (demo rows hidden on gh-pages).`,
    );
    await openDeliveryDrawerByDeepLink(page, appBase, deliveryId);
    await assertDeliveryDrawerOpen(page);
    await assertPickedUpReadback();
    await page.screenshot({
      path: resolve(screenshotDir, "prod-delivery3-picked-up-readback.png"),
      fullPage: false,
    });
  } else {
    const search = page.locator('input[placeholder*="Job #, name, PO"]');
    await search.waitFor({ state: "visible", timeout: 15_000 });
    await search.fill("");
    await search.fill(orderNumber);
    await page.waitForTimeout(1500);

    const row = page
      .locator("table tbody tr", { hasText: orderNumber })
      .first();
    if ((await row.count()) === 0) {
      throw new Error(
        `§14 readback FAIL: ${orderNumber} not found in deliveries table`,
      );
    }

    const listStatus = (await row.locator("td").first().innerText()).trim();
    if (listStatus !== "Picked Up") {
      throw new Error(
        `§14 readback FAIL: expected list status "Picked Up", got "${listStatus}"`,
      );
    }
    console.log(`PASS: ${orderNumber} list status is Picked Up`);

    const viewBtn = row.locator("button").filter({ hasText: /^View$/ });
    if (await viewBtn.isVisible().catch(() => false)) {
      await viewBtn.click({ force: true });
    } else {
      await row.click({ force: true });
    }
    await page.waitForTimeout(1200);
    await assertDeliveryDrawerOpen(page);
    await assertPickedUpReadback();
    await page.screenshot({
      path: resolve(screenshotDir, "ord004-picked-up-readback.png"),
      fullPage: false,
    });
  }

  await browser.close();
  console.log("verify:phase14-pickup-readback PASS");
  process.exit(0);
} catch (err) {
  await page
    .screenshot({
      path: resolve(screenshotDir, "phase14-readback-fail.png"),
      fullPage: true,
    })
    .catch(() => {});
  await browser.close();
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

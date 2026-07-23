/**
 * Playwright: dispatcher deliveries table Released To + drawer job release panel.
 *
 * Usage:
 *   npm run dev   (another terminal)
 *   npm run verify:dispatcher-job-release
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  assertReadableTextContrast,
  JOB_RELEASE_PANEL_CONTRAST_SPEC,
  MIN_LARGE_TEXT_CONTRAST,
  MIN_TEXT_CONTRAST,
  RELEASED_TO_BADGE_CONTRAST_SPEC,
} from "./lib/ui-text-contrast-lib.mjs";
import {
  ensureAuthenticated,
  loadEnvLocal,
  openDeliveryDrawerByDeepLink,
  openDeliveryDrawerForNavVerify,
} from "./dispatcherVerifyHelpers.mjs";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const authState = resolve(process.cwd(), "playwright/.auth/state.json");
const outDir = resolve(process.cwd(), "screenshots/dispatcher-job-release");
loadEnvLocal();

function isProdLikeBase(url) {
  return url.includes("lgarage.github.io");
}

async function openDrawerForJobReleaseVerify(page) {
  if (isProdLikeBase(baseUrl)) {
    const openId =
      process.env.STAGEVERIFY_OPEN_DELIVERY?.trim() ||
      process.env.STAGEVERIFY_VERIFY_DELIVERY_ID?.trim();
    if (openId) {
      await openDeliveryDrawerByDeepLink(page, appBase, openId);
      return { method: "deep-link", deliveryId: openId };
    }
    const firstReleasedCell = page.locator('[data-testid^="released-to-"]').first();
    if ((await firstReleasedCell.count()) > 0) {
      const testId = (await firstReleasedCell.getAttribute("data-testid")) ?? "";
      const deliveryId = testId.replace(/^released-to-/, "");
      if (deliveryId) {
        await openDeliveryDrawerByDeepLink(page, appBase, deliveryId);
        return { method: "deep-link-from-table", deliveryId };
      }
    }
    throw new Error(
      "Prod verify: set STAGEVERIFY_OPEN_DELIVERY or ensure deliveries table has rows (hideSeedDemoRows).",
    );
  }

  await openDeliveryDrawerForNavVerify(page);
  return { method: "search+view" };
}

(async () => {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const page = await context.newPage();

  console.log(`Opening ${appBase}/#/dispatcher`);
  await ensureAuthenticated(page, appBase);
  await page.goto(`${appBase}/#/dispatcher`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(1500);

  const releasedHeader = page.getByRole("columnheader", { name: "Released To" });
  await releasedHeader.waitFor({ timeout: 20_000 });
  console.log("PASS: Deliveries table has Released To column");

  const drawerOpen = await openDrawerForJobReleaseVerify(page);
  console.log(`PASS: Opened drawer (${drawerOpen.method})`);

  await page
    .getByTestId("job-release-to-technician-panel")
    .waitFor({ timeout: 20_000 });
  await page.getByTestId("job-release-panel-heading").waitFor({ timeout: 10_000 });
  await page
    .getByTestId("job-release-technician-select")
    .waitFor({ state: "visible", timeout: 20_000 });

  await assertReadableTextContrast(page, JOB_RELEASE_PANEL_CONTRAST_SPEC);
  console.log(
    `PASS: Job release panel contrast (≥${MIN_TEXT_CONTRAST}:1 / ≥${MIN_LARGE_TEXT_CONTRAST}:1 large)`,
  );

  const badgeCount = await page
    .locator('[data-testid^="released-to-badge-"]')
    .count();
  if (badgeCount > 0) {
    await assertReadableTextContrast(page, RELEASED_TO_BADGE_CONTRAST_SPEC);
    console.log("PASS: Released To table badge contrast");
  } else {
    console.log(
      "SKIP: No Released To badges in table (none released today) — column + drawer panel verified",
    );
  }

  await page.screenshot({
    path: resolve(outDir, "dispatcher-drawer-job-release.png"),
    fullPage: false,
  });
  await page.locator("table").first().screenshot({
    path: resolve(outDir, "dispatcher-table-released-to.png"),
  });

  console.log("PASS: verify:dispatcher-job-release");
  await browser.close();
})().catch(async (err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

/**
 * Playwright: technician pickup portal shows dispatcher resolution readback.
 *
 * Prerequisite: issue resolved on delivery (run verify-material-issue-dashboard first).
 *
 * Usage:
 *   npm run dev
 *   npm run verify:pickup-issue-resolution
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);

const jobId = process.env.STAGEVERIFY_PICKUP_JOB ?? "job-3";
const deliveryId = process.env.STAGEVERIFY_PICKUP_DELIVERY ?? "delivery-3";
const expectedResolutionType =
  process.env.STAGEVERIFY_RESOLUTION_TYPE ?? "vendor_redeliver";
const expectedResolutionLabel =
  process.env.STAGEVERIFY_RESOLUTION_LABEL ?? "Vendor Redeliver";
const expectedNoteFragment =
  process.env.STAGEVERIFY_RESOLUTION_NOTE ?? "Playwright verify resolution";

const outDir = resolve(process.cwd(), "screenshots");
mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });

  console.log("Pickup resolution readback…");
  await page.goto(`${appBase}/#/pickup?job=${jobId}`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(2500);

  const panel = page.getByTestId("pickup-material-issue-panel");
  await panel.waitFor({ state: "visible", timeout: 20_000 });

  const resolved = page.getByTestId("pickup-issue-resolved").first();
  const resolvedVisible = await resolved
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);

  if (!resolvedVisible) {
    const bodyText = await page.locator("body").innerText();
    await page.screenshot({
      path: resolve(outDir, "pickup-verify-issue-resolution-fail.png"),
      fullPage: true,
    });
    throw new Error(
      `Expected pickup-issue-resolved visible. Page text:\n${bodyText.slice(0, 1200)}`,
    );
  }

  const resolvedText = await resolved.innerText();
  if (!resolvedText.includes(expectedResolutionLabel)) {
    throw new Error(
      `Expected resolution label "${expectedResolutionLabel}" in:\n${resolvedText}`,
    );
  }
  if (!resolvedText.includes(expectedNoteFragment)) {
    throw new Error(
      `Expected resolution note fragment "${expectedNoteFragment}" in:\n${resolvedText}`,
    );
  }

  const openIssues = page.getByTestId("pickup-issue-open");
  const openCount = await openIssues.count();
  if (openCount > 0) {
    throw new Error(
      `Expected no open pickup issues after resolve, found ${openCount}.`,
    );
  }

  const blockingBanner = page.getByTestId("blocking-issue-warning");
  if (await blockingBanner.isVisible().catch(() => false)) {
    throw new Error(
      "Blocking issue banner still visible after dispatcher resolve.",
    );
  }

  await page.screenshot({
    path: resolve(outDir, "pickup-verify-issue-resolution-readback.png"),
    fullPage: true,
  });

  console.log(
    `PASS: pickup shows resolved issue (${expectedResolutionType}) for delivery ${deliveryId}.`,
  );

  await browser.close();
  process.exit(0);
})();

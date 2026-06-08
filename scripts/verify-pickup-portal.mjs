/**
 * Playwright E2E: pickup portal — Scenario B (Report Issue) + Scenario A (Done flow).
 * Optional: dispatcher issue badge when playwright/.auth/state.json exists.
 *
 * Usage:
 *   npm run dev
 *   node scripts/verify-pickup-portal.mjs
 *
 * Requires deployed createMaterialIssue Cloud Function + Firestore rules/indexes.
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  ensureAuthenticated,
  loadEnvLocal,
  openDeliveryDrawer,
} from "./dispatcherVerifyHelpers.mjs";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);

const jobId = process.env.STAGEVERIFY_PICKUP_JOB ?? "job-3";
const deliveryId = process.env.STAGEVERIFY_PICKUP_DELIVERY ?? "delivery-3";

const outDir = resolve(process.cwd(), "screenshots");
mkdirSync(outDir, { recursive: true });
const authState = resolve(process.cwd(), "playwright/.auth/state.json");
loadEnvLocal();

const pickRowSelector =
  "button.w-full.rounded-xl.border.border-border.bg-bg-surface.px-3.py-3.text-left";

async function waitForDoneEnabled(page, timeoutMs = 30_000) {
  await page.waitForFunction(
    () => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Done — All Picked Up"),
      );
      return btn && !btn.disabled;
    },
    { timeout: timeoutMs },
  );
}

async function runScenarioB(page) {
  console.log("Scenario B: Report Issue…");
  const reportBtn = page.getByTestId("report-issue-btn").first();
  const visible = await reportBtn
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!visible) {
    throw new Error(
      "Scenario B FAIL: no Report Issue button. Run npm run reset:pickup-verify first.",
    );
  }

  await reportBtn.click();

  await page.getByTestId("issue-type-select").selectOption("missing");
  await page.getByTestId("issue-description").fill("Playwright verify — missing item");
  await page.getByTestId("issue-submit").click();

  const success = page.getByText(/Issue reported|already recorded/i);
  const modalError = page.locator(".text-accent-red").last();
  const outcome = await Promise.race([
    success.waitFor({ state: "visible", timeout: 20_000 }).then(() => "success"),
    modalError
      .waitFor({ state: "visible", timeout: 20_000 })
      .then(async () => {
        const text = (await modalError.textContent()) ?? "";
        if (text.includes("Cannot report an issue while delivery status")) {
          return "skip";
        }
        throw new Error(text || "Issue report failed");
      }),
  ]);

  if (outcome === "skip") {
    await page.getByRole("button", { name: "Cancel" }).click();
    throw new Error("Scenario B FAIL: delivery not eligible for issue report.");
  }

  await page.getByTestId("blocking-issue-warning").waitFor({
    state: "visible",
    timeout: 10_000,
  });
  await page.screenshot({
    path: resolve(outDir, "pickup-verify-issue-reported.png"),
    fullPage: true,
  });
  console.log("Scenario B PASS: issue reported + blocking warning visible.");
}

async function runScenarioA(page) {
  console.log("Scenario A: pickup completion…");
  const rows = page.locator(pickRowSelector);
  const rowCount = await rows.count();
  console.log(`Clicking ${rowCount} pick-list row(s)…`);
  for (let i = 0; i < rowCount; i++) {
    await rows.nth(i).click();
    await page.waitForTimeout(150);
  }

  await waitForDoneEnabled(page);
  await page.getByRole("button", { name: /Done — All Picked Up/ }).click();

  const errorBanner = page.locator(
    "text=/Failed to record|permission denied|Cannot record pickup/i",
  );
  const errorVisible = await errorBanner
    .first()
    .isVisible({ timeout: 3_000 })
    .catch(() => false);
  if (errorVisible) {
    const msg = await errorBanner.first().textContent();
    throw new Error(msg?.trim() ?? "Pickup error banner shown");
  }

  await page.waitForSelector("text=All Items Picked Up!", { timeout: 20_000 });
  await page.screenshot({
    path: resolve(outDir, "pickup-verify-after.png"),
    fullPage: true,
  });
  console.log("Scenario A PASS: All Items Picked Up! screen shown.");
}

async function runDashboardBadgeCheck(browser) {
  if (!existsSync(authState)) {
    console.log("SKIP dashboard badge: no playwright/.auth/state.json");
    return;
  }

  console.log("Dashboard: open-issue badge…");
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    storageState: authState,
  });
  const page = await context.newPage();
  await ensureAuthenticated(page, appBase);
  await openDeliveryDrawer(page, "ORD-004", deliveryId);

  const badge = page.getByTestId(`open-issue-badge-${deliveryId}`);
  await badge.waitFor({ state: "visible", timeout: 20_000 });
  await page.screenshot({
    path: resolve(outDir, "pickup-verify-dashboard-badge.png"),
    fullPage: true,
  });
  await context.close();
  console.log("Dashboard PASS: open-issue badge visible.");
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const page = await context.newPage();

  const url = `${appBase}/#/pickup?job=${jobId}&delivery=${deliveryId}`;
  console.log(`Opening ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });

  await page.waitForSelector("text=Mark off items as you pick them up", {
    timeout: 30_000,
  });
  try {
    await page.waitForSelector("text=Staging:", { timeout: 30_000 });
  } catch {
    const bodyText = await page.locator("body").innerText();
    await page.screenshot({
      path: resolve(outDir, "pickup-verify-load-fail.png"),
      fullPage: true,
    });
    console.error("FAIL: Pickup list did not load. Page text:\n", bodyText.slice(0, 800));
    await browser.close();
    process.exit(1);
  }

  const empty = await page
    .getByText("No pickup-ready deliveries", { exact: false })
    .isVisible()
    .catch(() => false);
  if (empty) {
    console.error(
      "FAIL: No pickup-ready deliveries for this job. Stage delivery first (ready_for_pickup, complete, or partial).",
    );
    await browser.close();
    process.exit(1);
  }

  await page.screenshot({
    path: resolve(outDir, "pickup-verify-before.png"),
    fullPage: true,
  });

  try {
    await runScenarioB(page);
    await runScenarioA(page);
  } catch (err) {
    await page.screenshot({
      path: resolve(outDir, "pickup-verify-fail.png"),
      fullPage: true,
    });
    console.error("FAIL:", err instanceof Error ? err.message : err);
    await context.close();
    await browser.close();
    process.exit(1);
  }

  await context.close();

  try {
    await runDashboardBadgeCheck(browser);
  } catch (err) {
    throw new Error(
      `Dashboard badge FAIL: ${err instanceof Error ? err.message : err}`,
    );
  }

  console.log("PASS: Pickup portal Scenarios A + B complete.");
  await browser.close();
})();

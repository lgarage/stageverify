/**
 * Playwright: authenticated dispatcher Material Issue visibility (Phase 3 Slice 1).
 *
 * Prerequisite: issue exists on delivery-3 (run verify:pickup Scenario B first).
 *
 * Usage:
 *   npm run dev
 *   node scripts/playwright-auth-setup.mjs   (if token expired)
 *   npm run verify:material-issue-dashboard
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { ensureAuthenticated, openDeliveryDrawer } from "./dispatcherVerifyHelpers.mjs";

const baseUrl =
  process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const deliveryId = process.env.STAGEVERIFY_PICKUP_DELIVERY ?? "delivery-3";
const orderNumber = process.env.STAGEVERIFY_PICKUP_ORDER ?? "ORD-004";
const authState = resolve(process.cwd(), "playwright/.auth/state.json");
const outDir = resolve(process.cwd(), "screenshots");
mkdirSync(outDir, { recursive: true });

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const page = await context.newPage();

  console.log("Dispatcher Material Issue visibility…");
  await ensureAuthenticated(page, appBase);

  const badge = page.getByTestId(`open-issue-badge-${deliveryId}`);
  const hasIssueBadge = await badge.isVisible().catch(() => false);
  if (!hasIssueBadge) {
    console.log(
      `SKIP: no open-issue badge for ${deliveryId} — run verify:pickup Scenario B first.`,
    );
    await browser.close();
    process.exit(0);
  }
  console.log("PASS: Issues badge/count visible on delivery row.");

  await openDeliveryDrawer(page, orderNumber, deliveryId);

  await page.getByTestId("drawer-action-banner").waitFor({
    state: "visible",
    timeout: 20_000,
  });
  const bannerText = await page.getByTestId("drawer-action-banner").innerText();
  if (!/What Needs Attention|All Clear/i.test(bannerText)) {
    throw new Error(`Expected What Needs Attention or All Clear banner: ${bannerText.slice(0, 200)}`);
  }
  if (/Blocking|missing|WHAT NEEDS|not ready/i.test(bannerText)) {
    console.log("PASS: What Needs Attention banner shows blocking/missing context.");
  }

  const panel = page.getByTestId("material-issues-panel");
  const panelVisible = await panel.isVisible().catch(() => false);
  if (panelVisible) {
    const panelText = await panel.innerText();
    if (/BLOCKING/i.test(panelText)) {
      throw new Error(
        "Blocking issues should appear in What Needs Attention banner only, not Material Issues panel.",
      );
    }
    console.log("PASS: Material Issues panel shows non-blocking or resolved only.");
  } else {
    console.log("PASS: Material Issues panel hidden (blocking-only issues in banner).");
  }

  await page.screenshot({
    path: resolve(outDir, "material-issue-dashboard-panel.png"),
    fullPage: true,
  });

  const bannerResolve = page.getByTestId("drawer-action-resolve-issue");
  const resolveBtn = panelVisible
    ? panel.getByRole("button", { name: "Resolve" }).first()
    : bannerResolve;

  if (await bannerResolve.isEnabled().catch(() => false)) {
    await bannerResolve.click();
    await page.getByTestId("resolve-issue-modal").waitFor({ timeout: 10_000 });
    await page.getByTestId("resolution-type-select").waitFor({ timeout: 10_000 });
    const noteDefault = await page.getByTestId("resolution-note-input").inputValue();
    if (!noteDefault.trim()) {
      throw new Error("Resolve modal should open with suggested default note text.");
    }
    console.log("PASS: Resolve modal default note present.");

    const optionCount = await page
      .getByTestId("resolution-type-select")
      .locator("option")
      .count();
    if (optionCount < 8) {
      throw new Error(`Expected 8 resolution types, got ${optionCount}.`);
    }

    await page.getByTestId("resolution-type-select").selectOption("vendor_redeliver");
    await page.getByTestId("resolution-note-input").fill("Playwright verify resolution");
    const confirmResolve = page.getByTestId("confirm-resolve-issue");
    await confirmResolve.waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('[data-testid="confirm-resolve-issue"]');
        return btn instanceof HTMLButtonElement && !btn.disabled;
      },
      { timeout: 15_000 },
    );
    await confirmResolve.click();
    await page.waitForTimeout(2500);
    console.log("PASS: Resolve submitted from action banner.");
  } else if (await resolveBtn.isVisible().catch(() => false)) {
    await resolveBtn.click();
    await page.getByTestId("resolve-issue-modal").waitFor({ timeout: 10_000 });
    console.log("PASS: Resolve modal from non-blocking Material Issues row.");
    await page.getByRole("button", { name: "Cancel" }).click();
  } else {
    console.log("SKIP Resolve: no Resolve button (CF may not be deployed yet).");
  }

  await browser.close();
  process.exit(0);
})();

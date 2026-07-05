/**
 * Watchable headed clickthrough audit — slow enough for Dan to follow in Chrome.
 *
 * Usage:
 *   npm run audit:watch-clickthrough
 *
 * Step-through (Playwright Inspector):
 *   set PWDEBUG=1&& node scripts/audit-watch-clickthrough.mjs
 *
 * Auth: playwright/.auth/state.json — refresh with:
 *   node scripts/playwright-auth-setup.mjs
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  ensureAuthenticated,
  loadEnvLocal,
  assertDeliveryDrawerOpen,
  logDeliveryTableDiagnostics,
} from "./dispatcherVerifyHelpers.mjs";

const baseUrl =
  process.env.STAGEVERIFY_BASE_URL ?? "https://lgarage.github.io/stageverify";
const appBase = resolveAppBase(baseUrl);
const authState = resolve(process.cwd(), "playwright/.auth/state.json");
const outDir = resolve(process.cwd(), "screenshots/audit-watch");
const SCREENSHOT_PAUSE_MS = 2000;
const HOLD_OPEN_MS = 120_000;
const SLOW_MO_MS = 1200;

loadEnvLocal();
mkdirSync(outDir, { recursive: true });

let headedMode = true;

function logUrl(page) {
  console.log(`    URL: ${page.url()}`);
}

async function clickWithLog(page, description, clickFn) {
  console.log(`>>> CLICK: ${description}`);
  logUrl(page);
  await clickFn();
}

async function pauseAfterScreenshot(page, ms = SCREENSHOT_PAUSE_MS) {
  await page.waitForTimeout(ms);
}

async function shot(page, name) {
  const path = resolve(outDir, name);
  await page.screenshot({ path, fullPage: false });
  console.log(`  screenshot: ${path}`);
  await pauseAfterScreenshot(page);
  return path;
}

async function tryOpenDrawerForOrder(page, orderNumber) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  const search = page.locator('input[placeholder*="Job #, name, PO"]');
  await search.waitFor({ state: "visible", timeout: 15000 });
  await search.fill("");
  await search.fill(orderNumber);
  await page.waitForTimeout(1500);

  const rowCount = await page.locator("table tbody tr").count();
  const orderRow = page
    .locator("table tbody tr", { hasText: orderNumber })
    .first();
  const rowVisible = await orderRow.isVisible().catch(() => false);
  const viewBtn = orderRow.locator("button").filter({ hasText: /^View$/ });
  const hasView = await viewBtn.isVisible().catch(() => false);

  let drawerOk = false;
  let drawerError = null;

  try {
    if (hasView) {
      await clickWithLog(page, `View button for ${orderNumber}`, () =>
        viewBtn.click({ force: true }),
      );
    } else if (rowVisible) {
      await clickWithLog(page, `Delivery row for ${orderNumber}`, () =>
        orderRow.click({ force: true }),
      );
    } else {
      drawerError = `No row for ${orderNumber} (rows=${rowCount})`;
    }

    if (!drawerError) {
      await page.waitForTimeout(1200);
      try {
        await assertDeliveryDrawerOpen(page);
        drawerOk = true;
        console.log(`  drawer opened for ${orderNumber}`);
      } catch (e) {
        drawerError = e instanceof Error ? e.message : String(e);
        console.log(`  drawer issue for ${orderNumber}: ${drawerError}`);
      }
    }
  } catch (e) {
    drawerError = e instanceof Error ? e.message : String(e);
    console.log(`  click failed for ${orderNumber}: ${drawerError}`);
  }

  return { rowCount, rowVisible, hasView, drawerOk, drawerError };
}

async function launchBrowser() {
  const launchOpts = {
    headless: false,
    slowMo: SLOW_MO_MS,
    args: ["--start-maximized"],
  };
  try {
    headedMode = true;
    return await chromium.launch(launchOpts);
  } catch (err) {
    console.warn(
      "Headed launch failed, headless fallback:",
      err instanceof Error ? err.message : err,
    );
    headedMode = false;
    return chromium.launch({
      headless: true,
      slowMo: SLOW_MO_MS,
    });
  }
}

(async () => {
  if (!existsSync(authState)) {
    console.error(
      "Missing playwright/.auth/state.json — run: node scripts/playwright-auth-setup.mjs",
    );
    process.exit(1);
  }

  if (process.env.PWDEBUG) {
    console.log(
      "PWDEBUG=1 — Playwright Inspector step-through enabled (pause/resume in UI).",
    );
  }

  const browser = await launchBrowser();
  const context = await browser.newContext({
    storageState: authState,
    viewport: null,
  });
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.log(`[console.error] ${msg.text().slice(0, 300)}`);
    }
  });
  page.on("pageerror", (err) => {
    console.log(`[pageerror] ${(err.message ?? String(err)).slice(0, 300)}`);
  });

  console.log(`\nWatch clickthrough: ${appBase}`);
  console.log(`headed=${headedMode} slowMo=${SLOW_MO_MS}ms hold=${HOLD_OPEN_MS / 1000}s\n`);

  const authOutcome = await ensureAuthenticated(page, appBase);
  if (authOutcome === "login-success") {
    console.log("Auth state expired — re-run: node scripts/playwright-auth-setup.mjs");
  }

  await page
    .getByRole("heading", { name: "Delivery Overview" })
    .waitFor({ timeout: 30000 });
  await logDeliveryTableDiagnostics(page, { authOutcome });
  console.log(">>> STEP: Dispatcher dashboard (landing)");
  logUrl(page);
  await shot(page, "01-dispatcher-dashboard.png");

  const nav = page.locator("aside");

  await clickWithLog(page, "Settings (sidebar)", () =>
    nav.getByRole("link", { name: "Settings", exact: true }).click(),
  );
  await page.waitForTimeout(800);
  await shot(page, "02-settings-landing.png");

  await clickWithLog(page, "Vendors (sidebar — show emailDomain)", () =>
    nav.getByRole("link", { name: "Vendors", exact: true }).click(),
  );
  await page
    .getByRole("heading", { name: "Vendors", exact: true })
    .waitFor({ timeout: 15000 });

  const editBtn = page.getByRole("button", { name: /^Edit$/i }).first();
  const addDomain = page.getByTestId("add-vendor-email-domain");
  if (await editBtn.isVisible().catch(() => false)) {
    await clickWithLog(page, "Edit first vendor (emailDomain field)", () =>
      editBtn.click(),
    );
    await page.waitForTimeout(800);
    const domainField = (await addDomain.isVisible().catch(() => false))
      ? addDomain
      : page.locator('input[placeholder*="domain" i]').first();
    const domainVisible = await domainField.isVisible().catch(() => false);
    console.log(
      domainVisible
        ? "  emailDomain field visible"
        : "  emailDomain field not found after Edit",
    );
  } else {
    const colVisible = await page
      .getByRole("columnheader", { name: "Email Domain", exact: true })
      .isVisible()
      .catch(() => false);
    console.log(
      colVisible
        ? "  Email Domain column visible in vendors table"
        : "  No Edit button or Email Domain column",
    );
  }
  await shot(page, "03-vendors-emailDomain.png");

  await clickWithLog(page, "Dispatcher Dashboard (return to deliveries)", () =>
    nav.getByRole("link", { name: "Dispatcher Dashboard", exact: true }).click(),
  );
  await page
    .getByRole("heading", { name: "Delivery Overview" })
    .waitFor({ timeout: 15000 });
  await shot(page, "04-dispatcher-deliveries.png");

  console.log(">>> STEP: Search ORD-005 and open drawer");
  const ord005 = await tryOpenDrawerForOrder(page, "ORD-005");
  await shot(page, "05-ord005-drawer.png");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  console.log(">>> STEP: Search ORD-001 for comparison");
  const ord001 = await tryOpenDrawerForOrder(page, "ORD-001");
  await shot(page, "06-ord001-drawer.png");

  console.log("\n=== CLICKTHROUGH SUMMARY ===");
  console.log(`Headed Chrome: ${headedMode}`);
  console.log(`First URL: ${appBase}/#/dispatcher`);
  console.log(`slowMo: ${SLOW_MO_MS}ms between actions`);
  console.log(`ORD-005 drawer: ${ord005.drawerOk ? "opened" : ord005.drawerError ?? "failed"}`);
  console.log(`ORD-001 drawer: ${ord001.drawerOk ? "opened" : ord001.drawerError ?? "failed"}`);
  console.log(`Screenshots: ${outDir}`);
  console.log(
    `\nBrowser staying open ${HOLD_OPEN_MS / 1000}s for Dan to watch — close manually or wait`,
  );

  try {
    await page.waitForTimeout(HOLD_OPEN_MS);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/closed|target/i.test(msg)) {
      console.log("Browser closed during hold — OK.");
    } else {
      throw e;
    }
  }

  try {
    await browser.close();
  } catch {
    /* already closed manually */
  }
  console.log("Browser closed.");
})().catch((err) => {
  console.error("WATCH CLICKTHROUGH FAIL:", err.message ?? err);
  process.exit(1);
});

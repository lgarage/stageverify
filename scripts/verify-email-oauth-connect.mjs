/**
 * Playwright: Phase 6 slice 1–2 — Gmail OAuth gates + Email Vendor enabled when connected.
 *
 * Usage:
 *   npm run dev
 *   node scripts/playwright-auth-setup.mjs   (if token expired)
 *   npm run verify:email-oauth-connect
 *
 * Connected-state copy uses seed-email-oauth-fixture.mjs (ADC) when available.
 */

import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";

const baseUrl = process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const authState = resolve(process.cwd(), "playwright/.auth/state.json");

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  }
}

const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;

async function ensureAuthenticated(page) {
  await page.goto(`${appBase}/#/settings`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(1500);

  if (!page.url().includes("/login")) return;

  if (!email || !password) {
    throw new Error(
      "Redirected to login — set STAGEVERIFY_TEST_EMAIL/PASSWORD in .env.local",
    );
  }

  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/#\/(settings|dispatcher|hub)/, { timeout: 20_000 });

  if (!page.url().includes("/settings")) {
    await page.goto(`${appBase}/#/settings`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  }
}

function trySeed(status) {
  try {
    execSync(`node scripts/seed-email-oauth-fixture.mjs --status=${status}`, {
      stdio: "pipe",
      encoding: "utf8",
    });
    return true;
  } catch {
    console.warn(
      `SKIP seed --status=${status} (ADC unavailable — connected copy tests skipped)`,
    );
    return false;
  }
}

async function openResolveNeedMoreInfo(page) {
  await page.goto(`${appBase}/#/dispatcher`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.getByRole("heading", { name: "Delivery Overview" }).waitFor({
    timeout: 30_000,
  });

  const search = page.locator('input[placeholder*="Job #, name, PO"]');
  await search.waitFor({ state: "visible", timeout: 30_000 });
  await search.fill("ORD-1007");
  await page.waitForTimeout(1200);

  const viewBtn = page.locator("button").filter({ hasText: /^View$/ }).first();
  if (!(await viewBtn.isVisible().catch(() => false))) {
    await search.fill("");
    await page.waitForTimeout(800);
  }
  await viewBtn.waitFor({ state: "visible", timeout: 30_000 });
  await viewBtn.click();
  await page.waitForTimeout(800);

  const resolveBtn = page.getByTestId("drawer-action-resolve-issue");
  if (!(await resolveBtn.isEnabled().catch(() => false))) {
    return false;
  }
  await resolveBtn.click();
  await page.getByTestId("resolve-issue-modal").waitFor({ timeout: 10_000 });
  await page.getByTestId("resolution-type-select").selectOption("need_more_information");
  await page.getByTestId("resolve-need-more-info-section").waitFor({ timeout: 10_000 });
  return true;
}

async function assertEmailVendorDisabledWhenDisconnected(page) {
  const opened = await openResolveNeedMoreInfo(page);
  if (!opened) {
    console.log("SKIP resolve modal — no open issue on ORD-1007");
    return;
  }
  const emailVendorBtn = page.getByTestId("resolve-email-vendor");
  if (await emailVendorBtn.isEnabled()) {
    throw new Error("Email Vendor must stay disabled when Gmail OAuth disconnected");
  }
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(300);
}

async function assertEmailVendorEnabledWhenConnected(page) {
  const opened = await openResolveNeedMoreInfo(page);
  if (!opened) {
    console.log("SKIP connected Email Vendor enable — no open issue on ORD-1007");
    return;
  }
  const emailVendorBtn = page.getByTestId("resolve-email-vendor");
  const vendorEmail = await page.getByTestId("resolve-vendor-email").innerText();
  const hasVendorEmail = vendorEmail.includes("@");
  if (hasVendorEmail && !(await emailVendorBtn.isEnabled())) {
    throw new Error("Email Vendor must be enabled when OAuth connected and vendor email on file");
  }
  if (!hasVendorEmail && (await emailVendorBtn.isEnabled())) {
    throw new Error("Email Vendor must stay disabled when vendor has no email");
  }
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(300);
}

(async () => {
  trySeed("disconnected");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const page = await context.newPage();

  console.log("Settings: disconnected default + monitoring separate from OAuth…");
  await ensureAuthenticated(page);
  await page.getByText("Email Monitoring", { exact: true }).first().waitFor({
    timeout: 15_000,
  });

  const badge = page.getByTestId("gmail-oauth-status-badge");
  await badge.waitFor({ timeout: 15_000 });
  const statusAttr = await badge.getAttribute("data-status");
  if (statusAttr !== "disconnected") {
    throw new Error(`Expected disconnected Gmail badge, got data-status=${statusAttr}`);
  }
  await page.getByTestId("gmail-oauth-connect").waitFor({ timeout: 10_000 });

  const probeEmail = "verify-oauth-inbox@stageverify.test";
  await page.getByTestId("monitoring-inbox-email").fill(probeEmail);
  await page.getByTestId("email-monitoring-enabled").check();
  await page.getByTestId("save-email-settings").click();
  await page.getByTestId("email-settings-saved").waitFor({ timeout: 15_000 });

  console.log("Monitoring enabled — Email Vendor must remain disabled…");
  await assertEmailVendorDisabledWhenDisconnected(page);

  await page.goto(`${appBase}/#/settings`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.getByTestId("gmail-oauth-status-badge").waitFor({ timeout: 15_000 });
  const statusAfterMonitoring = await page
    .getByTestId("gmail-oauth-status-badge")
    .getAttribute("data-status");
  if (statusAfterMonitoring === "connected") {
    throw new Error("monitoringInboxEmail + emailMonitoringEnabled must NOT imply connected");
  }

  const seededConnected = trySeed("connected");
  if (seededConnected) {
    console.log("Connected fixture — badge + Vendor Communications copy…");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("gmail-oauth-status-badge").waitFor({ timeout: 15_000 });
    await page.waitForTimeout(800);
    const connectedStatus = await page
      .getByTestId("gmail-oauth-status-badge")
      .getAttribute("data-status");
    if (connectedStatus !== "connected") {
      throw new Error(`Expected connected badge after seed, got ${connectedStatus}`);
    }
    await page.getByTestId("gmail-connected-account").waitFor({ timeout: 10_000 });
    await page.getByTestId("gmail-oauth-disconnect").waitFor({ timeout: 10_000 });

    await page.goto(`${appBase}/#/dispatcher`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.getByRole("heading", { name: "Delivery Overview" }).waitFor({
      timeout: 30_000,
    });
    const search = page.locator('input[placeholder*="Job #, name, PO"]');
    await search.fill("ORD-1007");
    await page.waitForTimeout(1200);
    const viewBtn = page.locator("button").filter({ hasText: /^View$/ }).first();
    await viewBtn.waitFor({ state: "visible", timeout: 30_000 });
    await viewBtn.click();
    await page.waitForTimeout(800);
    await page.getByTestId("vendor-communications-toggle").click();
    await page.getByTestId("vendor-communications-empty").waitFor({ timeout: 10_000 });
    const connectedEmpty = await page.getByTestId("vendor-communications-empty").innerText();
    if (!/No outbound messages yet/i.test(connectedEmpty)) {
      throw new Error(`Connected empty copy unexpected: ${connectedEmpty}`);
    }
    const dataConnected = await page
      .getByTestId("vendor-communications-empty")
      .getAttribute("data-connected");
    if (dataConnected !== "true") {
      throw new Error("vendor-communications-empty data-connected should be true");
    }

    console.log("Connected — Email Vendor enabled when vendor email on file…");
    await assertEmailVendorEnabledWhenConnected(page);
    trySeed("disconnected");
  }

  await browser.close();
  console.log("verify:email-oauth-connect PASS");
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

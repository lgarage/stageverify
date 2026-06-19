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

async function ensureAuthenticated(page) {
  await page.goto(`${appBase}/#/dispatcher`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(1500);
  if (!page.url().includes("/login")) return;

  const email = process.env.STAGEVERIFY_TEST_EMAIL;
  const password = process.env.STAGEVERIFY_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Redirected to login — set STAGEVERIFY_TEST_EMAIL/PASSWORD in .env.local or refresh playwright auth.",
    );
  }
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/#\/(dispatcher|settings|hub|zones|vendors)/, {
    timeout: 20_000,
  });
  if (!page.url().includes("/dispatcher")) {
    await page.goto(`${appBase}/#/dispatcher`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
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
  await ensureAuthenticated(page);

  const search = page.locator(
    'input[placeholder*="Job #, name, PO"]',
  );
  await search.waitFor({ state: "visible", timeout: 15_000 });
  await search.fill(orderNumber);
  await page.waitForTimeout(1500);

  const badge = page.getByTestId(`open-issue-badge-${deliveryId}`);
  await badge.waitFor({ state: "visible", timeout: 20_000 });
  console.log("PASS: Issues badge/count visible on delivery row.");

  const viewBtn = page
    .locator("button")
    .filter({ hasText: /^View$|^Open$|^Details$/ })
    .first();
  const row = page.locator("tr").filter({ has: badge }).first();
  if (await row.isVisible().catch(() => false)) {
    await row.click();
  } else {
    await viewBtn.click();
  }
  await page.waitForTimeout(1500);

  const panel = page.getByTestId("material-issues-panel");
  await panel.waitFor({ state: "visible", timeout: 20_000 });

  await page.getByText("Material Issues", { exact: false }).first().waitFor({
    state: "visible",
    timeout: 10_000,
  });

  const panelText = await panel.innerText();
  const required = ["Missing", "Technician", "Playwright verify"];
  for (const fragment of required) {
    if (!panelText.includes(fragment)) {
      throw new Error(
        `Material Issues panel missing "${fragment}". Panel text:\n${panelText.slice(0, 500)}`,
      );
    }
  }
  if (
    !panelText.includes("Dispatch Lead") &&
    !panelText.includes("Unassigned")
  ) {
    throw new Error(
      `Material Issues panel missing owner. Panel text:\n${panelText.slice(0, 500)}`,
    );
  }
  if (!panelText.match(/Blocking|open|assigned|Assigned/i)) {
    throw new Error(
      `Material Issues panel missing status/blocking label. Panel text:\n${panelText.slice(0, 500)}`,
    );
  }

  await page.screenshot({
    path: resolve(outDir, "material-issue-dashboard-panel.png"),
    fullPage: true,
  });

  console.log("PASS: Material Issues read-only panel shows type, status, description, reporter, owner.");

  const resolveBtn = panel.getByRole("button", { name: "Resolve" }).first();
  if (await resolveBtn.isVisible().catch(() => false)) {
    await resolveBtn.click();
    await page.getByTestId("resolve-issue-modal").waitFor({ timeout: 10_000 });
    await page.getByTestId("resolution-type-select").waitFor({ timeout: 10_000 });
    const optionCount = await page
      .getByTestId("resolution-type-select")
      .locator("option")
      .count();
    if (optionCount < 8) {
      throw new Error(`Expected 8 resolution types, got ${optionCount}.`);
    }
    console.log("PASS: Resolve modal shows resolution-type picker (8 types).");

    const beforeCount = await panel.getByRole("button", { name: "Resolve" }).count();
    await page.getByTestId("resolution-type-select").selectOption("vendor_redeliver");
    await page.getByTestId("resolution-note-input").fill("Playwright verify resolution");
    await page.getByTestId("confirm-resolve-issue").click();
    await page.waitForTimeout(3000);
    const afterCount = await panel.getByRole("button", { name: "Resolve" }).count();
    if (afterCount >= beforeCount) {
      throw new Error(
        `Resolve FAIL: expected fewer open issues (${beforeCount} → ${afterCount}).`,
      );
    }
    console.log(`PASS: Resolve with type picker (${beforeCount} → ${afterCount}).`);
  } else {
    console.log("SKIP Resolve: no Resolve button (CF may not be deployed yet).");
  }

  await browser.close();
})();

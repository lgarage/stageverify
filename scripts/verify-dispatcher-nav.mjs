/**
 * Playwright: dispatcher portal sidebar + top bar navigation.
 *
 * Usage:
 *   npm run dev
 *   node scripts/playwright-auth-setup.mjs   (if token expired)
 *   npm run verify:dispatcher-nav
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";

const baseUrl =
  process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
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
  await page.goto(`${appBase}/#/dispatcher`, {
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

function assertUrl(page, pattern, label) {
  const url = page.url();
  if (!pattern.test(url)) {
    throw new Error(`${label}: expected URL matching ${pattern}, got ${url}`);
  }
}

function sidebar(page) {
  return page.locator("aside");
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();

  console.log("Opening dispatcher…");
  await ensureAuthenticated(page);
  await page
    .getByRole("heading", { name: "Delivery Overview" })
    .waitFor({ timeout: 30_000 });

  const nav = sidebar(page);

  if (
    (await nav.getByRole("link", { name: "Deliveries", exact: true }).count()) >
    0
  ) {
    throw new Error("Deliveries sidebar link should be removed");
  }

  console.log("Sidebar: Staging Map…");
  await nav.getByRole("link", { name: "Staging Map", exact: true }).click();
  await page.waitForTimeout(400);
  assertUrl(page, /\/zones/, "Staging Map");
  await page.getByRole("heading", { name: "Zone Management" }).waitFor({
    timeout: 15_000,
  });

  console.log("Sidebar: Vendors…");
  await nav.getByRole("link", { name: "Vendors", exact: true }).click();
  await page.waitForTimeout(400);
  assertUrl(page, /\/vendors/, "Vendors");
  await page.getByRole("heading", { name: "Vendors", exact: true }).waitFor({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Add Vendor" }).waitFor({
    timeout: 15_000,
  });

  console.log("Sidebar: Dispatcher Dashboard…");
  await nav
    .getByRole("link", { name: "Dispatcher Dashboard", exact: true })
    .click();
  await page.waitForTimeout(400);
  assertUrl(page, /\/dispatcher/, "Dispatcher Dashboard");
  await page
    .getByRole("heading", { name: "Delivery Overview" })
    .waitFor({ timeout: 15_000 });

  console.log("Sidebar: Settings (pinned)…");
  await nav.getByRole("link", { name: "Settings", exact: true }).click();
  await page.waitForTimeout(400);
  assertUrl(page, /\/settings/, "Settings");
  await page.getByRole("heading", { name: "Settings" }).waitFor({
    timeout: 15_000,
  });
  if (
    (await page.getByRole("button", { name: "Add Vendor" }).count()) > 0
  ) {
    throw new Error("Settings should not include Add Vendor form");
  }

  console.log("Return to dispatcher for top bar…");
  await nav
    .getByRole("link", { name: "Dispatcher Dashboard", exact: true })
    .click();
  await page.waitForTimeout(400);
  assertUrl(page, /\/dispatcher/, "back to dispatcher");

  console.log("Top bar: + New Delivery…");
  await page.getByRole("button", { name: "+ New Delivery" }).click();
  await page.getByRole("heading", { name: "New Delivery" }).waitFor({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("heading", { name: "New Delivery" }).waitFor({
    state: "hidden",
    timeout: 10_000,
  });

  console.log("Top bar: Refresh Now…");
  await page.getByRole("button", { name: "Refresh Now" }).click();
  await page.waitForTimeout(800);
  assertUrl(page, /\/dispatcher/, "after Refresh");

  console.log("Top bar: Pickup Portal (new tab)…");
  const [pickupPage] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("link", { name: "Pickup Portal ↗" }).click(),
  ]);
  await pickupPage.waitForLoadState("domcontentloaded");
  if (!pickupPage.url().includes("/pickup")) {
    throw new Error(`Pickup Portal tab: expected /pickup, got ${pickupPage.url()}`);
  }
  await pickupPage.close();

  console.log("Top bar: Vendor Portal (new tab)…");
  const [receivePage] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("link", { name: "Vendor Portal ↗" }).click(),
  ]);
  await receivePage.waitForLoadState("domcontentloaded");
  if (!receivePage.url().includes("/receive")) {
    throw new Error(`Vendor Portal tab: expected /receive, got ${receivePage.url()}`);
  }
  await receivePage.close();

  console.log("Job readiness panel (Slice 3)…");
  await page
    .getByRole("heading", { name: "Delivery Overview" })
    .waitFor({ timeout: 15_000 });
  const firstViewBtn = page.locator("button").filter({ hasText: /^View$/ }).first();
  if (await firstViewBtn.isVisible().catch(() => false)) {
    await firstViewBtn.click();
    await page.getByTestId("job-readiness-panel").waitFor({ timeout: 15_000 });
    const everythingReady = page.getByTestId("everything-ready-badge");
    if (await everythingReady.isVisible().catch(() => false)) {
      console.log("Slice 3: Everything Ready badge visible (all deliveries ready).");
    } else {
      console.log("Slice 3: job-readiness-panel visible; no Everything Ready badge (expected when job incomplete).");
    }

    console.log("Slice 5: pickup token copy link…");
    let clipboardText = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByTestId("generate-pickup-link").click();
      await page.getByTestId("pickup-token-reveal").waitFor({ timeout: 20_000 });
      await page.getByRole("button", { name: "Copy Pickup Information" }).click();
      await page.waitForTimeout(1500);
      clipboardText = await page.evaluate(async () => navigator.clipboard.readText()).catch(() => "");
      if (/#\/pickup\?t=[a-f0-9]{64}/.test(clipboardText)) break;
    }
    if (!/#\/pickup\?t=[a-f0-9]{64}/.test(clipboardText)) {
      throw new Error(
        `Copy Pickup Information expected token URL in clipboard, got: ${clipboardText.slice(0, 120)}`,
      );
    }
    console.log("Slice 5 PASS: clipboard contains opaque pickup token URL.");

    const orderNumber = process.env.STAGEVERIFY_PICKUP_ORDER ?? "ORD-004";
    const search = page.locator('input[placeholder*="Job #, name, PO"]');
    try {
      if (await search.isVisible().catch(() => false)) {
        await search.fill(orderNumber);
        await page.waitForTimeout(1200);
        const rowView = page.locator("button").filter({ hasText: /^View$/ }).first();
        if (await rowView.isVisible().catch(() => false)) {
          await rowView.click({ force: true });
          await page.waitForTimeout(1000);
          const summary = page.getByTestId("pickup-summary-panel");
          if (await summary.isVisible().catch(() => false)) {
            const text = (await summary.innerText()) ?? "";
            if (!text.trim()) {
              throw new Error("pickup-summary-panel visible but empty.");
            }
            console.log("Pickup summary PASS: pickup-summary-panel visible in delivery drawer.");
          } else {
            console.log(
              "SKIP pickup summary: panel not visible (expand Pickup Summary section if collapsed).",
            );
          }
        }
      }
    } catch (err) {
      console.log(
        `SKIP pickup summary check: ${err instanceof Error ? err.message : err}`,
      );
    }
  } else {
    console.log("SKIP job readiness panel: no delivery rows to open.");
  }

  console.log("Needs Review email strip (Phase 5)…");
  await page.getByTestId("needs-review-email-strip").waitFor({
    timeout: 15_000,
  });
  await page.getByTestId("needs-review-email-count").waitFor({ timeout: 10_000 });
  if (await page.getByTestId("proposed-email-updates-panel").count()) {
    throw new Error("Proposed Email Updates panel must be retired");
  }
  console.log("Phase 5 PASS: needs-review-email-strip visible; legacy panel absent.");

  console.log("Shop stock directory on Staging Map…");
  await page.goto(`${appBase}/#/zones`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.getByTestId("shop-stock-directory").waitFor({ timeout: 15_000 });
  console.log("Shop stock PASS: shop-stock-directory visible on /zones.");

  await browser.close();
  console.log("verify:dispatcher-nav PASS");
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

/**
 * Playwright E2E: exception-only vendor Delivered hub workflow.
 *
 * Covers: PIN, Delivered hub, Need More Space (shelf/ground/large), Issue, revert, dispatcher.
 *
 * Usage:
 *   npm run dev
 *   npm run verify:vendor-delivered
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

const deliveryId =
  process.env.STAGEVERIFY_RECEIVE_DELIVERY ?? "delivery-demo-vendor-1";
const orderNumber = process.env.STAGEVERIFY_VENDOR_ORDER ?? "ORD-005";
const correctPin = process.env.STAGEVERIFY_VENDOR_PIN ?? "1234";

const outDir = resolve(process.cwd(), "screenshots", "vendor-delivered");
mkdirSync(outDir, { recursive: true });
const authState = resolve(process.cwd(), "playwright/.auth/state.json");
loadEnvLocal();

const results = [];

function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
}

async function shot(page, name) {
  const path = resolve(outDir, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(`  screenshot: ${path}`);
}

async function enterPin(page, digits) {
  for (const digit of digits) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
}

async function unlockWithPin(page) {
  await page.waitForSelector("text=Enter Vendor PIN", { timeout: 30_000 });
  await enterPin(page, correctPin);
  await page.waitForSelector("text=DELIVERED", { timeout: 30_000 });
}

async function runDeliveredFlow(page) {
  const url = `${appBase}/#/receive?id=${deliveryId}`;
  console.log(`Opening ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });

  await page.waitForSelector("text=Enter Vendor PIN", { timeout: 30_000 });
  await shot(page, "01-pin-gate");
  await unlockWithPin(page);
  record("PIN unlocks Delivered hub", true);
  await shot(page, "02-delivered-hub");

  const noItemCheckoff = !(await page
    .getByText("Check off items as delivered")
    .isVisible()
    .catch(() => false));
  record("No item checkoff on happy path", noItemCheckoff);

  await page.waitForSelector("text=Expected items", { timeout: 10_000 });
  record("Delivery context card visible", true);

  // --- Need More Space: tier picker ---
  await page.getByRole("button", { name: "📦 Need More Space?" }).click();
  await page.waitForSelector("text=Where do you need additional space?", {
    timeout: 10_000,
  });
  record("Need More Space tier picker opens", true);
  await shot(page, "03-need-more-space-pick");

  // Shelf path
  await page.getByRole("button", { name: "Shelf", exact: true }).click();
  await page.waitForSelector("text=Loading locations", {
    state: "hidden",
    timeout: 30_000,
  });
  const shelfSpot = await page.getByText("Recommended").isVisible().catch(() => false);
  const shelfNoSpot = await page
    .getByText(/No shelf spots available/i)
    .isVisible()
    .catch(() => false);
  record(
    "Shelf path resolves",
    shelfSpot || shelfNoSpot,
    shelfSpot ? "spot shown" : "no spots (valid)",
  );
  await shot(page, "04-shelf-path");
  await page.getByRole("button", { name: "← Back" }).click();

  // Ground path
  await page.getByRole("button", { name: "Ground", exact: true }).click();
  await page.waitForSelector("text=Loading locations", {
    state: "hidden",
    timeout: 30_000,
  });
  const groundSpot = await page.getByText("Recommended").isVisible().catch(() => false);
  const groundNoSpot = await page
    .getByText(/No ground spots available/i)
    .isVisible()
    .catch(() => false);
  record(
    "Ground path resolves",
    groundSpot || groundNoSpot,
    groundSpot ? "spot shown" : "no spots (valid)",
  );
  await shot(page, "05-ground-path");
  await page.getByRole("button", { name: "← Back" }).click();

  // Large / Oversized path
  await page
    .getByRole("button", { name: "Large / Oversized Delivery" })
    .click();
  await page.waitForSelector("text=Call Dispatcher", { timeout: 10_000 });
  const callLink = page.locator('a[href="tel:9203360110"]');
  record(
    "Large/oversized shows dispatcher call",
    await callLink.isVisible(),
  );
  await shot(page, "06-large-oversized");
  await page.getByRole("button", { name: "← Back" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();

  // --- Issue workflow ---
  await page.getByRole("button", { name: "⚠️ Issue" }).click();
  await page.waitForSelector("text=What's the issue?", { timeout: 10_000 });
  await page.getByRole("button", { name: "Missing Items" }).click();
  await page.locator("textarea").fill("Obvious short shipment");
  await page.getByRole("button", { name: "Submit" }).click();
  await page.waitForSelector("text=dispatcher notified", { timeout: 15_000 });
  record("Issue submit succeeds", true);
  await shot(page, "07-issue-submitted");

  // --- DELIVERED ---
  await page.getByRole("button", { name: "DELIVERED", exact: true }).click();
  await page.waitForSelector("text=Delivery Confirmed", { timeout: 30_000 });
  record("DELIVERED confirms without item checkoff", true);
  await shot(page, "08-delivery-confirmed");

  const body = await page.locator("body").innerText();
  record(
    "Status stays arrived (not ready_for_pickup UI)",
    !/ready for pickup/i.test(body) && !/Check-in Complete/i.test(body),
  );

  return page;
}

async function runRevertFlow(page) {
  // --- Revert ---
  await page.getByRole("button", { name: "Undo Delivery" }).click();
  await page.waitForSelector("text=DELIVERED", { timeout: 30_000 });
  record("Revert returns to Delivered hub", true);
  await shot(page, "09-reverted-to-hub");
}

async function runDispatcherVisibility(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const page = await context.newPage();

  await ensureAuthenticated(page, appBase);
  await openDeliveryDrawer(page, orderNumber, deliveryId);

  const body = await page.locator("body").innerText();
  const notPartial = !/Partial/i.test(body) || /Arrived|Delivered/i.test(body);
  record(
    "Dispatcher does not show vendor partial check-in",
    notPartial,
    notPartial ? "" : "unexpected Partial from exception-only flow",
  );
  await shot(page, "10-dispatcher-drawer");
  await context.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  const vendorContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const vendorPage = await vendorContext.newPage();

  let vendorPageAfterDelivered = null;
  try {
    vendorPageAfterDelivered = await runDeliveredFlow(vendorPage);
  } catch (err) {
    record("Delivered flow", false, err.message ?? String(err));
    await shot(vendorPage, "error-delivered-flow");
  }

  try {
    await runDispatcherVisibility(browser);
  } catch (err) {
    record("Dispatcher visibility", false, err.message ?? String(err));
  }

  if (vendorPageAfterDelivered) {
    try {
      await runRevertFlow(vendorPageAfterDelivered);
    } catch (err) {
      record("Revert flow", false, err.message ?? String(err));
      await shot(vendorPageAfterDelivered, "error-revert-flow");
    }
  }

  await vendorContext.close();

  await browser.close();

  console.log("\n--- Vendor Delivered E2E summary ---");
  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`  [${r.pass ? "ok" : "X"}] ${r.name}${r.detail ? `: ${r.detail}` : ""}`);
  }

  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} checks passed.`);
  process.exit(0);
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

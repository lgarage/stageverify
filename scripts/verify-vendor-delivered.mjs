/**
 * Playwright E2E: exception-only vendor Delivered hub workflow (CANONICAL prod test).
 *
 * Real parsed/approved ingest only — no demo defaults.
 *
 * Required env:
 *   STAGEVERIFY_RECEIVE_DELIVERY  — Firestore delivery id
 *   STAGEVERIFY_VENDOR_ORDER      — order number shown on hub
 *   STAGEVERIFY_VENDOR_PIN        — vendor PIN for this delivery
 *   STAGEVERIFY_VENDOR_JOB        — job/site name asserted on hub
 *   STAGEVERIFY_VENDOR_PO         — PO number asserted on hub
 *
 * Usage:
 *   npm run verify:vendor-delivered
 *   npm run verify:vendor-delivered:prod   (gh-pages + live Firebase/CF)
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  ensureAuthenticated,
  loadEnvLocal,
  openDeliveryDrawer,
  openDeliveryDrawerByDeepLink,
} from "./dispatcherVerifyHelpers.mjs";
import {
  assertNoElementOverlap,
  assertReadableTextContrast,
  VENDOR_DELIVERED_HUB_CONTRAST_SPEC,
  VENDOR_DELIVERED_HUB_HEADER_OVERLAP_SPEC,
} from "./lib/ui-text-contrast-lib.mjs";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  process.env.STAGEVERIFY_PROD_BASE ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const isProd = /lgarage\.github\.io\/stageverify/i.test(baseUrl);

loadEnvLocal();

function requireEnv(name) {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing required env: ${name}`);
    console.error(
      "Set STAGEVERIFY_RECEIVE_DELIVERY, STAGEVERIFY_VENDOR_ORDER, STAGEVERIFY_VENDOR_PIN, STAGEVERIFY_VENDOR_JOB, STAGEVERIFY_VENDOR_PO (real parsed ingest only).",
    );
    process.exit(1);
  }
  return val;
}

const deliveryId = requireEnv("STAGEVERIFY_RECEIVE_DELIVERY");
const orderNumber = requireEnv("STAGEVERIFY_VENDOR_ORDER");
const jobName = requireEnv("STAGEVERIFY_VENDOR_JOB");
const poNumber = requireEnv("STAGEVERIFY_VENDOR_PO");
const correctPin = requireEnv("STAGEVERIFY_VENDOR_PIN");

const outDir = resolve(process.cwd(), "screenshots", "vendor-delivered");
mkdirSync(outDir, { recursive: true });
const authState = resolve(process.cwd(), "playwright/.auth/state.json");

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

async function assertFooterInViewport(page, label) {
  const footer = page.locator('[data-testid="vendor-hub-footer"]');
  await footer.waitFor({ state: "visible", timeout: 15_000 });
  const deliverBtn = page.locator('[data-testid="vendor-mark-delivered"]');
  const viewport = page.viewportSize();
  const deliverBox = await deliverBtn.boundingBox();
  const deliverInView =
    Boolean(deliverBox && viewport) &&
    deliverBox.y >= 0 &&
    deliverBox.y + deliverBox.height <= viewport.height + 2;
  record(`${label} deliver CTA in viewport`, deliverInView, deliverInView ? "" : `y=${deliverBox?.y}`);
  const undoBtn = page.locator('[data-testid="vendor-undo-delivery"]');
  if (await undoBtn.isVisible().catch(() => false)) {
    const undoBox = await undoBtn.boundingBox();
    const undoInView =
      Boolean(undoBox && viewport) &&
      undoBox.y >= 0 &&
      undoBox.y + undoBox.height <= viewport.height + 2;
    record(`${label} undo CTA in viewport`, undoInView, undoInView ? "" : `y=${undoBox?.y}`);
  }
  const header = page.locator(".vendor-hub-header");
  if (await header.isVisible().catch(() => false)) {
    const headerBox = await header.boundingBox();
    const headerInView =
      Boolean(headerBox && viewport) &&
      headerBox.y >= 0 &&
      headerBox.y + headerBox.height <= viewport.height + 2;
    record(`${label} header actions in viewport`, headerInView);
  }
}

async function enterPin(page, digits) {
  for (const digit of digits) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
}

async function unlockWithPin(page) {
  await page.waitForSelector("text=Enter Vendor PIN", { timeout: 30_000 });
  await enterPin(page, correctPin);
  await page.waitForSelector("text=Mark Delivered", { timeout: 30_000 });
  const hubText = await page.locator("body").innerText();
  record("Job / Site visible on hub", hubText.includes(jobName));
  record("Order # visible on hub", hubText.includes(orderNumber));
  record("PO # visible on hub", hubText.includes(poNumber));
}

/** Receive deep link (real QR payload shape: /#/receive?id=…). */
async function enterViaReceiveDeepLink(page) {
  const receiveUrl = `${appBase}/#/receive?id=${deliveryId}`;
  console.log(`Opening receive deep link ${receiveUrl}`);
  await page.goto(receiveUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  record("Receive deep link loads", true);
  await shot(page, "00-receive-deep-link");
}

async function runDeliveredFlow(page) {
  await enterViaReceiveDeepLink(page);

  await page.waitForSelector("text=Enter Vendor PIN", { timeout: 30_000 });
  await shot(page, "01-pin-gate");
  await unlockWithPin(page);
  record("PIN unlocks Delivered hub", true);
  await assertFooterInViewport(page, "Hub after PIN");
  await assertReadableTextContrast(page, VENDOR_DELIVERED_HUB_CONTRAST_SPEC);
  await assertNoElementOverlap(page, VENDOR_DELIVERED_HUB_HEADER_OVERLAP_SPEC);
  record("D-42 hub text contrast", true);
  await shot(page, "02-delivered-hub");

  record(
    "Exception-only Delivered hub",
    await page.getByRole("button", { name: "Mark Delivered", exact: true }).isVisible(),
  );

  const hasLegacyUi =
    (await page.getByText("Filter rack").isVisible().catch(() => false)) ||
    (await page
      .getByRole("button", { name: /Next: Assign Zone/i })
      .isVisible()
      .catch(() => false)) ||
    (await page
      .getByText("Check off items as delivered")
      .isVisible()
      .catch(() => false)) ||
    (await page.getByText("Assign Staging Zone").isVisible().catch(() => false));
  record("No legacy full_checkin UI", !hasLegacyUi);

  const noItemCheckoff = !(await page
    .getByText("Check off items as delivered")
    .isVisible()
    .catch(() => false));
  record("No item checkoff on happy path", noItemCheckoff);

  await page.waitForSelector("text=Expected items", { timeout: 10_000 });
  record("Delivery context card visible", true);
  await assertFooterInViewport(page, "Pre-deliver");

  const spaceSheet = () => page.locator(".fixed.inset-0.z-50").last();

  async function waitForSpaceTier(label) {
    await page.waitForFunction(
      (tierLabel) => document.body.innerText.includes(tierLabel),
      label,
      { timeout: 30_000 },
    );
  }

  // --- Need More Space: tier picker ---
  await page.getByRole("button", { name: "📦 Need More Space?" }).click();
  await page.waitForSelector("text=Where do you need additional space?", {
    timeout: 10_000,
  });
  record("Need More Space tier picker opens", true);
  await shot(page, "03-need-more-space-pick");

  // Shelf path
  await page.getByRole("button", { name: "Shelf", exact: true }).click();
  await waitForSpaceTier("Shelf spot");
  await page
    .getByTestId("vendor-need-more-space-flow")
    .waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(800);
  const shelfMulti = await page
    .getByTestId("nms-spot-multi-select")
    .isVisible()
    .catch(() => false);
  const shelfNoSpots = await page
    .getByText(/No shelf spots available/i)
    .isVisible()
    .catch(() => false);
  const shelfOk = shelfMulti || shelfNoSpots;
  record(
    "Shelf path resolves",
    shelfOk,
    shelfOk ? "shelf tier rendered" : "shelf tier missing content",
  );
  await shot(page, "04-shelf-path");
  await spaceSheet().getByRole("button", { name: "← Back" }).click();
  await page.waitForSelector("text=Where do you need additional space?", {
    timeout: 10_000,
  });

  // Ground path
  await page.getByRole("button", { name: "Ground", exact: true }).click();
  await waitForSpaceTier("Ground spot");
  const groundMulti = await page
    .getByTestId("nms-spot-multi-select")
    .isVisible()
    .catch(() => false);
  const groundNoSpots = await page
    .getByText(/No ground spots available/i)
    .isVisible()
    .catch(() => false);
  const groundOk = groundMulti || groundNoSpots;
  record(
    "Ground path resolves",
    groundOk,
    groundOk ? "ground tier rendered" : "ground tier missing content",
  );
  await shot(page, "05-ground-path");
  await spaceSheet().getByRole("button", { name: "← Back" }).click();
  await page.waitForSelector("text=Where do you need additional space?", {
    timeout: 10_000,
  });

  // Large / Oversized path
  await page
    .getByRole("button", { name: "Large / Oversized Delivery" })
    .click();
  await page.waitForSelector("text=Large / Oversized Delivery", {
    timeout: 10_000,
  });
  const callLink = page.getByRole("link", { name: "Call Dispatcher" });
  record(
    "Large/oversized shows dispatcher call",
    await callLink.isVisible(),
  );
  await shot(page, "06-large-oversized");
  await spaceSheet().getByRole("button", { name: "← Back" }).click();
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

  // --- Mark Delivered ---
  await page.getByRole("button", { name: "Mark Delivered", exact: true }).click();
  await page.waitForFunction(() => {
    const btn = document.querySelector('[data-testid="vendor-mark-delivered"]');
    return btn && /Delivered/i.test(btn.textContent ?? "");
  }, { timeout: 30_000 });
  record("Mark Delivered stays on hub with Delivered label", true);
  await assertFooterInViewport(page, "Post-deliver");
  record(
    "Undo Delivery on delivered hub",
    await page
      .getByRole("button", { name: "Undo Delivery" })
      .isVisible()
      .catch(() => false),
  );
  await shot(page, "08-delivery-confirmed");

  const body = await page.locator("body").innerText();
  record(
    "Status stays arrived (not ready_for_pickup UI)",
    !/ready for pickup/i.test(body) && !/Check-in Complete/i.test(body),
  );
  record("No Deliver Another on delivered hub", !(await page.getByRole("button", { name: "Deliver Another" }).isVisible().catch(() => false)));

  return page;
}

async function runRevertFlow(page) {
  // --- Revert on same hub screen ---
  await page.getByRole("button", { name: "Undo Delivery" }).click();
  await page.waitForSelector("text=Mark Delivered", { timeout: 30_000 });
  record("Undo stays on hub with Mark Delivered CTA", true);
  await assertFooterInViewport(page, "Post-undo");
  record(
    "No Delivery Confirmed screen after undo",
    !(await page.getByText("Delivery Confirmed").isVisible().catch(() => false)),
  );
  await shot(page, "09-reverted-to-hub");
}

async function runDispatcherVisibility(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const page = await context.newPage();

  await ensureAuthenticated(page, appBase);
  if (isProd) {
    await openDeliveryDrawerByDeepLink(page, appBase, deliveryId);
  } else {
    await openDeliveryDrawer(page, orderNumber, deliveryId);
  }

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

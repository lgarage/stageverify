/**
 * Playwright: Staging Map assign-mode exits after successful assign (no sticky banner).
 *
 * Coverage:
 *   A enter assign mode → banner visible
 *   B cancel with X → mode exits, no write of a new pending spot
 *   C/D/E select valid spot → confirm → banner gone + assignDelivery cleared
 *   F refresh → normal browse (no assign mode)
 *   G delivery still has the selected location
 *   H normal map browse still works
 *
 * Usage:
 *   npm run dev
 *   npm run verify:assign-mode-exit
 *   npm run verify:assign-mode-exit:prod
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  ensureAuthenticated,
  loadEnvLocal,
  openDeliveryDrawerByDeepLink,
} from "./dispatcherVerifyHelpers.mjs";

const DELIVERY_ID =
  process.env.STAGEVERIFY_ASSIGN_DELIVERY_ID?.trim() || "delivery-2";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const authState = resolve(process.cwd(), "playwright/.auth/state.json");
const outDir = resolve(process.cwd(), "screenshots/assign-mode-exit");
loadEnvLocal();

function pass(msg) {
  console.log(`PASS: ${msg}`);
}

async function enterAssignMode(page) {
  await openDeliveryDrawerByDeepLink(page, appBase, DELIVERY_ID);
  await page.getByTestId("delivery-detail-drawer").waitFor({
    state: "visible",
    timeout: 20_000,
  });
  const vendorBtn = page.getByTestId("delivery-fulfillment-delivery");
  if (await vendorBtn.isVisible().catch(() => false)) {
    if ((await vendorBtn.getAttribute("aria-pressed")) !== "true") {
      await vendorBtn.click();
      await page.waitForTimeout(1200);
    }
  }
  const assignCta = page.getByTestId("drawer-staging-location-assign");
  if (await assignCta.isVisible().catch(() => false)) {
    await assignCta.click();
  } else {
    await page.goto(
      `${appBase}/#/zones?assignDelivery=${encodeURIComponent(DELIVERY_ID)}`,
      { waitUntil: "domcontentloaded" },
    );
  }
  await page.waitForURL(/assignDelivery=/, { timeout: 15_000 });
  const banner = page.getByTestId("assign-mode-banner");
  await banner.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="assign-mode-banner"]')
        ?.getAttribute("data-assign-ready") === "true",
    null,
    { timeout: 20_000 },
  );
  return banner;
}

async function pickGreenSpot(page) {
  // Prefer ground G* spots — shelf layout slots often lack Firestore zone rows
  // ("Could not resolve that spot") in assign mode.
  const greens = page.locator(
    '[data-testid^="shop-spot-G"][data-spot-color="green"]',
  );
  await greens.first().waitFor({ state: "visible", timeout: 15_000 });
  const n = await greens.count();
  for (let i = 0; i < Math.min(n, 12); i += 1) {
    await greens.nth(i).click({ force: true });
    try {
      const pending = page.getByTestId("assign-mode-pending-code");
      await pending.waitFor({ state: "visible", timeout: 1500 });
      return (await pending.innerText()).trim();
    } catch {
      /* try next */
    }
  }
  throw new Error(`no eligible green ground spot (G* count=${n})`);
}

(async () => {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const page = await context.newPage();
  await ensureAuthenticated(page, appBase);

  // ── B first: cancel with X (no write) ──
  let banner = await enterAssignMode(page);
  pass("A: assignment banner visible in assign mode");
  if (!new RegExp(`assignDelivery=${DELIVERY_ID}\\b`).test(page.url())) {
    throw new Error(`B setup: expected assignDelivery=${DELIVERY_ID}`);
  }
  await page.getByTestId("assign-mode-exit").click();
  await banner.waitFor({ state: "hidden", timeout: 10_000 });
  await page.waitForFunction(
    () => !window.location.href.includes("assignDelivery="),
    null,
    { timeout: 10_000 },
  );
  pass("B: cancel X exits assign mode (banner gone, URL cleared)");

  // ── C/D/E: select + confirm → auto-exit ──
  banner = await enterAssignMode(page);
  const code = await pickGreenSpot(page);
  pass(`C: selected valid spot ${code}`);
  await page.getByTestId("assign-mode-confirm").click();
  await page
    .getByTestId("assign-location-toast")
    .waitFor({ state: "visible", timeout: 15_000 });
  await banner.waitFor({ state: "hidden", timeout: 15_000 });
  pass("D: banner disappears immediately after success");
  await page.waitForFunction(
    () => !window.location.href.includes("assignDelivery="),
    null,
    { timeout: 10_000 },
  );
  if (/assignDelivery=/.test(page.url())) {
    throw new Error(`E: URL still has assignDelivery — ${page.url()}`);
  }
  pass("E: URL/state no longer contains assignDelivery");

  // ── F: post-success we are already on clean `#/zones` (E). Re-assert browse
  // mode, then leave and return via hash (full reload drops hash on Vite).
  await page.getByTestId("shop-floor-map").waitFor({
    state: "visible",
    timeout: 10_000,
  });
  if (/assignDelivery=/.test(page.url())) {
    throw new Error(`F: still in assign mode after success — ${page.url()}`);
  }
  if (
    await page
      .getByTestId("assign-mode-banner")
      .isVisible()
      .catch(() => false)
  ) {
    throw new Error("F: assign-mode banner still visible after success");
  }
  await page.evaluate(() => {
    window.location.hash = "#/dispatcher";
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    window.location.hash = "#/zones";
  });
  await page.getByTestId("shop-floor-map").waitFor({
    state: "visible",
    timeout: 20_000,
  });
  if (/assignDelivery=/.test(page.url())) {
    throw new Error(`F: return to zones re-entered assign mode — ${page.url()}`);
  }
  if (
    await page
      .getByTestId("assign-mode-banner")
      .isVisible()
      .catch(() => false)
  ) {
    throw new Error("F: return to zones showed assign-mode banner");
  }
  pass("F: Staging Map after assignment → normal browse (no assign mode)");

  // ── G: delivery still has location ──
  await openDeliveryDrawerByDeepLink(page, appBase, DELIVERY_ID);
  await page.getByTestId("delivery-detail-drawer").waitFor({
    state: "visible",
    timeout: 20_000,
  });
  const chip = page.getByTestId(`delivery-basics-staging-chip-${code}`);
  await chip.waitFor({ state: "visible", timeout: 10_000 });
  pass(`G: delivery still has selected location ${code}`);

  // ── H: normal map browse ──
  await page.goto(`${appBase}/#/zones`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("shop-floor-map").waitFor({
    state: "visible",
    timeout: 15_000,
  });
  if (/assignDelivery=/.test(page.url())) {
    throw new Error(`H: browse URL has assignDelivery — ${page.url()}`);
  }
  if (
    await page
      .getByTestId("assign-mode-banner")
      .isVisible()
      .catch(() => false)
  ) {
    throw new Error("H: browse showed assign-mode banner");
  }
  await page
    .locator('[data-testid^="shop-spot-"]')
    .first()
    .waitFor({ state: "visible", timeout: 10_000 });
  pass("H: normal Staging Map browse unchanged");

  console.log("verify:assign-mode-exit — ALL PASS");
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

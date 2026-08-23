/**
 * Playwright: Staging Map header toolbar placement (A–J).
 *
 *   npm run verify:shop-map-toolbar
 *   npm run verify:shop-map-toolbar:prod
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  ensureAuthenticated,
  loadEnvLocal,
} from "./dispatcherVerifyHelpers.mjs";
import { assertReadableTextContrast } from "./lib/ui-text-contrast-lib.mjs";

loadEnvLocal();
const baseUrl =
  process.env.STAGEVERIFY_BASE_URL ??
  process.argv.find((a) => a.startsWith("--base-url="))?.slice("--base-url=".length) ??
  "http://localhost:5173";
const BASE = resolveAppBase(baseUrl);
const SCREEN_DIR = resolve("screenshots");
if (!existsSync(SCREEN_DIR)) mkdirSync(SCREEN_DIR, { recursive: true });

const ACTION_TEST_IDS = [
  "staging-map-print-all-location-labels",
  "staging-map-print-map",
  "shop-map-vendor-view-toggle",
  "shop-map-edit-mode-toggle",
  "shop-map-zone-tools-toggle",
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  try {
    await ensureAuthenticated(page, BASE);
    await page.goto(`${BASE}/#/zones`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("shop-floor-map").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await page.getByTestId("shop-map-guide-header").waitFor({
      state: "visible",
      timeout: 15_000,
    });

    const header = page.getByTestId("shop-map-guide-header");
    const actions = page.getByTestId("shop-map-header-actions");
    if ((await actions.count()) === 0) {
      throw new Error("shop-map-header-actions missing inside guide header");
    }

    // A — five buttons inside blue/map header, same order, right-grouped
    const labels = [];
    for (const id of ACTION_TEST_IDS) {
      const btn = actions.getByTestId(id);
      await btn.waitFor({ state: "visible", timeout: 10_000 });
      const inHeader = await header.locator(`[data-testid="${id}"]`).count();
      if (inHeader !== 1) {
        throw new Error(`${id} not inside shop-map-guide-header`);
      }
      labels.push((await btn.innerText()).trim());
    }
    const expected = [
      "Print location labels",
      "Print map",
      "Vendor view",
      "Edit Locations",
      "Zone tools",
    ];
    if (labels.join("|") !== expected.join("|")) {
      throw new Error(`Button order/labels mismatch: ${labels.join(" | ")}`);
    }
    const host = page.locator(".shop-floor-map-host");
    const hostBox = await host.boundingBox();
    const actionsBox = await actions.boundingBox();
    const titleBox = await header.locator("h2").boundingBox();
    if (!hostBox || !actionsBox || !titleBox) {
      throw new Error("Missing geometry for header/actions");
    }
    if (actionsBox.y < hostBox.y - 2) {
      throw new Error("Actions sit above map host card (should be inside)");
    }
    if (actionsBox.x + 40 < titleBox.x) {
      throw new Error("Actions appear left of title (should be right-grouped)");
    }
    console.log("PASS: A five buttons inside map header, right-grouped, same order");

    // H/I — zoom + canvas controls still present (v0.0.273 unchanged surface)
    await page.getByTestId("shop-map-view-controls").waitFor({ state: "visible" });
    await page.getByTestId("shop-map-zoom-percent").waitFor({ state: "visible" });
    console.log("PASS: H zoom controls still present");

    const viewControls = page.getByTestId("shop-map-view-controls");
    const legend = page.getByTestId("shop-map-legend");
    await legend.waitFor({ state: "visible" });
    if ((await viewControls.locator('[data-testid="shop-map-legend"]').count()) !== 1) {
      throw new Error("shop-map-legend not inside shop-map-view-controls");
    }
    const legendText = await legend.innerText();
    for (const label of [
      "Available",
      "Assigned / planned",
      "Staged — Ready for pickup",
      "Shop stock",
    ]) {
      if (!legendText.includes(label)) {
        throw new Error(`Legend missing "${label}". Got: ${legendText}`);
      }
    }
    if (/\bFree\b/i.test(legendText)) {
      throw new Error(`Legend still says Free. Got: ${legendText}`);
    }
    const fitBtn = page.getByTestId("shop-map-zoom-fit");
    const fitBox = await fitBtn.boundingBox();
    const legendBox = await legend.boundingBox();
    if (!fitBox || !legendBox) {
      throw new Error("Missing geometry for Fit button or legend");
    }
    const fitCenterY = fitBox.y + fitBox.height / 2;
    const legendCenterY = legendBox.y + legendBox.height / 2;
    const yDelta = Math.abs(fitCenterY - legendCenterY);
    if (yDelta > 20) {
      throw new Error(
        `Legend not aligned with Fit row (delta=${yDelta.toFixed(1)}px, fitY=${fitCenterY.toFixed(1)}, legendY=${legendCenterY.toFixed(1)})`,
      );
    }
    console.log("PASS: legend in view-controls row aligned with Fit");

    // E — Vendor view toggles
    const vendorBtn = actions.getByTestId("shop-map-vendor-view-toggle");
    await vendorBtn.click();
    await page.waitForTimeout(300);
    if ((await vendorBtn.getAttribute("aria-pressed")) !== "true") {
      throw new Error("Vendor view did not press on");
    }
    await vendorBtn.click();
    await page.waitForTimeout(300);
    console.log("PASS: E Vendor view toggles");

    // F — Edit Locations
    const editBtn = actions.getByTestId("shop-map-edit-mode-toggle");
    await editBtn.click();
    await page.getByTestId("shop-map-edit-mode-banner").waitFor({
      state: "visible",
      timeout: 10_000,
    });
    await page.getByTestId("shop-map-canvas-wider").waitFor({
      state: "visible",
      timeout: 10_000,
    });
    console.log("PASS: F Edit Locations + canvas controls (I)");
    await editBtn.click();
    await page.waitForTimeout(800);

    // G — Zone tools
    const zoneBtn = actions.getByTestId("shop-map-zone-tools-toggle");
    await zoneBtn.click();
    await page.waitForTimeout(400);
    if ((await zoneBtn.getAttribute("aria-pressed")) !== "true") {
      throw new Error("Zone tools did not press on");
    }
    await zoneBtn.click();
    console.log("PASS: G Zone tools toggles");

    // C — Print location labels navigates
    await actions.getByTestId("staging-map-print-all-location-labels").click();
    await page.waitForURL(/print-labels/, { timeout: 15_000 });
    console.log("PASS: C Print location labels navigates");
    await page.goto(`${BASE}/#/zones`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("shop-map-header-actions").waitFor({
      state: "visible",
      timeout: 30_000,
    });

    // D — Print map control still wired (window.print stub)
    let printCalled = false;
    await page.exposeFunction("__svPrintProbe", () => {
      printCalled = true;
    });
    await page.evaluate(() => {
      window.print = () => {
        void window.__svPrintProbe();
      };
    });
    await page.getByTestId("staging-map-print-map").click();
    await page.waitForTimeout(200);
    if (!printCalled) {
      throw new Error("Print map did not invoke window.print");
    }
    console.log("PASS: D Print map invokes window.print");

    // B — narrow wrap
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await page.getByTestId("shop-map-guide-header").waitFor({ state: "visible" });
    for (const id of ACTION_TEST_IDS) {
      await page.getByTestId(id).waitFor({ state: "visible", timeout: 10_000 });
    }
    const h1 = page.getByRole("heading", { name: "Staging Map", exact: true });
    await h1.waitFor({ state: "visible" });
    console.log("PASS: B narrow viewport — title + buttons visible");

    // D-42 contrast on header actions
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.waitForTimeout(300);
    await assertReadableTextContrast(page, {
      rootSelector: '[data-testid="shop-map-header-actions"]',
      elements: [
        {
          name: "Print location labels",
          selector: '[data-testid="staging-map-print-all-location-labels"]',
        },
        {
          name: "Edit Locations",
          selector: '[data-testid="shop-map-edit-mode-toggle"]',
        },
      ],
    });
    console.log("PASS: D-42 contrast on header action buttons");

    await page.screenshot({
      path: resolve(SCREEN_DIR, "shop-map-toolbar-verify.png"),
      fullPage: false,
    });
    console.log("PASS: verify-shop-map-toolbar complete (J no persistence change in scope)");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

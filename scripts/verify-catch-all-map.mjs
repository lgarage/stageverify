/**
 * Playwright: Staging Map catch-all spot label + pending check-in count (D-44 map).
 *
 *   npm run dev
 *   npm run verify:catch-all-map
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  assertReadableTextContrast,
  assertNoElementOverlap,
} from "./lib/ui-text-contrast-lib.mjs";
import {
  ensureAuthenticated,
  loadEnvLocal,
} from "./dispatcherVerifyHelpers.mjs";

const baseUrl =
  process.argv.find((a) => a.startsWith("--base-url="))?.split("=")[1] ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
loadEnvLocal();

const screenshotDir = resolve(process.cwd(), "screenshots");
mkdirSync(screenshotDir, { recursive: true });

async function ensureCatchAllSpotViaMap(page) {
  let catchAll = page.locator('[data-spot-catch-all="true"]').first();
  if ((await catchAll.count()) > 0) return catchAll;

  const editToggle = page.getByTestId("shop-map-edit-mode-toggle");
  await editToggle.click();
  await page.getByTestId("shop-map-edit-mode-banner").waitFor({
    state: "visible",
    timeout: 5000,
  });

  const g1 = page.getByTestId("shop-spot-G1");
  if (await g1.count()) {
    await g1.click();
    await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
    const caCheckbox = page.getByTestId("shop-map-edit-catch-all");
    if (await caCheckbox.isVisible()) {
      if (!(await caCheckbox.isChecked())) {
        await caCheckbox.check();
      }
      await page.getByTestId("shop-map-edit-save").click();
      await page.waitForTimeout(1500);
    }
  }

  await editToggle.click();
  await page.getByTestId("shop-map-edit-mode-banner").waitFor({ state: "hidden" });

  catchAll = page.locator('[data-spot-catch-all="true"]').first();
  if ((await catchAll.count()) > 0) return catchAll;

  await editToggle.click();
  await page.getByTestId("shop-map-add-catch-all").click();
  await page.waitForTimeout(2500);
  await editToggle.click();
  await page.getByTestId("shop-map-edit-mode-banner").waitFor({ state: "hidden" });

  catchAll = page.locator('[data-spot-catch-all="true"]').first();
  if ((await catchAll.count()) === 0) {
    throw new Error(
      "Could not create or designate catch-all spot on Staging Map",
    );
  }
  return catchAll;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(
    existsSync(resolve(process.cwd(), "playwright/.auth/state.json"))
      ? {
          storageState: resolve(process.cwd(), "playwright/.auth/state.json"),
        }
      : {},
  );
  const page = await context.newPage();
  await ensureAuthenticated(page, appBase);

  await page.goto(`${appBase}/#/zones`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="shop-floor-map"]', {
    timeout: 30000,
  });

  const catchAllSpot = await ensureCatchAllSpotViaMap(page);
  await catchAllSpot.scrollIntoViewIfNeeded();

  const label = catchAllSpot.getByTestId("shop-spot-catch-all-label");
  const countEl = catchAllSpot.getByTestId("catch-all-pending-count");
  await label.waitFor({ state: "visible", timeout: 5000 });
  await countEl.waitFor({ state: "visible", timeout: 5000 });

  const labelText = (await label.innerText()).trim();
  if (!/^Catch-all$/i.test(labelText)) {
    throw new Error(`Expected Catch-all label, got: "${labelText}"`);
  }
  const countText = (await countEl.innerText()).trim();
  if (!/^\d+$/.test(countText)) {
    throw new Error(`Expected numeric pending count, got: "${countText}"`);
  }

  const spotBg = await catchAllSpot.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  // #dbeafe → rgb(219, 234, 254)
  if (!/rgb\(\s*219\s*,\s*234\s*,\s*254\s*\)/i.test(spotBg)) {
    throw new Error(
      `Catch-all spot should be light blue (#dbeafe). got backgroundColor=${spotBg}`,
    );
  }

  const spotTestId = await catchAllSpot.getAttribute("data-testid");
  await assertReadableTextContrast(page, {
    rootSelector: `[data-testid="${spotTestId}"]`,
    elements: [
      {
        name: "Catch-all label",
        selector: '[data-testid="shop-spot-catch-all-label"]',
        large: true,
      },
      {
        name: "Pending count",
        selector: '[data-testid="catch-all-pending-count"]',
        large: true,
      },
    ],
  });

  const topBar = page.getByTestId("dispatcher-portal-top-bar");
  if (await topBar.count()) {
    await assertNoElementOverlap(page, {
      a: '[data-testid="dispatcher-portal-top-bar"]',
      b: `[data-testid="${spotTestId}"]`,
      label: "Catch-all map spot vs top bar",
      optional: true,
    });
  }

  console.log(
    `PASS: catch-all spot ${spotTestId} shows "${labelText}" + count ${countText}`,
  );

  const editToggle = page.getByTestId("shop-map-edit-mode-toggle");
  await editToggle.click();
  await page.getByTestId("shop-map-edit-mode-banner").waitFor({
    state: "visible",
    timeout: 5000,
  });

  const addCatchAll = page.getByTestId("shop-map-add-catch-all");
  if (!(await addCatchAll.isVisible())) {
    throw new Error("Missing shop-map-add-catch-all in edit mode");
  }

  const g1 = page.getByTestId("shop-spot-G1");
  if (await g1.count()) {
    await g1.click();
    await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
    const caCheckbox = page.getByTestId("shop-map-edit-catch-all");
    if (!(await caCheckbox.isVisible())) {
      throw new Error("Missing shop-map-edit-catch-all checkbox on ground spot");
    }
    const checkboxColor = await page
      .getByTestId("shop-map-edit-catch-all")
      .locator("xpath=ancestor::label[1]")
      .evaluate((el) => getComputedStyle(el).color);
    const lum = await page.evaluate((color) => {
      const m = color.match(/\d+/g)?.map(Number) ?? [0, 0, 0];
      return 0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2];
    }, checkboxColor);
    if (lum > 200) {
      throw new Error(
        `Catch-all checkbox label too light. color=${checkboxColor}`,
      );
    }
    await page.getByTestId("shop-map-edit-cancel").click();
  }

  await editToggle.click();
  await page.getByTestId("shop-map-edit-mode-banner").waitFor({ state: "hidden" });

  await page.screenshot({
    path: resolve(screenshotDir, "catch-all-map-verify.png"),
    fullPage: true,
  });

  console.log("PASS: verify:catch-all-map");
  await browser.close();
}

main().catch(async (err) => {
  console.error("FAIL:", err);
  process.exit(1);
});

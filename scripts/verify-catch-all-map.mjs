/**
 * Playwright: Staging Map catch-all overlay + G1 not catch-all (D-44 map repair).
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

const CATCH_ALL_BLUE = /rgb\(\s*219\s*,\s*234\s*,\s*254\s*\)/i;

async function assertG1NotCatchAll(page) {
  const g1 = page.getByTestId("shop-spot-G1");
  if (!(await g1.count())) return;
  const isCatchAllAttr = await g1.getAttribute("data-spot-catch-all");
  if (isCatchAllAttr === "true") {
    throw new Error("G1 must not be styled as catch-all");
  }
  const g1Bg = await g1.evaluate((el) => getComputedStyle(el).backgroundColor);
  if (CATCH_ALL_BLUE.test(g1Bg)) {
    throw new Error(
      `G1 must use normal occupancy colors, not catch-all blue. got ${g1Bg}`,
    );
  }
  const g1Text = (await g1.innerText()).trim();
  if (/^Catch-all$/i.test(g1Text)) {
    throw new Error(`G1 label must be G1, not "${g1Text}"`);
  }
}

async function assertNoCatchAllOverlay(page, context) {
  const catchAll = page.locator('[data-testid="shop-map-catch-all"]');
  if ((await catchAll.count()) > 0) {
    throw new Error(
      `${context}: catch-all overlay must not appear until Add Catch-all Location is clicked`,
    );
  }
}

async function ensureCatchAllOverlayViaMap(page) {
  await assertNoCatchAllOverlay(page, "Before edit mode");

  const editToggle = page.getByTestId("shop-map-edit-mode-toggle");
  await editToggle.click();
  await page.getByTestId("shop-map-edit-mode-banner").waitFor({
    state: "visible",
    timeout: 5000,
  });

  await assertNoCatchAllOverlay(page, "Edit mode entry");

  const addBtn = page.getByTestId("shop-map-add-catch-all");
  if (!(await addBtn.isVisible())) {
    throw new Error(
      "Missing shop-map-add-catch-all — enable Edit Locations and add catch-all location",
    );
  }
  await addBtn.click();
  await page.waitForTimeout(2500);

  const catchAll = page.locator('[data-testid="shop-map-catch-all"]').first();
  if ((await catchAll.count()) === 0) {
    throw new Error(
      "Add Catch-all Location did not create shop-map-catch-all overlay",
    );
  }

  // Done editing persists pending catch-all via withCatchAllMarker (no spot panel required).
  await editToggle.click();
  await page.getByTestId("shop-map-edit-mode-banner").waitFor({
    state: "hidden",
    timeout: 15000,
  });
  await page.waitForTimeout(1000);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="shop-floor-map"]', {
    timeout: 30000,
  });
  await page
    .getByText("Loading zones…")
    .waitFor({ state: "hidden", timeout: 30000 })
    .catch(() => {});

  const catchAllAfterReload = page
    .locator('[data-testid="shop-map-catch-all"]')
    .first();
  if ((await catchAllAfterReload.count()) === 0) {
    throw new Error(
      "Catch-all overlay must persist after Save layout and reload #/zones",
    );
  }

  return catchAllAfterReload;
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
  await page.getByText("Loading zones…").waitFor({
    state: "hidden",
    timeout: 30000,
  }).catch(() => {});

  await assertG1NotCatchAll(page);
  await assertNoCatchAllOverlay(page, "Initial zones map load");

  const catchAllSpot = await ensureCatchAllOverlayViaMap(page);
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
  if (!CATCH_ALL_BLUE.test(spotBg)) {
    throw new Error(
      `Catch-all overlay should be light blue (#dbeafe). got backgroundColor=${spotBg}`,
    );
  }

  await assertReadableTextContrast(page, {
    rootSelector: '[data-testid="shop-map-catch-all"]',
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
      b: '[data-testid="shop-map-catch-all"]',
      label: "Catch-all map overlay vs top bar",
      optional: true,
    });
  }

  console.log(
    `PASS: catch-all overlay shows "${labelText}" + count ${countText}`,
  );
  console.log("PASS: catch-all overlay persisted after Save + reload");

  // Edit mode: catch-all is draggable (resize handle present)
  const editToggle = page.getByTestId("shop-map-edit-mode-toggle");
  await editToggle.click();
  await page.getByTestId("shop-map-edit-mode-banner").waitFor({
    state: "visible",
    timeout: 5000,
  });

  await assertG1NotCatchAll(page);

  const resizeHandle = page.getByTestId("shop-map-catch-all-resize-handle");
  if (!(await resizeHandle.isVisible())) {
    throw new Error("Missing shop-map-catch-all-resize-handle in edit mode");
  }

  const addCatchAll = page.getByTestId("shop-map-add-catch-all");
  if (await addCatchAll.count()) {
    throw new Error(
      "Add Catch-all Location should be hidden when overlay already exists",
    );
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

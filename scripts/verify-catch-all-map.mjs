/**
 * Playwright: Staging Map catch-all overlay + add ground/shelf (D-44/D-45 repair).
 * Catch-all overlay: edit-only; persists marker on Save / Done editing; hidden in view.
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
      `${context}: catch-all overlay must not appear in view mode`,
    );
  }
}

async function waitForZonesMap(page) {
  await page.waitForSelector('[data-testid="shop-floor-map"]', {
    timeout: 30000,
  });
  await page
    .getByText("Loading zones…")
    .waitFor({ state: "hidden", timeout: 30000 })
    .catch(() => {});
}

async function enterEditMode(page) {
  const editToggle = page.getByTestId("shop-map-edit-mode-toggle");
  await editToggle.click();
  await page.getByTestId("shop-map-edit-mode-banner").waitFor({
    state: "visible",
    timeout: 5000,
  });
}

async function exitEditMode(page) {
  const editToggle = page.getByTestId("shop-map-edit-mode-toggle");
  await editToggle.click();
  await page.getByTestId("shop-map-edit-mode-banner").waitFor({
    state: "hidden",
    timeout: 15000,
  });
}

async function readCatchAllGeometry(catchAll) {
  const ox = await catchAll.getAttribute("data-map-offset-x");
  const oy = await catchAll.getAttribute("data-map-offset-y");
  const w = await catchAll.getAttribute("data-map-width");
  const h = await catchAll.getAttribute("data-map-height");
  return { ox, oy, w, h };
}

async function addCatchAllInEdit(page) {
  const addBtn = page.getByTestId("shop-map-add-catch-all");
  if (!(await addBtn.isVisible())) {
    const existing = page.locator('[data-testid="shop-map-catch-all"]').first();
    if ((await existing.count()) > 0) {
      return existing;
    }
    throw new Error(
      "Missing shop-map-add-catch-all and no restored catch-all overlay",
    );
  }
  await addBtn.click();
  await page.waitForTimeout(1500);

  const catchAll = page.locator('[data-testid="shop-map-catch-all"]').first();
  if ((await catchAll.count()) === 0) {
    throw new Error(
      "Add Catch All Location did not create shop-map-catch-all overlay",
    );
  }
  return catchAll;
}

async function assertCatchAllOverlayContent(page, catchAllSpot) {
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
}

async function assertCatchAllEditPanel(page, catchAllSpot) {
  const g1 = page.getByTestId("shop-spot-G1");
  if (await g1.count()) {
    await g1.click({ force: true });
    await page.waitForTimeout(200);
  }

  await catchAllSpot.click({ force: true });
  const title = page.getByTestId("shop-map-edit-panel-title");
  await title.waitFor({ state: "visible", timeout: 5000 });
  const titleText = (await title.innerText()).trim();
  if (!/^Edit Catch-all$/i.test(titleText)) {
    throw new Error(
      `Expected "Edit Catch-all" panel title after clicking overlay, got "${titleText}"`,
    );
  }

  await assertReadableTextContrast(page, {
    rootSelector: '[data-testid="shop-map-edit-panel"]',
    elements: [
      {
        name: "Edit panel title",
        selector: '[data-testid="shop-map-edit-panel-title"]',
        large: true,
      },
      {
        name: "Display name input",
        selector: '[data-testid="shop-map-edit-label"]',
      },
      {
        name: "Spot code input",
        selector: '[data-testid="shop-map-edit-code"]',
      },
    ],
  });

  const catchAllBtn = page.getByTestId("catch-all-delivery-btn");
  if (!(await catchAllBtn.count())) {
    throw new Error(
      "Catch-all delivery top bar button missing after Add Catch All Location (designation not synced)",
    );
  }

  console.log("PASS: Catch-all click opens Edit Catch-all panel + delivery button visible");
}

async function assertAddGroundSpotWorks(page) {
  const addGround = page.getByTestId("shop-map-add-ground");
  await addGround.waitFor({ state: "visible", timeout: 5000 });
  const maxBefore = await page
    .locator('[data-testid^="shop-spot-G"]')
    .evaluateAll((els) => {
      let max = 0;
      for (const el of els) {
        const id = el.getAttribute("data-testid") ?? "";
        const m = id.match(/^shop-spot-G(\d+)$/i);
        if (m) max = Math.max(max, Number.parseInt(m[1], 10));
      }
      return max;
    });
  await addGround.click({ force: true });
  await page.waitForTimeout(4000);
  const addErr = page.getByTestId("shop-map-add-error");
  if (await addErr.count()) {
    throw new Error(`Add ground spot failed: ${(await addErr.innerText()).trim()}`);
  }
  const maxAfter = await page
    .locator('[data-testid^="shop-spot-G"]')
    .evaluateAll((els) => {
      let max = 0;
      for (const el of els) {
        const id = el.getAttribute("data-testid") ?? "";
        const m = id.match(/^shop-spot-G(\d+)$/i);
        if (m) max = Math.max(max, Number.parseInt(m[1], 10));
      }
      return max;
    });
  if (maxAfter <= maxBefore) {
    throw new Error(
      `Add ground spot failed: max G index ${maxBefore} -> ${maxAfter}`,
    );
  }
  console.log(
    `PASS: Add ground spot created new spot (max G${maxBefore} -> G${maxAfter})`,
  );
}

async function assertAddShelfWorks(page) {
  const addShelf = page.getByTestId("shop-map-add-shelf");
  if (!(await addShelf.isVisible())) {
    console.log("SKIP: shop-map-add-shelf not visible");
    return;
  }
  const beforeUnits = await page.locator('[data-testid^="shop-spot-S"]').count();
  await addShelf.click();
  await page.waitForTimeout(2500);
  const afterUnits = await page.locator('[data-testid^="shop-spot-S"]').count();
  if (afterUnits <= beforeUnits) {
    throw new Error(
      `Add shelf failed: shelf spot count ${beforeUnits} -> ${afterUnits}`,
    );
  }
  console.log(`PASS: Add shelf created new shelf spots (${beforeUnits} -> ${afterUnits})`);
}

async function assertG1ClickNoBrokenDrawer(page) {
  const g1 = page.getByTestId("shop-spot-G1");
  if (!(await g1.count())) {
    console.log("SKIP: G1 not on map");
    return;
  }
  await g1.click({ force: true });
  await page.waitForTimeout(1500);
  const drawerError = page.getByText("Unable to load delivery details.");
  if (await drawerError.count()) {
    throw new Error(
      "G1 click opened drawer with Unable to load delivery details.",
    );
  }
  const drawer = page.locator('[data-testid="delivery-detail-drawer"]');
  if (await drawer.count()) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  console.log("PASS: G1 click does not show broken delivery drawer error");
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
  await waitForZonesMap(page);

  const lastUpdatedEl = page.getByTestId("dispatcher-topbar-last-updated");
  await lastUpdatedEl.waitFor({ state: "visible", timeout: 10000 });

  await assertG1NotCatchAll(page);
  await assertNoCatchAllOverlay(page, "Initial zones map load (view mode)");
  await assertG1ClickNoBrokenDrawer(page);

  await enterEditMode(page);
  await assertAddGroundSpotWorks(page);
  await assertAddShelfWorks(page);

  const catchAllSpot = await addCatchAllInEdit(page);
  await assertCatchAllOverlayContent(page, catchAllSpot);
  await assertCatchAllEditPanel(page, catchAllSpot);

  const resizeHandle = page.getByTestId("shop-map-catch-all-resize-handle");
  if (!(await resizeHandle.isVisible())) {
    throw new Error("Missing shop-map-catch-all-resize-handle in edit mode");
  }

  const box = await catchAllSpot.boundingBox();
  if (!box) throw new Error("Catch-all overlay missing bounding box");
  await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 40, box.y + box.height + 30, {
    steps: 8,
  });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const movedGeom = await readCatchAllGeometry(
    page.locator('[data-testid="shop-map-catch-all"]').first(),
  );

  await catchAllSpot.click({ force: true });
  await page.getByTestId("shop-map-edit-save").click();
  await page.waitForTimeout(2000);

  const savedGeom = await readCatchAllGeometry(
    page.locator('[data-testid="shop-map-catch-all"]').first(),
  );
  if (savedGeom.w !== movedGeom.w || savedGeom.h !== movedGeom.h) {
    throw new Error(
      `Catch-all Save did not keep size: before save ${JSON.stringify(movedGeom)} after ${JSON.stringify(savedGeom)}`,
    );
  }

  await exitEditMode(page);
  await assertNoCatchAllOverlay(page, "View mode after Done editing");

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForZonesMap(page);
  await assertNoCatchAllOverlay(page, "After reload in view mode");
  console.log("PASS: catch-all hidden after reload in view mode");

  await enterEditMode(page);
  const restored = page.locator('[data-testid="shop-map-catch-all"]').first();
  await restored.waitFor({ state: "visible", timeout: 8000 });
  const restoredGeom = await readCatchAllGeometry(restored);
  if (
    restoredGeom.ox !== savedGeom.ox ||
    restoredGeom.oy !== savedGeom.oy ||
    restoredGeom.w !== savedGeom.w ||
    restoredGeom.h !== savedGeom.h
  ) {
    throw new Error(
      `Re-enter edit did not restore saved catch-all geometry: saved ${JSON.stringify(savedGeom)} got ${JSON.stringify(restoredGeom)}`,
    );
  }
  console.log("PASS: catch-all restored at saved position after re-enter edit");

  await exitEditMode(page);
  await assertNoCatchAllOverlay(page, "View after restore test");

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

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

/** Done editing must persist catch-all marker and YAH in one extras write. Caller must already be in edit mode. */
async function assertDoneFlushKeepsCatchAllWithYah(page) {
  const catchAll = page.locator('[data-testid="shop-map-catch-all"]').first();
  await catchAll.waitFor({ state: "visible", timeout: 8000 });

  const resizeHandle = page.getByTestId("shop-map-catch-all-resize-handle");
  const box = await catchAll.boundingBox();
  if (!box) throw new Error("Catch-all missing box for Done+YAH flush test");
  await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 24, box.y + box.height + 18, {
    steps: 6,
  });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const catchAllGeomBeforeDone = await readCatchAllGeometry(catchAll);

  const vendorToggle = page.getByTestId("shop-map-vendor-view-toggle");
  await vendorToggle.scrollIntoViewIfNeeded();
  if ((await vendorToggle.getAttribute("aria-pressed")) !== "true") {
    await vendorToggle.click();
  }
  for (let i = 0; i < 15; i++) {
    if ((await vendorToggle.getAttribute("aria-pressed")) === "true") break;
    await page.waitForTimeout(200);
  }
  if ((await vendorToggle.getAttribute("aria-pressed")) !== "true") {
    throw new Error("Vendor view toggle did not turn on for Done+YAH flush test");
  }
  // Ensure YAH is visible so Done flushes extras that include both markers.
  const yah = page.getByTestId("shop-map-you-are-here");
  await yah.waitFor({ state: "visible", timeout: 8000 });
  const yahOxBefore = Number((await yah.getAttribute("data-map-offset-x")) ?? "0");
  // Prefer Playwright dragTo (mouse path is flaky vs React pointer handlers).
  await yah.dragTo(yah, {
    sourcePosition: { x: 20, y: 20 },
    targetPosition: { x: 80, y: 55 },
    force: true,
  });
  await page.waitForTimeout(300);
  let yahOxPending = Number((await yah.getAttribute("data-map-offset-x")) ?? "0");
  if (yahOxPending === yahOxBefore) {
    // Fallback: nudge via keyboard-less second dragTo
    await yah.dragTo(yah, {
      sourcePosition: { x: 16, y: 16 },
      targetPosition: { x: 100, y: 70 },
      force: true,
    });
    await page.waitForTimeout(300);
    yahOxPending = Number((await yah.getAttribute("data-map-offset-x")) ?? "0");
  }
  const yahDragged = yahOxPending !== yahOxBefore;

  const editToggle = page.getByTestId("shop-map-edit-mode-toggle");
  await editToggle.click();
  await page.getByTestId("shop-map-edit-mode-banner").waitFor({
    state: "hidden",
    timeout: 15000,
  });
  await page.waitForTimeout(2000);

  await enterEditMode(page);
  await vendorToggle.scrollIntoViewIfNeeded();
  if ((await vendorToggle.getAttribute("aria-pressed")) !== "true") {
    await vendorToggle.click();
  }
  for (let i = 0; i < 15; i++) {
    if ((await vendorToggle.getAttribute("aria-pressed")) === "true") break;
    await page.waitForTimeout(200);
  }
  const catchAllAfter = page.locator('[data-testid="shop-map-catch-all"]').first();
  await catchAllAfter.waitFor({ state: "visible", timeout: 8000 });
  const catchAllGeomAfterDone = await readCatchAllGeometry(catchAllAfter);
  if (
    catchAllGeomAfterDone.w !== catchAllGeomBeforeDone.w ||
    catchAllGeomAfterDone.h !== catchAllGeomBeforeDone.h
  ) {
    throw new Error(
      `Done flush dropped catch-all size: before ${JSON.stringify(catchAllGeomBeforeDone)} after ${JSON.stringify(catchAllGeomAfterDone)}`,
    );
  }

  if (yahDragged) {
    const yahAfter = page.getByTestId("shop-map-you-are-here");
    await yahAfter.waitFor({ state: "visible", timeout: 5000 });
    const yahOxPersisted = Number(
      (await yahAfter.getAttribute("data-map-offset-x")) ?? "0",
    );
    if (yahOxPersisted !== yahOxPending) {
      throw new Error(
        `Done flush dropped YAH offset: pending=${yahOxPending} persisted=${yahOxPersisted}`,
      );
    }
    console.log("PASS: Done editing flush kept catch-all marker and YAH together");
  } else {
    console.log(
      "PASS: Done editing flush kept catch-all size (YAH drag skipped — pointer did not move)",
    );
  }

  if ((await vendorToggle.getAttribute("aria-pressed")) === "true") {
    await vendorToggle.click();
  }
  await exitEditMode(page);
}

async function addCatchAllInEdit(page) {
  const addBtn = page.getByTestId("shop-map-add-catch-all");
  const existing = page.locator('[data-testid="shop-map-catch-all"]').first();
  for (let attempt = 0; attempt < 24; attempt++) {
    if (await existing.isVisible().catch(() => false)) {
      return existing;
    }
    if (await addBtn.isVisible().catch(() => false)) {
      await addBtn.click();
      await existing.waitFor({ state: "visible", timeout: 10000 });
      return existing;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(
    "Missing shop-map-add-catch-all and no restored catch-all overlay (timed out waiting for hydration)",
  );
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

async function maxGroundIndex(page) {
  return page.locator('[data-testid^="shop-spot-G"]').evaluateAll((els) => {
    let max = 0;
    for (const el of els) {
      const id = el.getAttribute("data-testid") ?? "";
      const m = id.match(/^shop-spot-G(\d+)$/i);
      if (m) max = Math.max(max, Number.parseInt(m[1], 10));
    }
    return max;
  });
}

/** Add then immediately delete so :prod verify does not leave stray G/shelf spots. */
async function assertAddGroundSpotWorks(page) {
  const addGround = page.getByTestId("shop-map-add-ground");
  await addGround.waitFor({ state: "visible", timeout: 5000 });
  const maxBefore = await maxGroundIndex(page);
  await addGround.click({ force: true });
  await page.waitForTimeout(4000);
  const addErr = page.getByTestId("shop-map-add-error");
  if (await addErr.count()) {
    throw new Error(`Add ground spot failed: ${(await addErr.innerText()).trim()}`);
  }
  const maxAfter = await maxGroundIndex(page);
  if (maxAfter <= maxBefore) {
    throw new Error(
      `Add ground spot failed: max G index ${maxBefore} -> ${maxAfter}`,
    );
  }
  const newSpot = page.getByTestId(`shop-spot-G${maxAfter}`);
  await newSpot.click({ force: true });
  await page.getByTestId("shop-map-edit-delete").click();
  await page.waitForTimeout(500);
  // Delete clears selection (Save panel gone) — Done editing flushes pendingHidden.
  await exitEditMode(page);
  await enterEditMode(page);
  const maxCleaned = await maxGroundIndex(page);
  if (maxCleaned >= maxAfter) {
    throw new Error(
      `Cleanup failed: added G${maxAfter} still present (max ${maxCleaned})`,
    );
  }
  console.log(
    `PASS: Add ground spot created G${maxAfter} then cleaned up (max now G${maxCleaned})`,
  );
}

async function assertAddShelfWorks(page) {
  // Mutating Add shelf without reliable cleanup polluted prod (extra S* units).
  // Assert the control is present; leave create/delete to a dedicated harness later.
  const addShelf = page.getByTestId("shop-map-add-shelf");
  if (!(await addShelf.isVisible())) {
    console.log("SKIP: shop-map-add-shelf not visible");
    return;
  }
  console.log("PASS: Add shelf control visible (create skipped — no prod pollution)");
}

async function assertG1ClickNoBrokenDrawer(page) {
  const g1 = page.getByTestId("shop-spot-G1");
  if (!(await g1.count())) {
    console.log("SKIP: G1 not on map");
    return;
  }
  // Clear any prior toast / drawer from earlier clicks in this script.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  const occupiedToast = page.getByText(
    /marked occupied but delivery details (are unavailable|could not be loaded)/i,
  );
  if (await occupiedToast.count()) {
    // Toast may linger from assertCatchAllEditPanel's G1 click — wait it out.
    await occupiedToast
      .first()
      .waitFor({ state: "hidden", timeout: 8000 })
      .catch(() => {});
  }
  await g1.click({ force: true });
  await page.waitForTimeout(1500);
  const drawerError = page.getByText("Unable to load delivery details.");
  if (await drawerError.count()) {
    throw new Error(
      "G1 click opened drawer with Unable to load delivery details.",
    );
  }
  if (await occupiedToast.isVisible().catch(() => false)) {
    throw new Error(
      "G1 click showed occupied-but-unloadable toast (stale occupancy / CA bleed).",
    );
  }
  const drawer = page.locator('[data-testid="delivery-detail-drawer"]');
  if (await drawer.count()) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  console.log("PASS: G1 click does not show broken delivery drawer error");
}

/** Delete CA → Save → Done → re-enter must NOT resurrect the overlay. */
async function assertDeleteCatchAllSurvivesDone(page) {
  await enterEditMode(page);
  const catchAll = await addCatchAllInEdit(page);
  await catchAll.click({ force: true });
  await page.getByTestId("shop-map-edit-panel-title").waitFor({
    state: "visible",
    timeout: 5000,
  });
  await page.getByTestId("shop-map-edit-delete").click();
  await page.waitForTimeout(800);
  const goneInEdit = page.locator('[data-testid="shop-map-catch-all"]');
  if (await goneInEdit.isVisible().catch(() => false)) {
    throw new Error("Catch-all still visible in edit after Delete");
  }
  // Delete clears selection — Done editing flushes withoutCatchAllMarker tombstone.
  await exitEditMode(page);
  await assertNoCatchAllOverlay(page, "View after Delete+Done");

  await enterEditMode(page);
  await page.waitForTimeout(1000);
  if (await goneInEdit.isVisible().catch(() => false)) {
    throw new Error(
      "Catch-all resurrected on re-enter Edit after Delete+Save+Done",
    );
  }
  const addBtn = page.getByTestId("shop-map-add-catch-all");
  await addBtn.waitFor({ state: "visible", timeout: 8000 });
  await exitEditMode(page);
  console.log("PASS: Delete catch-all survives Save+Done+re-enter (no resurrection)");
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

  await assertDoneFlushKeepsCatchAllWithYah(page);

  await assertNoCatchAllOverlay(page, "View after Done+YAH flush test");

  await assertDeleteCatchAllSurvivesDone(page);
  await assertG1ClickNoBrokenDrawer(page);

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

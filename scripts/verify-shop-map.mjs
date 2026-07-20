/**
 * Playwright: Staging Map floor map + shared delivery drawer.
 *
 *   npm run dev
 *   npm run verify:shop-map
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
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
  // Prefer sidebar nav (same path as dispatcher-nav)
  const stagingNav = page.locator("aside").getByRole("link", {
    name: /Staging Map/i,
  });
  if (await stagingNav.count()) {
    await stagingNav.click();
  }
  try {
    await page.waitForSelector('[data-testid="shop-floor-map"]', {
      timeout: 30000,
    });
  } catch (err) {
    const body = (await page.locator("body").innerText().catch(() => "")).slice(
      0,
      800,
    );
    await page.screenshot({
      path: resolve(screenshotDir, "shop-map-fail.png"),
      fullPage: true,
    });
    throw new Error(
      `shop-floor-map missing. URL=${page.url()} body=${body}`,
      { cause: err },
    );
  }

  const legend = page.getByTestId("shop-map-legend");
  if (!(await legend.isVisible())) {
    throw new Error("shop-map-legend not visible");
  }
  const legendText = await legend.innerText();
  if (!/Available/i.test(legendText)) {
    throw new Error(`Legend should say Available (not Free). Got: ${legendText}`);
  }
  if (/\bFree\b/i.test(legendText)) {
    throw new Error(`Legend still says Free — use Available. Got: ${legendText}`);
  }

  for (const code of ["G1", "G12", "S1A", "S1G", "S2L"]) {
    const spot = page.getByTestId(`shop-spot-${code}`);
    if (!(await spot.count())) {
      throw new Error(`Missing shop spot ${code}`);
    }
  }

  // Shelf units: flush bay column + staggered chips (no A+G / F+L labels)
  for (const unit of ["S1", "S2"]) {
    const bays = page.getByTestId(`shop-shelf-${unit}-bays`);
    if (!(await bays.isVisible())) {
      throw new Error(`Missing shelf bay column for ${unit}`);
    }
    const bayGap = await bays.evaluate((el) => getComputedStyle(el).gap);
    if (bayGap && bayGap !== "0px" && bayGap !== "normal") {
      throw new Error(
        `Shelf ${unit} bay column must be flush (gap 0). Got: ${bayGap}`,
      );
    }
    // Adjacent levels share edges — no vertical air gap between bay squares
    const levelA = page.getByTestId(`shop-shelf-${unit}-level-A`);
    const levelB = page.getByTestId(`shop-shelf-${unit}-level-B`);
    const boxLevelA = await levelA.boundingBox();
    const boxLevelB = await levelB.boundingBox();
    if (!boxLevelA || !boxLevelB) {
      throw new Error(`Could not measure ${unit} level A/B bay boxes`);
    }
    const seam = boxLevelA.y - (boxLevelB.y + boxLevelB.height);
    if (Math.abs(seam) > 2) {
      throw new Error(
        `${unit} bay levels not flush (A below B). seam=${seam}px (want ~0)`,
      );
    }
    // 5 internal dividers for 6 bays — A must have borderTop (A/G↔B/H seam)
    const aBorderTop = await levelA.evaluate((el) => getComputedStyle(el).borderTopWidth);
    if (aBorderTop !== "2px") {
      throw new Error(
        `${unit} level A missing 2px top divider (A/G↔B/H seam). Got: ${aBorderTop}`,
      );
    }
    const fBorderTop = await page
      .getByTestId(`shop-shelf-${unit}-level-F`)
      .evaluate((el) => getComputedStyle(el).borderTopWidth);
    if (fBorderTop !== "0px") {
      throw new Error(
        `${unit} level F should skip top border (outer frame). Got: ${fBorderTop}`,
      );
    }
    for (const [a, b] of [
      ["A", "G"],
      ["B", "H"],
      ["C", "I"],
      ["D", "J"],
      ["E", "K"],
      ["F", "L"],
    ]) {
      const codeA = `${unit}${a}`;
      const codeB = `${unit}${b}`;
      const spotA = page.getByTestId(`shop-spot-${codeA}`);
      const spotB = page.getByTestId(`shop-spot-${codeB}`);
      if (!(await spotA.count()) || !(await spotB.count())) {
        throw new Error(`Missing staggered shelf spots ${codeA} / ${codeB}`);
      }
      const boxA = await spotA.boundingBox();
      const boxB = await spotB.boundingBox();
      if (!boxA || !boxB) {
        throw new Error(`Could not measure ${codeA}/${codeB} bounding boxes`);
      }
      if (boxB.x <= boxA.x + 4 || boxB.y <= boxA.y + 4) {
        throw new Error(
          `${codeB} should be staggered down-right of ${codeA}. A=(${boxA.x},${boxA.y}) B=(${boxB.x},${boxB.y})`,
        );
      }
    }
  }

  // S1A (bottom level) should sit below S1F (top level) on screen
  const s1aBox = await page.getByTestId("shop-spot-S1A").boundingBox();
  const s1fBox = await page.getByTestId("shop-spot-S1F").boundingBox();
  if (!s1aBox || !s1fBox) {
    throw new Error("Could not measure S1A/S1F bounding boxes");
  }
  if (s1aBox.y <= s1fBox.y) {
    throw new Error(
      `S1A should be below S1F (vertical unit). S1A.y=${s1aBox.y} S1F.y=${s1fBox.y}`,
    );
  }

  // Moderate aisle (halved from 120 → 60) + pair shifted into open floor
  const s1Box = await page.getByTestId("shop-shelf-S1").boundingBox();
  const s2Box = await page.getByTestId("shop-shelf-S2").boundingBox();
  if (!s1Box || !s2Box) {
    throw new Error("Could not measure S1/S2 shelf bounding boxes");
  }
  const aisleGap = s2Box.x - (s1Box.x + s1Box.width);
  if (aisleGap < 45 || aisleGap > 85) {
    throw new Error(
      `S1–S2 aisle should be moderate (~60px after halving). Got: ${aisleGap}`,
    );
  }
  const shelfRow = page.getByTestId("shop-shelf-row");
  const rowMargin = await shelfRow.evaluate(
    (el) => getComputedStyle(el).marginLeft,
  );
  if (rowMargin !== "60px") {
    throw new Error(
      `Shelf row should shift right by half prior aisle (marginLeft 60px). Got: ${rowMargin}`,
    );
  }

  // Flat 2D spots — no faux-3D perspective cubbies
  const s1aTransform = await page.getByTestId("shop-spot-S1A").evaluate((el) =>
    getComputedStyle(el).transform,
  );
  if (s1aTransform && s1aTransform !== "none") {
    throw new Error(
      `S1A should be flat 2D (no transform). Got: ${s1aTransform}`,
    );
  }

  // Hover free or occupied — card should appear
  await page.getByTestId("shop-spot-G1").hover();
  await page.waitForTimeout(400);
  const hover = page.getByTestId("shop-map-hover-card");
  if (!(await hover.isVisible())) {
    throw new Error("Hover card not visible on G1");
  }
  const hoverText = await hover.innerText();
  if (!/Available|DELIVERY BASICS|Shop stock/i.test(hoverText)) {
    throw new Error(`Unexpected hover card content: ${hoverText}`);
  }

  // If any orange/red spot exists, click opens shared drawer
  const occupied = page.locator(
    '[data-testid^="shop-spot-"][data-spot-color="orange"], [data-testid^="shop-spot-"][data-spot-color="red"]',
  );
  const occupiedCount = await occupied.count();
  if (occupiedCount > 0) {
    const spotTestId = await occupied.first().getAttribute("data-testid");
    await page.getByTestId("shop-map-hover-card").waitFor({ state: "hidden", timeout: 2000 }).catch(() => {});
    await occupied.first().click({ force: true });
    const drawer = page.getByTestId("delivery-detail-drawer");
    try {
      await drawer.waitFor({ state: "visible", timeout: 20000 });
    } catch (err) {
      const body = (await page.locator("body").innerText()).slice(0, 400);
      throw new Error(
        `Drawer did not open after click ${spotTestId}. body=${body}`,
        { cause: err },
      );
    }
    await page.getByRole("heading", { name: "Delivery Details" }).waitFor({
      timeout: 10000,
    });
    // Wait for detail body (shared DetailContent) — not just the shell
    await page
      .getByText(/DELIVERY BASICS|Job #|Order #|Staging Location/i)
      .first()
      .waitFor({ timeout: 15000 });
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "detached", timeout: 10000 });
  } else {
    console.log(
      "WARN: no occupied spots to click — drawer click path skipped (env may be empty)",
    );
  }

  // Edit mode: drag persists before save, cancel reverts, code rename on chip, input contrast
  const editToggle = page.getByTestId("shop-map-edit-mode-toggle");
  if (!(await editToggle.isVisible())) {
    throw new Error("Missing shop-map-edit-mode-toggle");
  }
  await editToggle.click();
  await page.getByTestId("shop-map-edit-mode-banner").waitFor({
    state: "visible",
    timeout: 5000,
  });

  const g1 = page.getByTestId("shop-spot-G1");
  await g1.click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });

  const labelInput = page.getByTestId("shop-map-edit-label");
  const codeInput = page.getByTestId("shop-map-edit-code");
  const priorLabel = await labelInput.inputValue();
  const priorCode = await codeInput.inputValue();
  const testLabel = `${priorLabel} (verify)`;

  const labelColor = await labelInput.evaluate(
    (el) => getComputedStyle(el).color,
  );
  const labelLum = await labelInput.evaluate((el) => {
    const c = getComputedStyle(el).color.match(/\d+/g)?.map(Number) ?? [0, 0, 0];
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  });
  if (labelLum > 200) {
    throw new Error(
      `Edit label input text too light (unreadable). color=${labelColor}`,
    );
  }

  await labelInput.fill(testLabel);

  const priorOffsetX = Number(
    (await g1.getAttribute("data-map-offset-x")) ?? "0",
  );
  const priorWidth = Number(
    (await g1.getAttribute("data-map-width")) ?? "52",
  );
  const priorHeight = Number(
    (await g1.getAttribute("data-map-height")) ?? "52",
  );
  const g1BoxBefore = await g1.boundingBox();
  const g2BoxBefore = await page.getByTestId("shop-spot-G2").boundingBox();
  if (!g1BoxBefore) throw new Error("Could not measure G1 before drag");
  if (!g2BoxBefore) throw new Error("Could not measure G2 before drag");

  const dragStartX = g1BoxBefore.x + g1BoxBefore.width / 2;
  const dragStartY = g1BoxBefore.y + g1BoxBefore.height / 2;
  await page.mouse.move(dragStartX, dragStartY);
  await page.mouse.down();
  await page.mouse.move(dragStartX + 40, dragStartY + 30, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const offsetAfterDrag = Number(
    (await g1.getAttribute("data-map-offset-x")) ?? "0",
  );
  if (offsetAfterDrag === priorOffsetX) {
    throw new Error(
      `G1 drag should change offset before save. before=${priorOffsetX} after=${offsetAfterDrag}`,
    );
  }

  const g2BoxAfterDrag = await page.getByTestId("shop-spot-G2").boundingBox();
  if (!g2BoxAfterDrag) throw new Error("Could not measure G2 after G1 drag");
  if (
    Math.abs(g2BoxBefore.width - g2BoxAfterDrag.width) > 1 ||
    Math.abs(g2BoxBefore.height - g2BoxAfterDrag.height) > 1 ||
    Math.abs(g2BoxBefore.x - g2BoxAfterDrag.x) > 1 ||
    Math.abs(g2BoxBefore.y - g2BoxAfterDrag.y) > 1
  ) {
    throw new Error(
      `Moving G1 must not change G2 size/position. before=${JSON.stringify(g2BoxBefore)} after=${JSON.stringify(g2BoxAfterDrag)}`,
    );
  }

  await page.getByTestId("shop-map-edit-cancel").click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "hidden" });
  const offsetAfterCancel = Number(
    (await g1.getAttribute("data-map-offset-x")) ?? "0",
  );
  if (offsetAfterCancel !== priorOffsetX) {
    throw new Error(
      `Cancel should revert drag offset. expected=${priorOffsetX} got=${offsetAfterCancel}`,
    );
  }
  await g1.click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
  if ((await labelInput.inputValue()) !== priorLabel) {
    throw new Error("Cancel should revert label edit");
  }

  await page.getByTestId("shop-map-nudge-right").click();
  const offsetAfterNudge = Number(
    (await g1.getAttribute("data-map-offset-x")) ?? "0",
  );
  if (offsetAfterNudge <= priorOffsetX) {
    throw new Error(
      `G1 map offset should increase after nudge right. before=${priorOffsetX} after=${offsetAfterNudge}`,
    );
  }

  await page.getByTestId("shop-map-size-w-plus").click();
  await page.getByTestId("shop-map-size-h-plus").click();
  const widthAfterNudge = Number(
    (await g1.getAttribute("data-map-width")) ?? "0",
  );
  const heightAfterNudge = Number(
    (await g1.getAttribute("data-map-height")) ?? "0",
  );
  if (widthAfterNudge <= priorWidth || heightAfterNudge <= priorHeight) {
    throw new Error(
      `Size nudge should increase W/H before save. before=${priorWidth}x${priorHeight} after=${widthAfterNudge}x${heightAfterNudge}`,
    );
  }

  await page.getByTestId("shop-map-edit-cancel").click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "hidden" });
  const widthAfterSizeCancel = Number(
    (await g1.getAttribute("data-map-width")) ?? "0",
  );
  if (widthAfterSizeCancel !== priorWidth) {
    throw new Error(
      `Cancel should revert size edit. expected width=${priorWidth} got=${widthAfterSizeCancel}`,
    );
  }

  await g1.click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
  await page.getByTestId("shop-map-size-w-plus").click();
  await page.getByTestId("shop-map-size-h-plus").click();
  await page.getByTestId("shop-map-nudge-right").click();

  const tempCode = priorCode.toUpperCase() === "G1" ? "G4" : "G1";
  await codeInput.fill(tempCode);
  await page.getByTestId("shop-map-edit-save").click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "hidden" });
  await page.waitForTimeout(800);

  const chipText = (await g1.innerText()).trim();
  const expectedChip = tempCode.trim().toUpperCase();
  if (chipText !== expectedChip) {
    throw new Error(
      `G1 chip should show saved code "${expectedChip}". Got: "${chipText}"`,
    );
  }

  const savedOffset = Number(
    (await g1.getAttribute("data-map-offset-x")) ?? "0",
  );
  if (savedOffset <= priorOffsetX) {
    throw new Error(
      `Saved nudge offset not persisted. before=${priorOffsetX} after=${savedOffset}`,
    );
  }

  const savedWidth = Number(
    (await g1.getAttribute("data-map-width")) ?? "0",
  );
  const savedHeight = Number(
    (await g1.getAttribute("data-map-height")) ?? "0",
  );
  if (savedWidth <= priorWidth || savedHeight <= priorHeight) {
    throw new Error(
      `Saved size not persisted. before=${priorWidth}x${priorHeight} after=${savedWidth}x${savedHeight}`,
    );
  }

  // Restore label + code + offset + size for env hygiene
  await g1.click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
  await labelInput.fill(priorLabel);
  await codeInput.fill(priorCode);
  await page.getByTestId("shop-map-nudge-reset").click();
  await page.getByTestId("shop-map-edit-save").click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "hidden" });

  // Marquee multi-select: drag box over G1+G2, move together, cancel
  const canvas = page.getByTestId("shop-map-canvas");
  await canvas.scrollIntoViewIfNeeded();
  await g1.scrollIntoViewIfNeeded();
  await page.getByTestId("shop-spot-G2").scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const g1BoxM = await g1.boundingBox();
  const g2BoxM = await page.getByTestId("shop-spot-G2").boundingBox();
  if (!g1BoxM || !g2BoxM) throw new Error("Could not measure G1/G2 for marquee");
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("Could not measure shop-map-canvas");
  if (g1BoxM.y < 0 || g2BoxM.y < 0) {
    throw new Error(
      `G1/G2 off-screen for marquee. G1.y=${g1BoxM.y} G2.y=${g2BoxM.y}`,
    );
  }
  // Clamp marquee to canvas so pointerdown hits the map surface, not chrome
  const mLeft = Math.max(
    canvasBox.x + 8,
    Math.min(g1BoxM.x, g2BoxM.x) - 6,
  );
  const mTop = Math.max(
    canvasBox.y + 8,
    Math.min(g1BoxM.y, g2BoxM.y) - 6,
  );
  const mRight = Math.min(
    canvasBox.x + canvasBox.width - 8,
    Math.max(g1BoxM.x + g1BoxM.width, g2BoxM.x + g2BoxM.width) + 6,
  );
  const mBottom = Math.min(
    canvasBox.y + canvasBox.height - 8,
    Math.max(g1BoxM.y + g1BoxM.height, g2BoxM.y + g2BoxM.height) + 6,
  );
  await page.mouse.move(mLeft, mTop);
  await page.mouse.down();
  await page.mouse.move(mRight, mBottom, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const multiHint = page.getByTestId("shop-map-multi-hint");
  if (!(await multiHint.isVisible())) {
    throw new Error("Marquee should select multiple spots (shop-map-multi-hint)");
  }
  const g1OxBeforeMulti = Number(
    (await g1.getAttribute("data-map-offset-x")) ?? "0",
  );
  const g2OxBeforeMulti = Number(
    (await page.getByTestId("shop-spot-G2").getAttribute("data-map-offset-x")) ??
      "0",
  );
  const g1Center = {
    x: g1BoxM.x + g1BoxM.width / 2,
    y: g1BoxM.y + g1BoxM.height / 2,
  };
  await page.mouse.move(g1Center.x, g1Center.y);
  await page.mouse.down();
  await page.mouse.move(g1Center.x + 36, g1Center.y + 12, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const g1OxAfterMulti = Number(
    (await g1.getAttribute("data-map-offset-x")) ?? "0",
  );
  const g2OxAfterMulti = Number(
    (await page.getByTestId("shop-spot-G2").getAttribute("data-map-offset-x")) ??
      "0",
  );
  if (g1OxAfterMulti <= g1OxBeforeMulti || g2OxAfterMulti <= g2OxBeforeMulti) {
    throw new Error(
      `Marquee group drag should move G1 and G2. G1 ${g1OxBeforeMulti}→${g1OxAfterMulti} G2 ${g2OxBeforeMulti}→${g2OxAfterMulti}`,
    );
  }
  await page.getByTestId("shop-map-edit-cancel").click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "hidden" });

  // Shelf frame move: drag S1 frame — frame + chips translate together
  const s1Frame = page.getByTestId("shop-shelf-S1-frame");
  if (!(await s1Frame.isVisible())) {
    throw new Error("Missing shop-shelf-S1-frame");
  }
  await s1Frame.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const s1Shelf = page.getByTestId("shop-shelf-S1");
  const s1aBeforeFrame = await page.getByTestId("shop-spot-S1A").boundingBox();
  const s1OxBefore = Number(
    (await s1Shelf.getAttribute("data-map-offset-x")) ?? "0",
  );
  const frameBox = await s1Frame.boundingBox();
  if (!frameBox || !s1aBeforeFrame) {
    throw new Error("Could not measure S1 frame / S1A before drag");
  }
  if (frameBox.y < 0) {
    throw new Error(`S1 frame off-screen. y=${frameBox.y}`);
  }
  await page.mouse.move(
    frameBox.x + 20,
    frameBox.y + frameBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    frameBox.x + 20 + 48,
    frameBox.y + frameBox.height / 2 + 20,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.waitForTimeout(200);
  const s1OxAfter = Number(
    (await s1Shelf.getAttribute("data-map-offset-x")) ?? "0",
  );
  if (s1OxAfter <= s1OxBefore) {
    throw new Error(
      `S1 frame drag should change unit offset. before=${s1OxBefore} after=${s1OxAfter}`,
    );
  }
  const s1aAfterFrame = await page.getByTestId("shop-spot-S1A").boundingBox();
  if (!s1aAfterFrame) throw new Error("Could not measure S1A after frame drag");
  if (s1aAfterFrame.x <= s1aBeforeFrame.x + 10) {
    throw new Error(
      `S1A chip should move with S1 frame. before.x=${s1aBeforeFrame.x} after.x=${s1aAfterFrame.x}`,
    );
  }
  await page.getByTestId("shop-map-edit-cancel").click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "hidden" });

  await editToggle.click();

  // Print map: @media print must show the floor map (not blank)
  await page.emulateMedia({ media: "print" });
  await page.waitForTimeout(200);
  const mapVisiblePrint = await page
    .getByTestId("shop-floor-map")
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
    });
  if (!mapVisiblePrint) {
    throw new Error("shop-floor-map must remain visible under @media print");
  }
  const mapHostBox = await page.locator(".shop-floor-map-host").boundingBox();
  if (!mapHostBox || mapHostBox.height < 80) {
    throw new Error(
      `Print layout blank/collapsed shop-floor-map-host. box=${JSON.stringify(mapHostBox)}`,
    );
  }
  const sidebarHidden = await page.locator("aside").evaluate((el) => {
    const s = getComputedStyle(el);
    return s.display === "none" || s.visibility === "hidden";
  });
  if (!sidebarHidden) {
    throw new Error("aside sidebar should be print:hidden");
  }
  await page.screenshot({
    path: resolve(screenshotDir, "shop-map-print.png"),
    fullPage: true,
  });
  await page.emulateMedia({ media: "screen" });

  await page.screenshot({
    path: resolve(screenshotDir, "shop-map-verify.png"),
    fullPage: true,
  });

  console.log("PASS: verify:shop-map");
  await browser.close();
}

main().catch(async (err) => {
  console.error("FAIL:", err);
  process.exit(1);
});

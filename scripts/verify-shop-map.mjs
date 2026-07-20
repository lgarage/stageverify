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

  // Moderate aisle (halved from 120 → 60) + pair shifted into open floor.
  // Use CSS gap (not bounding boxes) so persisted mapOffsetX on S1/S2 cannot fail this.
  const shelfRow = page.getByTestId("shop-shelf-row");
  const rowGap = await shelfRow.evaluate((el) => getComputedStyle(el).gap);
  if (rowGap !== "60px") {
    throw new Error(
      `S1–S2 aisle CSS gap should be 60px after halving. Got: ${rowGap}`,
    );
  }
  const rowMargin = await shelfRow.evaluate(
    (el) => getComputedStyle(el).marginLeft,
  );
  if (rowMargin !== "60px") {
    throw new Error(
      `Shelf row should shift right by half prior aisle (marginLeft 60px). Got: ${rowMargin}`,
    );
  }
  const s1Box = await page.getByTestId("shop-shelf-S1").boundingBox();
  const s2Box = await page.getByTestId("shop-shelf-S2").boundingBox();
  if (!s1Box || !s2Box) {
    throw new Error("Could not measure S1/S2 shelf bounding boxes");
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

  // Multi-spot pending offsets: move A, then B — A must keep its new offset
  await page.getByTestId("shop-map-edit-cancel").click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "hidden" });
  const g2 = page.getByTestId("shop-spot-G2");
  const g1OxMultiBefore = Number(
    (await g1.getAttribute("data-map-offset-x")) ?? "0",
  );
  const g2OxMultiBefore = Number(
    (await g2.getAttribute("data-map-offset-x")) ?? "0",
  );
  await g1.click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
  const g1BoxMulti = await g1.boundingBox();
  if (!g1BoxMulti) throw new Error("Could not measure G1 for multi-move");
  const g1DragX = g1BoxMulti.x + g1BoxMulti.width / 2;
  const g1DragY = g1BoxMulti.y + g1BoxMulti.height / 2;
  await page.mouse.move(g1DragX, g1DragY);
  await page.mouse.down();
  await page.mouse.move(g1DragX + 48, g1DragY + 24, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const g1OxAfterMoveA = Number(
    (await g1.getAttribute("data-map-offset-x")) ?? "0",
  );
  if (g1OxAfterMoveA === g1OxMultiBefore) {
    throw new Error(
      `G1 should move before selecting G2. before=${g1OxMultiBefore} after=${g1OxAfterMoveA}`,
    );
  }
  await g2.click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
  // After selecting G2, G1 must still show its pending offset (no snap-back)
  const g1OxAfterSelectB = Number(
    (await g1.getAttribute("data-map-offset-x")) ?? "0",
  );
  if (g1OxAfterSelectB !== g1OxAfterMoveA) {
    throw new Error(
      `G1 snapped back when selecting G2. expected=${g1OxAfterMoveA} got=${g1OxAfterSelectB}`,
    );
  }
  const g2BoxMulti = await g2.boundingBox();
  if (!g2BoxMulti) throw new Error("Could not measure G2 for multi-move");
  const g2DragX = g2BoxMulti.x + g2BoxMulti.width / 2;
  const g2DragY = g2BoxMulti.y + g2BoxMulti.height / 2;
  await page.mouse.move(g2DragX, g2DragY);
  await page.mouse.down();
  await page.mouse.move(g2DragX + 40, g2DragY + 16, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const g1OxAfterMoveB = Number(
    (await g1.getAttribute("data-map-offset-x")) ?? "0",
  );
  const g2OxAfterMoveB = Number(
    (await g2.getAttribute("data-map-offset-x")) ?? "0",
  );
  if (g1OxAfterMoveB !== g1OxAfterMoveA) {
    throw new Error(
      `G1 snapped back after moving G2. expected=${g1OxAfterMoveA} got=${g1OxAfterMoveB}`,
    );
  }
  if (g2OxAfterMoveB === g2OxMultiBefore) {
    throw new Error(
      `G2 should have a new pending offset. before=${g2OxMultiBefore} after=${g2OxAfterMoveB}`,
    );
  }
  await page.getByTestId("shop-map-edit-cancel").click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "hidden" });
  const g1OxAfterMultiCancel = Number(
    (await g1.getAttribute("data-map-offset-x")) ?? "0",
  );
  const g2OxAfterMultiCancel = Number(
    (await g2.getAttribute("data-map-offset-x")) ?? "0",
  );
  if (
    g1OxAfterMultiCancel !== g1OxMultiBefore ||
    g2OxAfterMultiCancel !== g2OxMultiBefore
  ) {
    throw new Error(
      `Cancel should restore both pending moves. G1 ${g1OxMultiBefore}→${g1OxAfterMultiCancel} G2 ${g2OxMultiBefore}→${g2OxAfterMultiCancel}`,
    );
  }

  await g1.click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
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

  const nudgeUpLabel = (await page.getByTestId("shop-map-nudge-up").innerText()).trim();
  if (!nudgeUpLabel.includes("↑")) {
    throw new Error(`Nudge up button should show ↑ glyph. got="${nudgeUpLabel}"`);
  }
  const wMinusLabel = (await page.getByTestId("shop-map-size-w-minus").innerText()).trim();
  const wPlusLabel = (await page.getByTestId("shop-map-size-w-plus").innerText()).trim();
  if (wMinusLabel !== "−" || wPlusLabel !== "+") {
    throw new Error(
      `W size pads should show − and +. minus="${wMinusLabel}" plus="${wPlusLabel}"`,
    );
  }
  const typedWidth = priorWidth + 24;
  await page.getByTestId("shop-map-edit-width").click();
  await page.getByTestId("shop-map-edit-width").fill(String(typedWidth));
  await page.getByTestId("shop-map-edit-width").blur();
  await page.waitForTimeout(100);
  const widthAfterType = Number(
    (await g1.getAttribute("data-map-width")) ?? "0",
  );
  if (widthAfterType !== typedWidth) {
    throw new Error(
      `Typed width should update spot live. expected=${typedWidth} got=${widthAfterType}`,
    );
  }

  // Rotation — show degrees, cancel restores
  const rotBefore = Number((await g1.getAttribute("data-map-rotation-deg")) ?? "0");
  await page.getByTestId("shop-map-rotate-cw").click();
  const rotDegLabel = (await page.getByTestId("shop-map-rotation-deg").innerText()).trim();
  if (!/^\d+°$/.test(rotDegLabel)) {
    throw new Error(`Rotation label should show degrees. got="${rotDegLabel}"`);
  }
  const rotAfterClick = Number(
    (await g1.getAttribute("data-map-rotation-deg")) ?? "0",
  );
  if (rotAfterClick === rotBefore) {
    throw new Error(
      `Rotate CW should change rotation. before=${rotBefore} after=${rotAfterClick}`,
    );
  }

  // Shelf spot S2L — size + nudge
  const s2l = page.getByTestId("shop-spot-S2L");
  const s2lOxBefore = Number((await s2l.getAttribute("data-map-offset-x")) ?? "0");
  await s2l.click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
  if ((await page.getByTestId("shop-map-edit-width").count()) === 0) {
    throw new Error("S2L edit panel should show width input");
  }
  await page.getByTestId("shop-map-nudge-left").click();
  const s2lOx = Number((await s2l.getAttribute("data-map-offset-x")) ?? "0");
  if (s2lOx >= s2lOxBefore) {
    throw new Error(
      `S2L nudge left should decrease offset. before=${s2lOxBefore} after=${s2lOx}`,
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
  const rotAfterCancel = Number(
    (await g1.getAttribute("data-map-rotation-deg")) ?? "0",
  );
  if (rotAfterCancel !== rotBefore) {
    throw new Error(
      `Cancel should restore rotation. expected=${rotBefore} got=${rotAfterCancel}`,
    );
  }

  // Add layout controls visible in edit mode
  if (!(await page.getByTestId("shop-map-add-ground").isVisible())) {
    throw new Error("Add ground spot button missing in edit mode");
  }
  if (!(await page.getByTestId("shop-map-add-shelf").isVisible())) {
    throw new Error("Add shelf button missing in edit mode");
  }

  await g1.click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
  await page.getByTestId("shop-map-size-w-plus").click();
  await page.getByTestId("shop-map-size-h-plus").click();
  await page.getByTestId("shop-map-nudge-right").click();
  await page.getByTestId("shop-map-rotate-cw").click();

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

  const savedRotation = Number(
    (await g1.getAttribute("data-map-rotation-deg")) ?? "0",
  );
  const expectedSavedRot = (rotBefore + 15) % 360;
  if (savedRotation !== expectedSavedRot) {
    throw new Error(
      `Saved rotation not persisted. expected=${expectedSavedRot} got=${savedRotation}`,
    );
  }

  // Restore label + code + offset + size + rotation for env hygiene
  await g1.click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
  await labelInput.fill(priorLabel);
  await codeInput.fill(priorCode);
  await page.getByTestId("shop-map-nudge-reset").click();
  await page.getByTestId("shop-map-rotate-reset").click();
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

  // Shelf unit display-name rename (S1 title) — cancel reverts; save persists
  const s1Title = page.getByTestId("shop-shelf-S1-title");
  const s1TitleBefore = (await s1Title.innerText()).trim();
  const s1FrameForRename = page.getByTestId("shop-shelf-S1-frame");
  await s1FrameForRename.click({ position: { x: 10, y: 20 } });
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
  const shelfLabelInput = page.getByTestId("shop-map-edit-label");
  const priorShelfLabel = await shelfLabelInput.inputValue();
  const tempShelfName = `ShelfVerify ${Date.now().toString().slice(-4)}`;
  await shelfLabelInput.fill(tempShelfName);
  await page.waitForTimeout(100);
  const titleWhileEditing = (await s1Title.innerText()).trim();
  if (titleWhileEditing !== tempShelfName) {
    throw new Error(
      `S1 title should update live while editing. expected=${tempShelfName} got=${titleWhileEditing}`,
    );
  }
  // Spot chip rename path must still exist for ground spots (not shelf units)
  if (await page.getByTestId("shop-map-edit-code").count()) {
    throw new Error("Shelf unit edit panel must not show spot-code rename");
  }
  await page.getByTestId("shop-map-edit-cancel").click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "hidden" });
  const titleAfterCancel = (await s1Title.innerText()).trim();
  if (titleAfterCancel !== s1TitleBefore) {
    throw new Error(
      `Cancel should revert S1 title. expected=${s1TitleBefore} got=${titleAfterCancel}`,
    );
  }
  await s1FrameForRename.click({ position: { x: 10, y: 20 } });
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
  await shelfLabelInput.fill(tempShelfName);
  await page.getByTestId("shop-map-edit-save").click();
  try {
    await page.getByTestId("shop-map-edit-panel").waitFor({
      state: "hidden",
      timeout: 15000,
    });
  } catch (err) {
    const errText = await page
      .getByTestId("shop-map-edit-panel")
      .innerText()
      .catch(() => "");
    throw new Error(
      `S1 shelf rename save did not close panel. panel=${errText.slice(0, 400)}`,
      { cause: err },
    );
  }
  await page.waitForTimeout(800);
  const titleAfterSave = (await s1Title.innerText()).trim();
  if (titleAfterSave !== tempShelfName) {
    throw new Error(
      `S1 title should persist after save. expected=${tempShelfName} got=${titleAfterSave}`,
    );
  }
  // Restore prior shelf label for env hygiene
  await s1FrameForRename.click({ position: { x: 10, y: 20 } });
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
  await shelfLabelInput.fill(priorShelfLabel);
  await page.getByTestId("shop-map-edit-save").click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "hidden" });
  await page.waitForTimeout(500);

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

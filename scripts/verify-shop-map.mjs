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
  // Per-object Cancel: only the selected spot (G2) restores; G1 keeps its pending move
  if (g1OxAfterMultiCancel !== g1OxAfterMoveA) {
    throw new Error(
      `Cancel on G2 must leave G1 pending. expected=${g1OxAfterMoveA} got=${g1OxAfterMultiCancel}`,
    );
  }
  if (g2OxAfterMultiCancel !== g2OxMultiBefore) {
    throw new Error(
      `Cancel on G2 should restore G2. expected=${g2OxMultiBefore} got=${g2OxAfterMultiCancel}`,
    );
  }

  // Clear leftover G1 pending via Undo (per-object Cancel left G1 moved by design)
  await page.getByTestId("shop-map-undo").click();
  await page.getByTestId("shop-map-undo").click();
  await page.waitForTimeout(100);
  const g1OxCleared = Number(
    (await g1.getAttribute("data-map-offset-x")) ?? "0",
  );
  if (g1OxCleared !== g1OxMultiBefore) {
    throw new Error(
      `Undo should clear G1 pending after per-object Cancel. expected=${g1OxMultiBefore} got=${g1OxCleared}`,
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
  // Resize G1, then select G2 — G1 must keep pending size (no snap-back)
  await g2.click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
  const g1WidthAfterSelectG2 = Number(
    (await g1.getAttribute("data-map-width")) ?? "0",
  );
  const g1HeightAfterSelectG2 = Number(
    (await g1.getAttribute("data-map-height")) ?? "0",
  );
  if (
    g1WidthAfterSelectG2 !== widthAfterNudge ||
    g1HeightAfterSelectG2 !== heightAfterNudge
  ) {
    throw new Error(
      `G1 size snapped back when selecting G2. expected=${widthAfterNudge}x${heightAfterNudge} got=${g1WidthAfterSelectG2}x${g1HeightAfterSelectG2}`,
    );
  }
  await page.getByTestId("shop-map-size-w-plus").click();
  await g1.click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
  const g1WidthAfterReselect = Number(
    (await g1.getAttribute("data-map-width")) ?? "0",
  );
  if (g1WidthAfterReselect !== widthAfterNudge) {
    throw new Error(
      `G1 pending size lost after editing G2 size. expected=${widthAfterNudge} got=${g1WidthAfterReselect}`,
    );
  }

  const nudgeUpLabel = (await page.getByTestId("shop-map-nudge-up").innerText()).trim();
  if (!nudgeUpLabel.includes("↑")) {
    throw new Error(`Nudge up button should show ↑ glyph. got="${nudgeUpLabel}"`);
  }
  const nudgeResetLabel = (await page.getByTestId("shop-map-nudge-reset").innerText()).trim();
  if (!nudgeResetLabel.includes("●")) {
    throw new Error(`Nudge reset button should show ● glyph. got="${nudgeResetLabel}"`);
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
  const s2lOxAfterCancel = Number(
    (await s2l.getAttribute("data-map-offset-x")) ?? "0",
  );
  if (s2lOxAfterCancel !== s2lOxBefore) {
    throw new Error(
      `Cancel on S2L should restore S2L only. expected=${s2lOxBefore} got=${s2lOxAfterCancel}`,
    );
  }
  // Per-object Cancel: G1 keeps its pending size/rotation until Cancel on G1
  const g1WidthStillPending = Number(
    (await g1.getAttribute("data-map-width")) ?? "0",
  );
  if (g1WidthStillPending !== typedWidth) {
    throw new Error(
      `Cancel on S2L must leave G1 pending size. expected=${typedWidth} got=${g1WidthStillPending}`,
    );
  }
  await g1.click({ force: true });
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
  await page.getByTestId("shop-map-edit-cancel").click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "hidden" });

  const widthAfterSizeCancel = Number(
    (await g1.getAttribute("data-map-width")) ?? "0",
  );
  if (widthAfterSizeCancel !== priorWidth) {
    throw new Error(
      `Cancel on G1 should revert size edit. expected width=${priorWidth} got=${widthAfterSizeCancel}`,
    );
  }
  const rotAfterCancel = Number(
    (await g1.getAttribute("data-map-rotation-deg")) ?? "0",
  );
  if (rotAfterCancel !== rotBefore) {
    throw new Error(
      `Cancel on G1 should restore rotation. expected=${rotBefore} got=${rotAfterCancel}`,
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

  // Done editing persists pending offset without explicit Save
  const offsetBeforeDoneEdit = Number(
    (await g1.getAttribute("data-map-offset-x")) ?? "0",
  );
  await g1.click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
  await page.getByTestId("shop-map-nudge-right").click();
  const offsetAfterDoneNudge = Number(
    (await g1.getAttribute("data-map-offset-x")) ?? "0",
  );
  if (offsetAfterDoneNudge <= offsetBeforeDoneEdit) {
    throw new Error(
      `Done-editing test: nudge should increase offset. before=${offsetBeforeDoneEdit} after=${offsetAfterDoneNudge}`,
    );
  }
  await editToggle.click();
  await page.getByTestId("shop-map-edit-mode-banner").waitFor({
    state: "hidden",
    timeout: 10000,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("shop-floor-map").waitFor({
    state: "visible",
    timeout: 30000,
  });
  const g1AfterDoneReload = page.getByTestId("shop-spot-G1");
  await g1AfterDoneReload.waitFor({ state: "visible" });
  const offsetAfterDoneReload = Number(
    (await g1AfterDoneReload.getAttribute("data-map-offset-x")) ?? "0",
  );
  if (offsetAfterDoneReload !== offsetAfterDoneNudge) {
    throw new Error(
      `Done editing should persist offset after reload. expected=${offsetAfterDoneNudge} got=${offsetAfterDoneReload}`,
    );
  }
  await editToggle.click();
  await page.getByTestId("shop-map-edit-mode-banner").waitFor({
    state: "visible",
    timeout: 5000,
  });
  await g1AfterDoneReload.click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
  await page.getByTestId("shop-map-nudge-reset").click();
  await editToggle.click();
  await page.getByTestId("shop-map-edit-mode-banner").waitFor({
    state: "hidden",
    timeout: 10000,
  });
  await editToggle.click();
  await page.getByTestId("shop-map-edit-mode-banner").waitFor({
    state: "visible",
    timeout: 5000,
  });

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

  // Rotated shelf: spot drag follows screen X (not parent-local skew)
  const s1FrameRot = page.getByTestId("shop-shelf-S1-frame");
  await s1FrameRot.scrollIntoViewIfNeeded();
  await s1FrameRot.click({ position: { x: 10, y: 20 } });
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
  const s1RotBefore = Number(
    (await page.getByTestId("shop-shelf-S1").getAttribute("data-map-rotation-deg")) ??
      "0",
  );
  for (let i = 0; i < 6; i++) {
    await page.getByTestId("shop-map-rotate-cw").click();
  }
  const s1RotAfter = Number(
    (await page.getByTestId("shop-shelf-S1").getAttribute("data-map-rotation-deg")) ??
      "0",
  );
  if (s1RotAfter === s1RotBefore) {
    throw new Error("S1 frame rotation should change before rotated spot drag test");
  }

  const s1aRot = page.getByTestId("shop-spot-S1A");
  await s1aRot.click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
  const s1aBoxRotBefore = await s1aRot.boundingBox();
  if (!s1aBoxRotBefore) {
    throw new Error("Could not measure S1A before rotated drag");
  }
  const dragCx = s1aBoxRotBefore.x + s1aBoxRotBefore.width / 2;
  const dragCy = s1aBoxRotBefore.y + s1aBoxRotBefore.height / 2;
  await page.mouse.move(dragCx, dragCy);
  await page.mouse.down();
  await page.mouse.move(dragCx + 48, dragCy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const s1aBoxRotAfter = await s1aRot.boundingBox();
  if (!s1aBoxRotAfter) {
    throw new Error("Could not measure S1A after rotated drag");
  }
  const screenDx = s1aBoxRotAfter.x - s1aBoxRotBefore.x;
  const screenDy = s1aBoxRotAfter.y - s1aBoxRotBefore.y;
  if (Math.abs(screenDx) < 20 || Math.abs(screenDy) > Math.abs(screenDx) * 0.6) {
    throw new Error(
      `Rotated shelf S1A drag should follow screen X. dx=${screenDx} dy=${screenDy}`,
    );
  }

  const s1aOyBeforeNudge = Number(
    (await s1aRot.getAttribute("data-map-offset-y")) ?? "0",
  );
  await page.getByTestId("shop-map-nudge-right").click();
  const s1aOyAfterNudge = Number(
    (await s1aRot.getAttribute("data-map-offset-y")) ?? "0",
  );
  if (s1aOyAfterNudge >= s1aOyBeforeNudge) {
    throw new Error(
      `Rotated S1A nudge right should decrease local oy. before=${s1aOyBeforeNudge} after=${s1aOyAfterNudge}`,
    );
  }
  await page.getByTestId("shop-map-edit-cancel").click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "hidden" });

  // Label rotation control on shelf unit (independent of frame)
  await s1FrameRot.click({ position: { x: 10, y: 20 } });
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
  if (!(await page.getByTestId("shop-map-label-rotate-cw").isVisible())) {
    throw new Error("Missing Labels rotation control for shelf unit");
  }
  const titleBefore = Number(
    (await page.getByTestId("shop-shelf-S1-title").getAttribute(
      "data-map-label-rotation-deg",
    )) ?? "0",
  );
  await page.getByTestId("shop-map-label-rotate-cw").click();
  const titleAfter = Number(
    (await page.getByTestId("shop-shelf-S1-title").getAttribute(
      "data-map-label-rotation-deg",
    )) ?? "0",
  );
  if (titleAfter === titleBefore) {
    throw new Error(
      `Label rotate CW should change title rotation. before=${titleBefore} after=${titleAfter}`,
    );
  }
  const chipLabelDeg = Number(
    (await s1aRot
      .locator("[data-map-label-rotation-deg]")
      .first()
      .getAttribute("data-map-label-rotation-deg")) ?? "0",
  );
  if (chipLabelDeg !== titleAfter) {
    throw new Error(
      `Spot chip label rotation should match unit. title=${titleAfter} chip=${chipLabelDeg}`,
    );
  }
  await page.getByTestId("shop-map-label-rotate-reset").click();
  await page.getByTestId("shop-map-rotate-reset").click();
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

  // Undo: nudge then Undo restores offset (still in edit mode)
  await page.getByTestId("shop-map-edit-mode-banner").waitFor({ state: "visible" });
  await g1.click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
  const undoOxBefore = Number(
    (await g1.getAttribute("data-map-offset-x")) ?? "0",
  );
  await page.getByTestId("shop-map-nudge-right").click();
  const undoOxAfterNudge = Number(
    (await g1.getAttribute("data-map-offset-x")) ?? "0",
  );
  if (undoOxAfterNudge === undoOxBefore) {
    throw new Error("Undo prep: nudge should change G1 offset");
  }
  const undoBtn = page.getByTestId("shop-map-undo");
  if (await undoBtn.isDisabled()) {
    throw new Error("Undo should be enabled after nudge");
  }
  await undoBtn.click();
  await page.waitForTimeout(100);
  const undoOxRestored = Number(
    (await g1.getAttribute("data-map-offset-x")) ?? "0",
  );
  if (undoOxRestored !== undoOxBefore) {
    throw new Error(
      `Undo should restore G1 offset. expected=${undoOxBefore} got=${undoOxRestored}`,
    );
  }

  // Delete (pending hide) + Undo — do not Save (avoid mutating prod layout)
  await page.getByTestId("shop-map-edit-delete").click();
  await page.waitForTimeout(150);
  if ((await page.getByTestId("shop-spot-G1").count()) !== 0) {
    throw new Error("Delete should hide G1 from the map (pending)");
  }
  await page.getByTestId("shop-map-undo").click();
  await page.waitForTimeout(150);
  await page.getByTestId("shop-spot-G1").waitFor({ state: "visible" });

  // Rename code + Cancel restores code field on reselect
  await g1.click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
  const spotCodeInput = page.getByTestId("shop-map-edit-code");
  const codeBeforeRename = await spotCodeInput.inputValue();
  await spotCodeInput.fill("G1ZZ");
  await page.getByTestId("shop-map-edit-cancel").click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "hidden" });
  await g1.click();
  await page.getByTestId("shop-map-edit-panel").waitFor({ state: "visible" });
  if ((await spotCodeInput.inputValue()) !== codeBeforeRename) {
    throw new Error(
      `Cancel should restore spot code. expected=${codeBeforeRename} got=${await spotCodeInput.inputValue()}`,
    );
  }
  await page.getByTestId("shop-map-edit-cancel").click();

  const mapChromeText = await page.getByTestId("shop-floor-map").innerText();
  if (/jake/i.test(mapChromeText)) {
    throw new Error('Staging Map chrome must not contain user-facing "Jake"');
  }

  await editToggle.click();
  await page.getByTestId("shop-map-edit-mode-banner").waitFor({ state: "hidden" });

  // Door on dispatcher; YOU ARE HERE only after explicit Vendor view click
  const doorScreen = page.getByTestId("shop-map-door");
  if (!(await doorScreen.isVisible())) {
    throw new Error("Swinging door must be visible on dispatcher map");
  }
  const vendorToggle = page.getByTestId("shop-map-vendor-view-toggle");
  if (!(await vendorToggle.isVisible())) {
    throw new Error("Missing shop-map-vendor-view-toggle");
  }
  // Vendor toggle label stays stable; edit toggle shows idle vs active label
  const vendorLabel = (await vendorToggle.innerText()).trim();
  const editLabel = (await editToggle.innerText()).trim();
  if (vendorLabel !== "Vendor view") {
    throw new Error(`Vendor toggle label must stay "Vendor view". got="${vendorLabel}"`);
  }
  if (editLabel !== "Edit Locations") {
    throw new Error(`Edit toggle idle label must be "Edit Locations". got="${editLabel}"`);
  }
  // Leaving Edit does not turn Vendor view on
  const youAreHereAfterEdit = await page
    .getByTestId("shop-map-you-are-here")
    .evaluate((el) => getComputedStyle(el).display);
  if (youAreHereAfterEdit !== "none") {
    throw new Error(
      `YOU ARE HERE must stay hidden until Vendor view is clicked. display=${youAreHereAfterEdit}`,
    );
  }
  // Vendor view alone (no edit): marker visible; click again hides it
  await vendorToggle.click();
  if ((await vendorToggle.getAttribute("aria-pressed")) !== "true") {
    throw new Error("Vendor view toggle should be aria-pressed=true when on");
  }
  const yahVendor = page.getByTestId("shop-map-you-are-here");
  if (!(await yahVendor.isVisible())) {
    throw new Error("YOU ARE HERE circle must show in Vendor view");
  }
  await vendorToggle.click();
  const yahHiddenAgain = await page
    .getByTestId("shop-map-you-are-here")
    .evaluate((el) => getComputedStyle(el).display);
  if (yahHiddenAgain !== "none") {
    throw new Error(
      `Turning Vendor view off must hide YOU ARE HERE. display=${yahHiddenAgain}`,
    );
  }
  // Edit alone: still no YOU ARE HERE (must click Vendor view)
  await editToggle.click();
  await page.getByTestId("shop-map-edit-mode-banner").waitFor({ state: "visible" });
  const editLabelActive = (await editToggle.innerText()).trim();
  if (editLabelActive !== "Done editing") {
    throw new Error(
      `Edit toggle active label must be "Done editing". got="${editLabelActive}"`,
    );
  }
  const yahEditOnly = await page
    .getByTestId("shop-map-you-are-here")
    .evaluate((el) => getComputedStyle(el).display);
  if (yahEditOnly !== "none") {
    throw new Error(
      `Edit Locations alone must not show YOU ARE HERE. display=${yahEditOnly}`,
    );
  }
  // Edit + Vendor view: yellow circle + drag + resize handle
  await vendorToggle.click();
  const yahEdit = page.getByTestId("shop-map-you-are-here");
  if (!(await yahEdit.isVisible())) {
    throw new Error("YOU ARE HERE circle must show when Vendor view is on during Edit");
  }
  const yahText = (await yahEdit.innerText()).replace(/\s+/g, " ").trim();
  if (!/YOU\s*ARE\s*HERE/i.test(yahText)) {
    throw new Error(`YOU ARE HERE circle text unexpected: "${yahText}"`);
  }
  const yahBg = await yahEdit.evaluate((el) => getComputedStyle(el).backgroundColor);
  // #FFE600 ≈ rgb(255, 230, 0)
  if (!/rgb\(\s*255\s*,\s*230\s*,\s*0\s*\)/i.test(yahBg)) {
    throw new Error(`YOU ARE HERE should be bright yellow. got=${yahBg}`);
  }
  const resizeHandle = page.getByTestId("shop-map-yah-resize-handle");
  if (!(await resizeHandle.isVisible())) {
    throw new Error("YOU ARE HERE resize handle must show in Edit + Vendor view");
  }
  const yahSizeBefore = Number((await yahEdit.getAttribute("data-map-size")) ?? "0");
  if (yahSizeBefore < 48) {
    throw new Error(`YOU ARE HERE sizePx unexpected: ${yahSizeBefore}`);
  }
  const resizeBox = await resizeHandle.boundingBox();
  if (!resizeBox) throw new Error("Could not measure YOU ARE HERE resize handle");
  await page.mouse.move(
    resizeBox.x + resizeBox.width / 2,
    resizeBox.y + resizeBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    resizeBox.x + resizeBox.width / 2 + 36,
    resizeBox.y + resizeBox.height / 2 + 36,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.waitForTimeout(150);
  const yahSizeAfter = Number((await yahEdit.getAttribute("data-map-size")) ?? "0");
  if (yahSizeAfter <= yahSizeBefore) {
    throw new Error(
      `Resizing YOU ARE HERE should increase size. before=${yahSizeBefore} after=${yahSizeAfter}`,
    );
  }
  await page.getByTestId("shop-map-undo").click();
  await page.waitForTimeout(100);
  const yahSizeUndone = Number((await yahEdit.getAttribute("data-map-size")) ?? "0");
  if (yahSizeUndone !== yahSizeBefore) {
    throw new Error(
      `Undo should restore YOU ARE HERE size. expected=${yahSizeBefore} got=${yahSizeUndone}`,
    );
  }
  const yahOxBefore = Number((await yahEdit.getAttribute("data-map-offset-x")) ?? "0");
  const yahBox = await yahEdit.boundingBox();
  if (!yahBox) throw new Error("Could not measure YOU ARE HERE for drag");
  await page.mouse.move(yahBox.x + yahBox.width / 2, yahBox.y + yahBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    yahBox.x + yahBox.width / 2 + 40,
    yahBox.y + yahBox.height / 2 + 24,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.waitForTimeout(150);
  const yahOxAfter = Number((await yahEdit.getAttribute("data-map-offset-x")) ?? "0");
  if (yahOxAfter === yahOxBefore) {
    throw new Error(
      `Dragging YOU ARE HERE should change offset. before=${yahOxBefore} after=${yahOxAfter}`,
    );
  }
  await page.getByTestId("shop-map-undo").click();
  await page.waitForTimeout(100);
  const yahOxUndone = Number((await yahEdit.getAttribute("data-map-offset-x")) ?? "0");
  if (yahOxUndone !== yahOxBefore) {
    throw new Error(
      `Undo should restore YOU ARE HERE offset. expected=${yahOxBefore} got=${yahOxUndone}`,
    );
  }
  // Door: draggable in Edit mode (same persist path as YOU ARE HERE)
  const doorWrap = page.getByTestId("shop-map-door-wrap");
  if (!(await doorWrap.isVisible())) {
    throw new Error("Door wrap must be visible in Edit mode");
  }
  const doorOxBefore = Number(
    (await doorWrap.getAttribute("data-map-offset-x")) ?? "0",
  );
  const doorBox = await doorWrap.boundingBox();
  if (!doorBox) throw new Error("Could not measure door for drag");
  await doorWrap.hover();
  await page.mouse.down();
  await page.mouse.move(
    doorBox.x + doorBox.width / 2 + 40,
    doorBox.y + doorBox.height / 2 + 28,
    { steps: 10 },
  );
  await page.mouse.up();
  await page.waitForTimeout(200);
  const doorOxAfter = Number(
    (await doorWrap.getAttribute("data-map-offset-x")) ?? "0",
  );
  if (doorOxAfter === doorOxBefore) {
    throw new Error(
      `Dragging door should change offset. before=${doorOxBefore} after=${doorOxAfter}`,
    );
  }
  await page.getByTestId("shop-map-undo").click();
  await page.waitForTimeout(100);
  const doorOxUndone = Number(
    (await doorWrap.getAttribute("data-map-offset-x")) ?? "0",
  );
  if (doorOxUndone !== doorOxBefore) {
    throw new Error(
      `Undo should restore door offset. expected=${doorOxBefore} got=${doorOxUndone}`,
    );
  }

  await editToggle.click();
  await page.getByTestId("shop-map-edit-mode-banner").waitFor({ state: "hidden" });

  // Print map: location guide — no status colors / legend / unplaced; bold poster
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
  const legendPrintDisplay = await page
    .getByTestId("shop-map-legend")
    .evaluate((el) => getComputedStyle(el).display);
  if (legendPrintDisplay !== "none") {
    throw new Error("Print guide must hide status legend");
  }
  const unplacedCount = await page.getByTestId("shop-map-unplaced").count();
  if (unplacedCount > 0) {
    const unplacedPrintDisplay = await page
      .getByTestId("shop-map-unplaced")
      .evaluate((el) => getComputedStyle(el).display);
    if (unplacedPrintDisplay !== "none") {
      throw new Error("Print guide must hide unplaced codes");
    }
  }
  const youAreHerePrint = await page
    .getByTestId("shop-map-you-are-here")
    .evaluate((el) => getComputedStyle(el).display);
  if (youAreHerePrint === "none") {
    throw new Error("YOU ARE HERE must show on print guide");
  }
  if (!(await page.getByTestId("shop-map-door").isVisible())) {
    throw new Error("Door must show on print guide");
  }
  const lastEditedText = (
    await page.getByTestId("shop-map-last-edited").innerText()
  ).trim();
  if (!/^Last edited:/i.test(lastEditedText)) {
    throw new Error(
      `Print footer must say Last edited. got="${lastEditedText}"`,
    );
  }
  const g1PrintBg = await page
    .getByTestId("shop-spot-G1")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  // Neutral white (rgb(255,255,255)) — not status green/red
  if (!/rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)/i.test(g1PrintBg)) {
    throw new Error(
      `Print spots must be neutral white, not status color. got=${g1PrintBg}`,
    );
  }
  const titlePrintSize = await page
    .getByTestId("shop-floor-map")
    .locator("h2")
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  if (titlePrintSize < 24) {
    throw new Error(
      `Print poster title should be bold/large (≥24px). got=${titlePrintSize}`,
    );
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

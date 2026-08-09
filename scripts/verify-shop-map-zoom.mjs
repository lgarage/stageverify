/**
 * Playwright: Staging Map view zoom + logical canvas sizing (edit mode).
 *
 *   npm run dev
 *   npm run verify:shop-map-zoom
 */
import { chromium } from "playwright";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  loadEnvLocal,
  ensureAuthenticated,
} from "./dispatcherVerifyHelpers.mjs";
import { assertReadableTextContrast } from "./lib/ui-text-contrast-lib.mjs";

loadEnvLocal();
const baseUrl =
  process.env.STAGEVERIFY_BASE_URL ??
  process.argv.find((a) => a.startsWith("--base-url="))?.slice("--base-url=".length) ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(60_000);

  await ensureAuthenticated(page, appBase);
  await page.goto(`${appBase}/#/zones`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("shop-floor-map").waitFor({ state: "visible" });

  // L — non-edit map still has zoom controls
  await page.getByTestId("shop-map-view-controls").waitFor({ state: "visible" });
  await page.getByTestId("shop-map-zoom-out").waitFor({ state: "visible" });
  await page.getByTestId("shop-map-zoom-percent").waitFor({ state: "visible" });
  await page.getByTestId("shop-map-zoom-in").waitFor({ state: "visible" });
  await page.getByTestId("shop-map-zoom-fit").waitFor({ state: "visible" });
  if (await page.getByTestId("shop-map-canvas-wider").count()) {
    throw new Error("Canvas size controls must be edit-mode only");
  }
  console.log("PASS: A/L view controls visible in browse; canvas size hidden");

  // B — zoom out / in + percent
  await page.getByTestId("shop-map-zoom-out").click();
  let pct = (await page.getByTestId("shop-map-zoom-percent").innerText()).trim();
  if (pct !== "90%") {
    throw new Error(`Zoom out expected 90%, got ${pct}`);
  }
  const zoomAttr = await page
    .getByTestId("shop-map-canvas")
    .getAttribute("data-view-zoom");
  if (Number(zoomAttr) !== 0.9) {
    throw new Error(`data-view-zoom expected 0.9, got ${zoomAttr}`);
  }
  await page.getByTestId("shop-map-zoom-in").click();
  pct = (await page.getByTestId("shop-map-zoom-percent").innerText()).trim();
  if (pct !== "100%") {
    throw new Error(`Zoom in expected 100%, got ${pct}`);
  }
  console.log("PASS: B zoom −/+ step 10%");

  // C — reset via percent button
  await page.getByTestId("shop-map-zoom-out").click();
  await page.getByTestId("shop-map-zoom-out").click();
  await page.getByTestId("shop-map-zoom-percent").click();
  pct = (await page.getByTestId("shop-map-zoom-percent").innerText()).trim();
  if (pct !== "100%") {
    throw new Error(`Reset expected 100%, got ${pct}`);
  }
  console.log("PASS: C reset to 100%");

  // D — Fit
  await page.getByTestId("shop-map-zoom-fit").click();
  pct = (await page.getByTestId("shop-map-zoom-percent").innerText()).trim();
  const fitZ = Number(
    await page.getByTestId("shop-map-canvas").getAttribute("data-view-zoom"),
  );
  if (!(fitZ >= 0.5 && fitZ <= 1)) {
    throw new Error(`Fit zoom out of [0.5,1]: ${fitZ} (${pct})`);
  }
  console.log(`PASS: D Fit → ${pct}`);

  // E — zoom does not change canvas logical size attrs
  const wBefore = await page
    .getByTestId("shop-map-canvas")
    .getAttribute("data-canvas-width");
  const hBefore = await page
    .getByTestId("shop-map-canvas")
    .getAttribute("data-canvas-height");
  await page.getByTestId("shop-map-zoom-out").click();
  await page.getByTestId("shop-map-zoom-out").click();
  const wAfterZoom = await page
    .getByTestId("shop-map-canvas")
    .getAttribute("data-canvas-width");
  const hAfterZoom = await page
    .getByTestId("shop-map-canvas")
    .getAttribute("data-canvas-height");
  if (wAfterZoom !== wBefore || hAfterZoom !== hBefore) {
    throw new Error("Zoom mutated canvas logical dimensions");
  }
  console.log("PASS: E zoom does not mutate canvas dimensions");

  // Enter edit
  await page.getByTestId("shop-map-edit-mode-toggle").click();
  await page.getByTestId("shop-map-add-bar").waitFor({ state: "visible" });
  await page.getByTestId("shop-map-canvas-wider").waitFor({ state: "visible" });
  console.log("PASS: H canvas controls appear in edit mode");

  // Capture G1 logical offset before drag at non-100% zoom
  await page.getByTestId("shop-map-zoom-percent").click(); // 100
  await page.getByTestId("shop-map-zoom-out").click(); // 90
  const g1 = page.getByTestId("shop-spot-G1");
  await g1.waitFor({ state: "visible" });
  const ox0 = Number(await g1.getAttribute("data-map-offset-x"));
  const oy0 = Number(await g1.getAttribute("data-map-offset-y"));
  const box = await g1.boundingBox();
  if (!box) throw new Error("G1 bounding box missing");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Move ~45 screen px at 90% zoom → ~50 logical px
  await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  const ox1 = Number(await g1.getAttribute("data-map-offset-x"));
  const oy1 = Number(await g1.getAttribute("data-map-offset-y"));
  if (!(ox1 > ox0)) {
    throw new Error(
      `F drag at 90% zoom did not increase ox (before=${ox0} after=${ox1})`,
    );
  }
  console.log(`PASS: F drag at non-100% zoom (ox ${ox0} → ${ox1})`);
  // Undo drag so harness never persists spot moves.
  await page.getByTestId("shop-map-undo").click();
  const oxUndone = Number(await g1.getAttribute("data-map-offset-x"));
  if (oxUndone !== ox0) {
    throw new Error(`Undo after drag failed (want ${ox0} got ${oxUndone})`);
  }

  // G — marquee at non-100%
  const g1Box = await g1.boundingBox();
  const g2 = page.getByTestId("shop-spot-G2");
  const g2Box = await g2.boundingBox();
  if (!g1Box || !g2Box) {
    throw new Error("Could not measure spots for marquee");
  }
  const mx0 = Math.min(g1Box.x, g2Box.x) - 4;
  const my0 = Math.min(g1Box.y, g2Box.y) - 4;
  const mx1 = Math.max(g1Box.x + g1Box.width, g2Box.x + g2Box.width) + 4;
  const my1 = Math.max(g1Box.y + g1Box.height, g2Box.y + g2Box.height) + 4;
  await page.mouse.move(mx0, my0);
  await page.mouse.down();
  await page.mouse.move(mx1, my1, { steps: 6 });
  await page.mouse.up();
  const panelTitle = (
    await page.getByTestId("shop-map-edit-panel-title").innerText()
  ).trim();
  if (!/2 spots selected|Edit G/.test(panelTitle)) {
    throw new Error(`G marquee selection unexpected: ${panelTitle}`);
  }
  console.log(`PASS: G marquee at zoom (${panelTitle})`);
  // Clear selection via small empty marquee / undo not needed — click zoom reset
  await page.getByTestId("shop-map-zoom-percent").click();

  const sizeLabel0 = (
    await page.getByTestId("shop-map-canvas-size-label").innerText()
  ).trim();
  const m0 = /(\d+)\s*×\s*(\d+)/.exec(sizeLabel0);
  if (!m0) throw new Error(`Bad canvas size label: ${sizeLabel0}`);
  const w0 = Number(m0[1]);
  const h0 = Number(m0[2]);
  const oxBeforeCanvas = Number(await g1.getAttribute("data-map-offset-x"));

  // H/I grow canvas
  await page.getByTestId("shop-map-canvas-wider").click();
  await page.getByTestId("shop-map-canvas-taller").click();
  const sizeLabel1 = (
    await page.getByTestId("shop-map-canvas-size-label").innerText()
  ).trim();
  const m1 = /(\d+)\s*×\s*(\d+)/.exec(sizeLabel1);
  if (!m1) throw new Error(`Bad canvas size after grow: ${sizeLabel1}`);
  if (Number(m1[1]) !== w0 + 50 || Number(m1[2]) !== h0 + 50) {
    throw new Error(`Expected +50/+50 canvas, got ${sizeLabel1} from ${sizeLabel0}`);
  }
  const oxAfterGrow = Number(await g1.getAttribute("data-map-offset-x"));
  if (oxAfterGrow !== oxBeforeCanvas) {
    throw new Error(
      `H/I canvas grow moved G1 ox (${oxBeforeCanvas} → ${oxAfterGrow})`,
    );
  }
  console.log("PASS: H/I canvas wider/taller preserves object offsets");

  // J shrink that should succeed (we grew first)
  await page.getByTestId("shop-map-canvas-narrower").click();
  await page.getByTestId("shop-map-canvas-shorter").click();
  const sizeLabel2 = (
    await page.getByTestId("shop-map-canvas-size-label").innerText()
  ).trim();
  if (sizeLabel2 !== sizeLabel0) {
    const m2 = /(\d+)\s*×\s*(\d+)/.exec(sizeLabel2);
    if (!m2 || Number(m2[1]) !== w0 || Number(m2[2]) !== h0) {
      throw new Error(`Shrink back mismatch: ${sizeLabel2} vs ${sizeLabel0}`);
    }
  }
  console.log("PASS: J shrink back to prior size when unoccupied");

  // Aggressive shrink until blocked (or hit min)
  let blocked = false;
  for (let i = 0; i < 40; i++) {
    await page.getByTestId("shop-map-canvas-narrower").click();
    if (await page.getByTestId("shop-map-canvas-size-error").count()) {
      blocked = true;
      break;
    }
    const label = (
      await page.getByTestId("shop-map-canvas-size-label").innerText()
    ).trim();
    const mm = /(\d+)/.exec(label);
    if (mm && Number(mm[1]) <= 640) break;
  }
  if (!blocked) {
    const label = (
      await page.getByTestId("shop-map-canvas-size-label").innerText()
    ).trim();
    console.log(
      `PASS: J shrink gate (reached bound without silent loss); label=${label}`,
    );
  } else {
    const err = (
      await page.getByTestId("shop-map-canvas-size-error").innerText()
    ).trim();
    if (!/can’t be narrower|can't be narrower/i.test(err)) {
      throw new Error(`Unexpected shrink error: ${err}`);
    }
    console.log("PASS: J shrink below occupied bounds blocked with warning");
  }

  // K — door still present
  await page.getByTestId("shop-map-door").waitFor({ state: "visible" });
  console.log("PASS: K door still rendered");

  await assertReadableTextContrast(page, {
    rootSelector: '[data-testid="shop-map-view-controls"]',
    elements: [
      {
        name: "zoom-percent",
        selector: '[data-testid="shop-map-zoom-percent"]',
      },
      {
        name: "canvas-wider",
        selector: '[data-testid="shop-map-canvas-wider"]',
      },
    ],
  });
  console.log("PASS: D-42 contrast on zoom/canvas controls");

  // Undo all canvas shrink/grow so we only persist a deliberate +50 width, then restore.
  for (let i = 0; i < 30; i++) {
    const undo = page.getByTestId("shop-map-undo");
    if (await undo.isDisabled()) break;
    await undo.click();
  }
  const oxClean = Number(await g1.getAttribute("data-map-offset-x"));
  // Ensure default canvas 1200×600 for persistence check
  for (let i = 0; i < 40; i++) {
    const label = (
      await page.getByTestId("shop-map-canvas-size-label").innerText()
    ).trim();
    const mm = /(\d+)\s*×\s*(\d+)/.exec(label);
    if (!mm) break;
    let w = Number(mm[1]);
    let h = Number(mm[2]);
    if (w === 1200 && h === 600) break;
    if (w < 1200) await page.getByTestId("shop-map-canvas-wider").click();
    else if (w > 1200) {
      await page.getByTestId("shop-map-canvas-narrower").click();
      if (await page.getByTestId("shop-map-canvas-size-error").count()) break;
    }
    if (h < 600) await page.getByTestId("shop-map-canvas-taller").click();
    else if (h > 600) {
      await page.getByTestId("shop-map-canvas-shorter").click();
      if (await page.getByTestId("shop-map-canvas-size-error").count()) break;
    }
  }
  // Persist a +50 width bump, reload, confirm, then restore width.
  await page.getByTestId("shop-map-canvas-wider").click();
  const canvasPersistLabel = (
    await page.getByTestId("shop-map-canvas-size-label").innerText()
  ).trim();
  await page.getByTestId("shop-map-edit-mode-toggle").click();
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: "domcontentloaded" });
  await ensureAuthenticated(page, appBase);
  await page.goto(`${appBase}/#/zones`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("shop-floor-map").waitFor({ state: "visible" });
  const g1Reload = page.getByTestId("shop-spot-G1");
  await g1Reload.waitFor({ state: "visible" });
  const oxReload = Number(await g1Reload.getAttribute("data-map-offset-x"));
  if (oxReload !== oxClean) {
    throw new Error(
      `Spot ox changed after canvas-only save: want ${oxClean} got ${oxReload}`,
    );
  }
  await page.getByTestId("shop-map-edit-mode-toggle").click();
  await page.getByTestId("shop-map-canvas-size-label").waitFor({ state: "visible" });
  const canvasAfterReload = (
    await page.getByTestId("shop-map-canvas-size-label").innerText()
  ).trim();
  if (canvasAfterReload !== canvasPersistLabel) {
    throw new Error(
      `Canvas size not persisted: saved=${canvasPersistLabel} reload=${canvasAfterReload}`,
    );
  }
  // Restore canvas width −50 so prod stays at 1200 when we started there
  await page.getByTestId("shop-map-canvas-narrower").click();
  await page.getByTestId("shop-map-edit-mode-toggle").click();
  await page.waitForTimeout(600);
  console.log(
    `PASS: E/F/I save/reload keeps spot ox=${oxClean}; canvas persisted then restored`,
  );

  // M — narrow viewport does not throw / hide map
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("shop-map-view-controls").waitFor({ state: "visible" });
  await page.getByTestId("shop-map-canvas").waitFor({ state: "visible" });
  console.log("PASS: M narrow viewport still shows map + zoom controls");

  console.log("PASS: verify-shop-map-zoom complete");
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

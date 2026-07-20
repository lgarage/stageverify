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

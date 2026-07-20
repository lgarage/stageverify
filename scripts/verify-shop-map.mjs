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

  for (const code of ["G1", "G12", "S1A", "S1G", "S2L"]) {
    const spot = page.getByTestId(`shop-spot-${code}`);
    if (!(await spot.count())) {
      throw new Error(`Missing shop spot ${code}`);
    }
  }

  // Floor-plan orientation: vertical shelf units with rotated level-pair labels
  for (const unit of ["S1", "S2"]) {
    const labels = page.getByTestId(`shop-shelf-${unit}-labels`);
    if (!(await labels.isVisible())) {
      throw new Error(`Missing shelf level labels for ${unit}`);
    }
    const labelText = await labels.innerText();
    if (
      !new RegExp(`${unit}A/${unit}G`, "i").test(labelText) ||
      !new RegExp(`${unit}F/${unit}L`, "i").test(labelText)
    ) {
      throw new Error(
        `Shelf ${unit} labels missing ${unit}A/${unit}G … ${unit}F/${unit}L. Got: ${labelText}`,
      );
    }
    const bottomLabel = page.getByTestId(`shop-shelf-${unit}-label-AG`);
    const transform = await bottomLabel.evaluate((el) => {
      const span = el.querySelector("span");
      return span ? getComputedStyle(span).transform : "";
    });
    if (!transform || transform === "none") {
      throw new Error(
        `Shelf ${unit} pair label should be rotated ~90°. Got: ${transform}`,
      );
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

  // S2 further right — aisle gap between S1 and S2
  const s1Box = await page.getByTestId("shop-shelf-S1").boundingBox();
  const s2Box = await page.getByTestId("shop-shelf-S2").boundingBox();
  if (!s1Box || !s2Box) {
    throw new Error("Could not measure S1/S2 shelf bounding boxes");
  }
  const aisleGap = s2Box.x - (s1Box.x + s1Box.width);
  if (aisleGap < 80) {
    throw new Error(
      `S1–S2 aisle gap too small (want ≥80px). Got: ${aisleGap}`,
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

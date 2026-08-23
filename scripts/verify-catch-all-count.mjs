/**
 * Playwright: Catch-all top-bar badge, map spot, and status drawer share
 * the same assigned-delivery count (view mode only — no edit/geometry writes).
 *
 *   npm run dev
 *   npm run verify:catch-all-count
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { assertReadableTextContrast } from "./lib/ui-text-contrast-lib.mjs";
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

function requireNumeric(label, text) {
  const trimmed = String(text ?? "").trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${label} is not a numeric count: "${trimmed}"`);
  }
  return trimmed;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await ensureAuthenticated(page, appBase);
  await page.goto(`${appBase}/#/zones`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="shop-floor-map"]', {
    timeout: 30_000,
  });
  await page
    .getByText("Loading zones…")
    .waitFor({ state: "hidden", timeout: 30_000 })
    .catch(() => {});

  const mapCount = page.getByTestId("catch-all-pending-count").first();
  await mapCount.waitFor({ state: "visible", timeout: 15_000 });
  const mapText = requireNumeric(
    "CA map count",
    await mapCount.innerText(),
  );

  const badge = page.getByTestId("catch-all-delivery-count-badge");
  await badge.waitFor({ state: "visible", timeout: 15_000 });
  const badgeText = requireNumeric(
    "top-bar Catch-all badge",
    await badge.innerText(),
  );
  if (badgeText !== mapText) {
    throw new Error(
      `Top-bar badge "${badgeText}" !== CA map count "${mapText}"`,
    );
  }

  await page.locator('[data-testid="shop-map-catch-all"]').first().click();
  const drawer = page.getByTestId("catch-all-status-drawer");
  await drawer.waitFor({ state: "visible", timeout: 8000 });
  const drawerText = requireNumeric(
    "Catch-all status drawer count",
    await page.getByTestId("catch-all-status-drawer-count").innerText(),
  );
  if (drawerText !== mapText) {
    throw new Error(
      `Drawer count "${drawerText}" !== CA map count "${mapText}"`,
    );
  }

  await assertReadableTextContrast(page, {
    rootSelector: '[data-testid="catch-all-delivery-topbar-slot"]',
    elements: [
      {
        name: "Catch-all delivery count badge",
        selector: '[data-testid="catch-all-delivery-count-badge"]',
      },
      {
        name: "Catch-all delivery button",
        selector: '[data-testid="catch-all-delivery-btn"]',
      },
    ],
  });
  await assertReadableTextContrast(page, {
    rootSelector: '[data-testid="shop-map-catch-all"]',
    elements: [
      {
        name: "Catch-all map count",
        selector: '[data-testid="catch-all-pending-count"]',
      },
    ],
  });

  await page.screenshot({
    path: resolve(screenshotDir, "catch-all-count-verify.png"),
    fullPage: false,
  });
  console.log(
    `PASS: verify:catch-all-count — top-bar=${badgeText} map=${mapText} drawer=${drawerText}`,
  );
  await browser.close();
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});

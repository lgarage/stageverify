/**
 * Playwright: portal shell — sidebar + top bar fixed; only main content scrolls.
 *
 * Usage:
 *   npm run dev
 *   node scripts/playwright-auth-setup.mjs   (if token expired)
 *   npm run verify:portal-layout
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";

const baseUrl =
  process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const authState = resolve(process.cwd(), "playwright/.auth/state.json");
const outDir = resolve(process.cwd(), "screenshots");
mkdirSync(outDir, { recursive: true });

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  }
}

const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;

async function ensureAuthenticated(page, hash) {
  await page.goto(`${appBase}/#/${hash}`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(1500);

  if (!page.url().includes("/login")) return;

  if (!email || !password) {
    throw new Error(
      "Redirected to login — set STAGEVERIFY_TEST_EMAIL/PASSWORD in .env.local",
    );
  }

  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/#\/(settings|dispatcher|hub|zones)/, {
    timeout: 20_000,
  });

  if (!page.url().includes(`/${hash}`)) {
    await page.goto(`${appBase}/#/${hash}`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  }
}

function box(page, selector) {
  return page.locator(selector).first().boundingBox();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const page = await context.newPage();

  const routes = [
    { hash: "settings", label: "Settings" },
    { hash: "dispatcher", label: "Dispatcher" },
    { hash: "zones", label: "Zones" },
  ];

  for (const route of routes) {
    console.log(`Checking ${route.label}…`);
    await ensureAuthenticated(page, route.hash);

    const settingsLink = page.getByRole("link", { name: "Settings" });
    await settingsLink.waitFor({ state: "visible", timeout: 30_000 });
    const settingsVisible = await settingsLink.isVisible();
    if (!settingsVisible) {
      throw new Error(`${route.label}: Settings link not visible without scroll`);
    }

    const sidebarTop = await box(page, "aside");
    const topBar = await box(page, '[data-testid="dispatcher-portal-topbar"]');
    if (!sidebarTop || !topBar) {
      throw new Error(`${route.label}: could not measure sidebar or top bar`);
    }

    const scrollEl = page.locator('[class*="overflow-y-auto"]').last();
    await scrollEl.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(300);

    const sidebarAfter = await box(page, "aside");
    const topBarAfter = await box(page, '[data-testid="dispatcher-portal-topbar"]');
    if (!sidebarAfter || !topBarAfter) {
      throw new Error(`${route.label}: lost sidebar/top bar after scroll`);
    }

    if (Math.abs(sidebarTop.y - sidebarAfter.y) > 1) {
      throw new Error(
        `${route.label}: sidebar moved on scroll (${sidebarTop.y} → ${sidebarAfter.y})`,
      );
    }
    if (Math.abs(topBar.y - topBarAfter.y) > 1) {
      throw new Error(
        `${route.label}: top bar moved on scroll (${topBar.y} → ${topBarAfter.y})`,
      );
    }

    const shot = resolve(outDir, `portal-layout-${route.label.toLowerCase()}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    console.log(`  ✓ ${route.label} — sidebar/top bar fixed (${shot})`);
  }

  await browser.close();
  console.log("verify:portal-layout PASS");
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

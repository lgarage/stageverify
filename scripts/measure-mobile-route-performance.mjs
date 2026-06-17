/**
 * Mobile/desktop route loading baseline (controlled local measurement).
 * Run: npm run dev  then  node scripts/measure-mobile-route-performance.mjs
 *
 * Environment: local Vite dev server, stageverify-db Firestore (authenticated reads).
 * Not proof of production performance on all networks/devices.
 */

import { chromium, devices } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { loadEnvLocal } from "./dispatcherVerifyHelpers.mjs";

loadEnvLocal();

const baseUrl =
  process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const authState = resolve(process.cwd(), "playwright/.auth/state.json");

const viewports = [
  { name: "iPhone SE", device: devices["iPhone SE"] },
  { name: "iPhone 14", device: devices["iPhone 14"] },
  { name: "Pixel 7", device: devices["Pixel 7"] },
  { name: "Desktop", device: { viewport: { width: 1280, height: 720 } } },
];

const routes = [
  {
    name: "vendor-receive",
    url: `${appBase}/#/receive?id=delivery-3`,
    auth: false,
    shellSelector: "text=Loading",
    identifySelector: "text=ORD-004",
    actionSelector:
      'button:has-text("DELIVERED"), button:has-text("Need More Space")',
  },
  {
    name: "technician-pickup",
    url: `${appBase}/#/pickup?job=job-3&delivery=delivery-3`,
    auth: false,
    shellSelector: "text=Loading",
    identifySelector: "text=ORD-004",
    actionSelector: 'button:has-text("Done"), button.w-full.rounded-xl',
  },
  {
    name: "dispatcher",
    url: `${appBase}/#/dispatcher`,
    auth: true,
    shellSelector: 'input[placeholder*="Job #"]',
    identifySelector: 'input[placeholder*="Job #"]',
    actionSelector: 'input[placeholder*="Job #"]',
  },
];

async function measureRoute(page, route) {
  const metrics = {
    route: route.name,
    url: route.url,
    shellVisibleMs: null,
    identifyVisibleMs: null,
    actionUsableMs: null,
    networkRequests: 0,
    failedRequests: 0,
  };

  page.on("request", () => {
    metrics.networkRequests++;
  });
  page.on("requestfailed", () => {
    metrics.failedRequests++;
  });

  const t0 = Date.now();
  await page.goto(route.url, { waitUntil: "commit", timeout: 60_000 });

  try {
    await page.locator(route.shellSelector).first().waitFor({
      state: "visible",
      timeout: 5_000,
    });
    metrics.shellVisibleMs = Date.now() - t0;
  } catch {
    metrics.shellVisibleMs = Date.now() - t0;
  }

  try {
    await page.locator(route.identifySelector).first().waitFor({
      state: "visible",
      timeout: 15_000,
    });
    metrics.identifyVisibleMs = Date.now() - t0;
  } catch {
    metrics.identifyVisibleMs = null;
  }

  try {
    await page.locator(route.actionSelector).first().waitFor({
      state: "visible",
      timeout: 15_000,
    });
    metrics.actionUsableMs = Date.now() - t0;
  } catch {
    metrics.actionUsableMs = null;
  }

  return metrics;
}

const results = [];

for (const vp of viewports) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...vp.device,
    ...(vp.name === "Desktop" && existsSync(authState)
      ? { storageState: authState }
      : {}),
  });
  const page = await context.newPage();

  for (const route of routes) {
    if (route.auth && vp.name !== "Desktop") continue;
    if (route.auth && !existsSync(authState)) {
      results.push({
        viewport: vp.name,
        route: route.name,
        skipped: true,
        reason: "no playwright auth state",
      });
      continue;
    }
    const metrics = await measureRoute(page, route);
    results.push({ viewport: vp.name, ...metrics });
    console.log(JSON.stringify({ viewport: vp.name, ...metrics }));
  }

  await browser.close();
}

const outDir = resolve(process.cwd(), "screenshots");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "mobile-route-performance-baseline.json");
writeFileSync(
  outPath,
  JSON.stringify(
    { measuredAt: new Date().toISOString(), baseUrl, results },
    null,
    2,
  ),
);
console.log(`\nWrote baseline: ${outPath}`);

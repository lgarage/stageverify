/**
 * Verify marketing landing page renders at desktop + mobile widths.
 * Usage: npm run verify:landing
 *        node scripts/verify-landing.mjs --base-url=https://lgarage.github.io/stageverify
 */

import { chromium } from "playwright";
import { mkdirSync, rmSync } from "fs";
import { resolve } from "path";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";

const outDir = resolve(process.cwd(), "screenshots", "landing-verify");
mkdirSync(outDir, { recursive: true });

const HEADLINE = "Stop Losing Job Materials Between Delivery and Pickup";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const url = `${baseUrl.replace(/\/$/, "")}/#/`;

  for (const [label, viewport] of [
    ["desktop", { width: 1280, height: 900 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    console.log(`Opening ${url} (${label})`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForSelector(`text=${HEADLINE}`, { timeout: 30_000 });
    const path = resolve(outDir, `landing-${label}.png`);
    await page.screenshot({ path, fullPage: true });
    console.log(`  screenshot: ${path}`);
    await context.close();
  }

  // Spot-check existing routes still load
  const routes = [
    { path: "#/receive?id=delivery-demo-vendor-1", expect: "Enter Vendor PIN" },
    { path: "#/pickup", expect: "Scan Zone QR" },
    { path: "#/login", expect: "Sign In" },
    { path: "#/demo/vendor-scan", expect: "Vendor receive demo" },
  ];

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  for (const r of routes) {
    const routeUrl = `${baseUrl.replace(/\/$/, "")}/${r.path}`;
    console.log(`Route check: ${routeUrl}`);
    await page.goto(routeUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForSelector(`text=${r.expect}`, { timeout: 30_000 });
    console.log(`  OK: found "${r.expect}"`);
  }
  await ctx.close();
  await browser.close();

  // Cleanup per session-cleanup-gate
  rmSync(outDir, { recursive: true, force: true });
  console.log("verify:landing passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

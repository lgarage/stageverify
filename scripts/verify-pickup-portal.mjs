/**
 * Playwright E2E: pickup portal — check all items, tap Done, assert success.
 *
 * Usage:
 *   npm run dev   (in another terminal, for local)
 *   node scripts/verify-pickup-portal.mjs
 *   node scripts/verify-pickup-portal.mjs --base-url https://lgarage.github.io/stageverify
 *
 * Env (optional): STAGEVERIFY_BASE_URL, STAGEVERIFY_PICKUP_JOB=job-1, STAGEVERIFY_PICKUP_DELIVERY=delivery-1
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);

const jobId = process.env.STAGEVERIFY_PICKUP_JOB ?? "job-1";
const deliveryId = process.env.STAGEVERIFY_PICKUP_DELIVERY ?? "delivery-1";

const outDir = resolve(process.cwd(), "screenshots");
mkdirSync(outDir, { recursive: true });

const pickRowSelector =
  "button.w-full.rounded-xl.border.border-border.bg-bg-surface.px-3.py-3.text-left";

async function waitForDoneEnabled(page, timeoutMs = 30_000) {
  await page.waitForFunction(
    () => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Done — All Picked Up"),
      );
      return btn && !btn.disabled;
    },
    { timeout: timeoutMs },
  );
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const page = await context.newPage();

  const url = `${appBase}/#/pickup?job=${jobId}&delivery=${deliveryId}`;
  console.log(`Opening ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });

  await page.waitForSelector("text=Mark off items as you pick them up", {
    timeout: 30_000,
  });
  try {
    await page.waitForSelector("text=Staging:", { timeout: 30_000 });
  } catch {
    const bodyText = await page.locator("body").innerText();
    await page.screenshot({
      path: resolve(outDir, "pickup-verify-load-fail.png"),
      fullPage: true,
    });
    console.error("FAIL: Pickup list did not load. Page text:\n", bodyText.slice(0, 800));
    await browser.close();
    process.exit(1);
  }

  const empty = await page
    .getByText("No pickup-ready deliveries", { exact: false })
    .isVisible()
    .catch(() => false);
  if (empty) {
    console.error(
      "FAIL: No pickup-ready deliveries for this job. Stage a delivery first (status ready_for_pickup, complete, or partial).",
    );
    await page.screenshot({
      path: resolve(outDir, "pickup-verify-empty.png"),
      fullPage: true,
    });
    await browser.close();
    process.exit(1);
  }

  await page.screenshot({
    path: resolve(outDir, "pickup-verify-before.png"),
    fullPage: true,
  });

  const rows = page.locator(pickRowSelector);
  const rowCount = await rows.count();
  console.log(`Clicking ${rowCount} pick-list row(s)…`);
  for (let i = 0; i < rowCount; i++) {
    await rows.nth(i).click();
    await page.waitForTimeout(150);
  }

  const readyBanner = page.getByText("All items picked up — tap Done to finish");
  await readyBanner.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {
    console.warn("WARN: Ready banner not visible; continuing…");
  });

  await waitForDoneEnabled(page);

  await page.screenshot({
    path: resolve(outDir, "pickup-verify-ready.png"),
    fullPage: true,
  });

  const doneBtn = page.getByRole("button", { name: /Done — All Picked Up/ });
  await doneBtn.click();

  const errorBanner = page.locator("text=/Failed to record|permission denied|Cannot record pickup/i");
  const errorVisible = await errorBanner
    .first()
    .isVisible({ timeout: 3_000 })
    .catch(() => false);
  if (errorVisible) {
    const msg = await errorBanner.first().textContent();
    await page.screenshot({
      path: resolve(outDir, "pickup-verify-error.png"),
      fullPage: true,
    });
    console.error(`FAIL: ${msg?.trim() ?? "Pickup error banner shown"}`);
    await browser.close();
    process.exit(1);
  }

  await page.waitForSelector("text=All Items Picked Up!", { timeout: 20_000 });
  await page.screenshot({
    path: resolve(outDir, "pickup-verify-after.png"),
    fullPage: true,
  });

  console.log("PASS: Pickup portal completed — All Items Picked Up! screen shown.");
  console.log(`Screenshots: ${outDir}/pickup-verify-*.png`);

  await browser.close();
})();

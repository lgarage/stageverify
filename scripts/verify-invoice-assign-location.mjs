/**
 * Playwright: Invoice Review Assign Location footer UX.
 *
 * Full CF confirm→persist path is covered by npm run test:invoice-fulfillment-override
 * (CF not deployed in verify env). This script exercises UI only:
 * - Will-Call: Assign Location → confirm dialog → Cancel keeps Will-Call + staging N/A
 * - Vendor Drop-Off: Assign Location opens staging picker without confirm dialog
 *
 * Usage:
 *   npm run dev
 *   node scripts/playwright-auth-setup.mjs   (if token expired)
 *   npm run verify:invoice-assign-location
 *   STAGEVERIFY_BASE_URL=https://lgarage.github.io/stageverify npm run verify:invoice-assign-location:prod
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrlIdx = args.indexOf("--base-url");
const baseUrl =
  baseUrlFlag?.slice("--base-url=".length) ??
  (baseUrlIdx >= 0 ? args[baseUrlIdx + 1] : undefined) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const authState = resolve(process.cwd(), "playwright/.auth/state.json");
const screenshotDir = resolve(process.cwd(), "screenshots/invoice-assign-location-verify");

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  }
}

const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;

async function ensureAuthenticated(page) {
  await page.goto(`${appBase}/#/invoice-review`, {
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
  await page.waitForURL(/\/#\/(invoice-review|dispatcher|settings|hub|zones|vendors)/, {
    timeout: 20_000,
  });

  await page.goto(`${appBase}/#/invoice-review`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
}

async function openFirstPendingInspectModal(page) {
  await page.waitForURL(/\/#\/dispatcher/, { timeout: 20_000 });
  await page.getByTestId("invoice-review-panel").waitFor({ timeout: 15_000 });
  await page.waitForFunction(
    () => {
      const panel = document.querySelector('[data-testid="invoice-review-panel"]');
      if (!panel) return false;
      const loading = panel.textContent?.includes("Loading…");
      const rows = panel.querySelectorAll('[data-testid^="invoice-review-queue-row-"]').length;
      const empty = panel.querySelector('[data-testid="invoice-review-empty"]');
      return !loading && (rows > 0 || !!empty);
    },
    { timeout: 30_000 },
  );
  const rowContent = page.locator('[data-testid^="invoice-review-row-content-"]').first();
  if (!(await rowContent.isVisible().catch(() => false))) {
    return false;
  }
  await rowContent.click();
  await page.getByTestId("invoice-parsed-inspect-modal").waitFor({ timeout: 10_000 });
  return true;
}

async function main() {
  mkdirSync(screenshotDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const page = await context.newPage();

  try {
    console.log(`verify-invoice-assign-location @ ${appBase}/#/invoice-review`);

    await ensureAuthenticated(page);

    const opened = await openFirstPendingInspectModal(page);
    if (!opened) {
      console.log("SKIP: no pending queue rows — assign-location UI not exercised");
      console.log("\nverify-invoice-assign-location: PASS (skip)");
      return;
    }

    const assignBtn = page.getByTestId("invoice-parsed-inspect-assign-location");
    await assignBtn.waitFor({ timeout: 5000 });

    const fulfillmentLabel = (
      await page.getByTestId("invoice-parsed-inspect-fulfillment-label").innerText()
    ).trim();
    const isWillCall = /Will-Call/i.test(fulfillmentLabel);

    if (isWillCall) {
      await assignBtn.click();
      const dialog = page.getByTestId("invoice-fulfillment-override-confirm-dialog");
      await dialog.waitFor({ timeout: 5000 });
      console.log("PASS: Will-Call Assign Location opens confirm dialog");

      await page.getByTestId("invoice-fulfillment-override-cancel").click();
      await dialog.waitFor({ state: "hidden", timeout: 5000 });

      const stagingNa = page.getByTestId("invoice-parsed-inspect-staging-na");
      if (!(await stagingNa.isVisible().catch(() => false))) {
        throw new Error("After cancel, Will-Call should still show staging N/A");
      }
      const labelAfter = (
        await page.getByTestId("invoice-parsed-inspect-fulfillment-label").innerText()
      ).trim();
      if (!/Will-Call/i.test(labelAfter)) {
        throw new Error(`After cancel, fulfillment should remain Will-Call — got "${labelAfter}"`);
      }
      console.log("PASS: cancel keeps Will-Call + staging N/A");
    } else {
      await assignBtn.click();
      const dialog = page.getByTestId("invoice-fulfillment-override-confirm-dialog");
      if (await dialog.isVisible().catch(() => false)) {
        throw new Error("Vendor Drop-Off Assign Location should not open confirm dialog");
      }
      const picker = page.getByTestId("invoice-staging-picker");
      const chooseBtn = page.getByTestId("invoice-staging-choose");
      const pickerVisible = await picker.isVisible().catch(() => false);
      const chooseVisible = await chooseBtn.isVisible().catch(() => false);
      if (!pickerVisible && !chooseVisible) {
        throw new Error("Vendor Drop-Off Assign Location should open staging picker");
      }
      console.log("PASS: Vendor Drop-Off Assign Location opens picker without confirm");
    }

    await page.screenshot({
      path: resolve(screenshotDir, "invoice-assign-location.png"),
      fullPage: false,
    });

    console.log("\nverify-invoice-assign-location: PASS");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`\nverify-invoice-assign-location: FAIL — ${err.message}`);
  process.exit(1);
});

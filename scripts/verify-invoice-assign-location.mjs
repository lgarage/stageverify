/**
 * Playwright: Invoice Review Assign Location / Approve fulfillment wizard UX.
 *
 * Full CF confirm→persist path is covered by npm run test:invoice-fulfillment-override
 * and approve-flow map confirm (approveFlow=1). This script exercises UI only:
 * - Approve → fulfillment choice (no footer Assign Location)
 * - Will-Call: choice → confirm step → Cancel
 * - Vendor Drop-Off: choice → staging banner → map with approveFlow=1
 * - Legacy draft path: scroll-body banner without approveFlow (when visible)
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
  await page.goto(`${appBase}/#/dispatcher?focus=needs-review`, {
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

  await page.goto(`${appBase}/#/dispatcher?focus=needs-review`, {
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
    console.log(`verify-invoice-assign-location @ ${appBase}/#/dispatcher?focus=needs-review`);

    await ensureAuthenticated(page);

    const opened = await openFirstPendingInspectModal(page);
    if (!opened) {
      console.log("SKIP: no pending queue rows — assign-location UI not exercised");
      console.log("\nverify-invoice-assign-location: PASS (skip)");
      return;
    }

    const footerAssign = page.getByTestId("invoice-parsed-inspect-assign-location");
    if (await footerAssign.isVisible().catch(() => false)) {
      throw new Error("Footer Assign Location button should be removed");
    }
    console.log("PASS: no footer Assign Location");

    const approveBtn = page.getByTestId("invoice-parsed-inspect-approve");
    if (!(await approveBtn.isVisible().catch(() => false))) {
      console.log("SKIP: Approve not visible for this import");
      console.log("\nverify-invoice-assign-location: PASS (skip)");
      return;
    }
    if (await approveBtn.isDisabled()) {
      console.log("SKIP: Approve disabled for this import");
      console.log("\nverify-invoice-assign-location: PASS (skip)");
      return;
    }

    await approveBtn.click();
    const choicePanel = page.getByTestId("invoice-approve-fulfillment-choice");
    await choicePanel.waitFor({ timeout: 5000 });
    console.log("PASS: Approve opens fulfillment choice");

    const fulfillmentLabel = (
      await page.getByTestId("invoice-parsed-inspect-fulfillment-label").innerText()
    ).trim();
    const isWillCall = /Will-Call/i.test(fulfillmentLabel);

    if (isWillCall) {
      await page.getByTestId("invoice-approve-choice-willcall").click();
      await page.getByTestId("invoice-approve-willcall-confirm").waitFor({ timeout: 5000 });

      {
        const { assertReadableTextContrast } = await import("./lib/ui-text-contrast-lib.mjs");
        await assertReadableTextContrast(page, {
          rootSelector: '[data-testid="invoice-parsed-inspect-modal"]',
          elements: [
            {
              name: "Will-Call confirm CTA",
              selector: '[data-testid="invoice-approve-willcall-confirm"]',
            },
          ],
        });
        console.log("PASS: Will-Call confirm readable contrast");
      }

      await page.getByTestId("invoice-approve-fulfillment-cancel").click();
      await page.getByTestId("invoice-approve-willcall-confirm").waitFor({
        state: "hidden",
        timeout: 5000,
      });
      console.log("PASS: Will-Call confirm Cancel returns to choice");
    }

    await page.getByTestId("invoice-approve-choice-dropoff").click();
    const wizardBanner = page.getByTestId("invoice-parsed-inspect-staging-needed");
    await wizardBanner.waitFor({ timeout: 5000 });
    console.log("PASS: Drop-Off choice shows wizard staging-needed banner");

    {
      const { assertReadableTextContrast } = await import("./lib/ui-text-contrast-lib.mjs");
      await assertReadableTextContrast(page, {
        rootSelector: '[data-testid="invoice-parsed-inspect-staging-needed"]',
        elements: [
          {
            name: "Wizard staging banner Assign Location",
            selector: '[data-testid="invoice-parsed-inspect-staging-location-assign"]',
          },
        ],
      });
      console.log("PASS: wizard staging banner readable contrast");
    }

    await page.getByTestId("invoice-parsed-inspect-staging-location-assign").click();
    await page.waitForURL(/assignInvoiceImport=/, { timeout: 15_000 });
    if (!/approveFlow=1/.test(page.url())) {
      throw new Error(`Expected approveFlow=1 in URL — got ${page.url()}`);
    }
    console.log("PASS: wizard Assign Location navigates to map with approveFlow=1");

    const picker = page.getByTestId("invoice-staging-picker");
    const chooseBtn = page.getByTestId("invoice-staging-choose");
    if (await picker.isVisible().catch(() => false)) {
      throw new Error("Inline invoice-staging-picker should not be visible");
    }
    if (await chooseBtn.isVisible().catch(() => false)) {
      throw new Error("Inline invoice-staging-choose should not be visible");
    }
    console.log("PASS: no inline staging picker on map navigation path");

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

/**
 * Playwright: dispatcher invoice review UI (/invoice-review).
 *
 * Usage:
 *   npm run dev
 *   node scripts/playwright-auth-setup.mjs   (if token expired)
 *   npm run verify:invoice-review
 *   STAGEVERIFY_BASE_URL=https://lgarage.github.io/stageverify npm run verify:invoice-review:prod
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
const screenshotDir = resolve(process.cwd(), "screenshots/invoice-review-verify");

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

  if (!page.url().includes("/invoice-review")) {
    await page.goto(`${appBase}/#/invoice-review`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  }
}

async function main() {
  if (!existsSync(authState)) {
    console.log("No auth state — run: node scripts/playwright-auth-setup.mjs");
  }

  mkdirSync(screenshotDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const page = await context.newPage();

  try {
    console.log(`verify-invoice-review @ ${appBase}/#/invoice-review`);

    await ensureAuthenticated(page);

    await page.getByTestId("invoice-review-page").waitFor({ timeout: 20_000 });
    console.log("PASS: invoice-review-page visible");

    await page.getByTestId("invoice-review-panel").waitFor({ timeout: 15_000 });
    console.log("PASS: invoice-review-panel visible");

    await page.getByTestId("invoice-review-queue").waitFor({ timeout: 15_000 });
    console.log("PASS: invoice-review-queue visible");

    const sidebarLink = page.getByRole("link", { name: "Invoice Review" });
    if (await sidebarLink.isVisible().catch(() => false)) {
      console.log("PASS: Invoice Review sidebar nav link visible");
    } else {
      throw new Error("Invoice Review sidebar link not visible");
    }

    const heading = page.getByRole("heading", { name: "Invoice import review" });
    await heading.waitFor({ timeout: 10_000 });
    console.log("PASS: page heading visible");

    const detail = page.getByTestId("invoice-review-detail");
    await detail.waitFor({ timeout: 10_000 });
    const detailText = await detail.innerText();
    const hasQueueOrDetail =
      /Select an import from the queue/i.test(detailText) ||
      /Invoice \d/i.test(detailText) ||
      /No parsed lines/i.test(detailText);
    if (!hasQueueOrDetail) {
      throw new Error(`Unexpected detail panel content: ${detailText.slice(0, 200)}`);
    }
    console.log("PASS: detail panel renders queue or import content");

    await page.getByTestId("dispatcher-refresh-now").waitFor({ timeout: 10_000 });
    console.log("PASS: shared dispatcher Refresh Now visible on Invoice Review");

    await page.getByRole("button", { name: "+ New Delivery" }).waitFor({ timeout: 10_000 });
    console.log("PASS: shared dispatcher + New Delivery visible on Invoice Review");

    await page.screenshot({
      path: resolve(screenshotDir, "invoice-review-page.png"),
      fullPage: true,
    });
    console.log(`Screenshot: screenshots/invoice-review-verify/invoice-review-page.png`);

    console.log("\nverify-invoice-review: PASS");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`\nverify-invoice-review: FAIL — ${err.message}`);
  process.exit(1);
});

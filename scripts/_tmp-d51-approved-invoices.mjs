/**
 * D-51 before/after screenshot helper for Approved invoices.
 * Usage: node scripts/_tmp-d51-approved-invoices.mjs before-approved-invoices.png
 */
import { chromium } from "playwright";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";

const outName = process.argv[2] || "before-approved-invoices.png";
const baseUrl = process.env.STAGEVERIFY_BASE_URL || "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto(`${appBase}/#/invoice-review`, {
  waitUntil: "domcontentloaded",
  timeout: 45_000,
});
await page.waitForTimeout(1500);

if (page.url().includes("/login")) {
  if (!email || !password) {
    throw new Error("Need STAGEVERIFY_TEST_EMAIL/PASSWORD");
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

await page.getByTestId("invoice-review-approved-link").waitFor({ timeout: 20_000 });
await page.getByTestId("invoice-review-approved-link").click();
await page.getByTestId("invoice-review-approved-list").waitFor({ timeout: 20_000 });
await page.waitForFunction(
  () => {
    const list = document.querySelector('[data-testid="invoice-review-approved-list"]');
    if (!list) return false;
    const loading = list.textContent?.includes("Loading…");
    const rows = list.querySelectorAll('[data-testid^="invoice-review-queue-row-"]').length;
    const empty = list.querySelector('[data-testid="invoice-review-approved-empty"]');
    return !loading && (rows > 0 || !!empty);
  },
  { timeout: 30_000 },
);

const out = resolve(process.cwd(), outName);
await page.screenshot({ path: out, fullPage: true });
console.log(`wrote ${out}`);
console.log(`url ${page.url()}`);
const firstApproved = await page.locator('[data-testid="invoice-review-field-value"]').allInnerTexts();
console.log("field-values:", JSON.stringify(firstApproved.slice(0, 12)));
await browser.close();

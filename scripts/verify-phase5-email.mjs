/**
 * Playwright: Phase 5 Proposed Email Updates panel — filters + row expand.
 *
 * Usage:
 *   npm run dev
 *   node scripts/playwright-auth-setup.mjs   (if token expired)
 *   npm run verify:phase5-email
 */

import { chromium } from "playwright";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";

const baseUrl = process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const authState = resolve(process.cwd(), "playwright/.auth/state.json");

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
  await page.goto(`${appBase}/#/dispatcher`, {
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
  await page.waitForURL(/\/#\/(dispatcher|settings|hub|zones|vendors)/, {
    timeout: 20_000,
  });

  if (!page.url().includes("/dispatcher")) {
    await page.goto(`${appBase}/#/dispatcher`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const page = await context.newPage();

  console.log("Opening dispatcher Proposed Email panel…");
  await ensureAuthenticated(page);
  await page.getByTestId("proposed-email-updates-panel").waitFor({
    timeout: 30_000,
  });
  await page.getByTestId("proposed-email-summary").waitFor({ timeout: 10_000 });

  const summaryAll = page.getByTestId("proposed-email-summary");
  const allText = (await summaryAll.innerText()) ?? "";
  const allMatch = allText.match(/(\d+)\s+proposals/);
  const allCount = allMatch ? Number(allMatch[1]) : 0;
  if (allCount < 1) {
    throw new Error(`Expected at least 1 proposal in summary, got: ${allText}`);
  }
  console.log(`All view: ${allCount} proposals`);

  const firstRow = page.locator('[data-testid^="proposed-email-row-"]').first();
  const rowTestId = await firstRow.getAttribute("data-testid");
  if (!rowTestId) throw new Error("No proposed email row found");
  const messageId = rowTestId.replace("proposed-email-row-", "");

  console.log("Filter: Needs review…");
  await page.getByTestId("proposed-email-filter-needs_review").click();
  await page.waitForTimeout(300);
  const needsReviewRows = page.locator('[data-testid^="proposed-email-row-"]');
  const needsReviewCount = await needsReviewRows.count();
  if (needsReviewCount < 1) {
    throw new Error("Needs review filter returned zero rows");
  }
  console.log(`Needs review filter: ${needsReviewCount} row(s)`);

  console.log("Filter: Low confidence…");
  await page.getByTestId("proposed-email-filter-low_confidence").click();
  await page.waitForTimeout(300);
  const lowConfRows = page.locator('[data-testid^="proposed-email-row-"]');
  const lowConfCount = await lowConfRows.count();
  console.log(`Low confidence filter: ${lowConfCount} row(s)`);

  console.log("Filter: All (restore)…");
  await page.getByTestId("proposed-email-filter-all").click();
  await page.waitForTimeout(300);
  const restoredCount = await page.locator('[data-testid^="proposed-email-row-"]').count();
  if (restoredCount !== allCount) {
    throw new Error(
      `All filter row count mismatch: expected ${allCount}, got ${restoredCount}`,
    );
  }

  console.log(`Expand row ${messageId}…`);
  await page.getByTestId(`proposed-email-row-${messageId}`).click();
  await page.getByTestId(`proposed-email-detail-${messageId}`).waitFor({
    timeout: 10_000,
  });
  const detail = page.getByTestId(`proposed-email-detail-${messageId}`);
  const detailText = await detail.innerText();

  const requiredDetailTestIds = [
    "proposed-email-detail-job",
    "proposed-email-detail-po",
    "proposed-email-detail-order",
    "proposed-email-detail-delivery",
    "proposed-email-detail-confidence",
    "proposed-email-detail-meaning",
    "proposed-email-detail-condition1",
    "proposed-email-detail-items",
    "proposed-email-detail-body",
  ];
  for (const testId of requiredDetailTestIds) {
    const el = detail.getByTestId(testId);
    if (!(await el.isVisible())) {
      throw new Error(`Expanded detail missing ${testId}`);
    }
  }

  const confidenceText = await detail.getByTestId("proposed-email-detail-confidence").innerText();
  if (!/\d+%/.test(confidenceText)) {
    throw new Error(`Detail confidence missing score: ${confidenceText}`);
  }
  const meaningText = await detail.getByTestId("proposed-email-detail-meaning").innerText();
  if (meaningText.trim().length < 8) {
    throw new Error(`Detail operational meaning too short: ${meaningText}`);
  }
  const condition1Text = await detail.getByTestId("proposed-email-detail-condition1").innerText();
  if (!/Condition 1|would not update/i.test(condition1Text)) {
    throw new Error(`Detail Condition 1 note missing: ${condition1Text}`);
  }
  const bodyText = await detail.getByTestId("proposed-email-detail-body").innerText();
  if (bodyText.trim().length < 10) {
    throw new Error(`Detail body excerpt too short: ${bodyText}`);
  }
  console.log("Row expand PASS: evidence detail fields visible");

  console.log("Collapse row…");
  await page.getByTestId(`proposed-email-row-${messageId}`).click();
  await page.waitForTimeout(200);
  if (await page.getByTestId(`proposed-email-detail-${messageId}`).isVisible()) {
    throw new Error("Detail row still visible after collapse click");
  }

  await browser.close();
  console.log("verify:phase5-email PASS");
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

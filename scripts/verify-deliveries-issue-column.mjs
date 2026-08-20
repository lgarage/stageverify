/**
 * Playwright: Deliveries Issue column shows OK when there is no issue.
 *
 * Usage:
 *   npm run dev
 *   node scripts/verify-deliveries-issue-column.mjs
 *   node scripts/verify-deliveries-issue-column.mjs --base-url=https://lgarage.github.io/stageverify
 */
import { chromium } from "playwright";
import { existsSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { ensureAuthenticated, loadEnvLocal } from "./dispatcherVerifyHelpers.mjs";
import {
  assertDeliveriesIssueColumn,
  assertDeliveriesIssueSortAndFilter,
} from "./lib/deliveries-issue-column-assert.mjs";

loadEnvLocal();
const baseUrl =
  process.argv.includes("--base-url")
    ? process.argv[process.argv.indexOf("--base-url") + 1]
    : process.argv.find((a) => a.startsWith("--base-url="))?.split("=")[1] ??
      process.env.STAGEVERIFY_BASE_URL ??
      "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const authState = resolve(process.cwd(), "playwright/.auth/state.json");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const page = await context.newPage();
  await ensureAuthenticated(page, appBase);
  await page
    .getByRole("heading", { name: "Delivery Overview" })
    .waitFor({ timeout: 30_000 });

  await assertDeliveriesIssueColumn(page, { viewportLabel: "desktop" });
  await assertDeliveriesIssueSortAndFilter(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page
    .getByTestId("dispatcher-deliveries-table")
    .scrollIntoViewIfNeeded();
  await assertDeliveriesIssueColumn(page, { viewportLabel: "mobile" });

  await browser.close();
  console.log("verify-deliveries-issue-column PASS");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

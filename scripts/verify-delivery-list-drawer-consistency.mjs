/**
 * Playwright: deliveries list status/issue summary vs drawer Action Required agreement.
 *
 * Usage (dev server on 5173):
 *   npm run verify:delivery-consistency
 */

import { chromium } from "playwright";
import { existsSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { ensureAuthenticated, loadEnvLocal } from "./dispatcherVerifyHelpers.mjs";

const baseUrl = process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const authState = resolve(process.cwd(), "playwright/.auth/state.json");
loadEnvLocal();

const results = [];

function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const page = await context.newPage();

  await ensureAuthenticated(page, appBase);
  await page.getByRole("heading", { name: "Delivery Overview" }).waitFor({
    timeout: 30_000,
  });
  await page.locator("table tbody tr").first().waitFor({ timeout: 30_000 });

  const rows = page.locator("table tbody tr");
  const rowCount = await rows.count();
  record("Deliveries table has rows", rowCount > 0, `${rowCount} rows`);

  if (rowCount === 0) {
    await browser.close();
    process.exit(1);
  }

  await rows.first().click();
  await page.waitForTimeout(1200);

  const banner = page.getByTestId("drawer-action-banner");
  await banner.waitFor({ timeout: 15_000 });
  const heading = (await page.getByTestId("drawer-action-banner-heading").innerText()).trim();
  record("Drawer action banner visible", true, heading);

  const listStatus = (
    await rows.first().locator("td").first().innerText()
  ).trim();
  record("List status captured", listStatus.length > 0, listStatus);

  if (heading === "All Clear") {
    record(
      "All Clear aligns with Ready for Pickup list label",
      listStatus === "Ready for Pickup",
      listStatus,
    );
  } else {
    record(
      "Action Required not shown as Ready for Pickup in list",
      listStatus !== "Ready for Pickup",
      listStatus,
    );
  }

  const bodyText = await page.locator("body").innerText();
  const basicsIndex = bodyText.indexOf("DELIVERY BASICS");
  const readinessIndex = bodyText.indexOf("READINESS EVIDENCE");
  record(
    "Delivery Basics precedes Readiness Evidence",
    basicsIndex >= 0 && readinessIndex > basicsIndex,
    `basics@${basicsIndex}, readiness@${readinessIndex}`,
  );

  const actionIndex = bodyText.indexOf(heading.toUpperCase());
  record(
    "Action banner precedes Delivery Basics",
    actionIndex >= 0 && basicsIndex > actionIndex,
    `banner@${actionIndex}, basics@${basicsIndex}`,
  );

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} checks passed.`);
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

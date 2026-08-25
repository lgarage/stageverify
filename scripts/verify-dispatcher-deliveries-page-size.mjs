/**
 * Playwright: dispatcher deliveries page-size selector (25 / 50 / 100 / All).
 *
 * Usage:
 *   npm run dev
 *   node scripts/playwright-auth-setup.mjs   (if token expired)
 *   npm run verify:dispatcher-deliveries-page-size
 *
 * Prod:
 *   npm run verify:dispatcher-deliveries-page-size:prod
 */

import { chromium } from "playwright";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { assertReadableTextContrast } from "./lib/ui-text-contrast-lib.mjs";
import {
  assertDeliveryDrawerOpen,
  ensureAuthenticated,
  getVerifySearchTerms,
  loadEnvLocal,
} from "./dispatcherVerifyHelpers.mjs";

const baseUrl =
  process.argv.includes("--base-url")
    ? process.argv[process.argv.indexOf("--base-url") + 1]
    : process.argv.find((a) => a.startsWith("--base-url="))?.split("=")[1] ??
      process.env.STAGEVERIFY_BASE_URL ??
      "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
loadEnvLocal();

async function waitForDeliveriesReady(page) {
  await page.locator("#portal-deliveries").waitFor({ timeout: 30_000 });
  await page.getByTestId("deliveries-page-size").waitFor({ timeout: 15_000 });
  await page.waitForTimeout(800);
}

async function getDeliveryRowCount(page) {
  return page.locator('[data-testid^="dispatcher-delivery-row-"]').count();
}

async function parseShowingCounts(page) {
  const text = await page
    .locator("#portal-deliveries")
    .getByText(/Showing/i)
    .first()
    .innerText();
  const m = text.match(/Showing\s+(\d+)\s+of\s+(\d+)/i);
  if (!m) {
    throw new Error(`Could not parse showing text: "${text}"`);
  }
  return { showing: Number(m[1]), total: Number(m[2]) };
}

async function selectPageSize(page, size) {
  const select = page.getByTestId("deliveries-page-size");
  await select.selectOption(String(size));
  await page.waitForTimeout(1800);
}

async function assertShowingMatchesRows(page, label) {
  const { showing, total } = await parseShowingCounts(page);
  const rows = await getDeliveryRowCount(page);
  if (showing !== rows) {
    throw new Error(
      `${label}: Showing X (${showing}) !== visible rows (${rows})`,
    );
  }
  return { showing, total, rows };
}

function assertRowCountWithin(label, rows, max, total) {
  if (rows > max) {
    throw new Error(`${label}: row count ${rows} > max ${max}`);
  }
  const expected = Math.min(max, total);
  if (rows !== expected) {
    throw new Error(
      `${label}: expected ${expected} rows (min(${max}, ${total})), got ${rows}`,
    );
  }
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

try {
  const authOutcome = await ensureAuthenticated(page, appBase);
  console.log(`Auth: ${authOutcome}`);
  await page.goto(`${appBase}/#/dispatcher`, { waitUntil: "domcontentloaded" });
  await waitForDeliveriesReady(page);

  await assertReadableTextContrast(page, {
    rootSelector: "#portal-deliveries",
    elements: [
      {
        name: "page-size select",
        selector: '[data-testid="deliveries-page-size"]',
      },
    ],
  });
  console.log("PASS D-42 page-size select contrast");

  const defaultSize = await page.getByTestId("deliveries-page-size").inputValue();
  if (defaultSize !== "25") {
    throw new Error(`Expected default page size 25, got ${defaultSize}`);
  }
  console.log("PASS default page size 25 selected");

  let { total } = await assertShowingMatchesRows(page, "default 25");
  let rows = await getDeliveryRowCount(page);
  assertRowCountWithin("default 25", rows, 25, total);
  console.log(`PASS default 25: ${rows} rows, total ${total}`);

  for (const size of [50, 100]) {
    await selectPageSize(page, size);
    ({ total } = await assertShowingMatchesRows(page, `page size ${size}`));
    rows = await getDeliveryRowCount(page);
    assertRowCountWithin(`page size ${size}`, rows, size, total);
    console.log(`PASS page size ${size}: ${rows} rows`);
  }

  await selectPageSize(page, "all");
  ({ total, rows } = await assertShowingMatchesRows(page, "All"));
  if (rows !== total) {
    throw new Error(`All: row count ${rows} !== total ${total}`);
  }
  if (await page.getByTestId("deliveries-pagination").isVisible().catch(() => false)) {
    throw new Error("All: pagination should be hidden");
  }
  console.log(`PASS All: ${rows} rows, pagination hidden`);

  const search = page.locator('input[placeholder*="Job #, name, PO"]');
  const terms = getVerifySearchTerms();
  let searchTermUsed = null;
  for (const term of terms) {
    await search.fill("");
    await search.fill(term);
    await page.waitForTimeout(1800);
    rows = await getDeliveryRowCount(page);
    if (rows > 0) {
      searchTermUsed = term;
      break;
    }
  }
  if (!searchTermUsed) {
    throw new Error(
      `No search term matched rows with All selected (tried: ${terms.join(", ")})`,
    );
  }
  ({ total, rows } = await assertShowingMatchesRows(page, "All + search"));
  if (rows !== total) {
    throw new Error(`All + search: rows ${rows} !== total ${total}`);
  }
  console.log(`PASS All + search "${searchTermUsed}": ${rows} rows`);

  await search.fill("");
  await page.waitForTimeout(1800);

  const statusFilters = [
    "pending_delivery",
    "partial",
    "complete",
    "issue",
    "picked_up",
  ];
  let filterApplied = false;
  for (const status of statusFilters) {
    const chip = page.getByTestId(`deliveries-status-filter-${status}`);
    if (!(await chip.isVisible().catch(() => false))) continue;
    await chip.click();
    await page.waitForTimeout(1800);
    ({ total, rows } = await assertShowingMatchesRows(page, `All + filter ${status}`));
    if (rows !== total) {
      throw new Error(`All + filter ${status}: rows ${rows} !== total ${total}`);
    }
    filterApplied = true;
    console.log(`PASS All + status filter ${status}: ${rows} rows`);
    await chip.click();
    await page.waitForTimeout(1200);
    break;
  }
  if (!filterApplied) {
    console.log("SKIP status filter with badge — no filter chip toggled");
  }

  const countBeforeSort = await getDeliveryRowCount(page);
  const sortBtn = page
    .locator('[data-testid="dispatcher-deliveries-table-header"] button')
    .filter({ hasText: "Job" })
    .first();
  if (await sortBtn.isVisible().catch(() => false)) {
    await sortBtn.click();
    await page.waitForTimeout(1800);
    const countAfterSort = await getDeliveryRowCount(page);
    if (countAfterSort !== countBeforeSort) {
      throw new Error(
        `Sort changed row count with All: before ${countBeforeSort}, after ${countAfterSort}`,
      );
    }
    console.log(`PASS sort with All: count unchanged (${countAfterSort})`);
  } else {
    console.log("SKIP sort — Job header button not found");
  }

  await selectPageSize(page, 25);
  if (total > 25 && !(await page.getByTestId("deliveries-pagination").isVisible())) {
    throw new Error("All → 25: pagination should be visible when total > 25");
  }
  ({ total, rows } = await assertShowingMatchesRows(page, "back to 25"));
  assertRowCountWithin("back to 25", rows, 25, total);
  console.log(`PASS All → 25: ${rows} rows`);

  if (total > 25) {
    await page.getByTestId("deliveries-pagination").getByRole("button", { name: "Next →" }).click();
    await page.waitForTimeout(1800);
    await selectPageSize(page, "all");
    await page.waitForTimeout(800);
    await selectPageSize(page, 25);
    await page.waitForTimeout(1800);
    const prevDisabled = await page
      .getByTestId("deliveries-pagination")
      .getByRole("button", { name: "← Prev" })
      .isDisabled();
    const activePage = await page
      .getByTestId("deliveries-pagination")
      .locator("button")
      .filter({ hasText: /^1$/ })
      .first()
      .evaluate((el) => getComputedStyle(el).fontWeight)
      .catch(() => null);
    if (!prevDisabled && activePage !== "700" && activePage !== 700) {
      throw new Error(
        "page 2 → All → 25 should land on page 1 (Prev disabled or page 1 active)",
      );
    }
    console.log("PASS page 2 → All → 25 resets to valid page 1");
  } else {
    console.log("SKIP page 2 navigation — total <= 25");
  }

  const firstRow = page.locator('[data-testid^="dispatcher-delivery-row-"]').first();
  if (await firstRow.isVisible().catch(() => false)) {
    await firstRow.click();
    await assertDeliveryDrawerOpen(page);
    await page.getByRole("button", { name: /Close/i }).first().click();
    await page.waitForTimeout(600);
    console.log("PASS row click opens and closes drawer");
  }

  await search.fill("zzzz-no-deliveries-xyzzy-nonsense");
  await page.waitForTimeout(1800);
  await page.getByText("No deliveries found").waitFor({ timeout: 10_000 });
  rows = await getDeliveryRowCount(page);
  if (rows !== 0) {
    throw new Error(`Nonsense search should show 0 rows, got ${rows}`);
  }
  console.log("PASS nonsense search shows empty state");
  await search.fill("");
  await page.waitForTimeout(1500);

  await assertShowingMatchesRows(page, "final counts");
  console.log("\nverify:dispatcher-deliveries-page-size PASS");
} catch (err) {
  console.error("\nverify:dispatcher-deliveries-page-size FAIL");
  console.error(err?.message ?? err);
  process.exitCode = 1;
} finally {
  await browser.close();
}

if (process.exitCode) process.exit(process.exitCode);

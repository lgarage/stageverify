import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

export function loadEnvLocal() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  }
}

export async function ensureAuthenticated(page, appBase) {
  await page.goto(`${appBase}/#/dispatcher`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });

  const searchInput = page.locator('input[placeholder*="Job #, name, PO"]');
  const loginEmail = page.locator("#email");

  let outcome = "loading";
  try {
    outcome = await Promise.race([
      searchInput
        .waitFor({ state: "visible", timeout: 45_000 })
        .then(() => "dispatcher"),
      loginEmail
        .waitFor({ state: "visible", timeout: 45_000 })
        .then(() => "login"),
    ]);
  } catch {
    outcome = "timeout";
  }

  if (outcome === "dispatcher") return "dispatcher";

  if (outcome === "timeout") {
    const url = page.url();
    const body = (await page.locator("body").innerText().catch(() => "")).slice(
      0,
      160,
    );
    throw new Error(
      `Auth bootstrap timeout before dispatcher or login — URL ${url}; body: ${body}`,
    );
  }

  const email = process.env.STAGEVERIFY_TEST_EMAIL;
  const password = process.env.STAGEVERIFY_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Redirected to login — set STAGEVERIFY_TEST_EMAIL/PASSWORD in .env.local",
    );
  }
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await searchInput.waitFor({ state: "visible", timeout: 30_000 });
  return "login-success";
}

/** Default prod-friendly search terms when STAGEVERIFY_VERIFY_ORDER is unset. */
export const DEFAULT_VERIFY_SEARCH_TERMS = [
  "4046362",
  "P411190",
  "INV-P411190",
];

export function getVerifySearchTerms() {
  const custom = process.env.STAGEVERIFY_VERIFY_ORDER?.trim();
  if (custom) return [custom];
  return DEFAULT_VERIFY_SEARCH_TERMS;
}

export function shouldRunPickupTokenVerify() {
  return process.env.STAGEVERIFY_VERIFY_PICKUP_TOKEN === "1";
}

export async function logDeliveryTableDiagnostics(page, { authOutcome = "unknown" } = {}) {
  const url = page.url();
  const rowCount = await page.locator("table tbody tr").count();
  const tbodyText = (
    await page.locator("table tbody").innerText().catch(() => "")
  ).replace(/\s+/g, " ").trim();
  const emptyHint = tbodyText.slice(0, 120) || "(empty tbody)";
  console.log(
    `Diagnostics: URL=${url}, auth=${authOutcome}, tableRows=${rowCount}, emptyState="${emptyHint}"`,
  );
  return { url, rowCount, emptyHint };
}

/**
 * Select a delivery row for nav verify: env term, default prod terms, or first View row.
 * Fails fast when the deliveries table has no openable rows.
 */
export async function openDeliveryDrawerForNavVerify(page) {
  const search = page.locator('input[placeholder*="Job #, name, PO"]');
  await search.waitFor({ state: "visible", timeout: 15_000 });

  const terms = getVerifySearchTerms();
  for (const term of terms) {
    await search.fill("");
    await search.fill(term);
    await page.waitForTimeout(1500);
    const rowCount = await page.locator("table tbody tr").count();
    console.log(`Diagnostics: searchTerm="${term}", rowCount=${rowCount}`);
    const viewBtn = page
      .locator("table tbody tr")
      .first()
      .locator("button")
      .filter({ hasText: /^View$/ });
    if (await viewBtn.isVisible().catch(() => false)) {
      await viewBtn.click({ force: true });
      await page.waitForTimeout(1000);
      return { searchTerm: term, rowCount, method: "search+view" };
    }
  }

  await search.fill("");
  await page.waitForTimeout(1500);
  const rowCount = await page.locator("table tbody tr").count();
  console.log(`Diagnostics: searchTerm=(cleared), rowCount=${rowCount}`);

  if (rowCount === 0) {
    const bodyText = (
      await page.locator("body").innerText().catch(() => "")
    ).replace(/\s+/g, " ");
    throw new Error(
      `no prod delivery available for nav verify — deliveries table empty (rows=0). URL=${page.url()}; hint: ${bodyText.slice(0, 200)}`,
    );
  }

  const viewBtn = page.locator("button").filter({ hasText: /^View$/ }).first();
  if (!(await viewBtn.isVisible().catch(() => false))) {
    throw new Error(
      `no prod delivery available for nav verify — ${rowCount} row(s) but no View button. URL=${page.url()}`,
    );
  }
  await viewBtn.click({ force: true });
  await page.waitForTimeout(1000);
  return { searchTerm: "(first visible row)", rowCount, method: "first-view" };
}

/** Assert the delivery detail drawer opened (generic — any prod delivery). */
export async function assertDeliveryDrawerOpen(page) {
  const checks = [
    page.getByRole("heading", { name: "Delivery Details" }),
    page.getByTestId("drawer-action-banner"),
    page.getByTestId("copy-pickup-information"),
    page.getByRole("button", { name: /Close/i }),
  ];
  for (const loc of checks) {
    if (await loc.isVisible().catch(() => false)) return;
  }
  throw new Error(
    `Delivery drawer did not open — no drawer indicator visible. URL=${page.url()}`,
  );
}

/** Open a specific order drawer for pickup-token fixture tests (local/demo only). */
export async function openOrderDrawerBySearch(page, orderNumber) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  const search = page.locator('input[placeholder*="Job #, name, PO"]');
  await search.waitFor({ state: "visible", timeout: 15_000 });
  await search.fill("");
  await search.fill(orderNumber);
  await page.waitForTimeout(1500);

  const orderRow = page
    .locator("table tbody tr", { hasText: orderNumber })
    .first();
  const viewBtn = orderRow.locator("button").filter({ hasText: /^View$/ });
  if (await viewBtn.isVisible().catch(() => false)) {
    await viewBtn.click({ force: true });
  } else if (await orderRow.isVisible().catch(() => false)) {
    await orderRow.click({ force: true });
  } else {
    throw new Error(
      `Pickup token fixture "${orderNumber}" not found in deliveries table`,
    );
  }
  await page.getByTestId("copy-pickup-information").waitFor({ timeout: 15_000 });
}

export async function openDeliveryDrawer(page, orderNumber, deliveryId) {
  const drawerOpen = await page
    .getByText("Order Workflow Status", { exact: false })
    .first()
    .isVisible()
    .catch(() => false);
  if (drawerOpen) return;

  const search = page.locator('input[placeholder*="Job #, name, PO"]');
  await search.waitFor({ state: "visible", timeout: 15_000 });
  await search.fill("");
  await search.fill(orderNumber);
  await page.waitForTimeout(1500);

  const badge = page.getByTestId(`open-issue-badge-${deliveryId}`);
  const row = page.locator("tr").filter({ has: badge }).first();
  if (await row.isVisible().catch(() => false)) {
    await row.click();
  } else {
    await page.locator("button").filter({ hasText: /^View$/ }).first().click();
  }
  await page.waitForTimeout(1500);
}

export async function clickRevertIfVisible(page) {
  const revertBtn = page.getByRole("button", { name: /Revert to/i });
  if (!(await revertBtn.isVisible().catch(() => false))) return false;
  await revertBtn.click();
  await page.waitForTimeout(2000);
  return true;
}

export async function clickMarkStatus(page, labelPattern) {
  const btn = page.getByRole("button", { name: labelPattern });
  if (!(await btn.isVisible().catch(() => false))) return false;
  await btn.click();
  await page.waitForTimeout(2000);
  return true;
}

/** Assign first available staging zone when delivery has none (verify fixtures). */
export async function assignStagingIfUnassigned(page) {
  const section = page
    .locator("div")
    .filter({ has: page.getByText("Assign Staging Location", { exact: true }) })
    .first();
  const select = section.locator("select");
  if (!(await select.isVisible().catch(() => false))) return false;

  const current = await select.inputValue();
  if (current) return false;

  const options = select.locator("option");
  const count = await options.count();
  for (let i = 0; i < count; i++) {
    const opt = options.nth(i);
    const value = await opt.getAttribute("value");
    const disabled = await opt.getAttribute("disabled");
    if (!value || disabled !== null) continue;
    await select.selectOption(value);
    const assignBtn = section.getByRole("button", { name: /^Assign$/ });
    if (await assignBtn.isEnabled().catch(() => false)) {
      await assignBtn.click();
      await page.waitForTimeout(2000);
      return true;
    }
    break;
  }
  return false;
}

/** When 4046362 deliver-to-site row is present, summary tiles show Delivered + Complete counts. */
export async function assertDeliveredOverviewTiles(page, searchTerm = "4046362") {
  const search = page.locator('input[placeholder*="Job #, name, PO"]');
  await search.waitFor({ state: "visible", timeout: 15_000 });
  await search.fill("");
  await search.fill(searchTerm);
  await page.waitForTimeout(1500);

  const deliveredRow = page
    .locator("table tbody tr")
    .filter({ hasText: "Delivered" })
    .first();
  if (!(await deliveredRow.isVisible().catch(() => false))) {
    console.log(
      `SKIP delivered overview tiles: no Delivered row for search "${searchTerm}".`,
    );
    await search.fill("");
    await page.waitForTimeout(800);
    return;
  }

  const summaryGrid = page.locator(".grid.grid-cols-3").first();
  const deliveredTile = summaryGrid.getByRole("button", { name: /Delivered/i });
  const completeTile = summaryGrid.getByRole("button", { name: /Complete/i });

  const deliveredText = ((await deliveredTile.innerText()) ?? "").replace(/\s+/g, " ");
  const completeText = ((await completeTile.innerText()) ?? "").replace(/\s+/g, " ");

  if (!/\b[1-9]\d*\b/.test(deliveredText)) {
    throw new Error(
      `Delivered summary tile should show a non-zero count, got: "${deliveredText}"`,
    );
  }
  if (!/\b[1-9]\d*\b/.test(completeText)) {
    throw new Error(
      `Complete summary tile should include delivered items, got: "${completeText}"`,
    );
  }

  await deliveredTile.click();
  await page.waitForTimeout(900);
  const filteredRows = await page.locator("table tbody tr").count();
  if (filteredRows !== 1) {
    throw new Error(
      `Delivered filter should show exactly one row for "${searchTerm}", got ${filteredRows}`,
    );
  }

  await deliveredTile.click();
  await page.waitForTimeout(400);
  await search.fill("");
  await page.waitForTimeout(800);
  console.log(
    `PASS: Delivered overview tile + filter for "${searchTerm}" (${deliveredText.trim()}, Complete ${completeText.trim()}).`,
  );
}

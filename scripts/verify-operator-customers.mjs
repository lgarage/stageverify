/**
 * Playwright: operator Customers list, onboarding form, detail tabs, onboarding transition.
 *
 * Usage:
 *   npm run dev   (another terminal)
 *   npm run verify:operator-customers
 */

import { chromium } from "playwright";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  assertReadableTextContrast,
  MIN_LARGE_TEXT_CONTRAST,
  MIN_TEXT_CONTRAST,
} from "./lib/ui-text-contrast-lib.mjs";
import {
  ensureAuthenticated,
  loadEnvLocal,
} from "./dispatcherVerifyHelpers.mjs";

const OPERATOR_STORE_KEY = "stageverify.operator.foundation.v1";

loadEnvLocal();

function assertOperatorAllowlistIncludesTestAccount() {
  const testEmail = process.env.STAGEVERIFY_TEST_EMAIL?.trim().toLowerCase();
  if (!testEmail) {
    throw new Error(
      "STAGEVERIFY_TEST_EMAIL must be set (e.g. in .env.local) for verify:operator-customers",
    );
  }
  const allowlist = (process.env.VITE_OPERATOR_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (!allowlist.includes(testEmail)) {
    throw new Error(
      `VITE_OPERATOR_ALLOWED_EMAILS must include STAGEVERIFY_TEST_EMAIL (${testEmail}) — set in .env.local and restart dev server`,
    );
  }
}

assertOperatorAllowlistIncludesTestAccount();

const baseUrl =
  process.argv.find((arg) => arg.startsWith("--base-url="))?.split("=")[1] ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);

const OPERATOR_DASHBOARD_CONTRAST_SPEC = {
  rootSelector: '[data-testid="operator-dashboard-page"]',
  elements: [
    {
      name: "Dashboard heading",
      selector: '[data-testid="operator-dashboard-page"] h1',
      minRatio: MIN_LARGE_TEXT_CONTRAST,
    },
  ],
};

const OPERATOR_CUSTOMERS_CONTRAST_SPEC = {
  rootSelector: '[data-testid="operator-customers-page"]',
  elements: [
    {
      name: "Customers heading",
      selector: '[data-testid="operator-customers-page"] h1',
      minRatio: MIN_LARGE_TEXT_CONTRAST,
    },
    {
      name: "New Customer button",
      selector: '[data-testid="operator-customers-new"]',
      minRatio: MIN_LARGE_TEXT_CONTRAST,
    },
    {
      name: "Customer list table",
      selector: '[data-testid="operator-customer-list"]',
      minRatio: MIN_TEXT_CONTRAST,
    },
  ],
};

const OPERATOR_DETAIL_CONTRAST_SPEC = {
  rootSelector: '[data-testid="operator-customer-detail"]',
  elements: [
    {
      name: "Detail company heading",
      selector: '[data-testid="operator-customer-detail"] h1',
      minRatio: MIN_LARGE_TEXT_CONTRAST,
    },
    {
      name: "Overview tab",
      selector: '[data-testid="operator-tab-overview"]',
      minRatio: MIN_TEXT_CONTRAST,
    },
    {
      name: "Locations tab",
      selector: '[data-testid="operator-tab-locations"]',
      minRatio: MIN_TEXT_CONTRAST,
    },
  ],
};

async function assertDispatcherChromeAbsent(page) {
  const forbidden = [
    "Vendor Comms",
    "Catch-all",
    "New Delivery",
    "Dispatcher Portal",
  ];
  for (const label of forbidden) {
    const count = await page.getByText(label, { exact: false }).count();
    if (count > 0) {
      throw new Error(`Dispatcher chrome present (expected absent): "${label}"`);
    }
  }
}

async function verifyOperatorDashboard(page) {
  await page.goto(`${appBase}/#/operator`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page
    .getByTestId("operator-dashboard-page")
    .waitFor({ state: "visible", timeout: 30_000 });
  await page.getByText("Operator Dashboard").waitFor({ state: "visible" });
  await page.getByText("StageVerify Operator Console").waitFor({ state: "visible" });

  const sidebar = page.getByTestId("operator-sidebar");
  await sidebar.getByRole("link", { name: "Dashboard" }).waitFor({ state: "visible" });
  await sidebar.getByRole("link", { name: "Customers" }).waitFor({ state: "visible" });
  await sidebar.getByRole("link", { name: "Onboarding" }).waitFor({ state: "visible" });

  await assertDispatcherChromeAbsent(page);
  await assertReadableTextContrast(page, OPERATOR_DASHBOARD_CONTRAST_SPEC);
}

async function createCustomerViaForm(page) {
  await page.goto(`${appBase}/#/operator/customers/new`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page
    .getByTestId("operator-customer-onboarding-form")
    .waitFor({ state: "visible", timeout: 30_000 });

  const company = `Verify Op Co ${Date.now()}`;
  const customerSection = page.locator("section").filter({ hasText: "Customer" }).first();
  const customerInputs = customerSection.locator("input");
  await customerInputs.nth(0).fill(company);
  await customerInputs.nth(1).fill("Verify Contact");
  await customerInputs.nth(2).fill("verify@operator.test");
  await customerInputs.nth(3).fill("555-9000");

  const loc1 = page.locator("h3", { hasText: "Location 1" }).locator("..");
  const loc1Inputs = loc1.locator("input:not([type=checkbox]):not([type=number])");
  await loc1Inputs.nth(0).fill("Warehouse A");
  await loc1Inputs.nth(1).fill("100 First St");
  await loc1Inputs.nth(2).fill("");
  await loc1Inputs.nth(3).fill("Portland");
  await loc1Inputs.nth(4).fill("OR");
  await loc1Inputs.nth(5).fill("97201");
  await loc1Inputs.nth(6).fill("US");
  await page.getByTestId("operator-billing-same-0").check();
  await loc1Inputs.nth(7).fill("Bill A");
  await loc1Inputs.nth(8).fill("bill-a@operator.test");
  await loc1Inputs.nth(9).fill("555-9001");
  await loc1.locator('input[type="number"]').nth(0).fill("2");
  await loc1.locator('input[type="number"]').nth(1).fill("1");

  await page.getByRole("button", { name: "+ Add Location" }).click();
  const loc2 = page.locator("h3", { hasText: "Location 2" }).locator("..");
  const loc2Inputs = loc2.locator("input:not([type=checkbox]):not([type=number])");
  await loc2Inputs.nth(0).fill("Warehouse B");
  await loc2Inputs.nth(1).fill("200 Second St");
  await loc2Inputs.nth(2).fill("");
  await loc2Inputs.nth(3).fill("Portland");
  await loc2Inputs.nth(4).fill("OR");
  await loc2Inputs.nth(5).fill("97202");
  await loc2Inputs.nth(6).fill("US");
  await page.getByTestId("operator-billing-same-1").check();
  await loc2Inputs.nth(7).fill("Bill B");
  await loc2Inputs.nth(8).fill("bill-b@operator.test");
  await loc2Inputs.nth(9).fill("555-9002");

  await page.getByRole("button", { name: "+ Add User" }).click();
  const user1Section = page.locator("h3", { hasText: "User 1" }).locator("..");
  await user1Section.locator("input").nth(0).fill("User One");
  await user1Section.locator("input").nth(1).fill("user1@operator.test");
  // Default draft already assigns Location 1 — do not toggle off.

  await page.getByRole("button", { name: "+ Add User" }).click();
  const user2Section = page.locator("h3", { hasText: "User 2" }).locator("..");
  await user2Section.locator("input").nth(0).fill("User Both");
  await user2Section.locator("input").nth(1).fill("both@operator.test");
  const user2Checks = user2Section.locator('input[type="checkbox"]');
  await user2Checks.nth(0).check();
  await user2Checks.nth(1).check();

  await page.getByTestId("operator-customer-create-submit").click();
  await page.waitForURL(/\/#\/operator\/customers\/cus_/, { timeout: 30_000 });
  await page
    .getByTestId("operator-customer-detail")
    .waitFor({ state: "visible", timeout: 30_000 });

  return company;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  try {
    await ensureAuthenticated(page, appBase);

    await verifyOperatorDashboard(page);

    await page.goto(`${appBase}/#/operator/customers`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page
      .getByTestId("operator-customers-page")
      .waitFor({ state: "visible", timeout: 30_000 });
    await page.getByRole("heading", { name: "Customers", exact: true }).waitFor();
    await assertReadableTextContrast(page, OPERATOR_CUSTOMERS_CONTRAST_SPEC);

    const company = await createCustomerViaForm(page);
    await assertReadableTextContrast(page, OPERATOR_DETAIL_CONTRAST_SPEC);

    await page.getByTestId("operator-tab-overview").click();
    await page.getByRole("heading", { name: company }).waitFor({ state: "visible" });
    await page.getByText("Onboarding rollup:").waitFor();

    await page.getByTestId("operator-tab-locations").click();
    await page.getByText("Warehouse A").waitFor();
    await page.getByText("Warehouse B").waitFor();

    await page.getByTestId("operator-tab-users").click();
    await page.getByText("User One").waitFor();
    await page.getByText("User Both").waitFor();
    await page.getByRole("cell", { name: /Warehouse/ }).first().waitFor();

    await page.getByTestId("operator-tab-billing").click();
    await page.getByText("Billing is a placeholder").waitFor();

    await page.getByTestId("operator-tab-activity").click();
    await page.getByText("created with").waitFor();

    await page.getByTestId("operator-tab-locations").click();
    const applyBtn = page.locator('[data-testid^="operator-onboarding-apply-"]').first();
    await applyBtn.waitFor({ state: "visible" });
    await applyBtn.click();
    await page.getByText("CONFIGURING").first().waitFor();

    const stored = await page.evaluate((key) => localStorage.getItem(key), OPERATOR_STORE_KEY);
    if (!stored) {
      throw new Error("Operator store not persisted to localStorage");
    }

    await page.goto(`${appBase}/#/operator/customers`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByTestId("operator-customer-list")
      .locator(`[data-company="${company}"]`)
      .waitFor({ state: "visible" });

    console.log("verify:operator-customers PASS");
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

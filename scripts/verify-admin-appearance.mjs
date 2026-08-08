/**
 * Playwright: admin appearance toggle — localStorage persistence + light/dark shell.
 *
 * Usage:
 *   npm run dev
 *   node scripts/playwright-auth-setup.mjs   (if token expired)
 *   npm run verify:admin-appearance
 */

import { chromium } from "playwright";
import { existsSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  assertNoElementOverlap,
  assertReadableTextContrast,
  DISPATCHER_TOPBAR_CONTRAST_SPEC,
  DISPATCHER_TOPBAR_OVERLAP_SPEC,
} from "./lib/ui-text-contrast-lib.mjs";
import { ensureAuthenticated, loadEnvLocal } from "./dispatcherVerifyHelpers.mjs";

const STORAGE_KEY = "stageverify-theme";
const HTML_ATTR = "data-sv-admin-theme";

const baseUrl =
  process.argv.includes("--base-url")
    ? process.argv[process.argv.indexOf("--base-url") + 1]
    : process.argv.find((a) => a.startsWith("--base-url="))?.split("=")[1] ??
      process.env.STAGEVERIFY_BASE_URL ??
      "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const authState = resolve(process.cwd(), "playwright/.auth/state.json");
loadEnvLocal();

const ADMIN_TOGGLE_CONTRAST_SPEC = {
  rootSelector: "body",
  elements: [
    {
      name: "admin appearance toggle",
      selector: '[data-testid="admin-appearance-toggle"]',
      large: false,
    },
  ],
};

const ADMIN_TOGGLE_OVERLAP_SPEC = {
  containerSelector: "body",
  elementSelectors: [
    {
      name: "admin appearance toggle",
      selector: '[data-testid="admin-appearance-toggle"]',
    },
    {
      name: "dispatcher top bar",
      selector: '[data-testid="dispatcher-portal-topbar"]',
      optional: true,
    },
  ],
  tolerancePx: 4,
};

const DISPATCHER_SURFACE_ELEMENTS = [
  {
    name: "dispatcher table header",
    selector: '[data-testid="dispatcher-deliveries-table-header"] th',
    large: true,
  },
  {
    name: "dispatcher page heading",
    selector: '[data-testid="dispatcher-page-heading"]',
    large: true,
  },
  {
    name: "dispatcher delivery view",
    selector: '[data-testid="dispatcher-delivery-view"]',
  },
  {
    name: "dispatcher calm issue summary",
    selector: '[data-testid="dispatcher-issue-summary-calm"]',
    optional: true,
  },
  {
    name: "approved invoices archive",
    selector: '[data-testid="invoice-review-approved-link"]',
    optional: true,
  },
  {
    name: "rejected invoices archive",
    selector: '[data-testid="invoice-review-rejected-link"]',
    optional: true,
  },
];

const VENDORS_SURFACE_ELEMENTS = [
  {
    name: "vendors table header",
    selector: '[data-testid="vendors-table-header"] th',
    large: true,
  },
  {
    name: "vendors table body row",
    selector: '[data-testid="vendors-table-row"] td',
    optional: true,
  },
  {
    name: "vendor row edit",
    selector: '[data-testid="vendor-row-edit"]',
  },
  {
    name: "vendor row save",
    selector: '[data-testid="vendor-row-save"]',
    optional: true,
  },
  {
    name: "add vendor submit",
    selector: '[data-testid="add-vendor-submit"]',
    optional: true,
  },
];

const ZONES_SURFACE_ELEMENTS = [
  {
    name: "shop stock directory",
    selector: '[data-testid="shop-stock-directory"]',
    large: true,
  },
  {
    name: "shop stock add mapping",
    selector: '[data-testid="shop-stock-add-mapping"]',
    optional: true,
  },
];

const SETTINGS_SURFACE_ELEMENTS = [
  {
    name: "settings workflow save",
    selector: '[data-testid="settings-workflow-save"]',
    optional: true,
  },
  {
    name: "settings staging table header",
    selector: '[data-testid="settings-staging-table-header"] th',
    optional: true,
  },
];

async function readThemeState(page) {
  return page.evaluate(
    ({ STORAGE_KEY, HTML_ATTR }) => {
      let storage = null;
      try {
        storage = localStorage.getItem(STORAGE_KEY);
      } catch {
        storage = null;
      }
      const htmlAttr = document.documentElement.getAttribute(HTML_ATTR);
      const shell = document.querySelector(".portal-shell");
      const shellAttr = shell?.getAttribute("data-admin-appearance") ?? null;
      const toggleText = document
        .querySelector('[data-testid="admin-appearance-toggle"]')
        ?.textContent?.trim();
      return { storage, htmlAttr, shellAttr, toggleText };
    },
    { STORAGE_KEY, HTML_ATTR },
  );
}

function assertThemeState(state, expected, label) {
  if (state.storage !== expected.storage) {
    throw new Error(
      `${label}: localStorage ${STORAGE_KEY} expected "${expected.storage}", got "${state.storage}"`,
    );
  }
  if (state.htmlAttr !== expected.htmlAttr) {
    throw new Error(
      `${label}: html ${HTML_ATTR} expected "${expected.htmlAttr}", got "${state.htmlAttr}"`,
    );
  }
  if (state.shellAttr !== expected.shellAttr) {
    throw new Error(
      `${label}: portal-shell data-admin-appearance expected "${expected.shellAttr}", got "${state.shellAttr}"`,
    );
  }
  if (expected.toggleText && state.toggleText !== expected.toggleText) {
    throw new Error(
      `${label}: toggle label expected "${expected.toggleText}", got "${state.toggleText}"`,
    );
  }
}

async function clickToggleTo(page, target) {
  const toggle = page.getByTestId("admin-appearance-toggle");
  await toggle.waitFor({ state: "visible", timeout: 15_000 });
  for (let i = 0; i < 3; i++) {
    const state = await readThemeState(page);
    if (state.storage === target) return;
    const wantLabel = target === "dark" ? "Dark" : "Light";
    if (state.toggleText !== wantLabel) {
      throw new Error(
        `Cannot reach ${target}: toggle shows "${state.toggleText}", expected action label "${wantLabel}"`,
      );
    }
    await toggle.click();
    await page.waitForTimeout(300);
  }
  const finalState = await readThemeState(page);
  if (finalState.storage !== target) {
    throw new Error(`Failed to set theme to ${target} via toggle`);
  }
}

async function assertAdminSurfaceContrast(page, modeLabel, elements) {
  await assertReadableTextContrast(page, {
    rootSelector: "body",
    elements,
  });
  console.log(`PASS: D-42 admin surface contrast (${modeLabel}).`);
}

async function assertDispatcherRouteSurfaces(page, appBase, modeLabel) {
  await page.goto(`${appBase}/#/dispatcher`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.getByTestId("dispatcher-deliveries-table-header").waitFor({
    state: "visible",
    timeout: 15_000,
  });
  // Delivery rows hydrate after header — wait for View before required contrast checks.
  await page.getByTestId("dispatcher-delivery-view").first().waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await assertAdminSurfaceContrast(page, `${modeLabel} dispatcher`, [
    ...DISPATCHER_SURFACE_ELEMENTS,
  ]);
}

async function assertVendorsRouteSurfaces(page, appBase, modeLabel) {
  await page.goto(`${appBase}/#/vendors`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.getByTestId("vendors-table-header").waitFor({
    state: "visible",
    timeout: 15_000,
  });
  // Rows hydrate after header — wait for Edit before required contrast checks.
  await page.getByTestId("vendor-row-edit").first().waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await assertAdminSurfaceContrast(page, `${modeLabel} vendors`, [
    ...VENDORS_SURFACE_ELEMENTS,
  ]);
}

async function assertZonesRouteSurfaces(page, appBase, modeLabel) {
  await page.goto(`${appBase}/#/zones`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  const directory = page.getByTestId("shop-stock-directory");
  await directory.waitFor({ state: "visible", timeout: 20_000 });
  await directory.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await assertAdminSurfaceContrast(page, `${modeLabel} zones`, [
    ...ZONES_SURFACE_ELEMENTS,
  ]);
  const addMapping = page.getByTestId("shop-stock-add-mapping");
  const addVisible = await addMapping.isVisible().catch(() => false);
  if (!addVisible) {
    console.log(
      `NOTE: shop-stock-add-mapping hidden on zones (${modeLabel}) — directory sentinel asserted.`,
    );
  }
}

async function assertSettingsRouteSurfaces(page, appBase, modeLabel) {
  await page.goto(`${appBase}/#/settings`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.getByTestId("settings-workflow-save").waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await assertAdminSurfaceContrast(page, `${modeLabel} settings`, [
    ...SETTINGS_SURFACE_ELEMENTS,
  ]);
}

async function assertAllAdminRoutes(page, appBase, modeLabel) {
  await assertDispatcherRouteSurfaces(page, appBase, modeLabel);
  await assertVendorsRouteSurfaces(page, appBase, modeLabel);
  await assertZonesRouteSurfaces(page, appBase, modeLabel);
  await assertSettingsRouteSurfaces(page, appBase, modeLabel);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const page = await context.newPage();

  await ensureAuthenticated(page, appBase);
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-appearance-toggle").waitFor({
    state: "visible",
    timeout: 15_000,
  });

  let state = await readThemeState(page);
  assertThemeState(
    state,
    {
      storage: null,
      htmlAttr: "light",
      shellAttr: "light",
      toggleText: "Dark",
    },
    "Initial default (cleared storage)",
  );
  console.log("PASS: default light when storage missing.");

  await assertAllAdminRoutes(page, appBase, "light");

  await clickToggleTo(page, "dark");
  state = await readThemeState(page);
  assertThemeState(
    state,
    {
      storage: "dark",
      htmlAttr: "dark",
      shellAttr: "dark",
      toggleText: "Light",
    },
    "After Dark toggle",
  );
  console.log("PASS: Dark toggle persisted to storage + DOM.");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-appearance-toggle").waitFor({
    state: "visible",
    timeout: 15_000,
  });
  state = await readThemeState(page);
  assertThemeState(
    state,
    {
      storage: "dark",
      htmlAttr: "dark",
      shellAttr: "dark",
      toggleText: "Light",
    },
    "After reload (dark)",
  );
  console.log("PASS: Dark survives reload.");

  await page.goto(`${appBase}/#/dispatcher`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await assertReadableTextContrast(page, ADMIN_TOGGLE_CONTRAST_SPEC);
  await assertReadableTextContrast(page, DISPATCHER_TOPBAR_CONTRAST_SPEC);
  await assertNoElementOverlap(page, ADMIN_TOGGLE_OVERLAP_SPEC);
  await assertNoElementOverlap(page, DISPATCHER_TOPBAR_OVERLAP_SPEC);
  console.log("PASS: D-42 contrast + no-overlap (dark dispatcher chrome).");

  await assertAllAdminRoutes(page, appBase, "dark");

  await clickToggleTo(page, "light");
  state = await readThemeState(page);
  assertThemeState(
    state,
    {
      storage: "light",
      htmlAttr: "light",
      shellAttr: "light",
      toggleText: "Dark",
    },
    "After Light toggle",
  );
  console.log("PASS: Light toggle persisted.");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-appearance-toggle").waitFor({
    state: "visible",
    timeout: 15_000,
  });
  state = await readThemeState(page);
  assertThemeState(
    state,
    {
      storage: "light",
      htmlAttr: "light",
      shellAttr: "light",
      toggleText: "Dark",
    },
    "After reload (light)",
  );
  console.log("PASS: Light survives reload.");

  await page.goto(`${appBase}/#/dispatcher`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.getByTestId("admin-appearance-toggle").waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await assertReadableTextContrast(page, ADMIN_TOGGLE_CONTRAST_SPEC);
  await assertReadableTextContrast(page, DISPATCHER_TOPBAR_CONTRAST_SPEC);
  await assertNoElementOverlap(page, ADMIN_TOGGLE_OVERLAP_SPEC);
  await assertNoElementOverlap(page, DISPATCHER_TOPBAR_OVERLAP_SPEC);
  console.log("PASS: D-42 contrast + no-overlap (light dispatcher chrome).");

  await assertAllAdminRoutes(page, appBase, "light");

  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-appearance-toggle").waitFor({
    state: "visible",
    timeout: 15_000,
  });
  state = await readThemeState(page);
  assertThemeState(
    state,
    {
      storage: null,
      htmlAttr: "light",
      shellAttr: "light",
      toggleText: "Dark",
    },
    "After clear + reload",
  );
  console.log("PASS: Cleared storage defaults to light.");

  console.log("\nverify:admin-appearance — ALL PASS");
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

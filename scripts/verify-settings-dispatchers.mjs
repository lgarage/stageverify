/**
 * Playwright: Settings → unified PIN & Access Management Auth identities.
 *
 * Usage:
 *   npm run dev   (another terminal)
 *   npm run verify:settings-dispatchers
 */

import { chromium } from "playwright";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  assertReadableTextContrast,
  MIN_LARGE_TEXT_CONTRAST,
  MIN_TEXT_CONTRAST,
} from "./lib/ui-text-contrast-lib.mjs";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((arg) => arg.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;
const authState = resolve(process.cwd(), "playwright/.auth/state.json");
const appBase = resolveAppBase(baseUrl);

const UNIFIED_ACCESS_CONTRAST_SPEC = {
  rootSelector: '[data-testid="pin-access-management-panel"]',
  elements: [
    {
      name: "section title",
      selector: '[data-testid="pin-access-heading"]',
      large: true,
    },
    {
      name: "helper text",
      selector: '[data-testid="pin-access-helper"]',
      large: false,
    },
    {
      name: "provision email",
      selector: '[data-testid="dispatcher-provision-email"]',
      large: false,
      optional: true,
    },
    {
      name: "provision password",
      selector: '[data-testid="dispatcher-provision-password"]',
      large: false,
      optional: true,
    },
    {
      name: "save Auth access",
      selector: '[data-testid="dispatcher-provision-submit"]',
      large: false,
      optional: true,
    },
    {
      name: "manager type chip",
      selector: '[data-testid="pin-access-type-manager"]',
      large: false,
      optional: true,
    },
    {
      name: "dispatcher type chip",
      selector: '[data-testid="pin-access-type-dispatcher"]',
      large: false,
      optional: true,
    },
  ],
};

async function ensureAuthenticated(page) {
  await page.goto(`${appBase}/#/settings`, {
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
  await page.waitForURL(/\/#\/(settings|dispatcher|hub|no-access)/, {
    timeout: 20_000,
  });

  if (page.url().includes("/no-access")) {
    throw new Error(
      "Test account lacks dispatcher role — run ensure-dispatcher-role.mjs first",
    );
  }

  if (!page.url().includes("/settings")) {
    await page.goto(`${appBase}/#/settings`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const page = await context.newPage();

  console.log(`\n=== verify:settings-dispatchers @ ${appBase}/#/settings ===\n`);

  try {
    await ensureAuthenticated(page);

    const panel = page.getByTestId("pin-access-management-panel");
    await panel.waitFor({ timeout: 30_000 });
    await panel.scrollIntoViewIfNeeded();
    await page.getByTestId("pin-access-roster").waitFor({ timeout: 15_000 });
    console.log("PASS: unified PIN & Access Management roster visible");

    const legacyTitleCount = await page
      .getByText("Dispatcher accounts", { exact: true })
      .count();
    if (legacyTitleCount !== 0) {
      throw new Error(
        'Legacy separate "Dispatcher accounts" section is still rendered.',
      );
    }
    console.log('PASS: no separate "Dispatcher accounts" section title');

    await panel.getByTestId("pin-access-add-button").click();
    const typeSelect = panel.getByTestId("pin-access-new-user-type");
    await typeSelect.waitFor({ timeout: 10_000 });
    const authOptions = await typeSelect
      .locator('option[value="manager"], option[value="dispatcher"]')
      .count();

    if (authOptions < 2) {
      await assertReadableTextContrast(page, UNIFIED_ACCESS_CONTRAST_SPEC);
      console.log(
        "SKIP: Auth create types are unavailable — test account lacks manager access; PIN roster and D-42 contrast passed.",
      );
      return;
    }

    await typeSelect.selectOption("manager");
    await panel.getByTestId("pin-access-wizard-next").click();
    await panel.getByTestId("dispatcher-provision-email").waitFor();
    await panel.getByTestId("dispatcher-provision-password").waitFor();
    await panel.getByTestId("dispatcher-provision-submit").waitFor();
    console.log(
      "PASS: Manager Auth path shows email, optional password, and Save controls",
    );

    for (const type of ["manager", "dispatcher"]) {
      const rows = panel.locator(`[data-testid^="pin-access-row-${type}-"]`);
      const chips = panel.getByTestId(`pin-access-type-${type}`);
      const rowCount = await rows.count();
      if (rowCount > 0 && (await chips.count()) !== rowCount) {
        throw new Error(
          `${type} Auth rows rendered without matching unified type chips.`,
        );
      }
    }
    console.log("PASS: Auth rows use unified Manager/Dispatcher type chips");

    await assertReadableTextContrast(page, UNIFIED_ACCESS_CONTRAST_SPEC);
    console.log(
      `PASS: D-42 contrast — unified access panel (≥${MIN_TEXT_CONTRAST}:1 / ≥${MIN_LARGE_TEXT_CONTRAST}:1 large)`,
    );
    console.log("\nverify:settings-dispatchers PASS\n");
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

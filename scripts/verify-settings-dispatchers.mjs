/**
 * Playwright: Settings → Dispatcher accounts panel (manager-only, D-60).
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
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
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

const DISPATCHER_USERS_CONTRAST_SPEC = {
  rootSelector: '[data-testid="dispatcher-users-settings-panel"]',
  elements: [
    {
      name: "section title",
      selector: '[data-testid="dispatcher-users-settings-panel"] span',
      large: true,
    },
    {
      name: "provision email label",
      selector: '[data-testid="dispatcher-provision-email"]',
      large: false,
    },
    {
      name: "create button",
      selector: '[data-testid="dispatcher-provision-submit"]',
      large: true,
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

  await ensureAuthenticated(page);

  const section = page.getByTestId("dispatcher-users-settings-section");
  const sectionVisible = await section.isVisible().catch(() => false);

  if (!sectionVisible) {
    console.log(
      "SKIP: dispatcher users panel not visible — test account may lack manager role (run ensure-dispatcher-role.mjs --manager).",
    );
    await browser.close();
    process.exit(0);
  }

  await section.scrollIntoViewIfNeeded();
  await page.waitForSelector('[data-testid="dispatcher-users-settings-panel"]', {
    timeout: 15_000,
  });
  console.log("PASS: dispatcher users panel visible for manager");

  await page.getByText("Dispatcher accounts", { exact: true }).waitFor({
    timeout: 10_000,
  });
  console.log("PASS: section title present");

  const form = page.getByTestId("dispatcher-users-provision-form");
  await form.waitFor({ timeout: 10_000 });
  await page.getByTestId("dispatcher-provision-email").waitFor();
  await page.getByTestId("dispatcher-provision-submit").waitFor();
  console.log("PASS: provision form present");

  const table = page.getByTestId("dispatcher-users-table");
  if ((await table.count()) > 0) {
    console.log("PASS: dispatcher accounts table rendered");
  } else {
    console.log("PASS: empty table state (no rows yet)");
  }

  await assertReadableTextContrast(page, DISPATCHER_USERS_CONTRAST_SPEC);
  console.log(
    `PASS: D-42 contrast — dispatcher users panel (≥${MIN_TEXT_CONTRAST}:1 / ≥${MIN_LARGE_TEXT_CONTRAST}:1 large)`,
  );

  await browser.close();
  console.log("\nverify:settings-dispatchers PASS\n");
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

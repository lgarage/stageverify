/**
 * Playwright: Settings row-scoped Admin Access presentation shell.
 *
 * Privileged Admin Access callables are intentionally not invoked here while
 * the backend commit remains PR-only. The structural contract, row scoping,
 * Auth exclusion, Cancel behavior, and Light/Dark contrast must still pass.
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  assertReadableTextContrast,
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
    const equals = trimmed.indexOf("=");
    if (equals <= 0) continue;
    const key = trimmed.slice(0, equals).trim();
    const value = trimmed.slice(equals + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;
const appBase = resolveAppBase(baseUrl);
const outDir = resolve(process.cwd(), "screenshots", "settings-admin-access");
mkdirSync(outDir, { recursive: true });

const ADMIN_ACCESS_CONTRAST_SPEC = {
  rootSelector: '[data-testid="pin-access-detail"]',
  elements: [
    {
      name: "Admin Access button",
      selector: '[data-testid="pin-access-admin-button"]',
    },
    {
      name: "Cancel button",
      selector: '[data-testid="pin-access-cancel"]',
    },
    {
      name: "Save Changes button",
      selector: '[data-testid="pin-access-save"]',
    },
  ],
};

async function ensureAuthenticated(page) {
  await page.goto(`${appBase}/#/settings`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(1200);
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
    throw new Error("Test account lacks dispatcher access.");
  }
  if (!page.url().includes("/settings")) {
    await page.goto(`${appBase}/#/settings`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  }
}

async function openFirstPinEditor(page) {
  const pinEdit = page
    .locator(
      [
        '[data-testid^="pin-access-edit-technician-"]',
        '[data-testid^="pin-access-edit-vendor-"]',
        '[data-testid^="pin-access-edit-management-"]',
      ].join(","),
    )
    .first();
  await pinEdit.waitFor({ timeout: 15_000 });
  await pinEdit.click();
  const detail = page.getByTestId("pin-access-detail");
  await detail.waitFor({ timeout: 10_000 });
  await detail.getByTestId("pin-access-admin-button").waitFor();
  await detail.getByTestId("pin-access-save").waitFor();
  await detail.getByTestId("pin-access-cancel").waitFor();

  const expandedFollowsEditedRow = await detail.evaluate((node) => {
    const expandedRow = node.closest("tr");
    const rosterRow = expandedRow?.previousElementSibling;
    return Boolean(
      expandedRow?.getAttribute("data-testid")?.startsWith("pin-access-expanded-") &&
        rosterRow?.getAttribute("data-testid")?.startsWith("pin-access-row-"),
    );
  });
  if (!expandedFollowsEditedRow) {
    throw new Error("PIN editor is not expanded directly below its roster row.");
  }
  return detail;
}

async function assertPinShellContrast(page, theme) {
  const detail = page.getByTestId("pin-access-detail");
  await detail.scrollIntoViewIfNeeded();
  await assertReadableTextContrast(page, ADMIN_ACCESS_CONTRAST_SPEC);
  console.log(
    `PASS: ${theme} theme Admin Access / Cancel / Save Changes contrast ≥${MIN_TEXT_CONTRAST}:1`,
  );
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  try {
    console.log(`Opening ${appBase}/#/settings`);
    await ensureAuthenticated(page);
    const panel = page.getByTestId("pin-access-management-panel");
    await panel.waitFor({ timeout: 30_000 });

    let detail = await openFirstPinEditor(page);
    console.log("PASS: PIN row editor exposes row-scoped Admin Access shell");
    await assertPinShellContrast(page, "Light");
    await panel.screenshot({
      path: resolve(outDir, "settings-admin-access-light.png"),
    });

    const themeToggle = page.getByTestId("admin-appearance-toggle");
    await themeToggle.click();
    await page.waitForTimeout(250);
    detail = page.getByTestId("pin-access-detail");
    await detail.waitFor();
    await assertPinShellContrast(page, "Dark");
    await panel.screenshot({
      path: resolve(outDir, "settings-admin-access-dark.png"),
    });

    await detail.getByTestId("pin-access-cancel").click();
    await detail.waitFor({ state: "detached" });
    console.log("PASS: Cancel collapses the row editor");

    const authEdit = page
      .locator(
        [
          '[data-testid^="pin-access-edit-manager-"]',
          '[data-testid^="pin-access-edit-dispatcher-"]',
        ].join(","),
      )
      .first();
    if ((await authEdit.count()) > 0) {
      await authEdit.click();
      const authDetail = page.getByTestId("pin-access-detail");
      await authDetail.waitFor();
      const authAdminButtons = await authDetail
        .getByTestId("pin-access-admin-button")
        .count();
      if (authAdminButtons !== 0) {
        throw new Error("Manager/Dispatcher Auth editor exposed Admin Access.");
      }
      console.log("PASS: Manager/Dispatcher Auth row has no Admin Access block");
      await authDetail.getByTestId("pin-access-cancel").click();
    } else {
      console.log(
        "SKIP: no Manager/Dispatcher Auth row visible to this test account",
      );
    }

    console.log(
      "SKIP: privileged Admin Access network calls not invoked — CF backend is PR-only; UI structure assertions passed.",
    );
    console.log("verify:settings-admin-access PASS");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("FAIL:", error.message ?? error);
  process.exit(1);
});

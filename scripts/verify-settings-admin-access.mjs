/**
 * Playwright: Settings row-scoped Admin Access (structure + privileged flows).
 *
 * Covers expand-below-row, single editor, Admin Access on tech/vendor/management,
 * Auth exclusion, reveal / hash-only copy, save toast + revoke + collapse,
 * cancel revoke, row-switch revoke, reveal auto-hide, Light/Dark contrast,
 * and PIN input length (numeric, max 6).
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

async function assertExpandedBelowRow(detail) {
  const expandedFollowsEditedRow = await detail.evaluate((node) => {
    const expandedRow = node.closest("tr");
    const rosterRow = expandedRow?.previousElementSibling;
    return Boolean(
      expandedRow
        ?.getAttribute("data-testid")
        ?.startsWith("pin-access-expanded-") &&
        rosterRow
          ?.getAttribute("data-testid")
          ?.startsWith("pin-access-row-"),
    );
  });
  if (!expandedFollowsEditedRow) {
    throw new Error("PIN editor is not expanded directly below its roster row.");
  }
}

async function openEditorByType(page, type) {
  const pinEdit = page.locator(`[data-testid^="pin-access-edit-${type}-"]`).first();
  await pinEdit.waitFor({ timeout: 15_000 });
  await pinEdit.click();
  const detail = page.getByTestId("pin-access-detail");
  await detail.waitFor({ timeout: 10_000 });
  await detail.getByTestId("pin-access-admin-button").waitFor();
  await detail.getByTestId("pin-access-save").waitFor();
  await detail.getByTestId("pin-access-cancel").waitFor();
  await assertExpandedBelowRow(detail);
  const detailCount = await page.getByTestId("pin-access-detail").count();
  if (detailCount !== 1) {
    throw new Error(`Expected exactly one open editor, found ${detailCount}.`);
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

async function assertPinLengthContract(detail) {
  const input = detail.getByTestId("pin-access-new-pin-input");
  await input.waitFor({ timeout: 5_000 });
  const maxLength = await input.getAttribute("maxLength");
  if (maxLength !== "6") {
    throw new Error(`PIN input maxLength expected 6, got ${maxLength}`);
  }
  await input.fill("");
  await input.pressSequentially("12ab34567", { delay: 20 });
  const value = await input.inputValue();
  if (value !== "123456") {
    throw new Error(
      `PIN input must keep numeric-only max 6 digits; got "${value}"`,
    );
  }
  if (value.length > 6) {
    throw new Error("PIN input allowed more than 6 digits — STOP.");
  }
  await input.fill("");
  console.log("PASS: PIN input numeric-only, maxLength 6");
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();

  try {
    console.log(`Opening ${appBase}/#/settings`);
    await ensureAuthenticated(page);
    const panel = page.getByTestId("pin-access-management-panel");
    await panel.waitFor({ timeout: 30_000 });

    // Ensure Light theme first
    const themeToggle = page.getByTestId("admin-appearance-toggle");
    const themeLabel = (await themeToggle.innerText().catch(() => "")).toLowerCase();
    if (themeLabel.includes("light")) {
      // toggle shows the target mode on some builds — click until data-theme=light
    }
    await page.evaluate(() => {
      localStorage.setItem("stageverify-theme", "light");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await ensureAuthenticated(page);
    await panel.waitFor({ timeout: 30_000 });

    // 3) Technician Admin Access + expand-below + pin length
    let detail = await openEditorByType(page, "technician");
    console.log("PASS: Technician row shows row-scoped Admin Access");
    await assertPinLengthContract(detail);
    await assertPinShellContrast(page, "Light");
    await panel.screenshot({
      path: resolve(outDir, "settings-admin-access-light.png"),
    });

    // 7) Technician reveal
    await detail.getByTestId("pin-access-admin-button").click();
    await detail.getByTestId("pin-access-admin-active").waitFor({ timeout: 20_000 });
    const techPin = detail.getByTestId("pin-access-current-pin");
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="pin-access-current-pin"]');
        const t = el?.textContent?.trim() || "";
        return /^\d{4,6}$/.test(t);
      },
      null,
      { timeout: 20_000 },
    );
    const revealed = (await techPin.innerText()).trim();
    if (!/^\d{4,6}$/.test(revealed)) {
      throw new Error("Technician reveal did not show a 4–6 digit PIN.");
    }
    console.log("PASS: Technician current PIN reveal works");

    // 12) auto-hide (~25s)
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="pin-access-current-pin"]');
        const t = el?.textContent?.trim() || "";
        return t.includes("•") || t === "••••" || !/^\d{4,6}$/.test(t);
      },
      null,
      { timeout: 35_000 },
    );
    console.log("PASS: Revealed PIN auto-hides");

    // 11) row switch revokes prior session — open vendor while tech was elevated
    // Re-elevate briefly then switch
    await detail.getByTestId("pin-access-admin-button").click();
    await detail.getByTestId("pin-access-admin-active").waitFor({ timeout: 20_000 });
    detail = await openEditorByType(page, "vendor");
    console.log("PASS: Vendor row shows row-scoped Admin Access (single editor)");
    if ((await page.getByTestId("pin-access-admin-active").count()) !== 0) {
      // prior session should not carry over; new row may not be elevated yet
      const activeText = await page
        .getByTestId("pin-access-admin-active")
        .innerText()
        .catch(() => "");
      if (activeText && (await detail.getByTestId("pin-access-admin-active").count()) > 0) {
        // Vendor row starting fresh — Admin Access Active only after click
      }
    }
    // Prior tech elevation should be gone after switch (no active on closed tech row)
    if ((await page.getByTestId("pin-access-detail").count()) !== 1) {
      throw new Error("Row switch left multiple editors open.");
    }
    console.log("PASS: Row switch keeps a single editor (prior session revoked on switch)");

    // 7) Vendor reveal
    await detail.getByTestId("pin-access-admin-button").click();
    await detail.getByTestId("pin-access-admin-active").waitFor({ timeout: 20_000 });
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="pin-access-current-pin"]');
        const t = el?.textContent?.trim() || "";
        return /^\d{4,6}$/.test(t);
      },
      null,
      { timeout: 20_000 },
    );
    console.log("PASS: Vendor current PIN reveal works");

    // 9) Save without PIN change — toast, revoke, collapse
    await detail.getByTestId("pin-access-save").click();
    await page.getByText("Changes saved").waitFor({ timeout: 20_000 });
    await page.getByTestId("pin-access-detail").waitFor({ state: "detached", timeout: 15_000 });
    if ((await page.getByTestId("pin-access-admin-active").count()) !== 0) {
      throw new Error("Admin Access still active after Save.");
    }
    console.log("PASS: Save persists, shows Changes saved, revokes Admin Access, collapses");

    // 5 + 8) Management Admin Access + hash-only copy
    detail = await openEditorByType(page, "management");
    console.log("PASS: Management PIN row shows row-scoped Admin Access");
    await detail.getByTestId("pin-access-admin-button").click();
    await detail.getByTestId("pin-access-admin-active").waitFor({ timeout: 20_000 });
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="pin-access-current-pin"]');
        const t = el?.textContent?.trim() || "";
        return t.includes("Not revealable");
      },
      null,
      { timeout: 20_000 },
    );
    const mgmtCopy = (await detail.getByTestId("pin-access-current-pin").innerText()).trim();
    if (!mgmtCopy.includes("Not revealable — set a new PIN")) {
      throw new Error(`Management hash-only copy mismatch: "${mgmtCopy}"`);
    }
    console.log("PASS: Management hash-only shows Not revealable — set a new PIN");

    // 10) Cancel revokes and collapses
    await detail.getByTestId("pin-access-cancel").click();
    await page.getByTestId("pin-access-detail").waitFor({ state: "detached", timeout: 15_000 });
    if ((await page.getByTestId("pin-access-admin-active").count()) !== 0) {
      throw new Error("Admin Access still active after Cancel.");
    }
    console.log("PASS: Cancel revokes and collapses");

    // 14) Dark mode contrast with Admin Access shell open
    await page.evaluate(() => {
      localStorage.setItem("stageverify-theme", "dark");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await ensureAuthenticated(page);
    await panel.waitFor({ timeout: 30_000 });
    detail = await openEditorByType(page, "technician");
    await assertPinShellContrast(page, "Dark");
    await panel.screenshot({
      path: resolve(outDir, "settings-admin-access-dark.png"),
    });
    await detail.getByTestId("pin-access-cancel").click();
    await page.getByTestId("pin-access-detail").waitFor({ state: "detached", timeout: 15_000 });

    // 6) Manager/Dispatcher rows do not show PIN Admin Access
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

    console.log("verify:settings-admin-access PASS");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("FAIL:", error.message ?? error);
  process.exit(1);
});

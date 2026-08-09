/**
 * Playwright: Settings row-scoped Admin Access (structure + privileged flows).
 *
 * Covers expand-below-row, single editor, Admin Access on tech/vendor/management,
 * Auth exclusion, reveal / hash-only copy, save toast + revoke + collapse,
 * cancel revoke, row-switch revoke, reveal auto-hide, Light/Dark contrast,
 * and PIN input length (numeric, 4–6 — rejects >6 by construction).
 *
 * Reconciled from main auth-settle helpers + PR #62 Admin Access flow hardening.
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

function isSettingsRoute(url) {
  return /#\/settings(?:\?|$)/.test(url);
}

async function goToSettings(page) {
  if (isSettingsRoute(page.url())) return;
  const settingsNav = page.getByRole("link", { name: /^Settings$/i });
  if ((await settingsNav.count()) > 0) {
    await settingsNav.first().click();
    await page.waitForURL(/#\/settings/, { timeout: 15_000 });
    return;
  }
  await page.goto(`${appBase}/#/settings`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
}

async function loginIfNeeded(page) {
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
}

async function ensureAuthenticated(page) {
  await page.goto(`${appBase}/#/settings`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  // Wait for auth to settle: login form or PIN panel (Firebase IndexedDB restore is async).
  for (let i = 0; i < 40; i += 1) {
    if (page.url().includes("/login")) {
      await loginIfNeeded(page);
      await goToSettings(page);
      continue;
    }
    if ((await page.getByTestId("pin-access-management-panel").count()) > 0) {
      return;
    }
    if (!isSettingsRoute(page.url())) {
      await goToSettings(page);
    }
    await page.waitForTimeout(500);
  }
  throw new Error(
    `Settings PIN panel not available after auth settle (url=${page.url()})`,
  );
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
  const adminBtn = detail.getByTestId("pin-access-admin-button");
  await adminBtn.waitFor({ timeout: 10_000 });
  // Row switch revokes prior session asynchronously — wait until Admin Access is clickable.
  await page.waitForFunction(
    () => {
      const btn = document.querySelector(
        '[data-testid="pin-access-detail"] [data-testid="pin-access-admin-button"]',
      );
      return btn instanceof HTMLButtonElement && !btn.disabled;
    },
    null,
    { timeout: 15_000 },
  );
  await detail.getByTestId("pin-access-save").waitFor();
  await detail.getByTestId("pin-access-cancel").waitFor();
  await assertExpandedBelowRow(detail);
  const detailCount = await page.getByTestId("pin-access-detail").count();
  if (detailCount !== 1) {
    throw new Error(`Expected exactly one open editor, found ${detailCount}.`);
  }
  return detail;
}

async function startAdminAccessOnDetail(detail, page, adminPin) {
  const pin =
    typeof adminPin === "string" && /^\d{6}$/.test(adminPin)
      ? adminPin
      : process.env.STAGEVERIFY_TEST_ADMIN_PIN;
  if (!pin || !/^\d{6}$/.test(pin)) {
    throw new Error(
      "STAGEVERIFY_TEST_ADMIN_PIN (exactly 6 digits) is required for Admin Access verify after named-Admin unlock.",
    );
  }
  const adminBtn = detail.getByTestId("pin-access-admin-button");
  await page.waitForFunction(
    () => {
      const btn = document.querySelector(
        '[data-testid="pin-access-detail"] [data-testid="pin-access-admin-button"]',
      );
      return btn instanceof HTMLButtonElement && !btn.disabled;
    },
    null,
    { timeout: 15_000 },
  );
  const cfErrors = [];
  const onResponse = async (res) => {
    if (
      res.url().includes("startAdminAccessSession") ||
      res.url().includes("revealAccessPin")
    ) {
      const text = await res.text().catch(() => "");
      cfErrors.push({
        status: res.status(),
        fn: res.url().split("/").pop(),
        // Redact 3+ digit runs so 4–6 digit PINs never leak as [PIN]56
        body: text.slice(0, 300).replace(/\d{3,}/g, "[PIN]"),
      });
    }
  };
  page.on("response", onResponse);
  try {
    await adminBtn.click();
    const prompt = detail.getByTestId("pin-access-admin-pin-prompt");
    await prompt.waitFor({ timeout: 10_000 });
    await detail.getByTestId("pin-access-admin-pin-input").fill(pin);
    await detail.getByTestId("pin-access-admin-pin-submit").click();
    await detail
      .getByTestId("pin-access-admin-active")
      .waitFor({ timeout: 25_000 });
  } catch (err) {
    const panelText = (
      await page.getByTestId("pin-access-management-panel").innerText()
    )
      .slice(0, 400)
      .replace(/\n/g, " | ")
      .replace(/\d{3,}/g, "[PIN]");
    throw new Error(
      `Admin Access did not activate. panel="${panelText}" cf=${JSON.stringify(cfErrors)} original=${err.message}`,
    );
  } finally {
    page.off("response", onResponse);
  }
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
  const cleared = await input.inputValue();
  if (cleared !== "") {
    throw new Error(
      `PIN input should be empty after clear; leftover digits "${cleared}"`,
    );
  }
  console.log("PASS: PIN input numeric-only, maxLength 6 (4–6 contract)");
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
    // Re-query panel after reload (stale locator hardening from main).
    const panelAfterLight = page.getByTestId("pin-access-management-panel");
    await panelAfterLight.waitFor({ timeout: 30_000 });

    // 3) Technician Admin Access + expand-below
    let detail = await openEditorByType(page, "technician");
    console.log("PASS: Technician row shows row-scoped Admin Access");
    await assertPinShellContrast(page, "Light");
    await panelAfterLight.screenshot({
      path: resolve(outDir, "settings-admin-access-light.png"),
    });

    // 7) Technician reveal (+ PIN length contract once New PIN input is shown)
    await startAdminAccessOnDetail(detail, page);
    await assertPinLengthContract(detail);
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
    // Do not log plaintext PIN values.
    console.log("PASS: Technician current PIN reveal works");

    // 11) row switch revokes prior session while elevation is live
    // (auto-hide verified later in isolation — do not interleave with row switch)
    detail = await openEditorByType(page, "vendor");
    console.log("PASS: Vendor row shows row-scoped Admin Access (single editor)");
    if ((await detail.getByTestId("pin-access-admin-active").count()) !== 0) {
      throw new Error("Prior Admin Access session carried over to the vendor row.");
    }
    if ((await page.getByTestId("pin-access-detail").count()) !== 1) {
      throw new Error("Row switch left multiple editors open.");
    }
    console.log("PASS: Row switch keeps a single editor (prior session revoked on switch)");

    // 7) Vendor reveal — settle prior revoke, then elevate via helper
    await page.waitForTimeout(1500);
    await startAdminAccessOnDetail(detail, page);
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          '[data-testid="pin-access-current-pin"]',
        );
        const t = el?.textContent?.trim() || "";
        return /^\d{4,6}$/.test(t);
      },
      null,
      { timeout: 25_000 },
    );
    console.log("PASS: Vendor current PIN reveal works");
    await page.waitForTimeout(1000);

    // 9) Save without PIN change — toast, revoke, collapse
    const newPin = detail.getByTestId("pin-access-new-pin-input");
    if ((await newPin.count()) > 0) {
      await newPin.fill("");
      await newPin.press("Control+A");
      await newPin.press("Backspace");
    }
    await detail.getByTestId("pin-access-save").click();
    const saveError = page
      .locator('[data-testid="pin-access-management-panel"]')
      .getByText(/Could not save|required|denied|Invalid/i);
    await Promise.race([
      page.getByText("Changes saved").waitFor({ timeout: 20_000 }),
      saveError.waitFor({ state: "visible", timeout: 20_000 }).then(async () => {
        throw new Error(`Save failed: ${(await saveError.innerText()).trim()}`);
      }),
    ]);
    await page
      .getByTestId("pin-access-detail")
      .waitFor({ state: "detached", timeout: 20_000 });
    if ((await page.getByTestId("pin-access-admin-active").count()) !== 0) {
      throw new Error("Admin Access still active after Save.");
    }
    console.log("PASS: Save persists, shows Changes saved, revokes Admin Access, collapses");

    // 5 + 8) Management Admin Access + hash-only copy
    detail = await openEditorByType(page, "management");
    console.log("PASS: Management PIN row shows row-scoped Admin Access");
    await startAdminAccessOnDetail(detail, page);
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

    // 12) revealed PIN auto-hides (fresh elevation — do not interleave with row switch)
    detail = await openEditorByType(page, "technician");
    await startAdminAccessOnDetail(detail, page);
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          '[data-testid="pin-access-current-pin"]',
        );
        const t = el?.textContent?.trim() || "";
        return /^\d{4,6}$/.test(t);
      },
      null,
      { timeout: 20_000 },
    );
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          '[data-testid="pin-access-current-pin"]',
        );
        const t = el?.textContent?.trim() || "";
        return t.includes("•") || t === "••••" || !/^\d{4,6}$/.test(t);
      },
      null,
      { timeout: 35_000 },
    );
    console.log("PASS: Revealed PIN auto-hides");
    await detail.getByTestId("pin-access-cancel").click();
    await page.getByTestId("pin-access-detail").waitFor({ state: "detached", timeout: 15_000 });

    // 14) Dark mode contrast with Admin Access shell open
    await page.evaluate(() => {
      localStorage.setItem("stageverify-theme", "dark");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await ensureAuthenticated(page);
    const panelAfterDark = page.getByTestId("pin-access-management-panel");
    await panelAfterDark.waitFor({ timeout: 30_000 });
    detail = await openEditorByType(page, "technician");
    await assertPinShellContrast(page, "Dark");
    await panelAfterDark.screenshot({
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

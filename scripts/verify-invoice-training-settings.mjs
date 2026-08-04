/**
 * Settings → Invoice training Admin section + contrast (away-136).
 */
import { chromium } from "playwright";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { assertReadableTextContrast } from "./lib/ui-text-contrast-lib.mjs";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrlIdx = args.indexOf("--base-url");
const baseUrl =
  baseUrlFlag?.slice("--base-url=".length) ??
  (baseUrlIdx >= 0 ? args[baseUrlIdx + 1] : undefined) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  }
}
const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;

/** Admin password for ignore-rules unlock (P5 verify) — env only; no hardcoded fallback. */
function resolveInvoiceTrainingAdminPassword() {
  const candidates = [
    process.env.STAGEVERIFY_INVOICE_TRAINING_ADMIN_PASSWORD,
    process.env.INVOICE_TRAINING_ADMIN_PASSWORD,
    process.env.STAGEVERIFY_INVOICE_TRAINING_PASSWORD,
  ];
  const seen = new Set();
  for (const raw of candidates) {
    const value = raw?.trim();
    if (!value || value.length < 8 || seen.has(value)) continue;
    seen.add(value);
    return value;
  }
  return null;
}

async function loginIfNeeded(page) {
  await page.goto(`${appBase}/#/settings?focus=invoice-training-admin`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(1200);
  if (page.url().includes("/login")) {
    if (!email || !password) throw new Error("Need STAGEVERIFY_TEST_EMAIL/PASSWORD");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/#\/(settings|dispatcher|hub)/, { timeout: 20_000 });
    await page.goto(`${appBase}/#/settings?focus=invoice-training-admin`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForTimeout(800);
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await loginIfNeeded(page);

    const section = page.getByTestId("settings-invoice-training-admin");
    await section.waitFor({ timeout: 15_000 });
    await page.getByTestId("invoice-training-alert-email").waitFor({ timeout: 5000 });
    await page.getByTestId("invoice-training-admin-password").waitFor({ timeout: 5000 });
    await page.getByTestId("save-invoice-training-admin").waitFor({ timeout: 5000 });
    await page.getByTestId("settings-invoice-ignore-rules").waitFor({ timeout: 5000 });
    await page.getByTestId("invoice-ignore-rules-password").waitFor({ timeout: 5000 });
    await page.getByTestId("load-invoice-ignore-rules").waitFor({ timeout: 5000 });

    const readonlyHint = page.getByTestId("invoice-ignore-rules-readonly-hint");
    const managerHint = page.getByTestId("invoice-ignore-rules-manager-hint");
    await Promise.race([
      readonlyHint.waitFor({ timeout: 5000 }),
      managerHint.waitFor({ timeout: 5000 }),
    ]);
    console.log("PASS: Invoice training Admin settings section visible");

    await assertReadableTextContrast(page, {
      rootSelector: '[data-testid="settings-invoice-training-admin"]',
      elements: [
        {
          name: "alert email input",
          selector: '[data-testid="invoice-training-alert-email"]',
        },
        {
          name: "password input",
          selector: '[data-testid="invoice-training-admin-password"]',
        },
        {
          name: "ignore rules password",
          selector: '[data-testid="invoice-ignore-rules-password"]',
        },
      ],
    });
    console.log("PASS: training Admin settings contrast");

    const adminPassword = resolveInvoiceTrainingAdminPassword();
    if (!adminPassword) {
      console.log(
        "SKIP: unlock-gated P5/P6 asserts — set STAGEVERIFY_INVOICE_TRAINING_ADMIN_PASSWORD (8+ chars) to exercise ignore-rules unlock flow",
      );
      console.log("verify-invoice-training-settings: PASS");
      return;
    }

    await page.getByTestId("invoice-ignore-rules-password").fill(adminPassword);
    await page.getByTestId("load-invoice-ignore-rules").click();

    await Promise.race([
      page.getByTestId("invoice-ignore-rules-empty").waitFor({ timeout: 20_000 }),
      page.getByTestId("invoice-ignore-rules-error").waitFor({ timeout: 20_000 }),
      page.getByTestId("invoice-ignore-rules-list").waitFor({ timeout: 20_000 }),
    ]);

    if (await page.getByTestId("invoice-ignore-rules-error").isVisible()) {
      const errText = await page.getByTestId("invoice-ignore-rules-error").innerText();
      throw new Error(`Ignore rules unlock failed: ${errText}`);
    }

    const showArchived = page.getByTestId("invoice-ignore-rules-show-archived");
    await showArchived.waitFor({ timeout: 5000 });
    await showArchived.locator('input[type="checkbox"]').click();
    console.log("PASS: show-archived toggle visible and clickable");

    const isManager = await managerHint.isVisible().catch(() => false);
    if (isManager) {
      await page.getByTestId("migrate-legacy-ignore-rules").waitFor({ timeout: 5000 });
      console.log("PASS: migrate-legacy-ignore-rules visible for manager");
    } else {
      console.log("PASS: readonly session — migrate button absent (expected)");
    }

    const contrastElements = [
      {
        name: "show archived label",
        selector: '[data-testid="invoice-ignore-rules-show-archived"]',
      },
      {
        name: "unlock rules button",
        selector: '[data-testid="load-invoice-ignore-rules"]',
        optional: true,
      },
    ];
    if (isManager) {
      contrastElements.push({
        name: "migrate legacy rules",
        selector: '[data-testid="migrate-legacy-ignore-rules"]',
        optional: true,
      });
    }

    await assertReadableTextContrast(page, {
      rootSelector: '[data-testid="settings-invoice-ignore-rules"]',
      elements: contrastElements,
    });
    console.log("PASS: unlock-gated ignore-rules contrast");

    await page.getByTestId("load-training-note-audit").waitFor({ timeout: 5000 });
    console.log("PASS: training note audit load button visible");

    const auditButton = page.locator('[data-testid^="audit-ignore-rule-"]').first();
    if ((await auditButton.count()) > 0) {
      const testId = await auditButton.getAttribute("data-testid");
      const key = testId?.replace("audit-ignore-rule-", "") ?? "";
      await auditButton.click();
      await page.getByTestId(`ignore-rule-audit-panel-${key}`).waitFor({
        timeout: 15_000,
      });
      console.log("PASS: ignore-rule audit panel opens");
    } else {
      console.log("PASS: no ignore rules — audit panel step skipped");
    }

    const reopenCountBadges = page.locator('[data-testid^="ignore-rule-reopen-count-"]');
    const autoDisabledBadges = page.locator('[data-testid^="ignore-rule-auto-disabled-"]');
    const reopenCountN = await reopenCountBadges.count();
    const autoDisabledN = await autoDisabledBadges.count();
    if (reopenCountN > 0) {
      console.log(`PASS: P6 ignore-rule-reopen-count visible (${reopenCountN})`);
    } else {
      console.log("PASS: P6 ignore-rule-reopen-count optional — none with reopenCount > 0");
    }
    if (autoDisabledN > 0) {
      console.log(`PASS: P6 ignore-rule-auto-disabled visible (${autoDisabledN})`);
    } else {
      console.log("PASS: P6 ignore-rule-auto-disabled optional — none auto-disabled");
    }

    const listVisible = await page.getByTestId("invoice-ignore-rules-list").isVisible();
    const ruleRows = page.locator('[data-testid^="invoice-ignore-rule-"]');
    let activeDisabledCount = 0;
    if (listVisible) {
      const ruleCount = await ruleRows.count();
      for (let i = 0; i < ruleCount; i++) {
        const row = ruleRows.nth(i);
        if (!(await row.isVisible())) continue;
        const statusBadge = row.locator('[data-testid^="ignore-rule-status-"]');
        if ((await statusBadge.count()) === 0) continue;
        const statusText = (await statusBadge.innerText()).trim().toLowerCase();
        if (statusText === "active" || statusText === "disabled") {
          activeDisabledCount++;
        }
      }
    }

    const bulkButtons = page.locator('[data-testid^="bulk-reopen-ignore-rule-"]');
    const bulkCount = await bulkButtons.count();
    if (isManager && activeDisabledCount > 0) {
      if (bulkCount < 1) {
        throw new Error(
          "P6: manager session with visible active/disabled rules must show bulk-reopen-ignore-rule-*",
        );
      }
      console.log(`PASS: P6 bulk-reopen-ignore-rule visible (${bulkCount})`);
      const p6ContrastElements = [
        {
          name: "bulk reopen skipped imports",
          selector: '[data-testid^="bulk-reopen-ignore-rule-"]',
          optional: true,
        },
      ];
      await assertReadableTextContrast(page, {
        rootSelector: '[data-testid="settings-invoice-ignore-rules"]',
        elements: p6ContrastElements,
      });
      console.log("PASS: P6 bulk-reopen button contrast");
    } else if (isManager) {
      console.log("PASS: P6 bulk-reopen optional — no visible active/disabled rules");
    } else {
      console.log("PASS: P6 bulk-reopen N/A — readonly session");
    }

    console.log("verify-invoice-training-settings: PASS");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("verify-invoice-training-settings: FAIL —", err.message);
  process.exit(1);
});

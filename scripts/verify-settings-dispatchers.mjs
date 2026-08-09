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
    {
      name: "remove button",
      selector: '[data-testid^="pin-access-remove-"]',
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
    await panel.getByTestId("dispatcher-provision-full-name").waitFor();
    await panel.getByTestId("dispatcher-provision-email").waitFor();
    await panel.getByTestId("dispatcher-provision-password").waitFor();
    await panel.getByTestId("dispatcher-provision-submit").waitFor();
    console.log(
      "PASS: Manager Auth path shows full name, email, optional password, and Save controls",
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

    // Active Auth rows must not expose Remove; PIN rows must never have Remove.
    for (const type of ["manager", "dispatcher"]) {
      const activeRows = panel.locator(`[data-testid^="pin-access-row-${type}-"]`);
      const n = await activeRows.count();
      for (let i = 0; i < n; i += 1) {
        const row = activeRows.nth(i);
        const status = (await row.locator("td").nth(4).innerText()).trim();
        const testid = await row.getAttribute("data-testid");
        const uid = testid?.replace(`pin-access-row-${type}-`, "") ?? "";
        if (status === "Active") {
          if (
            (await panel
              .locator(`[data-testid="pin-access-remove-${type}-${uid}"]`)
              .count()) !== 0
          ) {
            throw new Error(`Active ${type} ${uid} unexpectedly shows Remove.`);
          }
        }
      }
    }
    for (const pinType of ["technician", "vendor", "management"]) {
      const bad = await panel
        .locator(`[data-testid^="pin-access-remove-${pinType}-"]`)
        .count();
      if (bad !== 0) {
        throw new Error(`Remove must not appear on ${pinType} rows.`);
      }
    }
    console.log("PASS: Remove absent on active Auth + all PIN rows");

    // Provision → Deactivate → Remove throwaway dispatcher (never ops accounts).
    // Cancel open manager wizard, then open a fresh Dispatcher Auth wizard.
    const cancelWizard = panel.getByTestId("pin-access-cancel");
    if ((await cancelWizard.count()) > 0) {
      await cancelWizard.click();
      await page.waitForTimeout(400);
    }
    await panel.getByTestId("pin-access-add-button").click();
    await panel.getByTestId("pin-access-new-user-type").selectOption("dispatcher");
    await panel.getByTestId("pin-access-wizard-next").click();
    const throwawayEmail = `verify-remove-${Date.now()}@stageverify.dev`;
    await panel.getByTestId("dispatcher-provision-email").waitFor({ timeout: 10_000 });
    await panel.getByTestId("dispatcher-provision-full-name").fill("Verify Remove");
    await panel.getByTestId("dispatcher-provision-email").fill(throwawayEmail);
    await panel.getByTestId("dispatcher-provision-password").fill("TempPass9!");
    await panel.getByTestId("dispatcher-provision-submit").click();
    await page
      .getByText(/account created|temporary password/i)
      .first()
      .waitFor({ timeout: 20_000 });
    await panel.getByTestId("pin-access-roster").waitFor({ timeout: 15_000 });

    const newRow = panel
      .locator(`[data-testid^="pin-access-row-dispatcher-"]`)
      .filter({ hasText: throwawayEmail })
      .first();
    await newRow.waitFor({ timeout: 20_000 });
    const newTestId = await newRow.getAttribute("data-testid");
    const newUid = newTestId?.replace("pin-access-row-dispatcher-", "") ?? "";
    if (!newUid) throw new Error("Could not resolve provisioned dispatcher uid.");

    if (
      (await panel
        .locator(`[data-testid="pin-access-remove-dispatcher-${newUid}"]`)
        .count()) !== 0
    ) {
      throw new Error("Remove shown on newly provisioned active dispatcher.");
    }
    await panel
      .locator(`[data-testid="pin-access-active-dispatcher-${newUid}"]`)
      .click();
    await page.waitForTimeout(1500);
    const removeBtn = panel.locator(
      `[data-testid="pin-access-remove-dispatcher-${newUid}"]`,
    );
    await removeBtn.waitFor({ timeout: 15_000 });
    console.log("PASS: Remove appears only after Deactivate");

    let dialogMessage = "";
    page.once("dialog", (dialog) => {
      dialogMessage = dialog.message();
      void dialog.dismiss();
    });
    await removeBtn.click();
    await page.waitForTimeout(500);
    if (!dialogMessage.includes(throwawayEmail)) {
      throw new Error(
        `Remove confirm missing email. Got: ${dialogMessage || "(none)"}`,
      );
    }
    if ((await newRow.count()) !== 1) {
      throw new Error("Cancel/dismiss removed the account unexpectedly.");
    }
    console.log("PASS: Remove confirmation includes email; Cancel leaves account");

    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await removeBtn.click();
    await page
      .locator(`[data-testid="pin-access-row-dispatcher-${newUid}"]`)
      .waitFor({ state: "detached", timeout: 20_000 });
    console.log("PASS: Remove deletes roster row for throwaway dispatcher");

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

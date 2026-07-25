/**
 * Playwright: Settings → Catch-All receivers panel (D-42 contrast + layout asserts).
 *
 * Usage:
 *   npm run dev   (another terminal)
 *   npm run verify:settings-office-receivers
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  assertReadableTextContrast,
  MIN_LARGE_TEXT_CONTRAST,
  MIN_TEXT_CONTRAST,
  OFFICE_RECEIVER_PANEL_CONTRAST_SPEC,
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
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  }
}

const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;
const authState = resolve(process.cwd(), "playwright/.auth/state.json");
const outDir = resolve(process.cwd(), "screenshots");
mkdirSync(outDir, { recursive: true });

const appBase = resolveAppBase(baseUrl);

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
  await page.waitForURL(/\/#\/(settings|dispatcher|hub)/, { timeout: 20_000 });

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

  console.log(`Opening ${appBase}/#/settings (Catch-All receivers)`);
  await ensureAuthenticated(page);

  const panel = page.getByTestId("office-receivers-settings-panel");
  await panel.waitFor({ timeout: 30_000 });
  await panel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  await page.getByText("Catch-All receivers", { exact: true }).waitFor({
    timeout: 15_000,
  });

  const seedNameInPanel = panel.getByText("Verify Office Receiver", {
    exact: true,
  });
  if ((await seedNameInPanel.count()) > 0) {
    throw new Error(
      "Verify seed placeholder receiver must not appear in Settings UI",
    );
  }
  const seedEmailInPanel = panel.locator("text=/catchall-verify\\+/i");
  if ((await seedEmailInPanel.count()) > 0) {
    throw new Error(
      "catchall-verify+ seed emails must not appear in Settings UI",
    );
  }
  console.log("PASS: no verify seed Catch-All receiver cards visible");

  const savedRows = panel.locator('[data-testid^="office-receiver-row-"]');
  const savedCount = await savedRows.count();

  const signupForms = panel.locator('[data-testid^="office-receiver-signup-form-"]');

  if (savedCount === 0) {
    await panel.getByTestId("office-receiver-signup-title").waitFor({
      timeout: 10_000,
    });
    const signupTitle = (
      await panel.getByTestId("office-receiver-signup-title").textContent()
    )?.trim();
    if (signupTitle !== "Catch-All Receiver") {
      throw new Error(
        `Signup form title expected "Catch-All Receiver", got "${signupTitle ?? ""}"`,
      );
    }
    console.log("PASS: zero saved receivers → one signup form titled Catch-All Receiver");

    const formCount = await signupForms.count();
    if (formCount !== 1) {
      throw new Error(
        `Expected exactly 1 default signup form when no saved receivers, found ${formCount}`,
      );
    }
    console.log("PASS: one default Catch-All signup form when list empty");
  } else {
    const formCountBeforeAdd = await signupForms.count();
    if (formCountBeforeAdd !== 0) {
      throw new Error(
        `Expected 0 blank signup forms when ${savedCount} saved receiver(s) exist, found ${formCountBeforeAdd}`,
      );
    }
    console.log(
      `PASS: ${savedCount} saved receiver(s) → no blank signup form until Add`,
    );
  }

  const addBtn = panel.getByTestId("office-receiver-add-additional-btn");
  await addBtn.waitFor({ timeout: 10_000 });

  if (savedCount >= 1) {
    await addBtn.click();
    await page.waitForTimeout(300);
    const formCountAfterAdd = await signupForms.count();
    if (formCountAfterAdd !== 1) {
      throw new Error(
        `Expected 1 signup form after Add (with saved receivers), found ${formCountAfterAdd}`,
      );
    }
    console.log("PASS: Add reveals signup form when saved receivers exist");

    const cancelBtn = panel.getByTestId("office-receiver-cancel-drafts-btn");
    await cancelBtn.waitFor({ timeout: 5000 });
    await cancelBtn.click();
    await page.waitForTimeout(300);
    const formCountAfterCancel = await signupForms.count();
    if (formCountAfterCancel !== 0) {
      throw new Error(
        `Cancel must clear all draft forms; expected 0, found ${formCountAfterCancel}`,
      );
    }
    console.log("PASS: Cancel clears all blank add forms (saved rows unchanged)");

    await addBtn.click();
    await page.waitForTimeout(200);
    await addBtn.click();
    await page.waitForTimeout(200);
    const formCountTwo = await signupForms.count();
    if (formCountTwo !== 2) {
      throw new Error(
        `Expected 2 signup forms after double Add, found ${formCountTwo}`,
      );
    }
    await cancelBtn.click();
    await page.waitForTimeout(300);
    if ((await signupForms.count()) !== 0) {
      throw new Error("Cancel must clear all open draft forms at once");
    }
    console.log("PASS: Cancel clears multiple open draft forms at once");
  }

  const signupVisible = (await signupForms.count()) >= 1;
  if (signupVisible && savedCount === 0) {
    await page.getByTestId("office-receiver-name-input").waitFor({
      timeout: 10_000,
    });
    const emailInput = page.getByTestId("office-receiver-email-input");
    await emailInput.waitFor({ timeout: 10_000 });
    const smsInput = page.getByTestId("office-receiver-sms-coming-soon-input");
    await smsInput.waitFor({ timeout: 10_000 });

    if (await emailInput.isDisabled()) {
      throw new Error("Signup form email field must be an editable text input");
    }
    const emailBox = await emailInput.boundingBox();
    const smsBox = await smsInput.boundingBox();
    if (!emailBox || !smsBox) {
      throw new Error("Could not measure email vs SMS field positions");
    }
    if (emailBox.y >= smsBox.y) {
      throw new Error(
        "Email input must appear directly above SMS (coming soon) on the signup form",
      );
    }
    console.log("PASS: editable email input above SMS (coming soon)");

    console.log("PASS: name, email, and SMS (coming soon) fields visible");
  }

  if (savedCount === 0) {
    await addBtn.click();
    const formCountAfter = await signupForms.count();
    if (formCountAfter !== 2) {
      throw new Error(
        `Expected 2 signup forms after add click (empty list), found ${formCountAfter}`,
      );
    }
    console.log("PASS: Add additional Catch-All receivers reveals second form");

    const cancelEmptyList = panel.getByTestId("office-receiver-cancel-drafts-btn");
    await cancelEmptyList.waitFor({ timeout: 5000 });
    await cancelEmptyList.click();
    await page.waitForTimeout(400);
    const afterCancelEmpty = await signupForms.count();
    if (afterCancelEmpty !== 1) {
      throw new Error(
        `After Cancel with empty saved list, expect 1 default form (auto-seed), got ${afterCancelEmpty}`,
      );
    }
    console.log("PASS: Cancel clears extra drafts; one default form remains when list empty");
  }

  async function assertYellowActivateButton(locator, label) {
    await locator.waitFor({ timeout: 10_000 });
    const bg = await locator.evaluate((el) =>
      getComputedStyle(el).backgroundColor,
    );
    const color = await locator.evaluate((el) => getComputedStyle(el).color);
    const rgb = bg.match(/\d+/g)?.map(Number) ?? [];
    if (rgb.length < 3) {
      throw new Error(`${label}: could not parse background ${bg}`);
    }
    const [r, g, b] = rgb;
    const isYellowish = r >= 200 && g >= 150 && b <= 120;
    if (!isYellowish) {
      throw new Error(
        `${label}: expected yellow Activate background, got ${bg}`,
      );
    }
    const textRgb = color.match(/\d+/g)?.map(Number) ?? [];
    if (textRgb.length >= 3) {
      const lum =
        (0.299 * textRgb[0] + 0.587 * textRgb[1] + 0.114 * textRgb[2]) / 255;
      if (lum > 0.85) {
        throw new Error(
          `${label}: Activate text should be dark/readable, got ${color}`,
        );
      }
    }
    console.log(`PASS: ${label} uses yellow Activate styling (${bg})`);
  }

  const draftActivate = panel.getByTestId("office-receiver-add-btn");
  if ((await draftActivate.count()) > 0) {
    await assertYellowActivateButton(draftActivate.first(), "signup Activate");
  }

  const rowActivate = panel.locator('[data-testid^="office-receiver-activate-"]');
  if ((await rowActivate.count()) > 0) {
    await assertYellowActivateButton(rowActivate.first(), "inactive row Activate");
  } else if (savedCount === 0) {
    console.log(
      "SKIP: no inactive saved receiver — row Activate yellow not asserted",
    );
  }

  const activeStatus = panel.locator('[data-testid^="office-receiver-active-status-"]');
  const activeCount = await activeStatus.count();
  if (activeCount >= 1) {
    const label = (await activeStatus.first().textContent())?.trim() ?? "";
    if (label !== "Active") {
      throw new Error(`Active status button text expected "Active", got "${label}"`);
    }
    const bg = await activeStatus.first().evaluate((el) =>
      getComputedStyle(el).backgroundColor,
    );
    console.log(`PASS: green Active status present (${bg})`);

    const statusNote = panel.locator('[data-testid^="office-receiver-status-note-"]');
    if ((await statusNote.count()) >= 1) {
      const noteText = (await statusNote.first().textContent())?.trim() ?? "";
      if (!noteText.includes("email notifications active")) {
        throw new Error(
          `Expected green status note with email notifications active, got "${noteText}"`,
        );
      }
      const firstRow = savedRows.first();
      const nameBlock = firstRow.locator("span").filter({ hasText: /^Name$/ });
      const emailLabel = firstRow.locator("span").filter({ hasText: /^Email$/ });
      const smsInput = firstRow.locator(
        '[data-testid^="office-receiver-sms-coming-soon-"]',
      );
      const nameBox = await nameBlock.first().boundingBox();
      const emailBox = await emailLabel.first().boundingBox();
      const smsBox = await smsInput.first().boundingBox();
      const noteBox = await statusNote.first().boundingBox();
      if (!nameBox || !emailBox || !smsBox || !noteBox) {
        throw new Error("Could not measure saved row vertical stack layout");
      }
      if (nameBox.y >= emailBox.y || emailBox.y >= smsBox.y) {
        throw new Error(
          "Saved row must stack Name, then Email, then SMS vertically",
        );
      }
      if (noteBox.y < emailBox.y - 2 || noteBox.y > emailBox.y + 40) {
        throw new Error(
          "Green email notifications note must sit on the email line beside the address",
        );
      }
      const activeBox = await activeStatus.first().boundingBox();
      if (activeBox && Math.abs(noteBox.y - activeBox.y) < 8) {
        throw new Error(
          "Status note must not sit beside Active button — should be beside email",
        );
      }
      console.log(
        "PASS: saved row vertical stack; email notifications note beside email",
      );
    }
  } else {
    console.log(
      "SKIP: no active Catch-All receiver in Firestore — Active green state not asserted",
    );
  }

  if ((await signupForms.count()) === 0) {
    await addBtn.click();
    await page.waitForTimeout(300);
  }

  await assertReadableTextContrast(page, OFFICE_RECEIVER_PANEL_CONTRAST_SPEC);

  await page.screenshot({
    path: resolve(outDir, "settings-office-receivers-panel.png"),
  });

  console.log(
    `PASS: Catch-All receivers panel contrast verified (≥${MIN_TEXT_CONTRAST}:1 normal, ≥${MIN_LARGE_TEXT_CONTRAST}:1 large).`,
  );
  await browser.close();
})().catch(async (err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

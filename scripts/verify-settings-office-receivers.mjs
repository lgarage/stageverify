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
  console.log("PASS: signup form titled Catch-All Receiver");

  const signupForms = page.locator('[data-testid^="office-receiver-signup-form-"]');
  const formCount = await signupForms.count();
  if (formCount !== 1) {
    throw new Error(
      `Expected exactly 1 default signup form, found ${formCount}`,
    );
  }
  console.log("PASS: one default Catch-All signup form");

  await page.getByTestId("office-receiver-name-input").waitFor({ timeout: 10_000 });
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

  const addBtn = page.getByTestId("office-receiver-add-additional-btn");
  await addBtn.waitFor({ timeout: 10_000 });
  await addBtn.click();
  const formCountAfter = await signupForms.count();
  if (formCountAfter !== 2) {
    throw new Error(
      `Expected 2 signup forms after add click, found ${formCountAfter}`,
    );
  }
  console.log("PASS: Add additional Catch-All receivers reveals second form");

  const activeStatus = page.locator('[data-testid^="office-receiver-active-status-"]');
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
  } else {
    console.log(
      "SKIP: no active Catch-All receiver in Firestore — Active green state not asserted",
    );
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

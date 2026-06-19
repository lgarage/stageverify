/**
 * Playwright: Settings → Workflow → Staging Spots section visible.
 *
 * Usage:
 *   npm run dev   (another terminal)
 *   npm run verify:settings-staging
 *
 * Credentials from .env.local (STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD).
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";

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
  const contextOptions = {
    viewport: { width: 1280, height: 900 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  };
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  console.log(`Opening ${appBase}/#/settings`);
  await ensureAuthenticated(page);

  await page.getByText("Staging Spots", { exact: true }).first().waitFor({
    timeout: 30_000,
  });
  await page.waitForSelector("text=Already listed", { timeout: 10_000 });
  await page.waitForSelector("text=already listed", { timeout: 10_000 });
  await page.waitForSelector("text=Add Staging Spot", { timeout: 10_000 });
  await page.waitForSelector('input[placeholder="e.g. s1a or G4"]', {
    timeout: 10_000,
  });

  await page.getByText("Staging Spots", { exact: true }).first().scrollIntoViewIfNeeded();

  console.log("Email Monitoring settings (save + reload)…");
  await page.getByText("Email Monitoring", { exact: true }).first().waitFor({
    timeout: 10_000,
  });

  const inboxInput = page.getByTestId("monitoring-inbox-email");
  const enableCheckbox = page.getByTestId("email-monitoring-enabled");
  const originalEmail = await inboxInput.inputValue();
  const originalEnabled = await enableCheckbox.isChecked();

  const probeEmail = "verify-inbox@stageverify.test";
  await inboxInput.fill(probeEmail);
  await enableCheckbox.check();
  await page.waitForFunction(
    (probe) => {
      const el = document.querySelector('[data-testid="monitoring-inbox-email"]');
      const cb = document.querySelector('[data-testid="email-monitoring-enabled"]');
      return el?.value === probe && cb?.checked === true;
    },
    probeEmail,
    { timeout: 10_000 },
  );
  await page.getByTestId("save-email-settings").click();
  await page.getByTestId("email-settings-saved").waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1500);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("monitoring-inbox-email").waitFor({ timeout: 15_000 });
  await page.waitForTimeout(800);
  const reloadedEmail = await page.getByTestId("monitoring-inbox-email").inputValue();
  const reloadedEnabled = await page.getByTestId("email-monitoring-enabled").isChecked();
  if (reloadedEmail !== probeEmail) {
    throw new Error(
      `Inbox email did not persist after reload (expected ${probeEmail}, got ${reloadedEmail})`,
    );
  }
  if (!reloadedEnabled) {
    throw new Error("emailMonitoringEnabled did not persist after reload");
  }

  await page.getByTestId("monitoring-inbox-email").fill(originalEmail);
  if (originalEnabled) {
    await page.getByTestId("email-monitoring-enabled").check();
  } else {
    await page.getByTestId("email-monitoring-enabled").uncheck();
  }
  await page.waitForTimeout(400);
  await page.getByTestId("save-email-settings").click();
  await page.getByTestId("email-settings-saved").waitFor({ timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1000);

  console.log("PASS: Email Monitoring settings save + reload verified.");

  await page.getByText("Staging Spots", { exact: true }).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);

  const firstEdit = page.locator('[data-testid^="edit-spot-"]').first();
  await firstEdit.waitFor({ timeout: 10_000 });
  const editTestId = await firstEdit.getAttribute("data-testid");
  const spotCode = editTestId?.replace("edit-spot-", "") ?? "G1";
  await firstEdit.click();

  await page.getByTestId("edit-spot-label").waitFor({ timeout: 10_000 });

  const labelInput = page.getByTestId("edit-spot-label");
  let originalLabel = await labelInput.inputValue();
  originalLabel = originalLabel.replace(/ \(verify\)$/, "");
  const probeLabel = `${originalLabel} (verify)`;
  await labelInput.fill(probeLabel);
  await page.getByTestId(`save-spot-${spotCode}`).click();
  await page.getByTestId(`spot-label-${spotCode}`).filter({ hasText: probeLabel }).waitFor({
    timeout: 25_000,
  });

  await firstEdit.click();
  await page.getByTestId("edit-spot-label").waitFor({ timeout: 10_000 });
  await page.getByTestId("edit-spot-label").fill(originalLabel);
  await page.getByTestId(`save-spot-${spotCode}`).click();
  await page.getByTestId(`spot-label-${spotCode}`).filter({ hasText: originalLabel }).waitFor({
    timeout: 25_000,
  });

  await page.screenshot({
    path: resolve(outDir, "settings-staging-spots.png"),
    fullPage: true,
  });

  console.log("PASS: Settings workflow staging spots section verified.");
  await browser.close();
})().catch(async (err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

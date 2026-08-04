/**
 * Settings → Invoice training Admin section + contrast (away-136).
 */
import { chromium } from "playwright";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { assertReadableTextContrast } from "./lib/ui-text-contrast-lib.mjs";

const baseUrl =
  process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
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

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
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
    }
    const section = page.getByTestId("settings-invoice-training-admin");
    await section.waitFor({ timeout: 15_000 });
    await page.getByTestId("invoice-training-alert-email").waitFor({ timeout: 5000 });
    await page.getByTestId("invoice-training-admin-password").waitFor({ timeout: 5000 });
    await page.getByTestId("save-invoice-training-admin").waitFor({ timeout: 5000 });
    await page.getByTestId("settings-invoice-ignore-rules").waitFor({ timeout: 5000 });
    await page.getByTestId("invoice-ignore-rules-password").waitFor({ timeout: 5000 });
    await page.getByTestId("load-invoice-ignore-rules").waitFor({ timeout: 5000 });
    await page.getByTestId("invoice-ignore-rules-readonly-hint").waitFor({
      timeout: 5000,
    });
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

    console.log("verify-invoice-training-settings: PASS");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("verify-invoice-training-settings: FAIL —", err.message);
  process.exit(1);
});

/**
 * Playwright: Settings → Technicians & day release — mechanical contrast check.
 *
 * Usage:
 *   npm run dev   (another terminal)
 *   npm run verify:settings-technicians
 *
 * Credentials from .env.local (STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD).
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  assertReadableTextContrast,
  MIN_LARGE_TEXT_CONTRAST,
  MIN_TEXT_CONTRAST,
  TECHNICIAN_PANEL_CONTRAST_SPEC,
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
  const contextOptions = {
    viewport: { width: 1280, height: 900 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  };
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  console.log(`Opening ${appBase}/#/settings`);
  await ensureAuthenticated(page);

  await page
    .getByText("Technicians & day release", { exact: true })
    .waitFor({ timeout: 30_000 });
  await page.getByTestId("technician-settings-panel").waitFor({ timeout: 15_000 });
  await page.getByTestId("technician-settings-panel").scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  await assertReadableTextContrast(page, TECHNICIAN_PANEL_CONTRAST_SPEC);

  await page.screenshot({
    path: resolve(outDir, "settings-technicians-panel.png"),
  });

  console.log(
    `PASS: Technicians & day release text contrast verified (≥${MIN_TEXT_CONTRAST}:1 normal, ≥${MIN_LARGE_TEXT_CONTRAST}:1 large).`,
  );
  await browser.close();
})().catch(async (err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

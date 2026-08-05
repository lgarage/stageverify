/**
 * Playwright: signed-in user without dispatcherRoles → /no-access (D-60).
 *
 * Usage:
 *   npm run dev   (another terminal)
 *   npm run verify:no-access
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
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
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

const noRoleEmail = process.env.STAGEVERIFY_NO_ROLE_EMAIL;
const noRolePassword = process.env.STAGEVERIFY_NO_ROLE_PASSWORD;

const appBase = resolveAppBase(baseUrl);

const NO_ACCESS_CONTRAST_SPEC = {
  rootSelector: '[data-testid="no-access-page"]',
  elements: [
    { name: "title", selector: "h1", large: true },
    {
      name: "message",
      selector: '[data-testid="no-access-message"]',
      large: false,
    },
    {
      name: "sign out",
      selector: '[data-testid="no-access-sign-out"]',
      large: true,
    },
  ],
};

(async () => {
  if (!noRoleEmail || !noRolePassword) {
    console.log(
      "SKIP: verify:no-access — set STAGEVERIFY_NO_ROLE_EMAIL and STAGEVERIFY_NO_ROLE_PASSWORD in .env.local (Firebase Auth user without dispatcherRoles doc).",
    );
    process.exit(0);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });

  console.log(`\n=== verify:no-access @ ${appBase} ===\n`);

  await page.goto(`${appBase}/#/login`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.fill("#email", noRoleEmail);
  await page.fill("#password", noRolePassword);
  await page.click('button[type="submit"]');

  await page.waitForURL(/\/#\/no-access/, { timeout: 25_000 });
  console.log("PASS: signed-in user without role redirected to /no-access");

  await page.waitForSelector('[data-testid="no-access-page"]', {
    timeout: 10_000,
  });
  const message = await page
    .locator('[data-testid="no-access-message"]')
    .textContent();
  if (!message?.includes("does not have dispatcher permissions")) {
    throw new Error(`Unexpected no-access message: ${message ?? ""}`);
  }
  console.log("PASS: no-access message shown");

  await assertReadableTextContrast(page, NO_ACCESS_CONTRAST_SPEC);
  console.log(
    `PASS: D-42 contrast — no-access (≥${MIN_TEXT_CONTRAST}:1 / ≥${MIN_LARGE_TEXT_CONTRAST}:1 large)`,
  );

  const signOut = page.locator('[data-testid="no-access-sign-out"]');
  await signOut.click();
  await page.waitForURL(/\/#\/login/, { timeout: 15_000 });
  console.log("PASS: sign out returns to login");

  await browser.close();
  console.log("\nverify:no-access PASS\n");
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

/**
 * Playwright auth state setup for stageverify.
 *
 * Run once (or whenever Firebase token expires ~1 hour):
 *   node scripts/playwright-auth-setup.mjs
 *
 * Requires local dev server running:
 *   npm run dev
 *
 * Reads credentials from environment (set in .env.local):
 *   STAGEVERIFY_TEST_EMAIL=you@example.com
 *   STAGEVERIFY_TEST_PASSWORD=yourpassword
 *
 * Saves auth state to playwright/.auth/state.json (gitignored).
 */

import { chromium } from "playwright";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";

// Load .env.local if present
const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  }
}

const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;
const baseUrl = process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
const stateFile = resolve(process.cwd(), "playwright/.auth/state.json");

if (!email || !password) {
  console.error(
    "Missing STAGEVERIFY_TEST_EMAIL or STAGEVERIFY_TEST_PASSWORD.\n" +
    "Add them to .env.local in the project root."
  );
  process.exit(1);
}

mkdirSync(resolve(process.cwd(), "playwright/.auth"), { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

console.log(`Logging in as ${email} at ${baseUrl}...`);
await page.goto(`${baseUrl}/#/login`);
await page.fill("#email", email);
await page.fill("#password", password);
await page.click('button[type="submit"]');
await page.waitForURL(/\/#\/(dispatcher|hub)/, { timeout: 15000 });

await context.storageState({ path: stateFile });
await browser.close();

console.log(`Auth state saved to ${stateFile}`);
console.log("Run this script again if screenshots fail due to expired tokens.");

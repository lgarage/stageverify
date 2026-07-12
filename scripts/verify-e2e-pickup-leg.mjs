/**
 * E2E smoke pickup leg — delivery-3 ready list → complete pickup (§14 steps 17–22).
 *
 * Usage:
 *   npm run dev
 *   npm run verify:e2e-pickup-leg
 */

import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { ensureAuthenticated, loadEnvLocal } from "./dispatcherVerifyHelpers.mjs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { applyFullLocationDisplay } from "./pickupLocationDisplayFixture.mjs";

const baseUrl = process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const jobId = process.env.STAGEVERIFY_PICKUP_JOB ?? "job-3";
const deliveryId = process.env.STAGEVERIFY_PICKUP_DELIVERY ?? "delivery-3";

const firebaseConfig = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: "stageverify-db",
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
};

function loadEnvLocalInline() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();
loadEnvLocalInline();

async function generatePickupTokenForJob() {
  const email = process.env.STAGEVERIFY_TEST_EMAIL;
  const password = process.env.STAGEVERIFY_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error("STAGEVERIFY_TEST_EMAIL/PASSWORD required");
  }
  const app = initializeApp(firebaseConfig, "e2e-pickup-leg-token");
  const auth = getAuth(app);
  await signInWithEmailAndPassword(auth, email, password);
  const functions = getFunctions(app);
  const generate = httpsCallable(functions, "generatePickupToken");
  const response = await generate({ jobId });
  const token = response.data?.token;
  if (typeof token !== "string" || !token) {
    throw new Error("generatePickupToken did not return a token");
  }
  return token;
}

async function waitForDoneEnabled(page, timeoutMs = 30_000) {
  await page.waitForFunction(
    () => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Order Pickup Complete"),
      );
      return btn && !btn.disabled;
    },
    { timeout: timeoutMs },
  );
}

async function completePickupChecklist(page) {
  const itemRows = page.getByTestId("pickup-item-row");
  const itemCount = await itemRows.count();
  console.log(`Checking ${itemCount} pickup item row(s)…`);
  for (let i = 0; i < itemCount; i++) {
    const row = itemRows.nth(i);
    if ((await row.getAttribute("data-checked")) !== "true") {
      await row.click();
      await page.waitForTimeout(150);
    }
  }

  const shopStates = page.getByTestId("shop-stock-pull-state");
  const shopCount = await shopStates.count();
  for (let i = 0; i < shopCount; i++) {
    const state = shopStates.nth(i);
    const label = ((await state.textContent()) ?? "").trim();
    if (label !== "Pulled") {
      await state.locator("xpath=ancestor::button[1]").click();
      await page.waitForTimeout(150);
    }
  }

  if (shopCount > 0) {
    await page.waitForTimeout(400);
    const cardBtn = page
      .getByTestId("pickup-at-primary")
      .first()
      .locator("xpath=ancestor::button[1]");
    await cardBtn.waitFor({ state: "visible", timeout: 10_000 });
    if (await cardBtn.isDisabled().catch(() => false)) {
      throw new Error(
        "Shop stock FAIL: delivery card button still disabled after shop stock pulls.",
      );
    }
    await cardBtn.click();
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="shop-stock-pull-state"]');
        return el?.textContent?.trim() === "Staged";
      },
      { timeout: 20_000 },
    );
    console.log("PASS: shop stock staged for delivery card");
  }

  await waitForDoneEnabled(page);
  await page.getByRole("button", { name: /Order Pickup Complete/ }).click();

  const errorBanner = page.locator(
    "text=/Failed to record|permission denied|Cannot record pickup/i",
  );
  const errorVisible = await errorBanner
    .first()
    .isVisible({ timeout: 3_000 })
    .catch(() => false);
  if (errorVisible) {
    const msg = await errorBanner.first().textContent();
    throw new Error(msg?.trim() ?? "Pickup error banner shown");
  }

  await page.waitForSelector("text=All Items Picked Up!", { timeout: 20_000 });
  console.log("PASS: All Items Picked Up! screen shown");
}

const seedResult = spawnSync("npx", ["tsx", "scripts/seed-pickup-verify-readiness.mjs"], {
  cwd: process.cwd(),
  stdio: "inherit",
  shell: true,
});
if (seedResult.status !== 0) {
  process.exit(seedResult.status ?? 1);
}

await applyFullLocationDisplay(deliveryId);

const pickupToken = await generatePickupTokenForJob();
const outDir = resolve(process.cwd(), "screenshots", "e2e-pickup-leg");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
});

console.log(
  "Auth for pickup completion: live rules require auth for delivery getDoc inside recordPickupEvent…",
);
await ensureAuthenticated(page, appBase);

const url = `${appBase}/#/pickup?t=${pickupToken}&delivery=${deliveryId}`;
console.log(`Opening ${url}`);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
await page.waitForSelector('[data-testid="pickup-at-primary"]', { timeout: 30_000 });

const empty = await page
  .getByText("No pickup-ready deliveries", { exact: false })
  .isVisible()
  .catch(() => false);
if (empty) {
  throw new Error("No pickup-ready deliveries for job-3 after seed");
}

await completePickupChecklist(page);

await page.screenshot({
  path: resolve(outDir, "pickup-leg-complete.png"),
  fullPage: true,
});
await browser.close();
console.log("verify:e2e-pickup-leg PASS");
process.exit(0);

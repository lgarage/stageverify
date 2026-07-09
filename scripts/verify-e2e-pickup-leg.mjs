/**
 * E2E smoke pickup leg — delivery-3 ready list after patch + seed (no Scenario A/B).
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

function loadEnvLocal() {
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

const doneBtn = page.getByRole("button", { name: /Order Pickup Complete/ });
await doneBtn.waitFor({ state: "visible", timeout: 15_000 });
console.log("PASS: pickup-ready list visible with Order Pickup Complete control");

await page.screenshot({ path: resolve(outDir, "pickup-leg-ready.png"), fullPage: true });
await browser.close();
console.log("verify:e2e-pickup-leg PASS");
process.exit(0);

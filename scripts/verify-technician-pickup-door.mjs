/**
 * Phase 5 Slice A — technician door E2E (real unauthenticated phone path).
 * Any #/s?loc= → tech PIN → directed list → open job → Complete Pickup → Picked Up
 * WITHOUT Firebase Authentication in the Playwright browser.
 *
 * Node-side Auth is used only for fixture writes (technician doc + day release + seed).
 *
 * Usage:
 *   npm run dev
 *   node scripts/verify-technician-pickup-door.mjs
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { spawnSync } from "node:child_process";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  doc,
  getFirestore,
  setDoc,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: "stageverify-db",
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
};

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
const appBase = resolveAppBase(baseUrl);
const locCode = process.env.STAGEVERIFY_SIGN_LOC ?? "G1";
/** Prefer the pickup-verify fixture job so Complete Pickup has a ready delivery. */
const verifyJobId = process.env.STAGEVERIFY_PICKUP_JOB ?? "job-3";
const techPin = "5678";
const techId = "tech-verify-phase5";
const outDir = resolve(process.cwd(), "screenshots", "technician-door");
mkdirSync(outDir, { recursive: true });

const results = [];

function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
}

async function enterPin(page, digits) {
  for (const digit of digits) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  // Auto-submit only at 6 digits; 4–5 digit PINs need Verify.
  if (digits.length < 6) {
    const byTestId = page.getByTestId("technician-pin-verify");
    if ((await byTestId.count()) > 0) {
      await byTestId.click();
    } else {
      await page.getByRole("button", { name: /^Verify/ }).click();
    }
  }
}

async function setupTechnicianDocOnly() {
  if (!email || !password) {
    throw new Error("STAGEVERIFY_TEST_EMAIL/PASSWORD required for technician fixture");
  }
  const app = initializeApp(firebaseConfig, "verify-tech-door-fixture");
  const auth = getAuth(app);
  await signInWithEmailAndPassword(auth, email, password);
  const db = getFirestore(app);
  const now = new Date().toISOString();

  await setDoc(doc(db, "technicians", techId), {
    id: techId,
    name: "Verify Tech",
    pinCode: techPin,
    active: true,
    createdAt: now,
    updatedAt: now,
    permissions: { doorScan: true, receiveReleases: true },
  }).catch((err) => {
    console.warn("technician doc write:", err?.message ?? err);
  });

  const functions = getFunctions(app);
  const release = httpsCallable(functions, "releaseJobsToTechnician");
  await release({ technicianId: techId, jobIds: [], replace: true });

  return { app };
}

async function releaseJobForToday(app, jobId) {
  const functions = getFunctions(app);
  const release = httpsCallable(functions, "releaseJobsToTechnician");
  await release({ technicianId: techId, jobIds: [jobId] });
}

async function openTechnicianPinFlow(page) {
  const url = `${appBase}/#/s?loc=${encodeURIComponent(locCode)}&_t=${Date.now()}`;
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.getByRole("button", { name: "Technician" }).waitFor({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Technician" }).click();
}

async function confirmAllPickupLocations(page) {
  const confirms = page.getByTestId("pickup-location-confirm");
  const count = await confirms.count();
  if (count === 0) {
    console.log("SKIP: no pickup-location-confirm rows on fixture.");
    return;
  }
  for (let i = 0; i < count; i++) {
    const row = confirms.nth(i);
    if ((await row.getAttribute("data-confirmed")) !== "true") {
      await row.click();
      await page.waitForTimeout(100);
    }
  }
  console.log(`Confirmed ${count} pickup spot(s).`);
}

async function completeTechnicianPickup(page) {
  await page.getByTestId("pickup-at-primary").first().waitFor({ timeout: 30_000 });

  const itemRows = page.getByTestId("pickup-item-row");
  await itemRows.first().waitFor({ timeout: 15_000 }).catch(() => {});
  const itemCount = await itemRows.count();
  console.log(
    `Skipping item row clicks (${itemCount} row(s)) — item checkboxes are optional.`,
  );

  // Required: shop-stock pulls gate Complete Pickup when the fixture has them.
  const shopStates = page.getByTestId("shop-stock-pull-state");
  await shopStates.first().waitFor({ timeout: 5_000 }).catch(() => {});
  let shopCount = await shopStates.count();
  for (let attempt = 0; attempt < 3; attempt++) {
    shopCount = await shopStates.count();
    let pending = 0;
    for (let i = 0; i < shopCount; i++) {
      const state = shopStates.nth(i);
      await state.scrollIntoViewIfNeeded();
      const label = ((await state.textContent()) ?? "").trim();
      if (label !== "Pulled") {
        pending++;
        await state.locator("xpath=ancestor::button[1]").click();
        await page.waitForFunction(
          (idx) => {
            const el = document.querySelectorAll(
              '[data-testid="shop-stock-pull-state"]',
            )[idx];
            return el?.textContent?.trim() === "Pulled";
          },
          i,
          { timeout: 5_000 },
        );
      }
    }
    if (pending === 0) break;
  }
  shopCount = await shopStates.count();
  for (let i = 0; i < shopCount; i++) {
    const label = ((await shopStates.nth(i).textContent()) ?? "").trim();
    if (label !== "Pulled") {
      throw new Error(`Shop stock row ${i} still "${label}" after pull clicks`);
    }
  }
  if (shopCount > 0) {
    console.log(`Pulled ${shopCount} shop-stock row(s).`);
  }

  // Required: staging-location confirms gate Complete Pickup.
  await confirmAllPickupLocations(page);
  // Re-confirm after any late hydration (loadJobDeliveries resets confirms).
  await page.waitForTimeout(300);
  await confirmAllPickupLocations(page);

  await page.waitForFunction(
    () => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Complete Pickup"),
      );
      const shop = [...document.querySelectorAll('[data-testid="shop-stock-pull-state"]')];
      const shopOk =
        shop.length === 0 ||
        shop.every((el) => el.textContent?.trim() === "Pulled");
      const confirms = [
        ...document.querySelectorAll('[data-testid="pickup-location-confirm"]'),
      ];
      const confirmsOk =
        confirms.length === 0 ||
        confirms.every((el) => el.getAttribute("data-confirmed") === "true");
      return Boolean(btn && !btn.disabled && shopOk && confirmsOk);
    },
    { timeout: 30_000 },
  );

  await page.getByRole("button", { name: /Complete Pickup/ }).click();

  const errorBanner = page.locator(
    "text=/Failed to record|permission denied|Cannot record pickup|Pickup could not be saved/i",
  );
  const errorVisible = await errorBanner
    .first()
    .isVisible({ timeout: 3_000 })
    .catch(() => false);
  if (errorVisible) {
    const msg = await errorBanner.first().textContent();
    throw new Error(msg?.trim() ?? "Pickup error banner shown");
  }

  await page.waitForSelector("text=Picked Up", { timeout: 30_000 });
}

function seedPickupReadiness() {
  console.log("Seeding pickup-ready fixture for technician Complete Pickup…");
  const result = spawnSync(
    "npx",
    ["tsx", "scripts/seed-pickup-verify-readiness.mjs"],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: true,
      env: process.env,
    },
  );
  if (result.status !== 0) {
    throw new Error("seed-pickup-verify-readiness failed");
  }
}

async function main() {
  console.log(`Technician door verify — ${appBase}`);
  console.log(
    "Browser session stays UNAUTHENTICATED (Node Auth is fixture-only).",
  );

  seedPickupReadiness();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();

  try {
    const { app } = await setupTechnicianDocOnly();

    await openTechnicianPinFlow(page);
    record("technician role toggle", true);

    await enterPin(page, techPin.split(""));
    await page
      .getByTestId("technician-empty-released")
      .waitFor({ timeout: 30_000 });
    record("always-strict empty state", true, "Nothing released for you yet");
    await page.screenshot({
      path: resolve(outDir, "empty-released.png"),
      fullPage: true,
    });

    await releaseJobForToday(app, verifyJobId);

    await page.getByRole("button", { name: "← Back" }).click();
    await page.getByRole("button", { name: "Technician" }).click();
    await enterPin(page, techPin.split(""));
    await page
      .getByTestId(`tech-released-job-${verifyJobId}`)
      .waitFor({ timeout: 30_000 });
    record("directed list after day-release", true, verifyJobId);
    await page.screenshot({
      path: resolve(outDir, "released-jobs.png"),
      fullPage: true,
    });

    await page.getByTestId(`tech-released-job-${verifyJobId}`).click();
    await page.waitForURL(/#\/pickup\?.*door=tech/, { timeout: 20_000 });
    // Wait for hydrated JobPickupScreen — not the directed list ("Pick up today").
    await page.getByTestId("pickup-at-primary").waitFor({
      timeout: 45_000,
    });
    await page.getByRole("button", { name: /Complete Pickup/ }).waitFor({
      timeout: 15_000,
    });
    record("tech door opens JobPickupScreen", true);
    await page.screenshot({
      path: resolve(outDir, "job-pickup-screen.png"),
      fullPage: true,
    });

    // Prove the Playwright page never received a dispatcher Firebase login:
    // fresh context (no storageState), never call ensureAuthenticated, stay on
    // tech/pickup routes (not #/login or #/dispatcher).
    const routeHash = await page.evaluate(() => window.location.hash);
    if (!/#\/pickup\?/.test(routeHash) || !/door=tech/.test(routeHash)) {
      throw new Error(
        `Expected tech-door pickup URL before Complete Pickup, got: ${routeHash}`,
      );
    }
    if (/#\/(login|dispatcher|settings)/i.test(routeHash)) {
      throw new Error(
        `Browser left technician path before Complete Pickup: ${routeHash}`,
      );
    }
    record("browser on unauthenticated tech-door pickup URL", true);

    await completeTechnicianPickup(page);
    record("Complete Pickup → Picked Up (unauthenticated tech session)", true);
    await page.screenshot({
      path: resolve(outDir, "picked-up-success.png"),
      fullPage: true,
    });
  } catch (err) {
    record("technician door flow", false, err instanceof Error ? err.message : String(err));
    await page.screenshot({
      path: resolve(outDir, "failure.png"),
      fullPage: true,
    }).catch(() => {});
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.error("\nFailed checks:", failed);
    process.exit(1);
  }
  console.log("\nAll technician door checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

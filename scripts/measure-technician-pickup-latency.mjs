/**
 * Measure Technician Pickup workflow latency (prod or local).
 *
 * Labels each sample MEASURED (wall-clock from Playwright). CF start/end is
 * ESTIMATED from PerformanceResourceTiming when available.
 *
 * Usage:
 *   node scripts/measure-technician-pickup-latency.mjs --base-url=https://lgarage.github.io/stageverify
 *   node scripts/measure-technician-pickup-latency.mjs --phase=before
 *   node scripts/measure-technician-pickup-latency.mjs --samples=3 --skip-complete
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { spawnSync } from "node:child_process";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { doc, getFirestore, setDoc } from "firebase/firestore";
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
const phaseFlag = args.find((a) => a.startsWith("--phase="));
const samplesFlag = args.find((a) => a.startsWith("--samples="));
const skipComplete = args.includes("--skip-complete");
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "https://lgarage.github.io/stageverify";
const phase = phaseFlag ? phaseFlag.split("=")[1] : "measure";
const samples = Math.max(
  1,
  Number(samplesFlag ? samplesFlag.split("=")[1] : "3") || 3,
);

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
const verifyJobId = process.env.STAGEVERIFY_PICKUP_JOB ?? "job-3";
const techPin = "5678";
const techId = "tech-verify-phase5";
const outDir = resolve(process.cwd(), "screenshots", "technician-pickup-latency");
mkdirSync(outDir, { recursive: true });

function median(nums) {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

async function enterPin(page, digits) {
  for (const digit of digits) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  // Auto-submit only fires at 6 digits; 4–5 digit PINs need Verify.
  if (digits.length < 6) {
    const byTestId = page.getByTestId("technician-pin-verify");
    if ((await byTestId.count()) > 0) {
      await byTestId.click();
    } else {
      await page.getByRole("button", { name: /^Verify/ }).click();
    }
  }
}

async function setupFixture() {
  if (!email || !password) {
    throw new Error("STAGEVERIFY_TEST_EMAIL/PASSWORD required");
  }
  const app = initializeApp(firebaseConfig, `measure-tech-pickup-${Date.now()}`);
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
  }).catch(() => {});
  const functions = getFunctions(app);
  const release = httpsCallable(functions, "releaseJobsToTechnician");
  await release({ technicianId: techId, jobIds: [], replace: true });
  await release({ technicianId: techId, jobIds: [verifyJobId] });
  return { app, release };
}

function seedPickupReadiness() {
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

async function confirmAllPickupLocations(page) {
  const confirms = page.getByTestId("pickup-location-confirm");
  const count = await confirms.count();
  for (let i = 0; i < count; i++) {
    const row = confirms.nth(i);
    if ((await row.getAttribute("data-confirmed")) !== "true") {
      await row.click();
      await page.waitForTimeout(50);
    }
  }
}

async function pullShopStock(page) {
  const shopStates = page.getByTestId("shop-stock-pull-state");
  await shopStates.first().waitFor({ timeout: 3_000 }).catch(() => {});
  const shopCount = await shopStates.count();
  for (let i = 0; i < shopCount; i++) {
    const state = shopStates.nth(i);
    const label = ((await state.textContent()) ?? "").trim();
    if (label !== "Pulled") {
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
}

async function collectCallableTimings(page) {
  return page.evaluate(() => {
    const entries = performance.getEntriesByType("resource");
    const callables = entries
      .filter((e) => /cloudfunctions\.net|googleapis\.com.*functions/i.test(e.name))
      .map((e) => ({
        name: e.name.split("/").pop()?.split("?")[0] ?? e.name,
        durationMs: Math.round(e.duration),
        startMs: Math.round(e.startTime),
      }));
    return callables;
  });
}

async function measureColdOrWarm(page, label) {
  const sample = {
    label,
    kind: "MEASURED",
    coldIshEntryToUsefulListMs: null,
    warmEntryToUsefulListMs: null,
    sameSessionReuseMs: null,
    releasedJobsVisibleMs: null,
    selectJobToUsefulJobMs: null,
    stagingConfirmVisualMs: null,
    completePickupToSuccessMs: null,
    callables: [],
  };

  // Cold-ish: fresh navigation + PIN → useful list
  const coldUrl = `${appBase}/#/s?loc=${encodeURIComponent(locCode)}&_t=${Date.now()}`;
  const t0 = Date.now();
  await page.goto(coldUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.getByRole("button", { name: "Technician" }).waitFor({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Technician" }).click();
  const pinReady = Date.now();
  await enterPin(page, techPin.split(""));
  const pinSubmit = Date.now();
  await page
    .getByTestId(`tech-released-job-${verifyJobId}`)
    .waitFor({ timeout: 45_000 });
  const listReady = Date.now();
  sample.coldIshEntryToUsefulListMs = listReady - t0;
  sample.releasedJobsVisibleMs = listReady - pinSubmit;
  sample.pinGateReadyMs = pinReady - t0;
  sample.pinSubmitToListMs = listReady - pinSubmit;

  // Job select → useful job screen
  const jobTap = Date.now();
  await page.getByTestId(`tech-released-job-${verifyJobId}`).click();
  await page.waitForURL(/#\/pickup\?.*door=tech/, { timeout: 20_000 });
  await page.getByTestId("pickup-at-primary").waitFor({ timeout: 45_000 });
  sample.selectJobToUsefulJobMs = Date.now() - jobTap;

  // Staging confirm visual response
  const confirms = page.getByTestId("pickup-location-confirm");
  if ((await confirms.count()) > 0) {
    const row = confirms.first();
    if ((await row.getAttribute("data-confirmed")) !== "true") {
      const tap = Date.now();
      await row.click();
      await page.waitForFunction(
        () => {
          const el = document.querySelector(
            '[data-testid="pickup-location-confirm"]',
          );
          return el?.getAttribute("data-confirmed") === "true";
        },
        { timeout: 5_000 },
      );
      sample.stagingConfirmVisualMs = Date.now() - tap;
    }
  }

  sample.callables = await collectCallableTimings(page);

  if (!skipComplete) {
    await pullShopStock(page);
    await confirmAllPickupLocations(page);
    await page.waitForTimeout(200);
    await confirmAllPickupLocations(page);
    await page.waitForFunction(
      () => {
        const btn = [...document.querySelectorAll("button")].find((b) =>
          b.textContent?.includes("Complete Pickup"),
        );
        return Boolean(btn && !btn.disabled);
      },
      { timeout: 30_000 },
    );
    const completeTap = Date.now();
    await page.getByRole("button", { name: /Complete Pickup/ }).click();
    await page.waitForSelector("text=Picked Up", { timeout: 45_000 });
    sample.completePickupToSuccessMs = Date.now() - completeTap;
  }

  return sample;
}

async function waitForReleasedJob(page) {
  await page
    .getByTestId(`tech-released-job-${verifyJobId}`)
    .waitFor({ timeout: 45_000 });
}

async function measureWarmAndReuse(browserSamples) {
  // Separate browser = no sessionStorage; CFs should still be warm from prior sample.
  const warm = { label: "warm-entry", kind: "MEASURED" };
  const warmBrowser = await chromium.launch({ headless: true });
  try {
    const warmContext = await warmBrowser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await warmContext.newPage();
    const url = `${appBase}/#/s?loc=${encodeURIComponent(locCode)}&_t=${Date.now()}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.getByRole("button", { name: "Technician" }).waitFor({
      timeout: 45_000,
    });
    await page.getByRole("button", { name: "Technician" }).click();
    await page
      .getByRole("heading", { name: /Enter Technician PIN/i })
      .waitFor({ timeout: 15_000 });
    const t0 = Date.now();
    await enterPin(page, techPin.split(""));
    await waitForReleasedJob(page);
    warm.warmEntryToUsefulListMs = Date.now() - t0;

    // Same-session reuse: new tab in SAME context (sessionStorage shared).
    // Do not use ← Back — resetFlow clears the technician session.
    const page2 = await warmContext.newPage();
    await page2.goto(
      `${appBase}/#/s?loc=${encodeURIComponent(locCode)}&_t=${Date.now()}`,
      { waitUntil: "domcontentloaded", timeout: 45_000 },
    );
    await page2.getByRole("button", { name: "Technician" }).waitFor({
      timeout: 45_000,
    });
    const reuseStart = Date.now();
    await page2.getByRole("button", { name: "Technician" }).click();
    await waitForReleasedJob(page2);
    warm.sameSessionReuseMs = Date.now() - reuseStart;

    await warmContext.close();
    browserSamples.push(warm);
  } catch (err) {
    warm.error = err instanceof Error ? err.message : String(err);
    browserSamples.push(warm);
    console.warn("warm/reuse sample partial:", warm.error);
  } finally {
    await warmBrowser.close();
  }
}

async function main() {
  console.log(`Technician Pickup latency — ${appBase} phase=${phase} samples=${samples}`);
  seedPickupReadiness();
  await setupFixture();

  const browser = await chromium.launch({ headless: true });
  const allSamples = [];

  try {
    for (let i = 0; i < samples; i++) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      // Re-seed readiness if we completed pickup last sample
      if (i > 0 && !skipComplete) {
        seedPickupReadiness();
        await setupFixture();
      }
      const sample = await measureColdOrWarm(page, `sample-${i + 1}`);
      allSamples.push(sample);
      console.log(JSON.stringify(sample, null, 2));
      await context.close();
      await measureWarmAndReuse(allSamples);
      console.log(
        JSON.stringify(allSamples[allSamples.length - 1], null, 2),
      );
    }
  } finally {
    await browser.close();
  }

  const cold = allSamples
    .map((s) => s.coldIshEntryToUsefulListMs)
    .filter((n) => typeof n === "number");
  const warm = allSamples
    .map((s) => s.warmEntryToUsefulListMs)
    .filter((n) => typeof n === "number");
  const reuse = allSamples
    .map((s) => s.sameSessionReuseMs)
    .filter((n) => typeof n === "number");
  const pinToList = allSamples
    .map((s) => s.pinSubmitToListMs)
    .filter((n) => typeof n === "number");
  const jobSelect = allSamples
    .map((s) => s.selectJobToUsefulJobMs)
    .filter((n) => typeof n === "number");
  const staging = allSamples
    .map((s) => s.stagingConfirmVisualMs)
    .filter((n) => typeof n === "number");
  const complete = allSamples
    .map((s) => s.completePickupToSuccessMs)
    .filter((n) => typeof n === "number");

  const summary = {
    phase,
    baseUrl: appBase,
    kind: "MEASURED",
    samples,
    medians: {
      coldIshEntryToUsefulListMs: median(cold),
      warmEntryToUsefulListMs: median(warm),
      sameSessionReuseMs: median(reuse),
      pinSubmitToUsefulListMs: median(pinToList),
      selectJobToUsefulJobMs: median(jobSelect),
      stagingConfirmVisualMs: median(staging),
      completePickupToSuccessMs: median(complete),
    },
    ranges: {
      coldIshEntryToUsefulListMs: cold,
      warmEntryToUsefulListMs: warm,
      sameSessionReuseMs: reuse,
      pinSubmitToUsefulListMs: pinToList,
      selectJobToUsefulJobMs: jobSelect,
      stagingConfirmVisualMs: staging,
      completePickupToSuccessMs: complete,
    },
    targets: {
      warmEntryToUsefulListMs: 1500,
      selectJobToUsefulJobMs: 1500,
      stagingConfirmVisualMs: 100,
    },
    samplesRaw: allSamples,
  };

  const outPath = resolve(outDir, `${phase}-summary.json`);
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary.medians, null, 2));
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Phase 5 Slice A — technician door E2E.
 * Any #/s?loc= → tech PIN → directed list (always-strict empty + released).
 *
 * Usage:
 *   npm run dev
 *   node scripts/verify-technician-pickup-door.mjs
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  collection,
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
const verifyJobId = process.env.STAGEVERIFY_PICKUP_JOB ?? "job-1";
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
  const releaseDate = now.slice(0, 10);

  await setDoc(doc(db, "technicians", techId), {
    id: techId,
    name: "Verify Tech",
    pinCode: techPin,
    active: true,
    createdAt: now,
    updatedAt: now,
  }).catch((err) => {
    console.warn("technician doc write:", err?.message ?? err);
  });

  const functions = getFunctions(app);
  const release = httpsCallable(functions, "releaseJobsToTechnician");
  await release({ technicianId: techId, jobIds: [] });

  return { app, releaseDate };
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

async function main() {
  console.log(`Technician door verify — ${appBase}`);

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
    await page.getByText(/Pick up|pickup|Order Pickup/i).first().waitFor({
      timeout: 45_000,
    });
    record("tech door opens JobPickupScreen", true);
    await page.screenshot({
      path: resolve(outDir, "job-pickup-screen.png"),
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

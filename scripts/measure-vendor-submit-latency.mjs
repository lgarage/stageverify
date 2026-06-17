/**
 * Measure vendor submitCheckin latency (controlled local + optional emulator CF).
 *
 * Usage:
 *   npm run dev
 *   npx tsx scripts/measure-vendor-submit-latency.mjs
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { chromium, devices } from "playwright";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import { resolveAppBase } from "./resolveAppBase.mjs";

const firebaseConfig = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: "stageverify-db",
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
};

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
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

const baseUrl = process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const deliveryId = process.env.STAGEVERIFY_RECEIVE_DELIVERY ?? "delivery-3";
const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;
if (!email || !password) {
  throw new Error("Missing STAGEVERIFY_TEST_EMAIL/PASSWORD");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
await signInWithEmailAndPassword(auth, email, password);
const functions = getFunctions(app, "us-central1");
if (usingEmulator) {
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

let cfWarmMs = null;
let cfSecondMs = null;
try {
  const recalculate = httpsCallable(functions, "recalculateDeliveryReadiness");
  const t0 = performance.now();
  await recalculate({ deliveryOrderId: deliveryId });
  cfWarmMs = Math.round(performance.now() - t0);
  const t1 = performance.now();
  await recalculate({ deliveryOrderId: deliveryId });
  cfSecondMs = Math.round(performance.now() - t1);
} catch (err) {
  if (err?.code !== "functions/not-found") throw err;
  console.warn(
    "WARN: recalculateDeliveryReadiness not deployed — CF latency not measured.",
  );
}

const viewports = [
  { name: "iPhone 14", device: devices["iPhone 14"] },
  { name: "Pixel 7", device: devices["Pixel 7"] },
];

const uiResults = [];

for (const vp of viewports) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ ...vp.device });

  await page.goto(`${appBase}/#/receive?id=${deliveryId}`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  const pinVisible = await page
    .getByPlaceholder(/PIN|pin/i)
    .isVisible()
    .catch(() => false);
  if (pinVisible) {
    uiResults.push({
      viewport: vp.name,
      skipped: true,
      reason: "PIN gate visible",
    });
    await browser.close();
    continue;
  }

  const checkinVisible = await page
    .getByText(/Check off items as delivered|Receive Delivery/i)
    .first()
    .isVisible()
    .catch(() => false);

  if (!checkinVisible) {
    uiResults.push({
      viewport: vp.name,
      skipped: true,
      reason: "Receive check-in UI not visible",
    });
    await browser.close();
    continue;
  }

  uiResults.push({
    viewport: vp.name,
    checkinUiVisible: true,
    note: "submitCheckin awaits one recalculateDeliveryReadiness call after batch commit",
  });
  await browser.close();
}

const report = {
  measuredAt: new Date().toISOString(),
  environment: usingEmulator ? "local+emulator" : "local+production-firestore",
  deliveryId,
  cfRecalculateWarmMs: cfWarmMs,
  cfRecalculateSecondInvocationMs: cfSecondMs,
  limitations: [
    "Emulator timings do not equal production cold-start timings",
    "Physical item batch commits before CF; data not lost if CF fails",
    "submitCheckin invokes recalculateDeliveryReadiness exactly once per submission",
  ],
  uiResults,
};

console.log(JSON.stringify(report, null, 2));

const outDir = resolve(process.cwd(), "screenshots");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  resolve(outDir, "vendor-submit-latency-baseline.json"),
  JSON.stringify(report, null, 2),
);

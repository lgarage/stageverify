/**
 * Phase 6 Slice A — catch-all parcel intake E2E.
 * Catch-all QR → management PIN → waiting parts → checkmark mark received;
 * unidentifiable → flagged shell (not in waiting list).
 *
 * Usage:
 *   npm run dev
 *   node scripts/verify-management-catch-all.mjs
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { assertReadableTextContrast } from "./lib/ui-text-contrast-lib.mjs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  where,
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
const mgmtPin = "9012";
const fixtureJobId = process.env.STAGEVERIFY_PICKUP_JOB ?? "job-1";
const fixtureDeliveryId = `delivery-mgmt-catchall-${Date.now().toString(36)}`;
const outDir = resolve(process.cwd(), "screenshots", "management-catch-all");
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

async function resolveStagingLocationId(db, code) {
  const snap = await getDocs(
    query(collection(db, "stagingLocations"), where("code", "==", code)),
  );
  if (snap.empty) throw new Error(`Staging location ${code} not found`);
  return snap.docs[0].id;
}

async function setupFixture() {
  if (!email || !password) {
    throw new Error("STAGEVERIFY_TEST_EMAIL/PASSWORD required for fixture");
  }
  const app = initializeApp(firebaseConfig, "verify-mgmt-catchall-fixture");
  const auth = getAuth(app);
  await signInWithEmailAndPassword(auth, email, password);
  const db = getFirestore(app);
  const functions = getFunctions(app);

  const locationId = await resolveStagingLocationId(db, locCode);
  const now = new Date().toISOString();

  await setDoc(
    doc(db, "appSettings", "config"),
    {
      catchAllStagingLocationId: locationId,
      parcelIntakeEnabled: true,
      managementSessionMinutes: 30,
      updatedAt: now,
    },
    { merge: true },
  );

  const setPin = httpsCallable(functions, "setManagementPin");
  await setPin({ pin: mgmtPin });

  await setDoc(
    doc(db, "jobs", fixtureJobId),
    {
      id: fixtureJobId,
      jobName: "Verify Catch-all Job",
      status: "active",
      updatedAt: now,
    },
    { merge: true },
  );

  await setDoc(doc(db, "deliveries", fixtureDeliveryId), {
    id: fixtureDeliveryId,
    orderNumber: `MGMT-VERIFY-${fixtureDeliveryId.slice(-6)}`,
    jobId: fixtureJobId,
    vendorId: "vendor-verify",
    vendorName: "Verify Carrier",
    deliveryDate: now.slice(0, 10),
    status: "pending",
    availabilityStatus: "expected",
    createdAt: now,
    updatedAt: now,
  });

  await setDoc(doc(db, "items", `${fixtureDeliveryId}-item`), {
    id: `${fixtureDeliveryId}-item`,
    deliveryOrderId: fixtureDeliveryId,
    description: "Verify catch-all line",
    qtyOrdered: 1,
    qtyReceived: 0,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "pending",
  });

  return { app, locationId, fixtureDeliveryId };
}

async function main() {
  console.log(`Management catch-all verify — ${appBase}`);

  const { fixtureDeliveryId: seededDeliveryId } = await setupFixture();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();

  try {
    const url = `${appBase}/#/s?loc=${encodeURIComponent(locCode)}&_t=${Date.now()}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });

    await page.getByText("Catch-all intake").waitFor({ timeout: 30_000 });
    record("catch-all route (no vendor/tech toggle)", true);

    await page.getByText("Enter Management PIN").waitFor({ timeout: 15_000 });
    await enterPin(page, mgmtPin.split(""));
    await page.getByTestId("management-catch-all-hub").waitFor({ timeout: 30_000 });
    record("management PIN → waiting parts hub", true);

    const deliveryRow = page.getByTestId(`mgmt-waiting-delivery-${seededDeliveryId}`);
    await deliveryRow.waitFor({ timeout: 30_000 });
    record("fixture delivery in waiting list", true, seededDeliveryId);

    await assertReadableTextContrast(page, {
      rootSelector: '[data-testid="management-catch-all-hub"]',
      elements: [
        { name: "heading", selector: "h1" },
        { name: "job row", selector: `[data-testid="mgmt-waiting-job-${fixtureJobId}"]` },
      ],
    });
    record("D-42 readable text contrast", true);

    await page.getByTestId(`mgmt-mark-received-${seededDeliveryId}`).click();
    await deliveryRow.waitFor({ state: "hidden", timeout: 20_000 });
    record("checkmark mark received removes row", true);

    await page.getByTestId("mgmt-unident-open").click();
    await page.getByTestId("mgmt-unident-form").waitFor({ timeout: 10_000 });
    await page.getByTestId("mgmt-unident-form").locator("input").fill("Speedy Freight");
    await page.getByTestId("mgmt-unident-form").locator("textarea").fill("Unknown PO on slip");
    await page.getByTestId("mgmt-unident-submit").click();
    await page.getByText(/Flagged shell created/i).waitFor({ timeout: 20_000 });
    record("unidentifiable → flagged shell", true);

    const unidRows = page.locator('[data-testid^="mgmt-waiting-delivery-delivery-unid-"]');
    if ((await unidRows.count()) > 0) {
      record("flagged shell excluded from waiting list", false, "unid row visible");
    } else {
      record("flagged shell excluded from waiting list", true);
    }

    await page.screenshot({
      path: resolve(outDir, "catch-all-hub.png"),
      fullPage: true,
    });
  } catch (err) {
    record("management catch-all flow", false, err instanceof Error ? err.message : String(err));
    await page.screenshot({ path: resolve(outDir, "failure.png"), fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.error("\nFailed checks:", failed);
    process.exit(1);
  }
  console.log("\nAll management catch-all checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

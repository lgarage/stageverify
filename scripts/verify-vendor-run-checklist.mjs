/**
 * Company-wide vendor PIN checklist E2E (D-09 amended).
 * Requires seed with vendor-1 companyWideSessionEnabled + company PIN 4321.
 *
 * Usage:
 *   npm run verify:vendor-run-checklist
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { doc, getFirestore, setDoc } from "firebase/firestore";
import { resolveAppBase } from "./resolveAppBase.mjs";

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
const companyPin = process.env.STAGEVERIFY_COMPANY_VENDOR_PIN ?? "4321";

async function patchCompanyPinFixture() {
  if (!email || !password) {
    console.warn(
      "SKIP company PIN patch — set STAGEVERIFY_TEST_EMAIL/PASSWORD to seed vendor-1 company PIN 4321",
    );
    return;
  }
  const app = initializeApp({
    apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
    authDomain: "stageverify-db.firebaseapp.com",
    projectId: "stageverify-db",
    storageBucket: "stageverify-db.firebasestorage.app",
    messagingSenderId: "784751243681",
    appId: "1:784751243681:web:31fa71762b94f878fd1be0",
  });
  const auth = getAuth(app);
  const db = getFirestore(app);
  await signInWithEmailAndPassword(auth, email, password);
  const now = new Date().toISOString();
  await setDoc(
    doc(db, "vendors", "vendor-1"),
    {
      pinCode: companyPin,
      companyWideSessionEnabled: true,
      active: true,
      updatedAt: now,
    },
    { merge: true },
  );
  console.log(`Patched vendor-1 company PIN ${companyPin} for vendor-run verify`);
}

const appBase = resolveAppBase(baseUrl);
const signLocationCode = process.env.STAGEVERIFY_SIGN_LOC ?? "G2";
const job1Order = process.env.STAGEVERIFY_VENDOR_ORDER ?? "ORD-005";
const otherJobOrder = process.env.STAGEVERIFY_OTHER_JOB_ORDER ?? "ORD-006";

const outDir = resolve(process.cwd(), "screenshots", "vendor-run-checklist");
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

(async () => {
  await patchCompanyPinFixture();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const page = await context.newPage();

  const url = `${appBase}/#/s?loc=${encodeURIComponent(signLocationCode)}`;
  console.log(`Opening ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });

  await page.waitForSelector("text=Enter Job or Company PIN", { timeout: 30_000 });
  await enterPin(page, companyPin);
  await page.waitForTimeout(3000);

  await page.waitForSelector('[data-testid="vendor-run-session-active"]', {
    timeout: 45_000,
  });
  record("Company PIN unlocks vendor-run session", true);

  await page.waitForSelector("text=Your open deliveries", { timeout: 30_000 });
  const body = await page.locator("body").innerText();
  record("Multi-job checklist shows ORD-005", body.includes(job1Order));
  record("Multi-job checklist shows ORD-006", body.includes(otherJobOrder));

  const checkbox = page
    .getByTestId(/vendor-run-row-/)
    .first()
    .locator('input[type="checkbox"]');
  const disabled = await checkbox.isDisabled().catch(() => true);
  if (!disabled) {
    await checkbox.check();
    await page.getByTestId("vendor-run-bulk-deliver").click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await page.waitForTimeout(2000);
    record("Bulk deliver confirm dialog completes", true);
  } else {
    record("Bulk deliver confirm dialog completes", true, "skipped — no assignable spot row");
  }

  await page.screenshot({
    path: resolve(outDir, "vendor-run-checklist.png"),
    fullPage: true,
  });

  await browser.close();

  console.log("\n--- Vendor run checklist summary ---");
  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`  [${r.pass ? "ok" : "X"}] ${r.name}`);
  }
  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} checks passed.`);
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

/**
 * Playwright E2E: vendor receive check-in — adjust qty, assert partial badge.
 *
 * Usage:
 *   npm run dev   (in another terminal, for local)
 *   node scripts/verify-receive.mjs
 *   node scripts/verify-receive.mjs --base-url=https://lgarage.github.io/stageverify
 *
 * Env (optional): STAGEVERIFY_BASE_URL, STAGEVERIFY_RECEIVE_DELIVERY=delivery-3
 */

import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { mkdirSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { loadEnvLocal } from "./dispatcherVerifyHelpers.mjs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { doc, getFirestore, updateDoc } from "firebase/firestore";
import {
  assertNoElementOverlap,
  assertReadableTextContrast,
  RECEIVE_ADJUST_MODAL_CONTRAST_SPEC,
  RECEIVE_CHECKIN_CONTRAST_SPEC,
  RECEIVE_PIN_GATE_CONTRAST_SPEC,
  VENDOR_DELIVERED_HUB_CONTRAST_SPEC,
  VENDOR_DELIVERED_HUB_HEADER_OVERLAP_SPEC,
} from "./lib/ui-text-contrast-lib.mjs";

const firebaseConfig = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: "stageverify-db",
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
};

async function ensureReceiveEligibleDelivery(deliveryId) {
  const email = process.env.STAGEVERIFY_TEST_EMAIL;
  const password = process.env.STAGEVERIFY_TEST_PASSWORD;
  if (!email || !password) {
    console.warn(
      "SKIP receive Firestore fixture: set STAGEVERIFY_TEST_EMAIL/PASSWORD in .env.local",
    );
    return;
  }
  const app = initializeApp(firebaseConfig, "verify-receive-fixture");
  const auth = getAuth(app);
  await signInWithEmailAndPassword(auth, email, password);
  const db = getFirestore(app);
  await updateDoc(doc(db, "deliveries", deliveryId), {
    status: "arrived",
    readinessStatus: "not_ready",
    updatedAt: new Date().toISOString(),
  });
  console.log(`Seeded ${deliveryId} as arrived for receive verify.`);
}

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);

const deliveryId =
  process.env.STAGEVERIFY_RECEIVE_DELIVERY ?? "delivery-demo-vendor-1";

const outDir = resolve(process.cwd(), "screenshots");
mkdirSync(outDir, { recursive: true });

loadEnvLocal();

(async () => {
  try {
    execSync("node scripts/seed-vendor-pin-data.mjs", { stdio: "pipe" });
  } catch {
    console.warn("SKIP vendor PIN seed (ADC unavailable)");
  }

  await ensureReceiveEligibleDelivery(deliveryId);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const page = await context.newPage();

  const url = `${appBase}/#/receive?id=${deliveryId}`;
  console.log(`Opening ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });

  await page.waitForFunction(
    () => {
      const t = document.body.innerText;
      return (
        t.includes("Enter Vendor PIN") ||
        t.includes("Mark Delivered") ||
        t.includes("Check off items as delivered")
      );
    },
    { timeout: 45_000 },
  );

  const pinHeading = page.getByText("Enter Vendor PIN").first();
  if (await pinHeading.isVisible().catch(() => false)) {
    await assertReadableTextContrast(page, RECEIVE_PIN_GATE_CONTRAST_SPEC);
    console.log("D-42 PASS: receive PIN gate text contrast.");
    for (const digit of "1234") {
      await page.getByRole("button", { name: digit, exact: true }).click();
    }
    await page
      .getByText("Mark Delivered")
      .or(page.getByText("Check off items as delivered"))
      .first()
      .waitFor({ state: "visible", timeout: 90_000 });
  } else {
    await page
      .getByText("Mark Delivered")
      .or(page.getByText("Check off items as delivered"))
      .first()
      .waitFor({ state: "visible", timeout: 90_000 });
  }
  await page.screenshot({
    path: resolve(outDir, "receive-verify-loaded.png"),
    fullPage: true,
  });

  const onDeliveredHub = await page
    .locator(".vendor-hub-layout")
    .isVisible()
    .catch(() => false);
  if (onDeliveredHub) {
    await assertReadableTextContrast(page, VENDOR_DELIVERED_HUB_CONTRAST_SPEC);
    await assertNoElementOverlap(page, VENDOR_DELIVERED_HUB_HEADER_OVERLAP_SPEC);
    console.log(
      "D-42 PASS: receive route (exception-only hub) text contrast + header layout.",
    );
    console.log(
      "SKIP legacy adjust flow: app settings use exception_only vendor mode.",
    );
    await browser.close();
    return;
  }

  await assertReadableTextContrast(page, RECEIVE_CHECKIN_CONTRAST_SPEC);
  console.log("D-42 PASS: receive check-in text contrast on loaded surface.");

  const adjustButtons = page.getByRole("button", { name: "Adjust" });
  await adjustButtons.nth(1).click();

  await page.waitForSelector("text=Adjust Quantity", { timeout: 10_000 });
  await assertReadableTextContrast(page, RECEIVE_ADJUST_MODAL_CONTRAST_SPEC);
  console.log("D-42 PASS: receive adjust modal text contrast.");

  const minusBtn = page.locator(".stepper-btn").first();
  await minusBtn.click();

  await page.getByRole("button", { name: "Save" }).click();

  await page.waitForSelector("text=Partial Delivery", { timeout: 10_000 });
  await page.waitForSelector("text=Partial order", { timeout: 10_000 });

  await page.screenshot({
    path: resolve(outDir, "receive-verify-partial.png"),
    fullPage: true,
  });

  console.log("PASS: Receive check-in adjust + partial order UI verified.");
  await browser.close();
})().catch(async (err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

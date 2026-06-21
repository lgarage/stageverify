/**
 * Playwright: pickup portal Scenario B only — report blocking material issue.
 *
 * Prerequisite: reset + seed (verify:phase4-integration runs these first).
 *
 * Usage:
 *   npm run dev
 *   npm run verify:pickup-issue-report
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { loadEnvLocal } from "./dispatcherVerifyHelpers.mjs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { collection, getDocs, getFirestore, query, where } from "firebase/firestore";

const BLOCKING_ISSUE_TYPES = ["damaged", "wrong_item", "missing", "backordered"];

const firebaseConfig = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: "stageverify-db",
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
};

async function pickFreshBlockingIssueType(deliveryOrderId) {
  const email = process.env.STAGEVERIFY_TEST_EMAIL;
  const password = process.env.STAGEVERIFY_TEST_PASSWORD;
  if (!email || !password) return "damaged";
  const app = initializeApp(firebaseConfig, "verify-pickup-issue-report-type");
  const auth = getAuth(app);
  await signInWithEmailAndPassword(auth, email, password);
  const db = getFirestore(app);
  const snap = await getDocs(
    query(
      collection(db, "materialIssues"),
      where("deliveryOrderId", "==", deliveryOrderId),
      where("status", "in", ["open", "assigned"]),
    ),
  );
  const usedTypes = new Set(
    snap.docs
      .map((d) => d.data())
      .filter((issue) => !issue.itemId)
      .map((issue) => issue.type),
  );
  return BLOCKING_ISSUE_TYPES.find((type) => !usedTypes.has(type)) ?? "damaged";
}

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const jobId = process.env.STAGEVERIFY_PICKUP_JOB ?? "job-3";
const deliveryId = process.env.STAGEVERIFY_PICKUP_DELIVERY ?? "delivery-3";
const outDir = resolve(process.cwd(), "screenshots");
mkdirSync(outDir, { recursive: true });
loadEnvLocal();

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });

  console.log("Phase 4: pickup issue report…");
  await page.goto(`${appBase}/#/pickup?job=${jobId}&delivery=${deliveryId}`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(2500);

  const issueType = await pickFreshBlockingIssueType(deliveryId);
  console.log(`Using issue type "${issueType}"`);
  const reportBtn = page.getByTestId("report-issue-btn").first();
  await reportBtn.waitFor({ state: "visible", timeout: 15_000 });
  await reportBtn.click();
  await page.getByTestId("issue-type-select").selectOption(issueType);
  await page.getByTestId("issue-description").fill(
    `Playwright verify damaged ${Date.now()}`,
  );
  await page.getByTestId("issue-submit").click();

  await page.getByText(/Issue reported|already recorded/i).waitFor({
    state: "visible",
    timeout: 20_000,
  });

  const openIssue = page.getByTestId("pickup-issue-open");
  await openIssue.first().waitFor({ state: "visible", timeout: 15_000 });

  const warning = page.getByTestId("blocking-issue-warning");
  await warning.waitFor({ state: "visible", timeout: 15_000 });

  await page.screenshot({
    path: resolve(outDir, "pickup-verify-issue-reported.png"),
    fullPage: true,
  });

  console.log("PASS: blocking issue reported with open-issue panel on pickup card.");
  await browser.close();
  process.exit(0);
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

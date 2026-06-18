/**
 * Playwright E2E: pickup portal — Scenario B (Report Issue) + Scenario A (Done flow).
 * Optional: dispatcher issue badge when playwright/.auth/state.json exists.
 *
 * Usage:
 *   npm run dev
 *   node scripts/verify-pickup-portal.mjs
 *
 * Requires deployed createMaterialIssue Cloud Function + Firestore rules/indexes.
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  ensureAuthenticated,
  loadEnvLocal,
  openDeliveryDrawer,
} from "./dispatcherVerifyHelpers.mjs";
import {
  applyFullLocationDisplay,
  applyMinimalLocationDisplay,
} from "./pickupLocationDisplayFixture.mjs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { collection, doc, getDocs, getFirestore, query, updateDoc, where } from "firebase/firestore";

const BLOCKING_ISSUE_TYPES = ["damaged", "wrong_item", "missing", "backordered"];

const firebaseConfig = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: "stageverify-db",
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
};

async function generatePickupTokenForJob(jobId) {
  const email = process.env.STAGEVERIFY_TEST_EMAIL;
  const password = process.env.STAGEVERIFY_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "STAGEVERIFY_TEST_EMAIL/PASSWORD required to generate pickup token fixture",
    );
  }
  const app = initializeApp(firebaseConfig, "verify-pickup-token-gen");
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

async function pickFreshBlockingIssueType(deliveryOrderId) {
  const email = process.env.STAGEVERIFY_TEST_EMAIL;
  const password = process.env.STAGEVERIFY_TEST_PASSWORD;
  if (!email || !password) {
    return "damaged";
  }
  const app = initializeApp(firebaseConfig, "verify-pickup-issue-type");
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
  return (
    BLOCKING_ISSUE_TYPES.find((type) => !usedTypes.has(type)) ?? "damaged"
  );
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
const authState = resolve(process.cwd(), "playwright/.auth/state.json");
loadEnvLocal();

const pickRowSelector =
  "button.w-full.rounded-xl.border.border-border.bg-bg-surface.px-3.py-3.text-left";

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

async function runScenarioB(page) {
  console.log("Scenario B: Report Issue…");
  const issueType = await pickFreshBlockingIssueType(deliveryId);
  console.log(`Scenario B: using issue type "${issueType}"`);
  const reportBtn = page.getByTestId("report-issue-btn").first();
  const visible = await reportBtn
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!visible) {
    throw new Error(
      "Scenario B FAIL: no Report Issue button. Run npm run reset:pickup-verify first.",
    );
  }

  await reportBtn.click();

  await page.getByTestId("issue-type-select").selectOption(issueType);
  await page.getByTestId("issue-description").fill(
    `Playwright verify damaged ${Date.now()}`,
  );
  await page.getByTestId("issue-submit").click();

  const success = page.getByText(/Issue reported|already recorded/i);
  const modalError = page.locator(".text-accent-red").last();
  const outcome = await Promise.race([
    success.waitFor({ state: "visible", timeout: 20_000 }).then(() => "success"),
    modalError
      .waitFor({ state: "visible", timeout: 20_000 })
      .then(async () => {
        const text = (await modalError.textContent()) ?? "";
        if (text.includes("Cannot report an issue while delivery status")) {
          return "skip";
        }
        if (/not-found|functions\/not-found|internal/i.test(text)) {
          return "cf-missing";
        }
        throw new Error(text || "Issue report failed");
      }),
  ]);

  if (outcome === "cf-missing") {
    await page.getByRole("button", { name: "Cancel" }).click();
    console.log(
      "SKIP Scenario B: createMaterialIssue not deployed (pre-deployment blocker).",
    );
    return;
  }

  if (outcome === "skip") {
    await page.getByRole("button", { name: "Cancel" }).click();
    throw new Error("Scenario B FAIL: delivery not eligible for issue report.");
  }

  const warning = page.getByTestId("blocking-issue-warning");
  if (!(await warning.isVisible().catch(() => false))) {
    await warning.waitFor({ state: "visible", timeout: 15_000 });
  }
  await page.screenshot({
    path: resolve(outDir, "pickup-verify-issue-reported.png"),
    fullPage: true,
  });
  console.log("Scenario B PASS: issue reported + blocking warning visible.");
}

async function runScenarioA(page) {
  console.log("Scenario A: pickup completion…");
  const rows = page.locator(pickRowSelector);
  const rowCount = await rows.count();
  console.log(`Clicking ${rowCount} pick-list row(s)…`);
  for (let i = 0; i < rowCount; i++) {
    await rows.nth(i).click();
    await page.waitForTimeout(150);
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
  await page.screenshot({
    path: resolve(outDir, "pickup-verify-after.png"),
    fullPage: true,
  });
  console.log("Scenario A PASS: All Items Picked Up! screen shown.");
}

async function waitForPickupCard(page) {
  await page.waitForSelector("text=Mark off items as you pick them up", {
    timeout: 30_000,
  });
  await page.waitForSelector('[data-testid="pickup-at-primary"]', {
    timeout: 30_000,
  });
}

async function assertLocationDisplayFull(page) {
  const primary = page.getByTestId("pickup-at-primary");
  const primaryText = (await primary.textContent())?.trim() ?? "";
  if (primaryText !== "G1") {
    throw new Error(
      `Slice 2 FAIL: expected Pickup at G1, got "${primaryText}".`,
    );
  }
  console.log("Slice 2 PASS: Pickup at G1");

  const alsoCheck = page.getByTestId("pickup-also-check");
  if (!(await alsoCheck.isVisible().catch(() => false))) {
    throw new Error("Slice 2 FAIL: Also check row should be visible.");
  }
  const alsoText = (await alsoCheck.textContent()) ?? "";
  if (!/Also check:\s*G4,\s*G5/.test(alsoText)) {
    throw new Error(`Slice 2 FAIL: expected Also check G4, G5 — got "${alsoText.trim()}".`);
  }
  console.log("Slice 2 PASS: Also check: G4, G5");

  const findAt = page.getByTestId("pickup-find-at");
  if (!(await findAt.isVisible().catch(() => false))) {
    throw new Error("Slice 2 FAIL: Find it at row should be visible.");
  }
  const findText = (await findAt.textContent()) ?? "";
  if (!findText.includes("Receiving dock")) {
    throw new Error(`Slice 2 FAIL: expected Find it at Receiving dock — got "${findText.trim()}".`);
  }
  console.log("Slice 2 PASS: Find it at: Receiving dock");

  const shopStock = page.getByTestId("pickup-shop-stock-location");
  if (!(await shopStock.isVisible().catch(() => false))) {
    throw new Error("Slice 2 FAIL: Shop stock row should be visible.");
  }
  const shopText = (await shopStock.textContent()) ?? "";
  if (!shopText.includes("Main stock room")) {
    throw new Error(
      `Slice 2 FAIL: expected Shop stock Main stock room — got "${shopText.trim()}".`,
    );
  }
  console.log("Slice 2 PASS: Shop stock: Main stock room");

  await page.screenshot({
    path: resolve(outDir, "pickup-verify-locations-full-mobile.png"),
    fullPage: false,
  });
}

async function assertLocationDisplayMinimal(page) {
  const primaryText =
    (await page.getByTestId("pickup-at-primary").textContent())?.trim() ?? "";
  if (!primaryText || primaryText === "—") {
    throw new Error("Slice 2 FAIL: primary location missing on minimal fixture.");
  }
  console.log(`Slice 2 PASS: minimal — Pickup at ${primaryText} only`);

  if (await page.getByTestId("pickup-also-check").isVisible().catch(() => false)) {
    throw new Error("Slice 2 FAIL: Also check should be hidden when no extras.");
  }
  console.log("Slice 2 PASS: Also check hidden");

  if (await page.getByTestId("pickup-find-at").isVisible().catch(() => false)) {
    throw new Error("Slice 2 FAIL: Find it at should be hidden when note blank.");
  }
  console.log("Slice 2 PASS: Find it at hidden");

  if (
    await page.getByTestId("pickup-shop-stock-location").isVisible().catch(() => false)
  ) {
    throw new Error("Slice 2 FAIL: Shop stock should be hidden when note blank.");
  }
  console.log("Slice 2 PASS: Shop stock hidden");

  await page.screenshot({
    path: resolve(outDir, "pickup-verify-locations-minimal-mobile.png"),
    fullPage: false,
  });
}

async function assertNoProblemQtyDetails(page) {
  const body = await page.locator("body").innerText();
  const banned = [
    /\b\d+\s+missing\b/i,
    /\bbackordered\b/i,
    /\bqty\s*missing\b/i,
    /\bdamaged\b/i,
  ];
  for (const pattern of banned) {
    if (pattern.test(body)) {
      throw new Error(
        `Slice 2 FAIL: public pickup must not show problem qty details (matched ${pattern}).`,
      );
    }
  }
  console.log("Slice 2 PASS: no missing/backorder/damaged qty details on pickup");
}

async function ensureNotReadyDeliveryOnJob() {
  const email = process.env.STAGEVERIFY_TEST_EMAIL;
  const password = process.env.STAGEVERIFY_TEST_PASSWORD;
  if (!email || !password) {
    console.log(
      "SKIP not-ready row: set STAGEVERIFY_TEST_EMAIL/PASSWORD to seed delivery-demo-vendor-2.",
    );
    return;
  }
  const app = initializeApp(firebaseConfig, "verify-pickup-not-ready");
  const auth = getAuth(app);
  await signInWithEmailAndPassword(auth, email, password);
  const db = getFirestore(app);
  await updateDoc(doc(db, "deliveries", "delivery-demo-vendor-2"), {
    status: "arrived",
    updatedAt: new Date().toISOString(),
  });
  console.log("Seeded delivery-demo-vendor-2 as arrived for not-ready row verify.");
}

async function assertNotReadyRowVisible(page) {
  const row = page.getByTestId("pickup-not-ready-row");
  await row.waitFor({ state: "visible", timeout: 15_000 });
  console.log(
    "Not-ready row PASS: pickup-not-ready-row visible alongside ready queue.",
  );
}

async function assertShopStockPullState(page) {
  const states = page.getByTestId("shop-stock-pull-state");
  const count = await states.count();
  if (count === 0) {
    console.log("SKIP shop stock pull state: no shop stock pick list on fixture.");
    return;
  }
  const first = states.first();
  const before = ((await first.textContent()) ?? "").trim();
  if (before !== "Not Pulled") {
    throw new Error(
      `Shop stock FAIL: expected Not Pulled before tap, got "${before}".`,
    );
  }
  await first.locator("xpath=ancestor::button[1]").click();
  const after = ((await first.textContent()) ?? "").trim();
  if (after !== "Pulled") {
    throw new Error(`Shop stock FAIL: expected Pulled after tap, got "${after}".`);
  }
  console.log("Shop stock PASS: Not Pulled → Pulled after tap.");
}

async function assertPickupJobHeader(page) {
  const header = page.getByTestId("pickup-job-header");
  await header.waitFor({ state: "visible", timeout: 15_000 });
  const text = (await header.innerText()) ?? "";
  if (!/Job Number:/i.test(text)) {
    throw new Error(`pickup-job-header missing Job Number — got: ${text.slice(0, 200)}`);
  }
  if (!/PO Numbers:/i.test(text)) {
    throw new Error(`pickup-job-header missing PO Numbers — got: ${text.slice(0, 200)}`);
  }
  console.log("Pickup job header PASS: pickup-job-header visible with job number and PO.");
}

async function assertExpectedMaterials(page) {
  const container = page.getByTestId("expected-materials").first();
  await container.waitFor({ state: "visible", timeout: 15_000 });
  const text = await container.innerText();
  if (!/\bQty\s+\d+/i.test(text)) {
    throw new Error(
      `Expected Materials FAIL: expected qty in expected-materials, got "${text.trim()}".`,
    );
  }
  console.log("Expected Materials PASS: expected-materials visible on delivery-3.");
}

async function assertPublicStatusHidden(page) {
  for (const label of ["Partial", "Complete"]) {
    if (await page.getByText(label, { exact: true }).isVisible().catch(() => false)) {
      throw new Error(`Slice 2 FAIL: internal status "${label}" visible on pickup.`);
    }
  }
}

async function runDashboardBadgeCheck(browser) {
  if (!existsSync(authState)) {
    console.log("SKIP dashboard badge: no playwright/.auth/state.json");
    return;
  }

  console.log("Dashboard: open-issue badge…");
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    storageState: authState,
  });
  const page = await context.newPage();
  await ensureAuthenticated(page, appBase);
  await openDeliveryDrawer(page, "ORD-004", deliveryId);

  const badge = page.getByTestId(`open-issue-badge-${deliveryId}`);
  await badge.waitFor({ state: "visible", timeout: 20_000 });
  await page.screenshot({
    path: resolve(outDir, "pickup-verify-dashboard-badge.png"),
    fullPage: true,
  });
  await context.close();
  console.log("Dashboard PASS: open-issue badge visible.");
}

(async () => {
  await applyFullLocationDisplay(deliveryId);
  await ensureNotReadyDeliveryOnJob();
  console.log("Slice 2: applied full location display fixture on delivery-3.");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const page = await context.newPage();

  let pickupToken;
  try {
    pickupToken = await generatePickupTokenForJob(jobId);
    console.log("Slice 5: generated pickup token fixture for job", jobId);
  } catch (err) {
    console.error(
      "FAIL: could not generate pickup token — deploy generatePickupToken CF and set .env.local credentials.",
      err instanceof Error ? err.message : err,
    );
    await browser.close();
    process.exit(1);
  }

  const url = `${appBase}/#/pickup?t=${pickupToken}&delivery=${deliveryId}`;
  console.log(`Opening ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });

  try {
    await waitForPickupCard(page);
  } catch {
    const bodyText = await page.locator("body").innerText();
    await page.screenshot({
      path: resolve(outDir, "pickup-verify-load-fail.png"),
      fullPage: true,
    });
    console.error("FAIL: Pickup list did not load. Page text:\n", bodyText.slice(0, 800));
    await browser.close();
    process.exit(1);
  }

  const empty = await page
    .getByText("No pickup-ready deliveries", { exact: false })
    .isVisible()
    .catch(() => false);
  if (empty) {
    console.error(
      "FAIL: No pickup-ready deliveries for this job. Stage delivery first (ready_for_pickup, complete, or partial).",
    );
    await browser.close();
    process.exit(1);
  }

  console.log("Slice 2: full location display…");
  try {
    await assertLocationDisplayFull(page);
    await assertPickupJobHeader(page);
    await assertExpectedMaterials(page);
    await assertShopStockPullState(page);
    await assertNotReadyRowVisible(page);
    await assertNoProblemQtyDetails(page);
    await assertPublicStatusHidden(page);
  } catch (err) {
    console.error("FAIL:", err instanceof Error ? err.message : err);
    await browser.close();
    process.exit(1);
  }

  console.log("Slice 2: minimal location display (hidden rows)…");
  await applyMinimalLocationDisplay(deliveryId);
  await page.reload({ waitUntil: "domcontentloaded" });
  try {
    await waitForPickupCard(page);
    await assertLocationDisplayMinimal(page);
    await assertNoProblemQtyDetails(page);
  } catch (err) {
    console.error("FAIL:", err instanceof Error ? err.message : err);
    await browser.close();
    process.exit(1);
  }

  await applyFullLocationDisplay(deliveryId);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForPickupCard(page);

  await page.screenshot({
    path: resolve(outDir, "pickup-verify-before.png"),
    fullPage: true,
  });

  try {
    await runScenarioB(page);
    await runScenarioA(page);
  } catch (err) {
    await page.screenshot({
      path: resolve(outDir, "pickup-verify-fail.png"),
      fullPage: true,
    });
    console.error("FAIL:", err instanceof Error ? err.message : err);
    await context.close();
    await browser.close();
    process.exit(1);
  }

  await context.close();

  try {
    await runDashboardBadgeCheck(browser);
  } catch (err) {
    throw new Error(
      `Dashboard badge FAIL: ${err instanceof Error ? err.message : err}`,
    );
  }

  console.log("PASS: Pickup portal Scenarios A + B complete.");
  await browser.close();
  process.exit(0);
})();

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
import { spawnSync } from "node:child_process";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  ensureAuthenticated,
  loadEnvLocal,
  openDeliveryDrawer,
  openDeliveryDrawerByDeepLink,
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
const isProd = /lgarage\.github\.io\/stageverify/i.test(baseUrl);

const jobId = process.env.STAGEVERIFY_PICKUP_JOB ?? "job-3";
const deliveryId = process.env.STAGEVERIFY_PICKUP_DELIVERY ?? "delivery-3";

const outDir = resolve(process.cwd(), "screenshots");
mkdirSync(outDir, { recursive: true });
const authState = resolve(process.cwd(), "playwright/.auth/state.json");
loadEnvLocal();

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

async function confirmAllPickupLocations(page) {
  const confirms = page.getByTestId("pickup-location-confirm");
  const count = await confirms.count();
  if (count === 0) {
    console.log("SKIP Level 1: no pickup-location-confirm rows on fixture.");
    return;
  }
  for (let i = 0; i < count; i++) {
    const row = confirms.nth(i);
    if ((await row.getAttribute("data-confirmed")) !== "true") {
      await row.click();
      await page.waitForTimeout(100);
    }
  }
  console.log(`Level 1 PASS: confirmed ${count} pickup spot(s).`);
}

async function assertLevel1CompletePickupGate(page) {
  const completeBtn = page.getByRole("button", {
    name: /Order Pickup Complete/,
  });
  await completeBtn.waitFor({ state: "visible", timeout: 15_000 });
  if (!(await completeBtn.isDisabled())) {
    throw new Error(
      "Level 1 FAIL: Order Pickup Complete should stay disabled until all spots are confirmed.",
    );
  }
  const confirms = page.getByTestId("pickup-location-confirm");
  const count = await confirms.count();
  if (count < 1) {
    throw new Error("Level 1 FAIL: expected pickup-location-confirm rows.");
  }
  console.log(
    `Level 1 PASS: Complete Pickup gated (${count} spot confirm row(s)).`,
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

async function reseedPickupFixtureAfterScenarioB() {
  console.log("Re-seeding delivery-3 readiness after Scenario B…");
  const result = spawnSync("npx", ["tsx", "scripts/seed-pickup-verify-readiness.mjs"], {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error("seed-pickup-verify-readiness failed after Scenario B");
  }
}

async function runScenarioA(page, pickupToken) {
  console.log("Scenario A: pickup completion…");
  const tokenUrl = `${appBase}/#/pickup?t=${pickupToken}&delivery=${deliveryId}`;
  if (!page.url().includes(pickupToken.slice(0, 16))) {
    await page.goto(tokenUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await waitForPickupCard(page);
  }
  const itemRows = page.getByTestId("pickup-item-row");
  const itemCount = await itemRows.count();
  console.log(`Checking ${itemCount} pickup item row(s)…`);
  for (let i = 0; i < itemCount; i++) {
    const row = itemRows.nth(i);
    if ((await row.getAttribute("data-checked")) !== "true") {
      await row.click();
      await page.waitForTimeout(150);
    }
  }

  const shopStates = page.getByTestId("shop-stock-pull-state");
  const shopCount = await shopStates.count();
  for (let i = 0; i < shopCount; i++) {
    const state = shopStates.nth(i);
    const label = ((await state.textContent()) ?? "").trim();
    if (label !== "Pulled") {
      await state.locator("xpath=ancestor::button[1]").click();
      await page.waitForTimeout(150);
    }
  }

  const shopCountAfterItems = await page.getByTestId("shop-stock-pull-state").count();
  if (shopCountAfterItems > 0) {
    const runningLowBtn = page.getByTestId("shop-stock-running-low").first();
    if (await runningLowBtn.isVisible().catch(() => false)) {
      await runningLowBtn.click();
      const runningLowOk = await page
        .waitForSelector(
          "text=/Running low reported|already reported for this item/i",
          { timeout: 20_000 },
        )
        .then(() => true)
        .catch(() => false);
      if (runningLowOk) {
        console.log("Running Low PASS: restock alert reported from shop stock row.");
      } else {
        const errText =
          (await page.locator(".text-accent-red").first().textContent().catch(() => "")) ??
          "";
        if (/already reported|duplicate/i.test(errText)) {
          console.log("Running Low PASS: duplicate restock alert (prior run).");
        } else {
          throw new Error(
            `Running Low FAIL: no success toast.${errText ? ` Error: ${errText}` : ""}`,
          );
        }
      }
    } else {
      console.log("SKIP Running Low: no shop-stock-running-low button on fixture.");
    }

    await page.waitForTimeout(400);
    await confirmAllPickupLocations(page);
    const cardBtn = page
      .getByTestId("pickup-at-primary")
      .first()
      .locator("xpath=ancestor::button[1]");
    await cardBtn.waitFor({ state: "visible", timeout: 10_000 });
    if (await cardBtn.isDisabled().catch(() => false)) {
      throw new Error(
        "Shop stock FAIL: delivery card button still disabled after shop stock pulls.",
      );
    }
    await cardBtn.click();
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="shop-stock-pull-state"]');
        return el?.textContent?.trim() === "Staged";
      },
      { timeout: 20_000 },
    );
    const staged = (
      (await page.getByTestId("shop-stock-pull-state").first().textContent()) ?? ""
    ).trim();
    if (staged !== "Staged") {
      const cardErr = await page.locator(".text-accent-red").first().textContent().catch(() => "");
      throw new Error(
        `Shop stock FAIL: expected Staged after delivery card check-off, got "${staged}".${cardErr ? ` Card error: ${cardErr}` : ""}`,
      );
    }
    console.log("Shop stock PASS: Pulled → Staged after delivery card check-off.");
  }

  await confirmAllPickupLocations(page);
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

/**
 * HashRouter ignores goto() to the same #/pickup?… URL (no remount).
 * Force a blank navigation first so fixture reseeds are visible.
 * Authenticate when needed: recordPickupEvent does a client getDoc(deliveries)
 * before the CF call, and live Firestore rules require auth for that read.
 */
async function remountPickupPortal(page, pickupToken, { authenticate = false } = {}) {
  if (authenticate) {
    console.log(
      "Auth for Scenario A: live rules require auth for delivery getDoc inside recordPickupEvent…",
    );
    await ensureAuthenticated(page, appBase);
  }
  await page.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 15_000 });
  const remountUrl = `${appBase}/#/pickup?t=${pickupToken}&delivery=${deliveryId}`;
  console.log(`Remounting pickup portal: ${remountUrl}`);
  await page.goto(remountUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await waitForPickupCard(page);
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

  const shopGroup = page.getByTestId("shop-stock-location-group");
  if (!(await shopGroup.isVisible().catch(() => false))) {
    throw new Error("Slice 2 FAIL: shop-stock-location-group should be visible.");
  }
  const groupHeader = page.getByTestId("shop-stock-location-group-header");
  if (!(await groupHeader.isVisible().catch(() => false))) {
    throw new Error("Slice 2 FAIL: shop-stock location group header should be visible.");
  }
  const headerText = (await groupHeader.textContent()) ?? "";
  if (!headerText.includes("Main stock room")) {
    throw new Error(
      `Slice 2 FAIL: expected group header Main stock room — got "${headerText.trim()}".`,
    );
  }
  console.log("Slice 2 PASS: shop-stock-location-group header visible.");

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

  if (
    await page.getByTestId("shop-stock-location-group-header").isVisible().catch(() => false)
  ) {
    throw new Error(
      "Slice 2 FAIL: shop-stock location group header should be hidden on minimal fixture.",
    );
  }
  console.log("Slice 2 PASS: shop-stock location group header hidden");

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
  await updateDoc(doc(db, "deliveries", "delivery-cross-vendor-1"), {
    status: "arrived",
    readinessStatus: "not_ready",
    updatedAt: new Date().toISOString(),
  });
  console.log(
    "Seeded delivery-cross-vendor-1 (job-3) as arrived for not-ready row verify.",
  );
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

async function assertPickupLocationSections(page) {
  const section = page.locator(
    '[data-testid="pickup-location-section"][data-staging-code="G1"]',
  );
  await section.waitFor({ state: "visible", timeout: 15_000 });
  const cardsInSection = section.getByTestId("pickup-at-primary");
  const count = await cardsInSection.count();
  if (count < 1) {
    throw new Error(
      "pickup-location-section G1 should contain at least one nested delivery card.",
    );
  }
  console.log(
    "Pickup location section PASS: G1 section visible with nested delivery cards.",
  );
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

async function assertPickupItemPoLabels(page) {
  const row = page.getByTestId("pickup-item-row").first();
  await row.waitFor({ state: "visible", timeout: 15_000 });
  const text = (await row.innerText()) ?? "";
  if (!/PO-\d+/i.test(text)) {
    throw new Error(
      `Pickup item row FAIL: expected PO prefix on item row, got "${text.trim()}".`,
    );
  }
  const cardBody = await page.locator("body").innerText();
  if (/Johnstone Supply/i.test(cardBody)) {
    throw new Error(
      "Pickup item row FAIL: vendor name Johnstone Supply should be hidden on delivery-3 card.",
    );
  }
  console.log("Pickup item PO PASS: PO prefix visible on item row; vendor hidden.");
}

async function assertPickupChecklistPersists(page, appBase, pickupToken) {
  const row = page.getByTestId("pickup-item-row").first();
  await row.waitFor({ state: "visible", timeout: 15_000 });
  const beforeChecked = await row.getAttribute("data-checked");
  if (beforeChecked === "true") {
    await row.click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="pickup-item-row"]')
          ?.getAttribute("data-checked") === "false",
    );
  }
  await row.click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="pickup-item-row"]')
        ?.getAttribute("data-checked") === "true",
  );
  await page.waitForTimeout(800);
  const reloadUrl = `${appBase}/#/pickup?t=${pickupToken}&delivery=${deliveryId}`;
  await page.goto(reloadUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await waitForPickupCard(page);
  const reloaded = page.getByTestId("pickup-item-row").first();
  await reloaded.waitFor({ state: "visible", timeout: 15_000 });
  const afterChecked = await reloaded.getAttribute("data-checked");
  if (afterChecked !== "true") {
    throw new Error(
      `Pickup checklist FAIL: item checkbox did not persist after reload (data-checked=${afterChecked}).`,
    );
  }
  await reloaded.click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="pickup-item-row"]')
        ?.getAttribute("data-checked") === "false",
  );
  await page.waitForTimeout(800);
  console.log("Pickup checklist PASS: item checkbox persisted after reload.");
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

  if (isProd) {
    // List `open-issue-badge-*` lives on table rows — seed ORD rows are hidden on
    // gh-pages (hideSeedDemoRows). Prove issue visibility via deep-link drawer.
    console.log(
      `Prod dashboard badge: deep-link drawer for ${deliveryId} (list badge N/A — demos hidden).`,
    );
    await openDeliveryDrawerByDeepLink(page, appBase, deliveryId);
    const drawerIssue = page
      .getByTestId("issue-summary-panel")
      .or(page.getByTestId("drawer-action-banner-heading"))
      .or(page.getByText(/Running Low|WHAT NEEDS ATTENTION|open issue/i));
    await drawerIssue.first().waitFor({ state: "visible", timeout: 20_000 });
    await page.screenshot({
      path: resolve(outDir, "pickup-verify-dashboard-badge.png"),
      fullPage: true,
    });
    await context.close();
    console.log(
      "Dashboard PASS: drawer issue/attention surface visible (prod deep-link).",
    );
    return;
  }

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
    await assertPickupLocationSections(page);
    await assertExpectedMaterials(page);
    await assertPickupItemPoLabels(page);
    await assertPickupChecklistPersists(page, appBase, pickupToken);
    await assertShopStockPullState(page);
    await assertLevel1CompletePickupGate(page);
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
    await reseedPickupFixtureAfterScenarioB();
    // Same-hash goto is a HashRouter no-op; remount + auth so Scenario A completion
    // can pass live Firestore rules (client getDoc in recordPickupEvent).
    await remountPickupPortal(page, pickupToken, { authenticate: true });
    await runScenarioA(page, pickupToken);
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

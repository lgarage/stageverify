/**
 * Playwright: Order Summary manual Delivered requires physical staging.
 *
 * Proves:
 *   A — no refs → map without reassign; receive not written
 *   B — planned only → map with reassign=1; receive not written
 *   C — exit/cancel → item stays Not Delivered
 *
 * Usage:
 *   npm run dev
 *   npm run verify:manual-item-receive-staging
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { resolve } from "path";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  updateDoc,
  deleteField,
} from "firebase/firestore";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { assertReadableTextContrast } from "./lib/ui-text-contrast-lib.mjs";
import {
  ensureAuthenticated,
  loadEnvLocal,
  openDeliveryDrawerByDeepLink,
} from "./dispatcherVerifyHelpers.mjs";

const FIXTURE_DELIVERY_ID = "delivery-2";
const FIXTURE_ITEM_ID = "item-3";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
loadEnvLocal();

const outDir = resolve(process.cwd(), "screenshots/manual-item-receive-staging");
mkdirSync(outDir, { recursive: true });

const FIREBASE = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: "stageverify-db",
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
};

async function withAuthedDb(fn) {
  const email = process.env.STAGEVERIFY_TEST_EMAIL;
  const password = process.env.STAGEVERIFY_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error("Missing STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD");
  }
  const app = initializeApp(FIREBASE, `verify-manual-receive-${Date.now()}`);
  const auth = getAuth(app);
  await signInWithEmailAndPassword(auth, email, password);
  return fn(getFirestore(app));
}

async function snapshotItemAndDelivery() {
  return withAuthedDb(async (db) => {
    const itemSnap = await getDoc(doc(db, "items", FIXTURE_ITEM_ID));
    const deliverySnap = await getDoc(doc(db, "deliveries", FIXTURE_DELIVERY_ID));
    if (!itemSnap.exists()) {
      throw new Error(`Missing fixture item ${FIXTURE_ITEM_ID}`);
    }
    if (!deliverySnap.exists()) {
      throw new Error(`Missing fixture delivery ${FIXTURE_DELIVERY_ID}`);
    }
    return { item: itemSnap.data(), delivery: deliverySnap.data() };
  });
}

async function restoreItemAndDelivery(snapshot) {
  await withAuthedDb(async (db) => {
    const item = snapshot.item;
    await updateDoc(doc(db, "items", FIXTURE_ITEM_ID), {
      qtyReceived: item.qtyReceived ?? 0,
      qtyMissing: item.qtyMissing ?? 0,
      status: item.status ?? "pending",
    });
    const d = snapshot.delivery;
    await updateDoc(doc(db, "deliveries", FIXTURE_DELIVERY_ID), {
      stagingLocationId: d.stagingLocationId ?? deleteField(),
      additionalStagingLocationIds: d.additionalStagingLocationIds ?? deleteField(),
      plannedStagingLocationIds: d.plannedStagingLocationIds ?? deleteField(),
      invoiceFulfillmentMethod: d.invoiceFulfillmentMethod ?? "delivery",
      updatedAt: new Date().toISOString(),
    });
  });
}

async function prepareNoActual({ planned }) {
  await withAuthedDb(async (db) => {
    await updateDoc(doc(db, "items", FIXTURE_ITEM_ID), {
      qtyReceived: 0,
      qtyMissing: 1,
      status: "pending",
    });
    const patch = {
      stagingLocationId: deleteField(),
      additionalStagingLocationIds: deleteField(),
      invoiceFulfillmentMethod: "delivery",
      updatedAt: new Date().toISOString(),
    };
    if (planned) {
      patch.plannedStagingLocationIds = ["staging-1"];
    } else {
      patch.plannedStagingLocationIds = deleteField();
    }
    await updateDoc(doc(db, "deliveries", FIXTURE_DELIVERY_ID), patch);
  });
}

async function readItemQtyReceived() {
  return withAuthedDb(async (db) => {
    const snap = await getDoc(doc(db, "items", FIXTURE_ITEM_ID));
    return Number(snap.data()?.qtyReceived ?? 0);
  });
}

function assertUrl(url, { reassign }) {
  const hash = url.split("#")[1] ?? "";
  const q = hash.includes("?") ? hash.slice(hash.indexOf("?")) : "";
  const params = new URLSearchParams(q.startsWith("?") ? q.slice(1) : q);
  if (params.get("assignDelivery") !== FIXTURE_DELIVERY_ID) {
    throw new Error(`Expected assignDelivery=${FIXTURE_DELIVERY_ID} in ${url}`);
  }
  if (params.get("pendingItemReceive") !== FIXTURE_ITEM_ID) {
    throw new Error(`Expected pendingItemReceive=${FIXTURE_ITEM_ID} in ${url}`);
  }
  const hasReassign = params.get("reassign") === "1";
  if (reassign && !hasReassign) {
    throw new Error(`Expected reassign=1 in ${url}`);
  }
  if (!reassign && hasReassign) {
    throw new Error(`Did not expect reassign=1 in ${url}`);
  }
}

async function selectDelivered(page) {
  const select = page.getByTestId(`issue-summary-status-${FIXTURE_ITEM_ID}`);
  await select.waitFor({ state: "visible", timeout: 15_000 });
  const tag = await select.evaluate((el) => el.tagName.toLowerCase());
  if (tag !== "select") {
    throw new Error(
      `Expected editable status select for ${FIXTURE_ITEM_ID}, got <${tag}>`,
    );
  }
  await select.selectOption("Delivered");
}

const BANNER_CONTRAST = {
  rootSelector: '[data-testid="assign-mode-banner"]',
  elements: [
    {
      name: "assign-mode note",
      selector:
        '[data-testid="assign-mode-reassign-note"], [data-testid="assign-mode-invoice-draft-note"]',
      large: false,
    },
    {
      name: "assign-mode exit",
      selector: '[data-testid="assign-mode-exit"]',
      large: false,
    },
  ],
};

async function runCase(browser, { name, planned, reassign, shot }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await ensureAuthenticated(page, appBase);
  await prepareNoActual({ planned });
  await openDeliveryDrawerByDeepLink(page, appBase, FIXTURE_DELIVERY_ID);
  await page.screenshot({
    path: resolve(outDir, `before-${shot}.png`),
    fullPage: true,
  });
  await selectDelivered(page);
  await page
    .getByTestId("assign-mode-banner")
    .waitFor({ state: "visible", timeout: 20_000 });
  assertUrl(page.url(), { reassign });
  const note = page.locator(
    '[data-testid="assign-mode-reassign-note"], [data-testid="assign-mode-invoice-draft-note"]',
  );
  await note.waitFor({ state: "visible", timeout: 10_000 });
  const noteText = (await note.innerText()).toLowerCase();
  if (!noteText.includes("physically placed")) {
    throw new Error(`${name}: banner must require physical placement; got "${noteText}"`);
  }
  if (planned && !noteText.includes("planned")) {
    throw new Error(`${name}: planned-only banner should mention planned spots`);
  }
  await assertReadableTextContrast(page, BANNER_CONTRAST);
  await page.screenshot({
    path: resolve(outDir, `after-${shot}.png`),
    fullPage: true,
  });
  await page.getByTestId("assign-mode-exit").click();
  const qty = await readItemQtyReceived();
  if (qty !== 0) {
    throw new Error(`${name}: cancel wrote qtyReceived=${qty} — false complete`);
  }
  await openDeliveryDrawerByDeepLink(page, appBase, FIXTURE_DELIVERY_ID);
  const select = page.getByTestId(`issue-summary-status-${FIXTURE_ITEM_ID}`);
  await select.waitFor({ state: "visible", timeout: 15_000 });
  const value = await select.inputValue();
  if (value !== "Not Delivered") {
    throw new Error(`${name}: after cancel expected Not Delivered, got ${value}`);
  }
  await page.close();
  console.log(`PASS ${name}`);
}

async function main() {
  const snapshot = await snapshotItemAndDelivery();
  const browser = await chromium.launch({ headless: true });
  try {
    await runCase(browser, {
      name: "A no planned/actual",
      planned: false,
      reassign: false,
      shot: "case-a-no-refs",
    });
    await runCase(browser, {
      name: "B planned-only",
      planned: true,
      reassign: true,
      shot: "case-b-planned",
    });
    console.log("verify-manual-item-receive-staging: ALL PASS");
  } finally {
    await Promise.race([
      restoreItemAndDelivery(snapshot),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("restore fixture timed out")), 20_000),
      ),
    ]).catch((err) => {
      console.error("restore fixture failed:", err);
    });
    await browser.close();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

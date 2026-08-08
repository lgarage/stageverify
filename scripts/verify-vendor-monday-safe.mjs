/**
 * Monday-safe vendor mobile checks (exception hub + no-spot CTA + Report a Problem).
 *
 * Phone viewport 390×844. Uses live Firebase for PIN/hub; temporarily sets
 * vendorDeliveryMode=exception_only for /#/receive proof and ALWAYS restores
 * the prior mode in finally (does not leave prod flipped).
 *
 * Usage:
 *   npm run verify:vendor-monday-safe
 *   STAGEVERIFY_BASE_URL=http://127.0.0.1:5173 npm run verify:vendor-monday-safe
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  assertNoElementOverlap,
  assertReadableTextContrast,
  VENDOR_DELIVERED_HUB_CONTRAST_SPEC,
  VENDOR_DELIVERED_HUB_HEADER_OVERLAP_SPEC,
} from "./lib/ui-text-contrast-lib.mjs";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length && !process.env[k.trim()]) {
      process.env[k.trim()] = v.join("=").trim();
    }
  }
}

const baseUrl =
  process.env.STAGEVERIFY_BASE_URL ?? "http://127.0.0.1:5173";
const appBase = resolveAppBase(baseUrl);
const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;
const deliveryId =
  process.env.STAGEVERIFY_RECEIVE_DELIVERY ?? "delivery-demo-vendor-1";
const vendorPin = process.env.STAGEVERIFY_VENDOR_PIN ?? "1234";
const jobPin = process.env.STAGEVERIFY_JOB1_PIN ?? "1234";
const runSuffix = Date.now().toString(36);
const ephemeralNoSpotDeliveryId = `delivery-monday-verify-nospot-${runSuffix}`;
const ephemeralWithSpotDeliveryId = `delivery-monday-verify-wspot-${runSuffix}`;
const noSpotOrder =
  process.env.STAGEVERIFY_NO_SPOT_ORDER ?? `MON-VERIFY-NOSPOT-${runSuffix.slice(-6)}`;
const withSpotOrder =
  process.env.STAGEVERIFY_WITH_SPOT_ORDER ?? `MON-VERIFY-WSPOT-${runSuffix.slice(-6)}`;
const fixtureJobId = "job-1";

const outDir = resolve(process.cwd(), "screenshots", "vendor-monday-safe");
mkdirSync(outDir, { recursive: true });

const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
}

const firebaseApp = initializeApp({
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: "stageverify-db",
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
});

async function readMode() {
  if (!email || !password) throw new Error("Missing STAGEVERIFY_TEST_EMAIL/PASSWORD");
  const auth = getAuth(firebaseApp);
  await signInWithEmailAndPassword(auth, email, password);
  const db = getFirestore(firebaseApp);
  const snap = await getDoc(doc(db, "appSettings", "config"));
  return snap.data()?.vendorDeliveryMode ?? "full_checkin";
}

async function writeMode(mode) {
  const auth = getAuth(firebaseApp);
  if (!auth.currentUser) {
    await signInWithEmailAndPassword(auth, email, password);
  }
  const db = getFirestore(firebaseApp);
  await setDoc(
    doc(db, "appSettings", "config"),
    { vendorDeliveryMode: mode },
    { merge: true },
  );
}

async function ensureAuthDb() {
  const auth = getAuth(firebaseApp);
  if (!auth.currentUser) {
    await signInWithEmailAndPassword(auth, email, password);
  }
  return getFirestore(firebaseApp);
}

async function seedEphemeralDeliveries() {
  const db = await ensureAuthDb();
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  await setDoc(doc(db, "deliveries", ephemeralNoSpotDeliveryId), {
    id: ephemeralNoSpotDeliveryId,
    orderNumber: noSpotOrder,
    jobId: fixtureJobId,
    vendorId: "vendor-1",
    vendorName: "Johnstone Supply",
    deliveryDate: today,
    status: "pending",
    availabilityStatus: "expected",
    createdAt: now,
    updatedAt: now,
  });

  await setDoc(doc(db, "deliveries", ephemeralWithSpotDeliveryId), {
    id: ephemeralWithSpotDeliveryId,
    orderNumber: withSpotOrder,
    jobId: fixtureJobId,
    vendorId: "vendor-1",
    vendorName: "Johnstone Supply",
    stagingLocationId: "staging-2",
    deliveryDate: today,
    status: "pending",
    availabilityStatus: "expected",
    createdAt: now,
    updatedAt: now,
  });

  console.log(
    `seeded ephemeral deliveries: ${noSpotOrder} (no spot), ${withSpotOrder} (with spot)`,
  );
}

async function deleteEphemeralDeliveries() {
  const db = await ensureAuthDb();
  const ids = [ephemeralNoSpotDeliveryId, ephemeralWithSpotDeliveryId];
  for (const deliveryId of ids) {
    const linkedItems = await getDocs(
      query(collection(db, "items"), where("deliveryOrderId", "==", deliveryId)),
    );
    for (const itemDoc of linkedItems.docs) {
      try {
        await deleteDoc(doc(db, "items", itemDoc.id));
        console.log(`cleanup: deleted items/${itemDoc.id}`);
      } catch (err) {
        console.warn(`cleanup: skip items/${itemDoc.id}:`, err instanceof Error ? err.message : err);
      }
    }
    try {
      await deleteDoc(doc(db, "deliveries", deliveryId));
      console.log(`cleanup: deleted deliveries/${deliveryId}`);
    } catch (err) {
      console.warn(
        `cleanup: skip deliveries/${deliveryId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

async function enterPin(page, pin) {
  for (const d of String(pin)) {
    await page.getByRole("button", { name: d, exact: true }).click();
    await page.waitForTimeout(120);
  }
}

async function shot(page, name) {
  await page.screenshot({ path: resolve(outDir, `${name}.png`) });
}

/** Pure CF-parity helper (mirrors src/dispatcher/models.ts). */
function deliveryHasAssignableSpot(delivery) {
  if (
    typeof delivery.stagingLocationId === "string" &&
    delivery.stagingLocationId.trim()
  ) {
    return true;
  }
  const planned = delivery.plannedStagingLocationIds;
  if (Array.isArray(planned)) {
    return planned.some(
      (id) => typeof id === "string" && id.trim().length > 0,
    );
  }
  return false;
}

// Unit-style predicate checks (no browser)
record(
  "helper: stagingLocationId alone assignable",
  deliveryHasAssignableSpot({ stagingLocationId: "staging-1" }) === true,
);
record(
  "helper: planned-only assignable",
  deliveryHasAssignableSpot({
    stagingLocationId: "",
    plannedStagingLocationIds: ["staging-2"],
  }) === true,
);
record(
  "helper: additional-only NOT assignable",
  deliveryHasAssignableSpot({
    stagingLocationId: "",
    plannedStagingLocationIds: [],
    // additionalStagingLocationIds alone must NOT count (CF parity);
    // helper intentionally ignores this field — assert stays false even if present on doc.
    additionalStagingLocationIds: ["staging-extra"],
  }) === false,
);
record(
  "helper: empty not assignable",
  deliveryHasAssignableSpot({}) === false,
);

let priorMode = "full_checkin";
let modeRestored = false;

try {
  priorMode = await readMode();
  console.log(`prior vendorDeliveryMode=${priorMode}`);
  await seedEphemeralDeliveries();
  if (priorMode !== "exception_only") {
    await writeMode("exception_only");
    console.log("temp set vendorDeliveryMode=exception_only for receive proof");
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();

  // --- Path A: /#/receive → exception hub ---
  await page.goto(`${appBase}/#/receive?id=${encodeURIComponent(deliveryId)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(1500);
  await enterPin(page, vendorPin);
  await page.getByTestId("vendor-mark-delivered").waitFor({
    state: "visible",
    timeout: 25_000,
  });
  await shot(page, "01-receive-exception-hub");
  record(
    "receive exception_only shows Mark Delivered hub",
    await page.getByTestId("vendor-mark-delivered").isVisible(),
  );
  record(
    "receive hub has Report a Problem",
    await page.getByTestId("vendor-report-problem").isVisible(),
  );
  record(
    "receive hub has Need More Space",
    await page.getByRole("button", { name: /Need More Space/i }).isVisible(),
  );
  record(
    "receive no Submit Check-in",
    !(await page.getByText("Submit Check-in").isVisible().catch(() => false)),
  );
  record(
    "receive no lifecycle Ordered/Shipped pickers",
    !(await page.getByText("Ordered", { exact: true }).isVisible().catch(() => false)) &&
      !(await page.getByText("Shipped", { exact: true }).isVisible().catch(() => false)) &&
      !(await page.getByText("Ready for Pickup").isVisible().catch(() => false)),
  );
  await assertReadableTextContrast(page, VENDOR_DELIVERED_HUB_CONTRAST_SPEC);
  await assertNoElementOverlap(page, VENDOR_DELIVERED_HUB_HEADER_OVERLAP_SPEC);
  record("receive hub contrast/overlap", true);

  // Report a Problem reasons on receive hub
  await page.getByTestId("vendor-report-problem").click();
  await page.waitForSelector("text=What's the issue?", { timeout: 10_000 });
  for (const reason of [
    "Wrong Location",
    "Damaged Items",
    "Missing Items",
    "Other",
  ]) {
    record(
      `receive reason ${reason}`,
      await page.getByRole("button", { name: reason }).isVisible(),
    );
  }
  record(
    "receive no No-staging-space under problems",
    !(await page.getByText(/No staging space/i).isVisible().catch(() => false)),
  );
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(400);

  // Need More Space opens
  await page.getByRole("button", { name: /Need More Space/i }).click();
  await page.waitForSelector("text=Need more space?", { timeout: 10_000 });
  record(
    "receive Need More Space opens",
    await page.getByText("Where do you need additional space?").isVisible(),
  );
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(400);

  // --- Path B: location QR no-spot ---
  await page.goto(`${appBase}/#/s?loc=G2`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(2000);
  const vendorTab = page.getByRole("button", { name: "Vendor", exact: true });
  if (await vendorTab.isVisible().catch(() => false)) await vendorTab.click();
  await enterPin(page, jobPin);
  await page.getByText("This job's deliveries").waitFor({ timeout: 20_000 });
  const noSpotCard = page.locator("button").filter({ hasText: noSpotOrder }).first();
  await noSpotCard.scrollIntoViewIfNeeded();
  await noSpotCard.click();
  await page.waitForTimeout(2000);
  await shot(page, "02-location-nospot-hub");

  const noSpotWarn = page.getByTestId("vendor-no-spot-warn");
  record("location no-spot warning visible", await noSpotWarn.isVisible());
  const deliverBtn = page.getByTestId("vendor-mark-delivered");
  const disabled = await deliverBtn.isDisabled();
  const label = ((await deliverBtn.textContent()) || "").trim();
  record(
    "location Mark Delivered disabled without spot",
    disabled,
    `label=${label}`,
  );
  record(
    "location CTA copy asks dispatch",
    /Ask dispatch for a staging spot/i.test(label),
    label,
  );
  record(
    "location Report a Problem still available",
    await page.getByTestId("vendor-report-problem").isVisible(),
  );
  record(
    "location Need More Space still available",
    await page.getByRole("button", { name: /Need More Space/i }).isVisible(),
  );

  // Attempt click should not enable deliver
  await deliverBtn.click({ force: true }).catch(() => {});
  await page.waitForTimeout(800);
  record(
    "location still not delivered after forced tap",
    !(await page.getByText("Delivery Confirmed").isVisible().catch(() => false)) &&
      (await deliverBtn.isDisabled()),
  );

  // --- Path B: with-spot Mark Delivered (undo after if we deliver) ---
  await page.getByRole("button", { name: "← Back" }).click();
  await page.waitForTimeout(800);
  const withSpotCard = page
    .locator("button")
    .filter({ hasText: withSpotOrder })
    .first();
  if (await withSpotCard.isVisible().catch(() => false)) {
    await withSpotCard.scrollIntoViewIfNeeded();
    await withSpotCard.click();
    await page.waitForTimeout(2000);
    await shot(page, "03-location-withspot-hub");
    const withBtn = page.getByTestId("vendor-mark-delivered");
    const withEnabled = !(await withBtn.isDisabled());
    const withLabel = ((await withBtn.textContent()) || "").trim();
    record(
      "location with-spot Mark Delivered enabled",
      withEnabled && /Mark Delivered/i.test(withLabel),
      withLabel,
    );
    if (withEnabled) {
      await withBtn.click();
      await page.waitForFunction(() => {
        const btn = document.querySelector(
          '[data-testid="vendor-mark-delivered"]',
        );
        const text = (btn?.textContent ?? "").replace(/\s+/g, " ").trim();
        return text === "Delivered" || /^Delivered/.test(text);
      }, { timeout: 30_000 });
      record("location Mark Delivered succeeds with spot", true);
      const undo = page.getByTestId("vendor-undo-delivery");
      await undo.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
      const undoVisible = await undo.isVisible().catch(() => false);
      record("location Undo Delivery control visible", undoVisible);
      if (undoVisible) {
        await undo.click();
        try {
          await page.waitForFunction(() => {
            const btn = document.querySelector(
              '[data-testid="vendor-mark-delivered"]',
            );
            const text = (btn?.textContent ?? "").replace(/\s+/g, " ").trim();
            return text === "Mark Delivered";
          }, { timeout: 20_000 });
          record("location Undo Delivery restores Mark Delivered", true);
        } catch {
          record(
            "location Undo Delivery restores Mark Delivered",
            false,
            ((await page.getByTestId("vendor-mark-delivered").textContent()) ||
              "").trim(),
          );
        }
      }
    }
  } else {
    record(
      "location with-spot Mark Delivered enabled",
      false,
      `order ${withSpotOrder} not in list`,
    );
  }

  // No Firebase Auth required — still unauthenticated session
  record(
    "no vendor Firebase Auth login wall",
    !(await page.getByText(/sign in|log in/i).first().isVisible().catch(() => false)),
  );

  await browser.close();
} catch (err) {
  record("verify script error", false, err instanceof Error ? err.message : String(err));
  console.error(err);
} finally {
  try {
    await deleteEphemeralDeliveries();
  } catch (cleanupErr) {
    console.error("FAILED to delete ephemeral deliveries", cleanupErr);
  }
  try {
    const current = await readMode();
    if (current !== priorMode) {
      await writeMode(priorMode);
      console.log(`restored vendorDeliveryMode=${priorMode}`);
    } else {
      console.log(`vendorDeliveryMode already ${current}`);
    }
    modeRestored = true;
  } catch (restoreErr) {
    console.error("FAILED to restore vendorDeliveryMode", restoreErr);
    modeRestored = false;
  }
}

record("vendorDeliveryMode restored after verify", modeRestored, `prior=${priorMode}`);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.error("FAILED:", failed.map((f) => f.name).join("; "));
  process.exit(1);
}
console.log("verify:vendor-monday-safe PASS");
process.exit(0);

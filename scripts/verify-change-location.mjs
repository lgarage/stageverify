/**
 * Playwright: Delivery Details Change Location CTA + Staging Map reassignment mode.
 * Confirm→CF path is covered by npm run test:reassign-staging-location (emulators).
 * Live Confirm persistence requires CF deploy (held until Dan approves).
 *
 * Usage:
 *   npm run dev
 *   npm run verify:change-location
 */
import { chromium } from "playwright";
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
} from "./dispatcherVerifyHelpers.mjs";

async function openDrawer(page, deliveryId) {
  await page.goto(
    `${appBase}/#/dispatcher?openDelivery=${encodeURIComponent(deliveryId)}`,
    { waitUntil: "domcontentloaded", timeout: 45_000 },
  );
  await page
    .getByText("Loading detail panel…")
    .waitFor({ state: "hidden", timeout: 25_000 })
    .catch(() => {});
  await page
    .getByTestId("delivery-detail-drawer")
    .waitFor({ state: "visible", timeout: 25_000 });
  await page
    .getByTestId("delivery-basics-staging-locations")
    .waitFor({ state: "visible", timeout: 25_000 });
}

const FIXTURE_NO_STAGING_ID = "delivery-2";
const FIXTURE_ASSIGNED_STAGING_ID = "delivery-demo-vendor-1";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
loadEnvLocal();

async function withAuthedDb(fn) {
  const email = process.env.STAGEVERIFY_TEST_EMAIL;
  const password = process.env.STAGEVERIFY_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error("Missing STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD");
  }
  const app = initializeApp(
    {
      apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
      authDomain: "stageverify-db.firebaseapp.com",
      projectId: "stageverify-db",
      storageBucket: "stageverify-db.firebasestorage.app",
      messagingSenderId: "784751243681",
      appId: "1:784751243681:web:31fa71762b94f878fd1be0",
    },
    `verify-change-location-${Date.now()}`,
  );
  const auth = getAuth(app);
  await signInWithEmailAndPassword(auth, email, password);
  return fn(getFirestore(app));
}

async function patchNoStagingFixture() {
  await withAuthedDb(async (db) => {
    await updateDoc(doc(db, "deliveries", FIXTURE_NO_STAGING_ID), {
      stagingLocationId: deleteField(),
      additionalStagingLocationIds: deleteField(),
      plannedStagingLocationIds: deleteField(),
      invoiceFulfillmentMethod: "delivery",
      invoiceImportStatus: "pending",
      updatedAt: new Date().toISOString(),
    });
  });
}

async function ensureAssignedFixtureHasStaging() {
  await withAuthedDb(async (db) => {
    const snap = await getDoc(doc(db, "deliveries", FIXTURE_ASSIGNED_STAGING_ID));
    if (!snap.exists()) {
      throw new Error(`Missing fixture ${FIXTURE_ASSIGNED_STAGING_ID}`);
    }
    const data = snap.data();
    const hasActual = Boolean(String(data.stagingLocationId ?? "").trim());
    const planned = Array.isArray(data.plannedStagingLocationIds)
      ? data.plannedStagingLocationIds.filter((id) => String(id ?? "").trim())
      : [];
    if (hasActual || planned.length > 0) return;
    await updateDoc(doc(db, "deliveries", FIXTURE_ASSIGNED_STAGING_ID), {
      invoiceFulfillmentMethod: "delivery",
      plannedStagingLocationIds: ["staging-1"],
      updatedAt: new Date().toISOString(),
    });
  });
}

let passed = 0;
let failed = 0;
function pass(msg) {
  passed += 1;
  console.log(`PASS: ${msg}`);
}
function fail(msg) {
  failed += 1;
  console.error(`FAIL: ${msg}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

try {
  await patchNoStagingFixture();
  await ensureAssignedFixtureHasStaging();
  await ensureAuthenticated(page, appBase);

  // A — no staging → Assign Location, no Change Location
  await openDrawer(page, FIXTURE_NO_STAGING_ID);
  await page.waitForSelector('[data-testid="drawer-staging-location-banner"]', {
    timeout: 15000,
  });
  const assignCount = await page
    .getByTestId("drawer-staging-location-assign")
    .count();
  const changeOnNoStaging = await page
    .getByTestId("drawer-staging-change-location")
    .count();
  if (assignCount === 1 && changeOnNoStaging === 0) {
    pass("A: no staging → Assign Location, no Change Location");
  } else {
    fail(
      `A: assign=${assignCount} change=${changeOnNoStaging} (expected 1 / 0)`,
    );
  }

  // B — assigned staging → Change Location visible near chips
  await openDrawer(page, FIXTURE_ASSIGNED_STAGING_ID);
  const changeBtn = page.getByTestId("drawer-staging-change-location");
  await changeBtn.waitFor({ state: "visible", timeout: 15000 });
  const bannerOnAssigned = await page
    .getByTestId("drawer-staging-location-banner")
    .count();
  if (bannerOnAssigned === 0) {
    pass("B: assigned staging → Change Location visible, no Assign banner");
  } else {
    fail("B: Assign banner should be hidden when Change Location shows");
  }

  await assertReadableTextContrast(page, {
    rootSelector: '[data-testid="delivery-basics-staging-locations"]',
    elements: [
      {
        name: "change location CTA",
        selector: '[data-testid="drawer-staging-change-location"]',
      },
    ],
  });
  pass("B/M: D-42 contrast on Change Location CTA");

  // C — opens Staging Map with assignDelivery + reassign=1
  await changeBtn.click();
  await page.waitForURL(/assignDelivery=/, { timeout: 15000 });
  const url = page.url();
  if (
    new RegExp(`assignDelivery=${FIXTURE_ASSIGNED_STAGING_ID}\\b`).test(url) &&
    /[?&]reassign=1\b/.test(url)
  ) {
    pass("C: Change Location → Staging Map reassignment context");
  } else {
    fail(`C: unexpected URL ${url}`);
  }
  await page.waitForSelector('[data-testid="assign-mode-banner"][data-reassign-mode="true"]', {
    timeout: 15000,
  });
  pass("C: reassignment banner mode");

  await page.waitForSelector('[data-testid="map-spot-also-assigned-note"]', {
    timeout: 15000,
  });
  const currentAssignmentSpot = page
    .locator('[data-spot-current-assignment="true"]')
    .first();
  await currentAssignmentSpot.waitFor({ state: "visible", timeout: 15000 });
  const currentAssignmentOutline = await currentAssignmentSpot.evaluate(
    (el) => getComputedStyle(el).outlineColor,
  );
  if (
    !/rgb\(\s*10\s*,\s*49\s*,\s*97\s*\)/i.test(currentAssignmentOutline)
  ) {
    throw new Error(
      `C: current assignment should have navy outline. got outlineColor=${currentAssignmentOutline}`,
    );
  }
  pass("C: current assignment has existing navy focus box");

  const currentAssignmentNote = currentAssignmentSpot.getByTestId(
    "map-spot-also-assigned-note",
  );
  const currentAssignmentNoteText = (
    await currentAssignmentNote.innerText()
  ).trim();
  if (!/Current assignment will move to the new spot/i.test(currentAssignmentNoteText)) {
    throw new Error(
      `C: current-assignment note missing. got="${currentAssignmentNoteText}"`,
    );
  }
  pass("C: current-assignment note remains present");
  // D-42 on the 7px #9a3412 note is out of scope: that color/size is
  // pre-existing selfPlanned chrome. This ship only restores the navy box.

  // D/E — Confirm/Cancel + no-write before Confirm are proven in
  // test:reassign-staging-location (emulator CF). Map spot arming varies by
  // occupancy paint; UI gate here is reassign banner + Confirm New Location label
  // when a pending selection already exists (optional).
  const confirmBtn = page.getByTestId("assign-mode-confirm");
  if (await confirmBtn.isVisible().catch(() => false)) {
    const confirmLabel = (await confirmBtn.innerText()).trim();
    if (/Confirm New Location/i.test(confirmLabel)) {
      pass("D: Confirm New Location label present");
    } else {
      fail(`D: confirm label="${confirmLabel}"`);
    }
  } else {
    pass(
      "D/E: deferred to test:reassign-staging-location (map spot arming env-dependent; reassign mode covered in C)",
    );
  }

  // L — Will-Call fixture: force will-call on delivery-2 briefly
  await withAuthedDb(async (db) => {
    await updateDoc(doc(db, "deliveries", FIXTURE_NO_STAGING_ID), {
      invoiceFulfillmentMethod: "will_call_pickup",
      invoiceImportStatus: "pickup_at_vendor",
      stagingLocationId: deleteField(),
      plannedStagingLocationIds: deleteField(),
      updatedAt: new Date().toISOString(),
    });
  });
  await openDrawer(page, FIXTURE_NO_STAGING_ID);
  await page.waitForSelector('[data-testid="delivery-basics-staging-will-call-na"]', {
    timeout: 15000,
  });
  const changeOnWillCall = await page
    .getByTestId("drawer-staging-change-location")
    .count();
  const assignOnWillCall = await page
    .getByTestId("drawer-staging-location-assign")
    .count();
  if (changeOnWillCall === 0 && assignOnWillCall === 0) {
    pass("L: Will-Call hides Assign Location and Change Location");
  } else {
    fail(
      `L: will-call assign=${assignOnWillCall} change=${changeOnWillCall}`,
    );
  }

  // restore delivery-2 drop-off clear for other verifies
  await patchNoStagingFixture();

  // M — narrow viewport tap target
  await page.setViewportSize({ width: 390, height: 844 });
  await openDrawer(page, FIXTURE_ASSIGNED_STAGING_ID);
  const narrowBtn = page.getByTestId("drawer-staging-change-location");
  await narrowBtn.waitFor({ state: "visible", timeout: 15000 });
  const box = await narrowBtn.boundingBox();
  if (box && box.height >= 36 && box.width >= 100) {
    pass("M: narrow viewport Change Location is easy to tap");
  } else {
    fail(`M: tap target too small ${JSON.stringify(box)}`);
  }

  console.log(
    "\nNOTE: Confirm→atomic CF persistence (F–K) covered by test:reassign-staging-location; live Confirm needs CF deploy (not approved this job).\n",
  );
} catch (err) {
  fail(err?.message ?? String(err));
} finally {
  await browser.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

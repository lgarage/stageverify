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
  VENDOR_DELIVERED_COLLAPSED_CONTRAST_SPEC,
  VENDOR_DELIVERED_HUB_CONTRAST_SPEC,
  VENDOR_DELIVERED_HUB_ITEMS_CONTRAST_SPEC,
  VENDOR_DELIVERED_HUB_ITEMS_EMPTY_CONTRAST_SPEC,
  VENDOR_DELIVERED_HUB_HEADER_OVERLAP_SPEC,
  VENDOR_RUN_DELIVERED_ROW_CONTRAST_SPEC,
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
let deliveryId = process.env.STAGEVERIFY_RECEIVE_DELIVERY;
const vendorPin = process.env.STAGEVERIFY_VENDOR_PIN ?? "1234";
const jobPin = process.env.STAGEVERIFY_JOB1_PIN ?? "1234";
const runSuffix = Date.now().toString(36);
const ephemeralNoSpotDeliveryId = `delivery-monday-verify-nospot-${runSuffix}`;
const ephemeralWithSpotDeliveryId = `delivery-monday-verify-wspot-${runSuffix}`;
deliveryId ??= ephemeralWithSpotDeliveryId;
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
  const receivePinVerify = page.getByRole("button", {
    name: "Verify",
    exact: true,
  });
  if (await receivePinVerify.isVisible().catch(() => false)) {
    await receivePinVerify.click();
  }
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

  const locationLabel = page.getByTestId("vendor-hub-location-label");
  record(
    "receive location label shows Location: code",
    (await locationLabel.textContent())?.match(/Location:\s*\S+/) !== null,
    (await locationLabel.textContent())?.trim() ?? "",
  );
  record(
    "receive no Assigned location eyebrow",
    !(await page.getByText("Assigned location").isVisible().catch(() => false)),
  );
  record(
    "receive no Ground Spot label",
    !(await page.getByText(/Ground Spot/i).isVisible().catch(() => false)),
  );
  record(
    "receive Invoice # row visible",
    await page.getByText("Invoice #", { exact: true }).isVisible(),
  );
  const invoiceRow = page.getByTestId("vendor-hub-invoice");
  record(
    "receive Invoice # testid present",
    await invoiceRow.isVisible(),
    (await invoiceRow.textContent())?.trim() ?? "",
  );
  const metaOrder = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll("span.text-text-secondary.shrink-0"))
      .map((el) => el.textContent?.trim() ?? "")
      .filter((t) => ["Order #", "Invoice #", "PO #"].includes(t));
    return labels;
  });
  record(
    "receive Invoice # above PO # in DOM",
    metaOrder.indexOf("Invoice #") >= 0 &&
      metaOrder.indexOf("PO #") >= 0 &&
      metaOrder.indexOf("Invoice #") < metaOrder.indexOf("PO #"),
    metaOrder.join(" → "),
  );

  // Items accordion — collapsed by default
  const itemsToggle = page.getByTestId("vendor-hub-items-toggle");
  const itemsList = page.getByTestId("vendor-hub-items-list");
  record(
    "receive items toggle visible",
    await itemsToggle.isVisible(),
  );
  record(
    "receive items list collapsed by default",
    !(await itemsList.isVisible().catch(() => false)) &&
      (await itemsToggle.getAttribute("aria-expanded")) === "false",
  );

  await itemsToggle.click();
  await page.waitForTimeout(400);
  record(
    "receive items list expands on tap",
    await itemsList.isVisible(),
  );

  const itemRows = page.getByTestId("vendor-hub-item-row");
  const rowCount = await itemRows.count();
  if (rowCount > 0) {
    record("receive at least one item row", rowCount >= 1, `count=${rowCount}`);
    await assertReadableTextContrast(page, VENDOR_DELIVERED_HUB_ITEMS_CONTRAST_SPEC);
  } else {
    record(
      "receive empty items copy",
      await page.getByText("No item details available.").isVisible(),
    );
    await assertReadableTextContrast(page, VENDOR_DELIVERED_HUB_ITEMS_EMPTY_CONTRAST_SPEC);
  }

  await itemsToggle.click();
  await page.waitForTimeout(400);
  record(
    "receive items list collapses on second tap",
    !(await itemsList.isVisible().catch(() => false)) &&
      (await itemsToggle.getAttribute("aria-expanded")) === "false",
  );

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
  const neutralPinVerify = page.getByTestId("location-scan-pin-verify");
  if (await neutralPinVerify.isVisible().catch(() => false)) {
    await neutralPinVerify.click();
  }
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
    let mockedDelivered = false;
    const mockedDeliveryDetails = () => ({
      delivery: {
        id: ephemeralWithSpotDeliveryId,
        orderNumber: withSpotOrder,
        vendorInvoiceNumber: `INV-${runSuffix.slice(-6)}`,
        jobId: fixtureJobId,
        vendorId: "vendor-1",
        vendorName: "Johnstone Supply",
        stagingLocationId: "staging-2",
        deliveryDate: new Date().toISOString().slice(0, 10),
        status: mockedDelivered ? "arrived" : "pending",
        availabilityStatus: "expected",
        vendorPhysicalDropoffConfirmed: mockedDelivered,
        vendorPhysicalDropoffConfirmedAt: mockedDelivered
          ? new Date().toISOString()
          : null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      vendor: { id: "vendor-1", name: "Johnstone Supply", active: true },
      job: { id: fixtureJobId, jobName: "Riverside Medical Center" },
      purchaseOrder: { id: "po-monday-verify", poNumber: "PO-MONDAY" },
      stagingLocation: {
        id: "staging-2",
        code: "G2",
        label: "Ground Spot 2",
        type: "ground",
      },
      items: [],
    });
    await page.route(/\/markVendorDelivered(?:\?.*)?$/, async (route) => {
      mockedDelivered = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { success: true } }),
      });
    });
    await page.route(/\/getVendorReceiveDetails(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ result: mockedDeliveryDetails() }),
      });
    });
    await page.route(/\/updateVendorDeliveryStatus(?:\?.*)?$/, async (route) => {
      mockedDelivered = false;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: { details: mockedDeliveryDetails() },
        }),
      });
    });
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
      const deliveryCard = page.getByTestId("vendor-hub-delivery-card");
      const cardToggle = page.getByTestId("vendor-hub-card-toggle");
      const cardDetails = page.getByTestId("vendor-hub-card-details");
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="vendor-hub-delivery-card"]')
            ?.getAttribute("data-delivered") === "true",
        { timeout: 30_000 },
      );
      record("location Mark Delivered succeeds with spot", true);
      record(
        "delivered hub auto-collapses",
        (await cardToggle.getAttribute("aria-expanded")) === "false" &&
          !(await cardDetails.isVisible().catch(() => false)),
      );
      record(
        "collapsed delivered hub uses compact green row",
        (await deliveryCard.getAttribute("data-delivered")) === "true" &&
          (await page.getByTestId("vendor-hub-delivered-label").textContent())?.trim() ===
            "DELIVERED",
      );
      record(
        "large delivered footer CTA removed",
        !(await page
          .getByTestId("vendor-mark-delivered")
          .isVisible()
          .catch(() => false)),
      );
      record(
        "delivered hub keeps Need More Space",
        await page.getByRole("button", { name: /Need More Space/i }).isVisible(),
      );
      record(
        "delivered hub keeps Report a Problem",
        await page.getByTestId("vendor-report-problem").isVisible(),
      );
      await assertReadableTextContrast(
        page,
        VENDOR_DELIVERED_COLLAPSED_CONTRAST_SPEC,
      );
      record("collapsed delivered row contrast", true);

      await cardToggle.click();
      await cardDetails.waitFor({ state: "visible", timeout: 10_000 });
      record(
        "delivered hub expands details downward",
        (await cardToggle.getAttribute("aria-expanded")) === "true" &&
          (await page.getByText("Job / Site", { exact: true }).isVisible()),
      );
      const undo = page.getByTestId("vendor-undo-delivery");
      await undo.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
      const undoVisible = await undo.isVisible().catch(() => false);
      record("expanded delivered hub shows Undo Delivery", undoVisible);
      if (undoVisible) {
        await cardToggle.click();
        record(
          "delivered hub collapses again",
          (await cardToggle.getAttribute("aria-expanded")) === "false" &&
            !(await cardDetails.isVisible().catch(() => false)),
        );
        await cardToggle.click();
        await undo.click();
        try {
          await page.waitForFunction(() => {
            const btn = document.querySelector(
              '[data-testid="vendor-mark-delivered"]',
            );
            const text = (btn?.textContent ?? "").replace(/\s+/g, " ").trim();
            return text === "Mark Delivered";
          }, { timeout: 20_000 });
          record(
            "Undo restores expanded undelivered hub and Mark Delivered",
            (await cardToggle.getAttribute("aria-expanded")) === "true" &&
              (await page.getByTestId("vendor-mark-delivered").isVisible()),
          );
        } catch {
          record(
            "Undo restores expanded undelivered hub and Mark Delivered",
            false,
            ((await page.getByTestId("vendor-mark-delivered").textContent()) ||
              "").trim(),
          );
        }
      }

      await page.setViewportSize({ width: 360, height: 800 });
      await page.getByTestId("vendor-mark-delivered").click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="vendor-hub-delivery-card"]')
            ?.getAttribute("data-delivered") === "true",
        { timeout: 30_000 },
      );
      record(
        "Android 360x800 delivered row auto-collapses",
        (await cardToggle.getAttribute("aria-expanded")) === "false",
      );
      await assertReadableTextContrast(
        page,
        VENDOR_DELIVERED_COLLAPSED_CONTRAST_SPEC,
      );
      await shot(page, "04-android-delivered-collapsed");
      await cardToggle.click();
      record(
        "Android delivered row expands with Undo",
        await page.getByTestId("vendor-undo-delivery").isVisible(),
      );
      await page.getByTestId("vendor-undo-delivery").click();
      await page
        .getByTestId("vendor-mark-delivered")
        .waitFor({ state: "visible", timeout: 20_000 });
      record("Android Undo restores Mark Delivered", true);
    }
  } else {
    record(
      "location with-spot Mark Delivered enabled",
      false,
      `order ${withSpotOrder} not in list`,
    );
  }

  // --- Path C: vendor-run stable order + independent expansion (mocked callable fixture) ---
  let vendorRunRows = [
    {
      deliveryId: "verify-run-active-a",
      jobId: "job-a",
      jobName: "Riverside Medical Center",
      orderNumber: "ORDER-100",
      vendorInvoiceNumber: "INV-100",
      poNumber: "PO-100",
      stagingLocationCodes: ["G2"],
      hasAssignableSpot: true,
      vendorPhysicalDropoffConfirmed: false,
      items: [{ id: "item-a", description: "Air handler", qtyOrdered: 1 }],
    },
    {
      deliveryId: "verify-run-delivered-b",
      jobId: "job-b",
      jobName: "Oak Street Offices",
      orderNumber: "ORDER-200",
      vendorInvoiceNumber: "INV-200",
      poNumber: "PO-200",
      stagingLocationCodes: ["S1-A"],
      hasAssignableSpot: true,
      vendorPhysicalDropoffConfirmed: true,
      items: [{ id: "item-b", description: "Thermostat", qtyOrdered: 4 }],
    },
    {
      deliveryId: "verify-run-active-c",
      jobId: "job-c",
      jobName: "Northside School",
      orderNumber: "ORDER-300",
      vendorInvoiceNumber: "INV-300",
      poNumber: "PO-300",
      stagingLocationCodes: ["G1"],
      hasAssignableSpot: true,
      vendorPhysicalDropoffConfirmed: false,
      items: [{ id: "item-c", description: "Condensing unit", qtyOrdered: 1 }],
    },
  ];

  await page.route("**/resolveLocationScanPin", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          success: true,
          accessType: "vendor",
          vendorId: "vendor-verify-run",
          vendorName: "Johnstone Supply",
          sessionToken: "verify-run-session",
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          scannedStagingLocationCode: "G2",
          sessionScope: "vendor",
          deliveryId: "verify-run-active-a",
        },
      }),
    });
  });
  await page.route("**/getVendorRunDeliveries", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          vendorId: "vendor-verify-run",
          scannedStagingLocationCode: "G2",
          deliveries: vendorRunRows,
        },
      }),
    });
  });
  await page.route("**/markVendorDeliveriesBulk", async (route) => {
    const requestBody = JSON.parse(route.request().postData() ?? "{}");
    const deliveryIds = requestBody.data?.deliveryIds ?? [];
    vendorRunRows = vendorRunRows.map((row) =>
      deliveryIds.includes(row.deliveryId)
        ? { ...row, vendorPhysicalDropoffConfirmed: true }
        : row,
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          results: deliveryIds.map((id) => ({
            deliveryId: id,
            success: true,
            vendorPhysicalDropoffConfirmed: true,
          })),
        },
      }),
    });
  });

  await page.evaluate(() => sessionStorage.clear());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${appBase}/#/s?loc=G2`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.getByRole("heading", { name: "Enter PIN" }).waitFor({
    timeout: 30_000,
  });
  await enterPin(page, "1234");
  await page.getByTestId("location-scan-pin-verify").click();
  await page.getByText("Your deliveries").waitFor({ timeout: 30_000 });

  const rowOrder = async () =>
    page.locator('[data-testid^="vendor-run-row-"]').evaluateAll((rows) =>
      rows.map((row) =>
        (row.getAttribute("data-testid") ?? "").replace("vendor-run-row-", ""),
      ),
    );
  const expectedStableOrder = [
    "verify-run-active-a",
    "verify-run-delivered-b",
    "verify-run-active-c",
  ];
  record(
    "vendor-run preserves server list order",
    JSON.stringify(await rowOrder()) === JSON.stringify(expectedStableOrder),
    (await rowOrder()).join(" → "),
  );

  const detailsA = page.getByTestId("vendor-run-details-verify-run-active-a");
  const detailsB = page.getByTestId("vendor-run-details-verify-run-delivered-b");
  const detailsC = page.getByTestId("vendor-run-details-verify-run-active-c");
  record(
    "vendor-run defaults undelivered expanded and delivered collapsed",
    (await detailsA.isVisible()) &&
      (await detailsC.isVisible()) &&
      !(await detailsB.isVisible().catch(() => false)),
  );

  await page.getByTestId("vendor-run-toggle-verify-run-active-c").click();
  record(
    "vendor-run expansion is independent",
    (await detailsA.isVisible()) &&
      !(await detailsC.isVisible().catch(() => false)),
  );
  await page.getByTestId("vendor-run-toggle-verify-run-delivered-b").click();
  record(
    "delivered vendor-run row expands in place",
    (await detailsB.isVisible()) &&
      !(await detailsC.isVisible().catch(() => false)),
  );
  await page.getByTestId("vendor-run-toggle-verify-run-delivered-b").click();

  const rowA = page.getByTestId("vendor-run-row-verify-run-active-a");
  await rowA.locator('input[type="checkbox"]').check();
  await page.getByTestId("vendor-run-bulk-deliver").click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="vendor-run-row-verify-run-active-a"]')
        ?.getAttribute("data-delivered") === "true",
    { timeout: 20_000 },
  );
  record(
    "bulk delivered row stays in the same position",
    JSON.stringify(await rowOrder()) === JSON.stringify(expectedStableOrder),
    (await rowOrder()).join(" → "),
  );
  record(
    "bulk success collapses only delivered ids",
    !(await detailsA.isVisible().catch(() => false)) &&
      !(await detailsC.isVisible().catch(() => false)),
  );
  await assertReadableTextContrast(
    page,
    VENDOR_RUN_DELIVERED_ROW_CONTRAST_SPEC,
  );
  record("vendor-run collapsed delivered row contrast", true);
  await page.getByTestId("vendor-run-toggle-verify-run-active-a").click();
  record(
    "bulk delivered row expands with details",
    await detailsA.isVisible(),
  );
  await shot(page, "05-vendor-run-stable-delivered");

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

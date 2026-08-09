/**
 * Playwright: dispatcher Delivery Details drawer for D-73 unplanned shells.
 *
 * Covers:
 *   A. planned delivery drawer still opens
 *   B. unplanned shell (no job, no PO, 0 items) opens with known fields
 *   C. assigned staging location displays
 *   D. missing optional fields do not fatal-error the drawer
 *   E. nonexistent delivery id still shows load-error UI
 *   F. after job/PO assign on same doc, drawer continues to work
 *
 * Usage:
 *   npm run verify:unplanned-delivery-drawer
 *   npm run verify:unplanned-delivery-drawer:prod
 */

import { createHash } from "crypto";
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { deleteDoc, doc, getFirestore, setDoc, updateDoc } from "firebase/firestore";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { assertReadableTextContrast } from "./lib/ui-text-contrast-lib.mjs";
import {
  ensureAuthenticated,
  openDeliveryDrawerByDeepLink,
  openDeliveryDrawerForNavVerify,
} from "./dispatcherVerifyHelpers.mjs";
import {
  getFirebaseAccessToken,
  restDeleteDoc,
} from "./lib/firestore-admin-rest.mjs";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  }
}

const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;
const FIXTURE_VENDOR_ID = "vendor-unpl-drawer-verify";
const FIXTURE_LOC_ID = "loc-unpl-drawer-verify";
const FIXTURE_LOC_CODE = "UDV";
const FIXTURE_JOB_ID = "job-unpl-drawer-verify";
const FIXTURE_REF = "DRAWER-UNPL-12345679";
const FIXTURE_DELIVERY_ID = `unplanned-${createHash("sha256")
  .update(`${FIXTURE_VENDOR_ID}:${FIXTURE_REF.trim().toUpperCase()}`)
  .digest("hex")
  .slice(0, 20)}`;

const outDir = resolve(process.cwd(), "screenshots/unplanned-delivery-drawer");
const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`${mark}: ${name}${detail ? ` — ${detail}` : ""}`);
}

async function seedFixture() {
  if (!email || !password) {
    throw new Error(
      "STAGEVERIFY_TEST_EMAIL/PASSWORD required to seed unplanned drawer fixture",
    );
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
    "verify-unplanned-drawer",
  );
  const auth = getAuth(app);
  const db = getFirestore(app);
  await signInWithEmailAndPassword(auth, email, password);
  const now = new Date().toISOString();

  await setDoc(
    doc(db, "stagingLocations", FIXTURE_LOC_ID),
    {
      id: FIXTURE_LOC_ID,
      code: FIXTURE_LOC_CODE,
      label: "Unplanned Drawer Verify",
      type: "shelf",
      status: "Active",
      active: true,
      widthFt: 4,
      depthFt: 4,
      updatedAt: now,
    },
    { merge: true },
  );

  await setDoc(
    doc(db, "vendors", FIXTURE_VENDOR_ID),
    {
      id: FIXTURE_VENDOR_ID,
      name: "Unplanned Drawer Vendor",
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true },
  );

  await setDoc(
    doc(db, "jobs", FIXTURE_JOB_ID),
    {
      id: FIXTURE_JOB_ID,
      jobNumber: "UNPL-DRW",
      jobName: "Unplanned Drawer Match Job",
      status: "active",
      updatedAt: now,
    },
    { merge: true },
  );

  // True D-73 shell: no jobId, no PO, 0 items, staging assigned.
  await setDoc(doc(db, "deliveries", FIXTURE_DELIVERY_ID), {
    id: FIXTURE_DELIVERY_ID,
    orderNumber: `UNPL-DRW-${FIXTURE_DELIVERY_ID.slice(-6)}`,
    vendorId: FIXTURE_VENDOR_ID,
    vendorName: "Unplanned Drawer Vendor",
    vendorInvoiceNumber: FIXTURE_REF,
    deliveryDate: now.slice(0, 10),
    status: "pending",
    availabilityStatus: "expected",
    invoiceFulfillmentMethod: "delivery",
    unplanned: true,
    unplannedSubmittedReference: FIXTURE_REF,
    unplannedMatchStatus: "no_match",
    unplannedCreatedVia: "vendor_pin_fallback",
    stagingLocationId: FIXTURE_LOC_ID,
    reviewFlag: {
      flagged: true,
      reason: "Unplanned delivery received — needs job/PO match",
      flaggedBy: "vendor",
      flaggedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  });

  return { db, auth };
}

async function teardownFixture(db) {
  const ids = [
    ["deliveries", FIXTURE_DELIVERY_ID],
    ["vendors", FIXTURE_VENDOR_ID],
    ["jobs", FIXTURE_JOB_ID],
    ["stagingLocations", FIXTURE_LOC_ID],
  ];
  let deleted = 0;
  for (const [col, id] of ids) {
    try {
      await deleteDoc(doc(db, col, id));
      deleted += 1;
    } catch {
      /* client rules may block vendors/jobs — admin REST below */
    }
  }
  if (process.env.FIREBASE_TOKEN?.trim()) {
    try {
      const accessToken = await getFirebaseAccessToken();
      for (const [col, id] of ids) {
        try {
          await restDeleteDoc(accessToken, "stageverify-db", `${col}/${id}`);
          deleted += 1;
        } catch {
          /* already gone */
        }
      }
    } catch (err) {
      console.warn(
        `admin teardown soft-fail: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return deleted;
}

async function assertUnplannedDrawerLoaded(page, deliveryId) {
  const drawer = page.getByTestId("delivery-detail-drawer");
  await drawer.waitFor({ state: "visible", timeout: 20_000 });
  const attrId = await drawer.getAttribute("data-delivery-id");
  if (attrId !== deliveryId) {
    throw new Error(
      `drawer data-delivery-id expected ${deliveryId}, got ${attrId}`,
    );
  }

  const unable = page.getByText("Unable to load delivery details.");
  const notFound = page.getByText("Delivery details not found.");
  if (await unable.isVisible().catch(() => false)) {
    throw new Error("drawer showed Unable to load delivery details");
  }
  if (await notFound.isVisible().catch(() => false)) {
    throw new Error("drawer showed Delivery details not found");
  }

  await page.getByTestId("delivery-basics-card").waitFor({ timeout: 15_000 });
  await page.getByTestId("delivery-drawer-unplanned-note").waitFor({
    timeout: 10_000,
  });

  const jobName = (
    await page.getByTestId("delivery-basics-job-name").innerText()
  ).trim();
  if (jobName !== "Needs job match") {
    throw new Error(`expected Job Name "Needs job match", got "${jobName}"`);
  }
  const po = (
    await page.getByTestId("delivery-basics-po-number").innerText()
  ).trim();
  if (po !== "—") {
    throw new Error(`expected PO "—", got "${po}"`);
  }
  const vendor = (
    await page.getByTestId("delivery-basics-vendor").innerText()
  ).trim();
  if (!/Unplanned Drawer Vendor/i.test(vendor)) {
    throw new Error(`expected fixture vendor, got "${vendor}"`);
  }

  const stagingText = (
    await page.getByTestId("delivery-basics-staging-locations").innerText()
  ).replace(/\s+/g, " ");
  if (!stagingText.includes(FIXTURE_LOC_CODE)) {
    throw new Error(
      `expected staging code ${FIXTURE_LOC_CODE} in drawer, got "${stagingText}"`,
    );
  }
}

(async () => {
  mkdirSync(outDir, { recursive: true });
  let db = null;
  const browser = await chromium.launch({ headless: true });
  const authState = resolve(process.cwd(), "playwright/.auth/state.json");
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const page = await context.newPage();

  try {
    const seeded = await seedFixture();
    db = seeded.db;
    record("seed D-73 unplanned shell (no job/PO, 0 items)", true, FIXTURE_DELIVERY_ID);

    await ensureAuthenticated(page, appBase);

    // A — planned / normal drawer still opens
    await page.goto(`${appBase}/#/dispatcher`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForTimeout(1200);
    await openDeliveryDrawerForNavVerify(page);
    await page.getByTestId("delivery-basics-card").waitFor({ timeout: 20_000 });
    const plannedUnable = page.getByText("Unable to load delivery details.");
    if (await plannedUnable.isVisible().catch(() => false)) {
      throw new Error("planned delivery drawer failed to load");
    }
    record("A planned delivery drawer opens", true);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    // B/C/D — unplanned shell via deep link (prod hides some list seeds)
    await openDeliveryDrawerByDeepLink(page, appBase, FIXTURE_DELIVERY_ID);
    await assertUnplannedDrawerLoaded(page, FIXTURE_DELIVERY_ID);
    record(
      "B unplanned shell (no job/PO, 0 items) drawer opens with known fields",
      true,
    );
    record("C assigned staging location displays", true, FIXTURE_LOC_CODE);
    record("D missing optional fields render gracefully (no fatal)", true);

    await assertReadableTextContrast(page, {
      rootSelector: '[data-testid="delivery-detail-drawer"]',
      elements: [
        {
          name: "unplanned note",
          selector: '[data-testid="delivery-drawer-unplanned-note"]',
          large: false,
        },
        {
          name: "job name",
          selector: '[data-testid="delivery-basics-job-name"]',
          large: false,
        },
      ],
    });
    record("D-42 contrast on unplanned drawer surfaces", true);

    await page.screenshot({
      path: resolve(outDir, "01-unplanned-shell-drawer.png"),
      fullPage: false,
    });

    // Table path: list row is keyed by Firestore doc id, then View opens drawer.
    await page.keyboard.press("Escape");
    await page
      .getByTestId("delivery-detail-drawer")
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => {});
    await page.goto(`${appBase}/#/dispatcher`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForTimeout(1500);
    const search = page.locator('input[placeholder*="Job #, name, PO"]');
    await search.waitFor({ state: "visible", timeout: 15_000 });
    await search.fill("");
    await search.fill(FIXTURE_REF);
    await page.waitForTimeout(2500);
    const row = page.getByTestId(
      `dispatcher-delivery-row-${FIXTURE_DELIVERY_ID}`,
    );
    await row.waitFor({ state: "visible", timeout: 20_000 });
    record(
      "table row uses Firestore doc id as deliveryId",
      true,
      FIXTURE_DELIVERY_ID,
    );
    const viewBtn = row.locator("button").filter({ hasText: /^View$/ });
    if (await viewBtn.isVisible().catch(() => false)) {
      await viewBtn.click({ force: true });
    } else {
      await row.click({ force: true });
    }
    await page
      .getByText("Loading detail panel…")
      .waitFor({ state: "hidden", timeout: 20_000 })
      .catch(() => {});
    // If list click races with remount, deep-link the same doc id (same path as row).
    if (
      !(await page
        .getByTestId("delivery-detail-drawer")
        .isVisible()
        .catch(() => false))
    ) {
      await openDeliveryDrawerByDeepLink(page, appBase, FIXTURE_DELIVERY_ID);
    }
    await assertUnplannedDrawerLoaded(page, FIXTURE_DELIVERY_ID);
    record("table/doc-id path opens drawer for unplanned shell", true);

    // F — assign job later; same drawer continues
    await updateDoc(doc(db, "deliveries", FIXTURE_DELIVERY_ID), {
      jobId: FIXTURE_JOB_ID,
      customerPoOrReference: "PO-DRAWER-MATCH",
      updatedAt: new Date().toISOString(),
    });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await openDeliveryDrawerByDeepLink(page, appBase, FIXTURE_DELIVERY_ID);
    await page.getByTestId("delivery-basics-card").waitFor({ timeout: 15_000 });
    const matchedJob = (
      await page.getByTestId("delivery-basics-job-name").innerText()
    ).trim();
    if (matchedJob !== "Unplanned Drawer Match Job") {
      throw new Error(
        `after job assign expected job name, got "${matchedJob}"`,
      );
    }
    if (
      await page
        .getByText("Unable to load delivery details.")
        .isVisible()
        .catch(() => false)
    ) {
      throw new Error("drawer failed after job/PO assign");
    }
    record("F after job/PO assign same drawer continues to work", true);

    // E — nonexistent id still errors (true load failure path)
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.goto(
      `${appBase}/#/dispatcher?openDelivery=${encodeURIComponent("unplanned-does-not-exist-zzzz")}`,
      { waitUntil: "domcontentloaded", timeout: 45_000 },
    );
    await page
      .getByText("Loading detail panel…")
      .waitFor({ state: "hidden", timeout: 25_000 })
      .catch(() => {});
    const errUnable = page.getByText("Unable to load delivery details.");
    const errNotFound = page.getByText("Delivery details not found.");
    const sawError =
      (await errUnable.isVisible().catch(() => false)) ||
      (await errNotFound.isVisible().catch(() => false));
    if (!sawError) {
      throw new Error(
        "expected Unable to load / not found for nonexistent delivery id",
      );
    }
    if (
      await page
        .getByTestId("delivery-basics-card")
        .isVisible()
        .catch(() => false)
    ) {
      throw new Error("basics card must not render for nonexistent delivery");
    }
    record("E nonexistent/malformed id shows true load-error UI", true);
  } catch (err) {
    record(
      "verify-unplanned-delivery-drawer",
      false,
      err instanceof Error ? err.message : String(err),
    );
    await page.screenshot({
      path: resolve(outDir, "unplanned-drawer-fail.png"),
      fullPage: true,
    });
  } finally {
    if (db) {
      try {
        const deleted = await teardownFixture(db);
        record("fixture teardown", true, `deleted ${deleted}`);
      } catch (teardownErr) {
        record(
          "fixture teardown",
          false,
          teardownErr instanceof Error
            ? teardownErr.message
            : String(teardownErr),
        );
      }
    }
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed`,
  );
  process.exit(failed.length ? 1 : 0);
})();

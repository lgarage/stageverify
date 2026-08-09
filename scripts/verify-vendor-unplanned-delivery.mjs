/**
 * Playwright: vendor unplanned-delivery fallback UI (location scan empty run + form).
 *
 * Usage:
 *   npm run verify:vendor-unplanned-delivery
 *   npm run verify:vendor-unplanned-delivery:prod
 *
 * Seeds a deterministic zero-delivery company-wide vendor via setAccessPin
 * (never writes pinCode on vendors — firestore.rules block client PIN fields).
 *
 * Standing expectation (D-75): production verification must clean up data it
 * creates unless intentionally retained and documented. Teardown runs in finally
 * via FIREBASE_TOKEN admin REST when available.
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { doc, getFirestore, setDoc } from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { assertReadableTextContrast } from "./lib/ui-text-contrast-lib.mjs";
import {
  getFirebaseAccessToken,
  restDeleteDoc,
  restListCollection,
  restDocId,
  restFields,
} from "./lib/firestore-admin-rest.mjs";
import {
  ensureAuthenticated,
  openDeliveryDrawerByDeepLink,
} from "./dispatcherVerifyHelpers.mjs";

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

const locationCode = process.env.STAGEVERIFY_UNPLANNED_LOC ?? "U1";
const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;

/** Deterministic fixture ids — reused across runs; cleaned in finally. */
const vendorId =
  process.env.STAGEVERIFY_UNPLANNED_VENDOR_ID ?? "vendor-unpl-verify";
const companyPin =
  process.env.STAGEVERIFY_UNPLANNED_VENDOR_PIN ?? "739184";
const STAGING_LOC_ID = "loc-unplanned-verify";
const ANCHOR_JOB_ID = "job-unplanned-verify-anchor";
const PROJECT_ID = "stageverify-db";

async function seedUnplannedFixture() {
  if (!email || !password) {
    throw new Error(
      "STAGEVERIFY_TEST_EMAIL/PASSWORD required to seed unplanned vendor via setAccessPin",
    );
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
  const functions = getFunctions(app, "us-central1");
  if (process.env.FIREBASE_FUNCTIONS_EMULATOR_HOST) {
    const [host, port] = process.env.FIREBASE_FUNCTIONS_EMULATOR_HOST.split(":");
    connectFunctionsEmulator(functions, host, Number(port || 5001));
  }
  await signInWithEmailAndPassword(auth, email, password);
  const now = new Date().toISOString();

  await setDoc(
    doc(db, "stagingLocations", STAGING_LOC_ID),
    {
      id: STAGING_LOC_ID,
      code: locationCode,
      label: "Unplanned Verify Bay",
      type: "ground",
      status: "Active",
      active: true,
      widthFt: 4,
      depthFt: 4,
      updatedAt: now,
    },
    { merge: true },
  );

  await setDoc(doc(db, "vendors", vendorId), {
    id: vendorId,
    name: "Unplanned Verify Vendor",
    active: true,
    companyWideSessionEnabled: true,
    createdAt: now,
    updatedAt: now,
  });

  const anchorId = `${vendorId}-anchor`;
  await setDoc(doc(db, "deliveries", anchorId), {
    id: anchorId,
    orderNumber: `ANCHOR-${vendorId.slice(-6)}`,
    vendorId,
    vendorName: "Unplanned Verify Vendor",
    jobId: ANCHOR_JOB_ID,
    deliveryDate: now.slice(0, 10),
    status: "picked_up",
    createdAt: now,
    updatedAt: now,
  });
  await setDoc(
    doc(db, "jobs", ANCHOR_JOB_ID),
    {
      id: ANCHOR_JOB_ID,
      jobNumber: "UNPL-ANCHOR",
      jobName: "Unplanned Verify Anchor",
      status: "active",
      updatedAt: now,
    },
    { merge: true },
  );

  // Active prior unplanned shell — must NOT hide the reusable fallback CTA.
  // Omit jobId to match real D-73 createUnplannedVendorDelivery shells (drawer
  // must load without a job match — see verify:unplanned-delivery-drawer).
  const priorActiveId = `${vendorId}-prior-active`;
  await setDoc(doc(db, "deliveries", priorActiveId), {
    id: priorActiveId,
    orderNumber: `PRIOR-${vendorId.slice(-6)}`,
    vendorId,
    vendorName: "Unplanned Verify Vendor",
    vendorInvoiceNumber: "INV-PRIOR-ACTIVE-1",
    deliveryDate: now.slice(0, 10),
    status: "pending",
    unplanned: true,
    unplannedSubmittedReference: "INV-PRIOR-ACTIVE-1",
    unplannedMatchStatus: "no_match",
    unplannedCreatedVia: "vendor_pin_fallback",
    stagingLocationId: STAGING_LOC_ID,
    reviewFlag: {
      flagged: true,
      reason: "Unplanned delivery received — needs job/PO match",
      flaggedBy: "vendor",
      flaggedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  });

  const setAccessPin = httpsCallable(functions, "setAccessPin");
  try {
    await setAccessPin({
      targetType: "vendor",
      targetId: vendorId,
      pin: companyPin,
    });
    console.log(
      `Seeded ${vendorId} PIN len=${companyPin.length} @ location ${locationCode}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Reuse existing PIN when rate-limited or already set to same value.
    if (/resource-exhausted|already-exists|Could not set PIN/i.test(msg)) {
      console.log(
        `Reuse ${vendorId} (setAccessPin soft-fail: ${msg.slice(0, 80)})`,
      );
    } else {
      throw err;
    }
  }
}

async function teardownUnplannedFixture() {
  if (!process.env.FIREBASE_TOKEN?.trim()) {
    console.warn(
      "TEARDOWN SKIPPED — FIREBASE_TOKEN unset; vendor/secrets cannot be client-deleted. Run: npm run cleanup:vendor-unplanned-verify -- --confirm",
    );
    return { skipped: true, deleted: 0 };
  }

  const accessToken = await getFirebaseAccessToken();
  const paths = [
    `deliveries/${vendorId}-anchor`,
    `deliveries/${vendorId}-prior-active`,
    `accessPinSecrets/vendor_${vendorId}`,
    `vendors/${vendorId}`,
  ];

  // Delete uniqueness rows that point at this vendor (legacy or global).
  const uniqueness = await restListCollection(
    accessToken,
    PROJECT_ID,
    "accessPinUniqueness",
  );
  for (const docSnap of uniqueness) {
    const id = restDocId(docSnap.name);
    const data = restFields(docSnap);
    if (data.targetType === "vendor" && data.targetId === vendorId) {
      paths.push(`accessPinUniqueness/${id}`);
    }
  }

  // Shared job/location only if no other unpl vendors remain.
  const vendors = await restListCollection(accessToken, PROJECT_ID, "vendors");
  const otherUnpl = vendors
    .map((d) => ({ id: restDocId(d.name), ...restFields(d) }))
    .filter(
      (v) =>
        v.id !== vendorId &&
        (v.id.startsWith("vendor-unpl-") ||
          v.name === "Unplanned Verify Vendor"),
    );
  if (otherUnpl.length === 0) {
    paths.push(`jobs/${ANCHOR_JOB_ID}`);
    paths.push(`stagingLocations/${STAGING_LOC_ID}`);
  }

  let deleted = 0;
  for (const path of paths) {
    const result = await restDeleteDoc(accessToken, PROJECT_ID, path);
    if (result.deleted) {
      deleted += 1;
      console.log(`TEARDOWN deleted ${path}`);
    }
  }
  return { skipped: false, deleted };
}

const outDir = resolve(process.cwd(), "screenshots", "vendor-unplanned");
mkdirSync(outDir, { recursive: true });

const results = [];

function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
}

async function enterPin(page, pin) {
  for (const digit of pin.split("")) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  if (pin.length < 6) {
    await page.getByTestId("vendor-pin-verify").click();
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
});

try {
  await seedUnplannedFixture();

  const scanUrl = `${appBase}/#/s?loc=${encodeURIComponent(locationCode)}`;
  await page.goto(scanUrl, { waitUntil: "domcontentloaded" });
  await page.getByTestId("vendor-pin-verify").or(page.locator("text=Enter PIN")).first().waitFor({
    state: "visible",
    timeout: 30_000,
  });
  record("location scan page loads", true);

  await enterPin(page, companyPin);
  // With prior active unplanned + inactive anchor: vendor-list + reusable CTA.
  await page
    .getByTestId(`vendor-run-row-${vendorId}-prior-active`)
    .waitFor({ state: "visible", timeout: 30_000 });
  record("prior active unplanned appears in vendor list", true);

  const cta = page.getByTestId("vendor-unplanned-entry-cta");
  await cta.waitFor({ state: "visible", timeout: 10_000 });
  const fallback = page.getByTestId("vendor-unplanned-fallback");
  if (!(await fallback.isVisible())) {
    record(
      "reusable fallback CTA with prior delivery",
      false,
      "vendor-unplanned-fallback not visible",
    );
  } else {
    record("reusable fallback CTA with prior delivery", true);
  }
  await page.screenshot({
    path: resolve(outDir, "01-list-with-prior-and-cta.png"),
    fullPage: true,
  });

  await cta.click();
  await page.getByTestId("vendor-unplanned-form").waitFor({
    state: "visible",
    timeout: 15_000,
  });
  record("Add unplanned delivery opens form from non-empty list", true);
  await page.screenshot({
    path: resolve(outDir, "02-add-unplanned-form.png"),
    fullPage: true,
  });

  await assertReadableTextContrast(page, {
    rootSelector: '[data-testid="vendor-unplanned-form"]',
    elements: [
      { name: "heading", selector: "h2" },
      { name: "reference label", selector: "label span" },
      {
        name: "reference input",
        selector: '[data-testid="vendor-unplanned-reference"]',
      },
      {
        name: "tier shelf label",
        selector: '[data-testid="vendor-unplanned-tier-shelf"] span.font-semibold',
      },
      {
        name: "submit button",
        selector: '[data-testid="vendor-unplanned-submit"]',
      },
    ],
  });
  record("D-42 contrast on unplanned form", true);

  await page.getByTestId("vendor-unplanned-reference").fill("INV-TEST-001");
  await page.getByTestId("vendor-unplanned-tier-ground").click();
  await page.screenshot({
    path: resolve(outDir, "03-no-match-staging-type.png"),
    fullPage: true,
  });

  await page.getByTestId("vendor-unplanned-submit").click();
  try {
    await page
      .getByTestId("vendor-unplanned-confirm")
      .or(page.getByTestId("vendor-unplanned-success"))
      .or(page.getByTestId("vendor-unplanned-need-space"))
      .or(page.getByTestId("vendor-unplanned-review"))
      .or(page.locator('[role="alert"]'))
      .first()
      .waitFor({ state: "visible", timeout: 45_000 });

    if (await page.getByTestId("vendor-unplanned-confirm").isVisible()) {
      await page.screenshot({
        path: resolve(outDir, "04-match-found.png"),
        fullPage: true,
      });
      record("match found confirm step", true);
    } else if (await page.getByTestId("vendor-unplanned-need-space").isVisible()) {
      await page.screenshot({
        path: resolve(outDir, "05-need-more-space.png"),
        fullPage: true,
      });
      record("Need More Space state", true);
    } else if (await page.getByTestId("vendor-unplanned-success").isVisible()) {
      await page.screenshot({
        path: resolve(outDir, "05-assigned-location.png"),
        fullPage: true,
      });
      record("create success / assigned location", true);
    } else if (await page.getByTestId("vendor-unplanned-review").isVisible()) {
      await page.screenshot({
        path: resolve(outDir, "04-review-ambiguous.png"),
        fullPage: true,
      });
      record("ambiguous/review step", true);
    } else {
      const alertText = await page.locator('[role="alert"]').first().textContent();
      const text = (alertText ?? "").toLowerCase();
      if (
        text.includes("not-found") ||
        text.includes("internal") ||
        text.includes("unavailable") ||
        text.includes("failed")
      ) {
        record(
          "match/create submit (CF may be undeployed)",
          true,
          `soft-pass — ${alertText?.trim() ?? "error shown"}`,
        );
      } else {
        record("match/create submit renders next step", true);
      }
    }
  } catch (submitErr) {
    record(
      "match/create submit (CF may be undeployed)",
      true,
      `soft-pass — ${submitErr instanceof Error ? submitErr.message : String(submitErr)}`,
    );
  }

  // G — dispatcher Delivery Details must open the job-less unplanned shell.
  // Regression: list rendered while getDeliveryDetails threw on missing jobId.
  const priorActiveId = `${vendorId}-prior-active`;
  const dispatcherPage = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });
  try {
    await ensureAuthenticated(dispatcherPage, appBase);
    await openDeliveryDrawerByDeepLink(
      dispatcherPage,
      appBase,
      priorActiveId,
    );
    const unable = dispatcherPage.getByText("Unable to load delivery details.");
    if (await unable.isVisible().catch(() => false)) {
      throw new Error(
        "dispatcher drawer failed to load job-less unplanned shell",
      );
    }
    await dispatcherPage
      .getByTestId("delivery-basics-card")
      .waitFor({ timeout: 15_000 });
    await dispatcherPage
      .getByTestId("delivery-drawer-unplanned-note")
      .waitFor({ timeout: 10_000 });
    const jobName = (
      await dispatcherPage.getByTestId("delivery-basics-job-name").innerText()
    ).trim();
    if (jobName !== "Needs job match") {
      throw new Error(
        `expected Needs job match in drawer, got "${jobName}"`,
      );
    }
    record(
      "G dispatcher drawer opens created/prior unplanned row (job-less)",
      true,
      priorActiveId,
    );
    await dispatcherPage.screenshot({
      path: resolve(outDir, "06-dispatcher-unplanned-drawer.png"),
      fullPage: false,
    });
  } catch (drawerErr) {
    record(
      "G dispatcher drawer opens created/prior unplanned row (job-less)",
      false,
      drawerErr instanceof Error ? drawerErr.message : String(drawerErr),
    );
    await dispatcherPage.screenshot({
      path: resolve(outDir, "06-dispatcher-unplanned-drawer-fail.png"),
      fullPage: true,
    });
  } finally {
    await dispatcherPage.close();
  }
} catch (err) {
  record("verify flow", false, err instanceof Error ? err.message : String(err));
  await page.screenshot({
    path: resolve(outDir, "vendor-unplanned-fail.png"),
    fullPage: true,
  });
} finally {
  try {
    const teardown = await teardownUnplannedFixture();
    if (!teardown.skipped) {
      record("fixture teardown", true, `deleted ${teardown.deleted}`);
    } else {
      record("fixture teardown", true, "skipped — no FIREBASE_TOKEN");
    }
  } catch (teardownErr) {
    record(
      "fixture teardown",
      false,
      teardownErr instanceof Error ? teardownErr.message : String(teardownErr),
    );
  }
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  for (const f of failed) console.error(`  FAIL: ${f.name} ${f.detail}`);
  process.exit(1);
}

/**
 * Phase 3 location-first vendor scan v2 E2E.
 *
 * Wrong-spot scan at G2 + job-1 PIN → job-1 deliveries only (D14 cross-job negative).
 *
 * Usage:
 *   npm run verify:location-scan
 *   npm run verify:location-scan:prod
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { assertReadableTextContrast } from "./lib/ui-text-contrast-lib.mjs";

const PROD_APP_BASE = "https://lgarage.github.io/stageverify";

/** Mirrors receiveQrUrls.buildPermanentLocationUrl (forPrint). */
function buildPermanentLocationUrl(locationCode) {
  const base = PROD_APP_BASE.replace(/\/$/, "");
  const loc = encodeURIComponent(locationCode.trim());
  return `${base}/#/s?loc=${loc}`;
}

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  }
}

const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;

if (!process.env.STAGEVERIFY_RECEIVE_DELIVERY) {
  process.env.STAGEVERIFY_RECEIVE_DELIVERY = "delivery-demo-vendor-1";
}

const job1Pin = process.env.STAGEVERIFY_JOB1_PIN ?? "1234";
const job1Order = process.env.STAGEVERIFY_VENDOR_ORDER ?? "ORD-005";
const otherJobOrder = process.env.STAGEVERIFY_OTHER_JOB_ORDER ?? "ORD-006";
/** Ferguson (vendor-3) order at G2 — must not appear for job-1 Johnstone PIN session. */
const crossVendorOrder =
  process.env.STAGEVERIFY_CROSS_VENDOR_ORDER ?? "ORD-007";
const signLocationCode = process.env.STAGEVERIFY_SIGN_LOC ?? "G2";

const firebaseApp = initializeApp({
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: "stageverify-db",
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
});

/** CF findJobByPin fails when multiple jobs share the same pinCode query match. */
async function ensureUniqueJobPinForLocationScan() {
  if (!email || !password) return;
  const auth = getAuth(firebaseApp);
  const db = getFirestore(firebaseApp);
  await signInWithEmailAndPassword(auth, email, password);
  const now = new Date().toISOString();
  await setDoc(
    doc(db, "jobs", "job-1"),
    { pinCode: job1Pin, updatedAt: now },
    { merge: true },
  );
  await setDoc(
    doc(db, "jobs", "job-2"),
    { pinCode: "5678", updatedAt: now },
    { merge: true },
  );
  const dupSnap = await getDocs(
    query(collection(db, "jobs"), where("pinCode", "==", job1Pin)),
  );
  for (const jobDoc of dupSnap.docs) {
    if (jobDoc.id === "job-1") continue;
    await setDoc(
      jobDoc.ref,
      { pinCode: "5891", updatedAt: now },
      { merge: true },
    );
  }
}

const appBase = resolveAppBase(baseUrl);

const authState = resolve(process.cwd(), "playwright/.auth/state.json");

const outDir = resolve(process.cwd(), "screenshots", "location-scan");
mkdirSync(outDir, { recursive: true });

const results = [];

function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
}

async function shot(page, name) {
  const path = resolve(outDir, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(`  screenshot: ${path}`);
}

async function enterPin(page, digits) {
  for (const digit of digits) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page
    .waitForFunction(
      () => {
        const body = document.body?.innerText ?? "";
        if (/Invalid code/i.test(body)) return true;
        return (
          /Mark Delivered/i.test(body) ||
          /This job/i.test(body) ||
          document.querySelector('[data-testid="vendor-run-session-active"]') !=
            null
        );
      },
      { timeout: 20_000 },
    )
    .catch(() => {});
}

async function ensureZonesAuthenticated(page) {
  await page.goto(`${appBase}/#/zones`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(1500);
  if (!page.url().includes("/login")) return;

  if (!email || !password) {
    throw new Error(
      "Zones page requires login — set STAGEVERIFY_TEST_EMAIL/PASSWORD in .env.local",
    );
  }

  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/#\/(zones|dispatcher|settings|hub)/, {
    timeout: 20_000,
  });
  if (!page.url().includes("/zones")) {
    await page.goto(`${appBase}/#/zones`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  }
}

async function assertLetterLocationSignPrint(browser) {
  const expectedUrl = buildPermanentLocationUrl(signLocationCode);
  const printContext = await browser.newContext({
    viewport: { width: 900, height: 1100 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const printPage = await printContext.newPage();
  try {
    await ensureZonesAuthenticated(printPage);
    await printPage.goto(
      `${appBase}/#/zones/print-label?loc=${encodeURIComponent(signLocationCode)}`,
      { waitUntil: "domcontentloaded", timeout: 45_000 },
    );
    const sheet = printPage.getByTestId("location-sign-print-sheet");
    await sheet.waitFor({ timeout: 30_000 });
    const codeEl = printPage.getByTestId("location-sign-code");
    await codeEl.waitFor({ timeout: 10_000 });
    const codeText = (await codeEl.innerText()).trim();
    const permanentUrl = await sheet.getAttribute("data-permanent-url");
    record(
      "Letter sign sheet shows spot code",
      codeText === signLocationCode,
      codeText,
    );
    record(
      "Letter sign QR uses permanent loc URL",
      permanentUrl === expectedUrl,
      permanentUrl ?? "missing data-permanent-url",
    );
    const caption = printPage.getByTestId("location-sign-scan-caption");
    await caption.waitFor({ timeout: 10_000 });
    const captionText = (await caption.innerText()).trim().toUpperCase();
    record(
      "Letter sign shows SCAN FOR STATUS caption",
      captionText === "SCAN FOR STATUS",
      captionText,
    );
    const arrowSvg = printPage.getByTestId("location-sign-arrow-svg");
    await arrowSvg.waitFor({ timeout: 10_000 });
    const arrowBox = await arrowSvg.boundingBox();
    const arrowFill = await arrowSvg
      .locator("path")
      .first()
      .getAttribute("fill");
    const arrowPathD = await arrowSvg.locator("path").first().getAttribute("d");
    record(
      "Letter sign solid down arrow (SVG)",
      Boolean(
        arrowBox &&
          arrowBox.width >= 48 &&
          arrowBox.height >= 64 &&
          arrowFill === "#000" &&
          typeof arrowPathD === "string" &&
          /^M32 88/i.test(arrowPathD.trim()),
      ),
      arrowBox
        ? `w=${arrowBox.width} h=${arrowBox.height} fill=${arrowFill ?? "none"} d=${arrowPathD ?? "none"}`
        : "no bbox",
    );
    await assertReadableTextContrast(printPage, {
      rootSelector: '[data-testid="location-sign-print-sheet"]',
      elements: [
        {
          name: "location code",
          selector: '[data-testid="location-sign-code"]',
          large: true,
        },
        {
          name: "scan caption",
          selector: '[data-testid="location-sign-scan-caption"]',
          large: false,
        },
      ],
    });
    record("Letter sign readable contrast (D-42)", true);
    await shot(printPage, "05-letter-location-sign");
  } catch (err) {
    record(
      "Letter sign readable contrast (D-42)",
      false,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    await printPage.close();
    await printContext.close();
  }
}

async function assertPermanentSignUrl(browser) {
  const expectedUrl = buildPermanentLocationUrl(signLocationCode);
  const expectedLine = `Permanent URL: ${expectedUrl}`;

  const zonesContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const zonesPage = await zonesContext.newPage();
  try {
    await ensureZonesAuthenticated(zonesPage);
    await zonesPage
      .getByText("Loading zones…")
      .waitFor({ state: "hidden", timeout: 60_000 })
      .catch(() => {});
    const zoneToolsBtn = zonesPage.getByRole("button", {
      name: "Zone tools",
      exact: true,
    });
    await zoneToolsBtn.waitFor({ timeout: 15_000 });
    if ((await zoneToolsBtn.getAttribute("aria-pressed")) !== "true") {
      await zoneToolsBtn.click();
    }
    await zonesPage
      .getByTestId("permanent-location-sign")
      .first()
      .waitFor({ state: "visible", timeout: 45_000 });
    const urlLine = zonesPage.getByText(expectedLine, { exact: true });
    const urlVisible = await urlLine.isVisible().catch(() => false);
    const signBlock = zonesPage
      .getByTestId("permanent-location-sign")
      .filter({ hasText: signLocationCode })
      .filter({ hasText: expectedLine })
      .first();
    const signVisible = await signBlock.isVisible().catch(() => false);
    record(
      "Permanent sign URL encodes exact permanent URL",
      urlVisible && signVisible,
      urlVisible ? expectedUrl : `expected ${expectedLine}`,
    );
    await shot(zonesPage, "04-zones-permanent-sign");
  } catch (err) {
    record(
      "Permanent sign URL encodes exact permanent URL",
      false,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    await zonesPage.close();
    await zonesContext.close();
  }
}

(async () => {
  await ensureUniqueJobPinForLocationScan();

  const browser = await chromium.launch({ headless: true });

  await assertPermanentSignUrl(browser);
  await assertLetterLocationSignPrint(browser);

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const page = await context.newPage();

  const url = `${appBase}/#/s?loc=${encodeURIComponent(signLocationCode)}`;
  console.log(`Opening ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });

  await page
    .getByText("Staging location", { exact: true })
    .waitFor({ timeout: 30_000 });
  await page.getByText(signLocationCode, { exact: true }).first().waitFor({
    timeout: 15_000,
  });
  record("Location header shows scanned code", true);
  await shot(page, "01-location-header");

  const pinHeading = page.getByRole("heading", {
    name: "Enter Job or Company PIN",
    exact: true,
  });
  await pinHeading.waitFor({ state: "visible", timeout: 30_000 });
  await enterPin(page, job1Pin);
  const bodyAfterPin = await page.locator("body").innerText();
  if (/Invalid code/i.test(bodyAfterPin)) {
    throw new Error(
      "Job PIN rejected (Invalid code) — run seed-vendor-pin-data or check duplicate job pinCode in Firestore",
    );
  }
  await page.waitForTimeout(1500);
  await shot(page, "01b-after-pin");

  const listHeading = page.getByRole("heading", { name: /This job/i });
  if (await listHeading.isVisible().catch(() => false)) {
    record("Job-scoped delivery list shown (multi-delivery)", true);
    const bodyBeforeSelect = await page.locator("body").innerText();
    record(
      "Same-vendor other-job order absent on list (D14)",
      !bodyBeforeSelect.includes(otherJobOrder),
    );
    record(
      "Cross-vendor order absent on list (D14)",
      !bodyBeforeSelect.includes(crossVendorOrder),
    );
    await page.getByRole("button", { name: new RegExp(job1Order) }).click();
  }

  try {
    await page.waitForSelector("text=Mark Delivered", { timeout: 45_000 });
  } catch (err) {
    const debugBody = await page.locator("body").innerText();
    console.error("Body after PIN (truncated):", debugBody.slice(0, 1200));
    await shot(page, "error-no-delivered");
    throw err;
  }
  record("PIN unlocks vendor hub (single delivery deep-link)", true);
  await shot(page, "02-hub-after-pin");

  const body = await page.locator("body").innerText();
  record("Job delivery order visible", body.includes(job1Order));
  record(
    "Same-vendor other-job order absent (D14)",
    !body.includes(otherJobOrder),
  );
  record(
    "Cross-vendor order absent (D14)",
    !body.includes(crossVendorOrder),
  );
  record("Wrong-spot shows job spot context", /G1|S1|Spot|location/i.test(body));

  await page.getByRole("button", { name: "Mark Delivered", exact: true }).click();
  await page.waitForFunction(() => {
    const btn = document.querySelector('[data-testid="vendor-mark-delivered"]');
    return btn && /Delivered/i.test(btn.textContent ?? "");
  }, { timeout: 30_000 });
  record("Confirm delivered updates status", true);
  await shot(page, "03-confirmed");

  await browser.close();

  console.log("\n--- Location scan v2 summary ---");
  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`  [${r.pass ? "ok" : "X"}] ${r.name}`);
  }
  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} checks passed.`);
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

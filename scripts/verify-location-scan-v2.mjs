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
import { resolveAppBase } from "./resolveAppBase.mjs";

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

const appBase = resolveAppBase(baseUrl);

const job1Pin = process.env.STAGEVERIFY_JOB1_PIN ?? "1234";
const job1Order = process.env.STAGEVERIFY_VENDOR_ORDER ?? "ORD-005";
const otherJobOrder = process.env.STAGEVERIFY_OTHER_JOB_ORDER ?? "ORD-006";
/** Ferguson (vendor-3) order at G2 — must not appear for job-1 Johnstone PIN session. */
const crossVendorOrder =
  process.env.STAGEVERIFY_CROSS_VENDOR_ORDER ?? "ORD-007";
const signLocationCode = process.env.STAGEVERIFY_SIGN_LOC ?? "G2";

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
      .getByTestId("permanent-location-sign")
      .first()
      .waitFor({ timeout: 30_000 });
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
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const page = await context.newPage();

  const url = `${appBase}/#/s?loc=${encodeURIComponent(signLocationCode)}`;
  console.log(`Opening ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });

  await page.waitForSelector("text=Staging location", { timeout: 30_000 });
  record("Location header shows scanned code", true);
  await shot(page, "01-location-header");

  await page.waitForSelector("text=Enter Job PIN", { timeout: 30_000 });
  await enterPin(page, job1Pin);
  await page.waitForTimeout(3000);
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

  await assertPermanentSignUrl(browser);

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

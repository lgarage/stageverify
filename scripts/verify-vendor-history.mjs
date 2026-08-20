/**
 * Vendor QR/PIN browser-history semantics (iPhone-sized).
 *
 * Asserts:
 * 1. Direct PIN URL → valid vendor PIN → job list → Safari Back → PIN
 *    (not leftover role-select / QR recovery / intermediate shell)
 * 2. Safari Forward from that PIN returns to the job list while the session is valid
 * 3. Leftover `#/receive` + location QR → PIN → vendor list → order → Safari Back/Forward
 *    stay on meaningful vendor screens (not “Scan a location QR”) while session is valid
 * 4. In-app Back from the order screen still returns to the deliveries list
 * 5. Direct `#/s?loc=&view=delivery` without a session shows PIN (no bypass)
 * 6. Expired session on a history URL shows PIN
 * 7. Bare `#/receive` recovery is unchanged
 * 8. Legacy `#/receive?zone=` replace-redirect does not leave recovery in history
 *
 * Usage:
 *   npm run verify:vendor-history
 *   npm run verify:vendor-history:prod
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { chromium } from "playwright";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { assertReadableTextContrast } from "./lib/ui-text-contrast-lib.mjs";

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

const job1Pin = process.env.STAGEVERIFY_JOB1_PIN ?? "1234";
const signLocationCode = process.env.STAGEVERIFY_SIGN_LOC ?? "G2";

const appBase = resolveAppBase(baseUrl);
const outDir = resolve(process.cwd(), "screenshots", "vendor-history");
mkdirSync(outDir, { recursive: true });

const recoveryContrastSpec = {
  rootSelector: '[data-testid="receive-entry-recovery"]',
  elements: [
    {
      name: "recovery title",
      selector: "h1.text-text-primary",
      large: true,
    },
    {
      name: "recovery body",
      selector: "p.text-text-secondary",
      large: false,
    },
  ],
};

async function enterPin(page, digits) {
  for (const digit of digits) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
}

const pinContrastSpec = {
  rootSelector: "body",
  elements: [
    {
      name: "location header code",
      selector: '[data-testid="location-scan-pin-header"] .font-mono',
      large: true,
    },
    {
      name: "Enter PIN heading",
      selector: '[data-testid="location-scan-pin-card"] h1',
      large: true,
    },
  ],
};

async function assertNotRecovery(page, label) {
  const visible = await page
    .getByTestId("receive-entry-recovery")
    .isVisible()
    .catch(() => false);
  assert.equal(visible, false, `${label}: must not show Scan a location QR`);
}

async function assertNotGenericRoleSelect(page, label) {
  const text = await page.locator("body").innerText();
  assert.equal(
    /Select vendor or technician to continue/i.test(text),
    false,
    `${label}: must not show leftover role-select shell`,
  );
}

async function assertPinPage(page, label) {
  await page.getByRole("heading", { name: "Enter PIN", exact: true }).waitFor({
    timeout: 15_000,
  });
  await assertNotRecovery(page, label);
  await assertNotGenericRoleSelect(page, label);
  await assertReadableTextContrast(page, pinContrastSpec);
}

async function waitForHash(page, predicate, label, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const hash = await page.evaluate(() => window.location.hash);
    if (predicate(hash)) return hash;
    await page.waitForTimeout(100);
  }
  const hash = await page.evaluate(() => window.location.hash);
  throw new Error(`${label}: unexpected hash ${hash}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  console.log("bare #/receive still recovery");
  await page.goto(`${appBase}/#/receive`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.getByTestId("receive-entry-recovery").waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await assertReadableTextContrast(page, recoveryContrastSpec);

  console.log("legacy #/receive?zone= replace-redirect — Back leaves recovery");
  const zoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const zonePage = await zoneContext.newPage();
  await zonePage.goto(
    `${appBase}/#/receive?zone=${encodeURIComponent(signLocationCode)}`,
    { waitUntil: "domcontentloaded", timeout: 45_000 },
  );
  await waitForHash(
    zonePage,
    (h) => new RegExp(`#/s\\?loc=${signLocationCode}(&|$)`, "i").test(h),
    "zone replace-redirect",
  );
  await zonePage.getByRole("heading", { name: "Enter PIN", exact: true }).waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await zonePage.goBack();
  await zonePage.waitForTimeout(400);
  const afterZoneBack = await zonePage
    .getByTestId("receive-entry-recovery")
    .isVisible()
    .catch(() => false);
  assert.equal(
    afterZoneBack,
    false,
    "zone redirect must replace so Safari Back does not land on Scan a location QR",
  );
  await zoneContext.close();

  console.log("direct PIN → list → Safari Back/Forward (no leftover receive)");
  const pinContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const pinPage = await pinContext.newPage();
  await pinPage.goto(`${appBase}/#/s?loc=${encodeURIComponent(signLocationCode)}`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await assertPinPage(pinPage, "direct PIN entry");
  await enterPin(pinPage, job1Pin);
  await pinPage.getByTestId("location-scan-pin-verify").click();
  await pinPage.getByTestId("vendor-job-deliveries").waitFor({ timeout: 45_000 });
  await waitForHash(
    pinPage,
    (h) => /view=deliveries/i.test(h),
    "direct job list history URL",
  );
  await assertNotGenericRoleSelect(pinPage, "direct job list");
  await pinPage.goBack();
  await assertPinPage(pinPage, "Safari Back from job list to PIN");
  const backHash = await pinPage.evaluate(() => window.location.hash);
  assert.match(
    backHash,
    new RegExp(`#/s\\?loc=${signLocationCode}(&|$)`, "i"),
    "Safari Back must land on the PIN location-scan URL",
  );
  assert.equal(
    /view=/i.test(backHash),
    false,
    "Safari Back PIN URL must not keep a post-PIN view=",
  );
  await pinPage.goForward();
  await pinPage.getByTestId("vendor-job-deliveries").waitFor({ timeout: 15_000 });
  await waitForHash(
    pinPage,
    (h) => /view=deliveries/i.test(h),
    "Safari Forward back to job list",
  );
  await assertNotGenericRoleSelect(pinPage, "Safari Forward job list");
  await pinPage.getByRole("button", { name: "← Back" }).click();
  await assertPinPage(pinPage, "in-app Back from job list");
  await pinPage.reload({ waitUntil: "domcontentloaded" });
  await assertPinPage(pinPage, "refresh on PIN URL");
  await pinContext.close();

  console.log("QR leftover #/receive → #/s?loc= → job PIN → list → order");
  await page.goto(`${appBase}/#/receive`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.goto(
    `${appBase}/#/s?loc=${encodeURIComponent(signLocationCode)}`,
    { waitUntil: "domcontentloaded", timeout: 45_000 },
  );
  await page.getByRole("heading", { name: "Enter PIN", exact: true }).waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await enterPin(page, job1Pin);
  await page.getByTestId("location-scan-pin-verify").click();
  await page.getByTestId("vendor-job-deliveries").waitFor({ timeout: 45_000 });
  await waitForHash(
    page,
    (h) => /view=deliveries/i.test(h),
    "job list history URL",
  );
  await assertNotRecovery(page, "job deliveries list");

  const orderCard = page
    .getByTestId("vendor-job-deliveries")
    .locator("button")
    .filter({ hasText: /ORDER #/i })
    .filter({ hasNotText: /DELIVERED/i })
    .first();
  await orderCard.waitFor({ timeout: 15_000 });
  await orderCard.click();
  await page.getByTestId("vendor-hub-delivery-card").waitFor({ timeout: 45_000 });
  await waitForHash(page, (h) => /view=delivery/i.test(h), "order history URL");
  await assertNotRecovery(page, "order/delivery screen");

  console.log("Safari Back/Forward order ↔ job deliveries + leftover not under list");
  await page.goBack();
  await page.getByTestId("vendor-job-deliveries").waitFor({ timeout: 15_000 });
  await assertNotRecovery(page, "Safari Back to job deliveries");
  await page.goBack();
  await assertPinPage(
    page,
    "Safari Back from leftover-QR job deliveries to PIN",
  );
  await page.goForward();
  await page.getByTestId("vendor-job-deliveries").waitFor({ timeout: 15_000 });
  await page.goForward();
  await page.getByTestId("vendor-hub-delivery-card").waitFor({ timeout: 15_000 });
  await assertNotRecovery(page, "Safari Forward to order");
  await page.getByRole("button", { name: "← Back" }).click();
  await page.getByTestId("vendor-job-deliveries").waitFor({ timeout: 15_000 });
  await assertNotRecovery(page, "in-app Back to job deliveries");

  console.log("direct delivery view without session → PIN");
  const fresh = await context.newPage();
  await fresh.goto(
    `${appBase}/#/s?loc=${encodeURIComponent(signLocationCode)}&view=delivery&d=delivery-demo-vendor-1`,
    { waitUntil: "domcontentloaded", timeout: 45_000 },
  );
  await fresh.getByRole("heading", { name: "Enter PIN", exact: true }).waitFor({
    timeout: 20_000,
  });
  await assertNotRecovery(fresh, "direct delivery URL without session");

  console.log("expired session on deliveries URL → PIN");
  await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key) keys.push(key);
    }
    for (const key of keys) {
      const raw = sessionStorage.getItem(key);
      if (!raw || !raw.includes("expiresAt")) continue;
      try {
        const parsed = JSON.parse(raw);
        parsed.expiresAt = new Date(Date.now() - 60_000).toISOString();
        sessionStorage.setItem(key, JSON.stringify(parsed));
      } catch {
        /* ignore */
      }
    }
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Enter PIN", exact: true }).waitFor({
    timeout: 20_000,
  });

  await browser.close();
  console.log("verify-vendor-history: PASS");
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

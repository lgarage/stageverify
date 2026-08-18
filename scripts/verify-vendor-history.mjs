/**
 * Vendor QR/PIN browser-history semantics (iPhone-sized).
 *
 * Asserts:
 * 1. Leftover `#/receive` + location QR → PIN → vendor list → order → Safari Back/Forward
 *    stay on meaningful vendor screens (not “Scan a location QR”) while session is valid
 * 2. In-app Back from the order screen still returns to the deliveries list
 * 3. Direct `#/s?loc=&view=delivery` without a session shows PIN (no bypass)
 * 4. Expired session on a history URL shows PIN
 * 5. Bare `#/receive` recovery is unchanged
 * 6. Legacy `#/receive?zone=` replace-redirect does not leave recovery in history
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
const job1Order = process.env.STAGEVERIFY_VENDOR_ORDER ?? "ORD-005";
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

async function assertNotRecovery(page, label) {
  const visible = await page
    .getByTestId("receive-entry-recovery")
    .isVisible()
    .catch(() => false);
  assert.equal(visible, false, `${label}: must not show Scan a location QR`);
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

  await page.getByRole("button", { name: new RegExp(job1Order) }).click();
  await page.getByTestId("vendor-mark-delivered").waitFor({ timeout: 45_000 });
  await waitForHash(page, (h) => /view=delivery/i.test(h), "order history URL");
  await assertNotRecovery(page, "order/delivery screen");

  console.log("Safari Back/Forward order ↔ job deliveries + leftover not under list");
  await page.goBack();
  await page.getByTestId("vendor-job-deliveries").waitFor({ timeout: 15_000 });
  await assertNotRecovery(page, "Safari Back to job deliveries");
  await page.goBack();
  await page.waitForTimeout(400);
  await assertNotRecovery(
    page,
    "Safari Back from job deliveries while PIN session is valid",
  );
  await page.goForward();
  await page.getByTestId("vendor-job-deliveries").waitFor({ timeout: 15_000 });
  await page.goForward();
  await page.getByTestId("vendor-mark-delivered").waitFor({ timeout: 15_000 });
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

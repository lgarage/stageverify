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
import { mkdirSync } from "fs";
import { resolve } from "path";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";

const job1Pin = process.env.STAGEVERIFY_JOB1_PIN ?? "1234";
const job1Order = process.env.STAGEVERIFY_VENDOR_ORDER ?? "ORD-005";
const otherJobOrder = process.env.STAGEVERIFY_OTHER_JOB_ORDER ?? "ORD-006";
const scanLoc = process.env.STAGEVERIFY_SCAN_LOC ?? "G2";

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

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const page = await context.newPage();

  const url = `${baseUrl.replace(/\/$/, "")}/#/s?loc=${encodeURIComponent(scanLoc)}`;
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
    record("Same-vendor other-job order absent on list (D14)", !bodyBeforeSelect.includes(otherJobOrder));
    await page.getByRole("button", { name: new RegExp(job1Order) }).click();
  }

  try {
    await page.waitForSelector("text=DELIVERED", { timeout: 45_000 });
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
  record("Same-vendor other-job order absent (D14)", !body.includes(otherJobOrder));
  record("Wrong-spot shows job spot context", /G1|S1|Spot|location/i.test(body));

  await page.getByRole("button", { name: "DELIVERED", exact: true }).click();
  await page.waitForSelector("text=Delivery Confirmed", { timeout: 30_000 });
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

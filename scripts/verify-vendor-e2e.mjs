/**
 * Playwright E2E: full vendor delivery workflow validation.
 *
 * Covers: PIN auth, partial/damaged/missing qty, Need More Space, session timeout,
 * check-in submit, dispatcher visibility.
 *
 * Usage:
 *   npm run dev
 *   npm run verify:vendor-e2e
 *   npm run verify:vendor-e2e:prod
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  ensureAuthenticated,
  loadEnvLocal,
  openDeliveryDrawer,
} from "./dispatcherVerifyHelpers.mjs";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);

const deliveryId =
  process.env.STAGEVERIFY_RECEIVE_DELIVERY ?? "delivery-demo-vendor-1";
const orderNumber = process.env.STAGEVERIFY_VENDOR_ORDER ?? "ORD-005";
const correctPin = process.env.STAGEVERIFY_VENDOR_PIN ?? "1234";
const wrongPin = "0000";
const SESSION_KEY = `sv-vendor-pin:${deliveryId}`;
const SESSION_MS = 15 * 60 * 1000;

const outDir = resolve(process.cwd(), "screenshots", "vendor-e2e");
mkdirSync(outDir, { recursive: true });
const authState = resolve(process.cwd(), "playwright/.auth/state.json");
loadEnvLocal();

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

async function unlockWithPin(page) {
  await page.waitForSelector("text=Enter Vendor PIN", { timeout: 30_000 });
  await enterPin(page, correctPin);
  await page.waitForSelector(`text=${orderNumber}`, { timeout: 30_000 });
}

async function runVendorFlow(page) {
  const url = `${appBase}/#/receive?id=${deliveryId}`;
  console.log(`Opening ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });

  // --- PIN: wrong then correct ---
  await page.waitForSelector("text=Enter Vendor PIN", { timeout: 30_000 });
  await shot(page, "01-pin-gate");
  await enterPin(page, wrongPin);
  await page.waitForSelector("text=Invalid code", { timeout: 15_000 });
  record("PIN rejects wrong code", true);
  await shot(page, "02-wrong-pin");

  await page.waitForTimeout(800);
  await enterPin(page, correctPin);
  await page.waitForSelector(`text=${orderNumber}`, { timeout: 30_000 });
  await page.waitForSelector("text=Filter rack", { timeout: 15_000 });
  record("PIN unlocks delivery", true);
  await shot(page, "03-items-loaded");

  // --- Session timeout (before qty edits so state is not lost) ---
  await page.evaluate(
    ({ key, ms, id }) => {
      const expired = {
        deliveryId: id,
        vendorId: "vendor-1",
        vendorName: "Johnstone Supply",
        lastActivityAt: Date.now() - ms - 60_000,
      };
      sessionStorage.setItem(key, JSON.stringify(expired));
    },
    { key: SESSION_KEY, ms: SESSION_MS, id: deliveryId },
  );
  await page.waitForSelector("text=Enter Vendor PIN", { timeout: 45_000 });
  record("Session timeout re-prompts PIN", true);
  await shot(page, "04-session-expired");
  await unlockWithPin(page);

  // --- Check off + partial + damaged + missing ---
  await page
    .getByRole("button", { name: "Toggle Air handler 3-ton horizontal" })
    .click();

  const filterAdjust = page
    .locator("text=Filter rack 16x25 MERV 11")
    .locator("xpath=ancestor::div[contains(@class,'rounded-xl')]")
    .getByRole("button", { name: "Adjust" });
  await filterAdjust.click();
  await page.waitForSelector("text=Adjust Quantity", { timeout: 10_000 });

  const minusBtn = page.locator(".stepper-btn").first();
  await minusBtn.click();
  await minusBtn.click();
  await page.locator('input[type="number"]').fill("1");
  await page.getByRole("button", { name: "Save" }).click();

  await page.waitForSelector("text=Partial Delivery", { timeout: 10_000 });
  await page.waitForSelector("text=1 damaged", { timeout: 10_000 });
  await page.waitForSelector("text=Partial order", { timeout: 10_000 });
  record("Partial delivery with damaged qty", true);
  await shot(page, "05-partial-damaged");

  // BAS controller left unchecked → missing qty on submit
  await page.getByRole("button", { name: "Next: Assign Zone" }).click();
  await page.waitForSelector("text=Assign Staging Zone", { timeout: 30_000 });
  const zoneButton = (code) =>
    page.locator("button").filter({
      has: page.getByText(code, { exact: true }),
    });
  await zoneButton("G1").first().waitFor({ state: "visible", timeout: 30_000 });
  record("Zone assignment step reachable", true);
  await shot(page, "06-zone-step");

  const zoneCodes = ["G1", "G2", "S1-A", "S2-A", "G4", "G5"];
  let zoneCount = 0;
  for (const code of zoneCodes) {
    if (await zoneButton(code).first().isVisible().catch(() => false)) {
      zoneCount += 1;
    }
  }

  // --- Need More Space (requires a selected zone) ---
  if (zoneCount > 0) {
    let pickedZone = false;
    for (const code of zoneCodes) {
      const btn = zoneButton(code).first();
      if (!(await btn.isVisible().catch(() => false))) continue;
      const label = await btn.innerText();
      if (/In use/i.test(label)) continue;
      await btn.click();
      pickedZone = true;
      break;
    }
    if (!pickedZone) {
      await zoneButton("G1").first().click();
    }
    const needSpace = page.getByRole("button", { name: "Need More Space?" });
    await needSpace.waitFor({ state: "visible", timeout: 10_000 });
    await needSpace.click();
    await page.getByText("Loading locations").waitFor({
      state: "hidden",
      timeout: 30_000,
    });
    const needMorePanel = await page
      .getByText("Need more space?", { exact: true })
      .isVisible()
      .catch(() => false);
    const noLarger = await page
      .getByText("No larger spots available")
      .isVisible()
      .catch(() => false);
    record(
      "Need More Space workflow opens",
      needMorePanel || noLarger,
      needMorePanel
        ? "spot suggestions shown"
        : noLarger
          ? "no larger spots (valid outcome)"
          : "panel did not resolve",
    );
    await shot(page, "07-need-more-space");
  } else {
    record("Need More Space workflow opens", false, "no available staging zones");
  }

  // Clear zone selection before submit (avoids stale local selection if persist failed)
  await page.getByRole("button", { name: "Skip (no zone)" }).click();
  await page.waitForTimeout(1500);

  await page.getByRole("button", { name: "Submit Check-in →" }).waitFor({
    state: "visible",
    timeout: 10_000,
  });
  await page.waitForFunction(
    () => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Submit Check-in"),
      );
      return btn && !btn.disabled;
    },
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: "Submit Check-in →" }).click();
  await page.waitForSelector("text=Check-in Complete", { timeout: 30_000 });
  await page.waitForSelector("text=Recorded as partial order", { timeout: 10_000 });
  record("Submit check-in completes as partial", true);
  await shot(page, "08-checkin-complete");

  const bodyAfter = await page.locator("body").innerText();
  record(
    "Missing materials reflected in summary",
    /2 items received|item.*received/i.test(bodyAfter),
    "unchecked BAS controller counts as missing on submit",
  );
}

async function runDispatcherVisibility(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const page = await context.newPage();

  await ensureAuthenticated(page, appBase);
  await openDeliveryDrawer(page, orderNumber, deliveryId);

  const body = await page.locator("body").innerText();
  const hasPartial = /Partial/i.test(body);
  const hasMissing = /Missing/i.test(body);
  record(
    "Dispatcher shows partial delivery",
    hasPartial,
    hasPartial ? "" : "Partial status not visible in drawer",
  );
  record(
    "Dispatcher shows missing qty",
    hasMissing,
    hasMissing ? "" : "Missing column not visible",
  );
  await shot(page, "09-dispatcher-drawer");
  await context.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  const vendorContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const vendorPage = await vendorContext.newPage();

  try {
    await runVendorFlow(vendorPage);
  } catch (err) {
    record("Vendor flow", false, err.message ?? String(err));
    await shot(vendorPage, "error-vendor-flow");
  }
  await vendorContext.close();

  try {
    await runDispatcherVisibility(browser);
  } catch (err) {
    record("Dispatcher visibility", false, err.message ?? String(err));
  }

  await browser.close();

  console.log("\n--- Vendor E2E summary ---");
  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`  [${r.pass ? "ok" : "X"}] ${r.name}${r.detail ? `: ${r.detail}` : ""}`);
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

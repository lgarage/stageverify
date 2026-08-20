/**
 * Vendor item presentation cleanup at a 390×844 mobile viewport.
 *
 * Usage:
 *   npm run dev
 *   node scripts/verify-vendor-item-display.mjs
 */
import { chromium } from "playwright";
import { resolve } from "node:path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  assertReadableTextContrast,
  VENDOR_RUN_ITEMS_CONTRAST_SPEC,
} from "./lib/ui-text-contrast-lib.mjs";

const baseUrl = process.env.STAGEVERIFY_BASE_URL ?? "http://127.0.0.1:5173";
const appBase = resolveAppBase(baseUrl);
const pin = process.env.STAGEVERIFY_VENDOR_ITEM_PIN ?? "9876";
const loc = process.env.STAGEVERIFY_SIGN_LOC ?? "G1";

async function enterPin(page) {
  for (const digit of pin) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.getByTestId("location-scan-pin-verify").click();
}

async function expandOrder(page, orderNumber) {
  const row = page
    .locator('[data-testid^="vendor-run-row-"]')
    .filter({ hasText: orderNumber })
    .first();
  await row.waitFor({ state: "visible", timeout: 45_000 });
  const details = row.locator('div[data-testid^="vendor-run-details-"]').first();
  if (!(await details.isVisible().catch(() => false))) {
    await row.locator('[data-testid^="vendor-run-toggle-"]').click();
  }
  await details.waitFor({ state: "visible", timeout: 15_000 });
  await details.getByTestId("vendor-item-title").first().waitFor();
  return { row, details };
}

function assertNoiseRemoved(text, label) {
  if (/\$|\b\d+\.\d{2}\b/.test(text)) {
    throw new Error(`${label}: price noise remains`);
  }
  if (
    /If you have any questions|Remit To|billtrust|Signature Proof|ENROLLMENT TOKEN/i.test(
      text,
    )
  ) {
    throw new Error(`${label}: invoice footer remains`);
  }
}

async function assertNoItemOverflow(details, label) {
  const overflow = await details
    .locator(
      '[data-testid="vendor-item-title"], [data-testid="vendor-item-spec"], [data-testid="vendor-item-qty"]',
    )
    .evaluateAll((elements) =>
      elements.some((element) => element.scrollWidth > element.clientWidth + 1),
    );
  if (overflow) {
    throw new Error(`${label}: vendor item text overflows its card`);
  }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

try {
  await page.goto(
    `${appBase}/#/s?loc=${encodeURIComponent(loc)}&_t=${Date.now()}`,
    { waitUntil: "domcontentloaded", timeout: 45_000 },
  );
  await page.getByTestId("location-scan-pin-keypad").waitFor({ timeout: 30_000 });
  await enterPin(page);
  await page.getByTestId("vendor-run-layout").waitFor({ timeout: 45_000 });

  const controller = await expandOrder(page, "6166261");
  const controllerText = await controller.details.innerText();
  assertNoiseRemoved(controllerText, "6166261");
  if (!controllerText.includes("210MN")) {
    throw new Error("6166261: model 210MN missing");
  }
  if (!/\bQty \d+\b/.test(controllerText)) {
    throw new Error("6166261: Qty label missing");
  }
  await assertNoItemOverflow(controller.details, "6166261");
  await assertReadableTextContrast(page, VENDOR_RUN_ITEMS_CONTRAST_SPEC);
  await page.waitForTimeout(300);
  await page.screenshot({
    path: resolve(process.cwd(), "after-vendor-run-expanded.png"),
    fullPage: false,
  });
  console.log("PASS: 6166261 strips prices/footer and keeps 210MN + Qty");

  const filter = await expandOrder(page, "6169414");
  const filterText = await filter.details.innerText();
  assertNoiseRemoved(filterText, "6169414");
  for (const token of ["ZLP20242", "MERV"]) {
    if (!filterText.includes(token)) {
      throw new Error(`6169414: ${token} missing`);
    }
  }
  if (!/\bQty 7\b/.test(filterText)) {
    throw new Error("6169414: Qty 7 missing");
  }
  await assertNoItemOverflow(filter.details, "6169414");
  console.log("PASS: 6169414 keeps ZLP20242 + MERV + Qty 7");
  console.log("PASS: vendor item title/spec/qty meet D-42 contrast");
} finally {
  await browser.close();
}

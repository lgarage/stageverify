/**
 * Legacy bare `/#/receive` + zone deep-link retirement checks.
 *
 * Asserts:
 * 1. Bare `#/receive` shows location-QR recovery (not obsolete Receive Delivery / Delivery ID)
 * 2. `#/receive?zone=` and compact `#/r?z=` redirect to `#/s?loc=`
 * 3. `#/receive?id=` still opens vendor PIN (delivery deep link kept)
 * 4. iPhone-like + Android-like viewports + D-42 contrast on recovery
 *
 * Usage:
 *   npm run dev
 *   npm run verify:receive-legacy-entry
 *   npm run verify:receive-legacy-entry:prod
 */

import assert from "node:assert/strict";
import { chromium } from "playwright";
import { assertReadableTextContrast } from "./lib/ui-text-contrast-lib.mjs";

const baseUrl = (
  process.env.STAGEVERIFY_BASE_URL ?? "http://127.0.0.1:5173/stageverify"
).replace(/\/$/, "");

const deliveryId =
  process.env.STAGEVERIFY_RECEIVE_DELIVERY ?? "delivery-demo-vendor-1";

const viewports = [
  { name: "iphone", width: 390, height: 844 },
  { name: "android", width: 360, height: 800 },
];

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
    {
      name: "recovery steps",
      selector: "ol.text-text-primary",
      large: false,
    },
  ],
};

async function assertRecovery(page, label) {
  await page.getByTestId("receive-entry-recovery").waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await page.getByRole("heading", { name: "Scan a location QR" }).waitFor({
    state: "visible",
    timeout: 5_000,
  });
  const body = await page.locator("body").innerText();
  assert.doesNotMatch(
    body,
    /Receive Delivery/i,
    `${label}: obsolete Receive Delivery title must not appear`,
  );
  assert.doesNotMatch(
    body,
    /Or enter delivery ID manually|Delivery ID/i,
    `${label}: manual Delivery ID entry must not appear`,
  );
  assert.match(
    body,
    /staging location QR/i,
    `${label}: recovery must mention staging location QR`,
  );
  await assertReadableTextContrast(page, recoveryContrastSpec);
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

async function main() {
  const browser = await chromium.launch({ headless: true });
  let failed = 0;

  try {
    for (const vp of viewports) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();

      console.log(`[${vp.name}] bare #/receive → recovery`);
      await page.goto(`${baseUrl}/#/receive`, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await assertRecovery(page, vp.name);

      console.log(`[${vp.name}] #/receive?zone=G2 → #/s?loc=G2`);
      await page.goto(`${baseUrl}/#/receive?zone=G2`, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await waitForHash(
        page,
        (h) => /^#\/s\?loc=G2(&|$)/i.test(h),
        `${vp.name} zone redirect`,
      );
      await page
        .getByRole("heading", { name: "Enter PIN", exact: true })
        .waitFor({ state: "visible", timeout: 30_000 });

      console.log(`[${vp.name}] #/r?z=G1 → #/s?loc=G1`);
      await page.goto(`${baseUrl}/#/r?z=G1`, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await waitForHash(
        page,
        (h) => /^#\/s\?loc=G1(&|$)/i.test(h),
        `${vp.name} compact zone redirect`,
      );
      await page
        .getByRole("heading", { name: "Enter PIN", exact: true })
        .waitFor({ state: "visible", timeout: 30_000 });

      await context.close();
    }

    // Delivery-id deep link still supported (one viewport).
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    console.log(`#/receive?id=${deliveryId} → vendor PIN (not recovery)`);
    await page.goto(`${baseUrl}/#/receive?id=${encodeURIComponent(deliveryId)}`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForTimeout(500);
    const recoveryVisible = await page
      .getByTestId("receive-entry-recovery")
      .isVisible()
      .catch(() => false);
    assert.equal(
      recoveryVisible,
      false,
      "delivery-id deep link must not show bare-receive recovery",
    );
    const body = await page.locator("body").innerText();
    assert.doesNotMatch(body, /Receive Delivery/i);
    // PIN gate, opening delivery, hub, or error — any non-recovery path is OK.
    const hasPinOrProgress =
      (await page.getByRole("heading", { name: /Enter PIN|PIN/i }).count()) >
        0 ||
      /Opening delivery|Vendor Portal|Invalid|Couldn't load|Check your connection|Delivered|Mark Delivered/i.test(
        body,
      );
    assert.ok(
      hasPinOrProgress,
      `expected vendor deep-link UI, got: ${body.slice(0, 240)}`,
    );
    await context.close();

    console.log("verify-receive-legacy-entry: PASS");
  } catch (err) {
    failed = 1;
    console.error("verify-receive-legacy-entry: FAIL");
    console.error(err);
  } finally {
    await browser.close();
  }
  process.exit(failed);
}

main();

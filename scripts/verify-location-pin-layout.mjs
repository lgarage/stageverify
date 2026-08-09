/**
 * Location-scan neutral PIN layout + state verification (no role selector).
 *
 * Usage:
 *   npm run dev
 *   node scripts/verify-location-pin-layout.mjs
 */

import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { assertReadableTextContrast } from "./lib/ui-text-contrast-lib.mjs";

const baseUrl =
  process.env.STAGEVERIFY_BASE_URL ??
  "http://127.0.0.1:5173/stageverify";
const outDir = resolve(process.cwd(), "screenshots", "neutral-pin");
mkdirSync(outDir, { recursive: true });

const viewports = [
  { name: "320", width: 320, height: 568, screenshot: true },
  { name: "390-short", width: 390, height: 664 },
  { name: "390", width: 390, height: 844, screenshot: true },
  { name: "430", width: 430, height: 932, screenshot: true },
];

const contrastSpec = {
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
    {
      name: "PIN helper",
      selector: '[data-testid="location-scan-pin-card"] h1 + p',
    },
    {
      name: "keypad digit",
      selector:
        '[data-testid="location-scan-pin-keypad"] button:not([aria-label])',
      large: true,
    },
    {
      name: "Verify",
      selector: '[data-testid="location-scan-pin-verify"]',
    },
  ],
};

async function newMobilePage(browser, width = 390, height = 844) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  return { context, page: await context.newPage() };
}

async function openNeutralPin(page) {
  const url = `${baseUrl.replace(/\/$/, "")}/#/s?loc=G1&_t=${Date.now()}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page
    .getByRole("heading", { name: "Enter PIN", exact: true })
    .waitFor({ state: "visible", timeout: 30_000 });
  await page.getByTestId("location-scan-pin-card").waitFor({
    state: "visible",
    timeout: 10_000,
  });
  await page.waitForTimeout(150);
}

async function enterPin(page, pin) {
  for (const digit of pin) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
}

async function assertNeutralLayout(page, viewport) {
  const layout = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`${selector} missing`);
      const box = element.getBoundingClientRect();
      return {
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        left: box.left,
        width: box.width,
        height: box.height,
      };
    };
    if (document.querySelector('[data-testid="pin-role-selector"]')) {
      throw new Error("role selector must be removed");
    }
    const bodyText = document.body.innerText;
    for (const banned of [
      "Technician Pickup",
      "Enter Technician PIN",
      "Vendor PIN",
      "Enter Job or Company PIN",
    ]) {
      if (bodyText.includes(banned)) {
        throw new Error(`role-specific wording still present: ${banned}`);
      }
    }
    return {
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      header: rect('[data-testid="location-scan-pin-header"]'),
      card: rect('[data-testid="location-scan-pin-card"]'),
      keypadButton: rect(
        '[data-testid="location-scan-pin-keypad"] button:not([aria-label])',
      ),
      verify: rect('[data-testid="location-scan-pin-verify"]'),
    };
  });

  const gap = layout.card.top - layout.header.bottom;
  const minimumGap = viewport.height <= 600 ? 10 : 16;
  assert.ok(
    gap >= minimumGap && gap <= 38,
    `${viewport.name}: header-to-card gap is ${gap.toFixed(1)}px`,
  );
  assert.ok(
    layout.verify.top >= 0 && layout.verify.bottom <= layout.viewportHeight + 1,
    `${viewport.name}: Verify is outside viewport (${layout.verify.bottom.toFixed(
      1,
    )}/${layout.viewportHeight})`,
  );
  assert.ok(
    layout.card.left >= -1 && layout.card.right <= layout.viewportWidth + 1,
    `${viewport.name}: PIN card overflows horizontally`,
  );
  assert.ok(
    layout.documentScrollWidth <= layout.viewportWidth,
    `${viewport.name}: document overflows horizontally`,
  );
  assert.ok(
    layout.keypadButton.width >= 52 &&
      layout.keypadButton.width <= 69 &&
      Math.abs(layout.keypadButton.width - layout.keypadButton.height) < 1,
    `${viewport.name}: keypad button is ${layout.keypadButton.width.toFixed(1)}px`,
  );

  await assertReadableTextContrast(page, contrastSpec);
  return { ...layout, gap };
}

function assertStandaloneContract() {
  const receivingSource = readFileSync(
    resolve(process.cwd(), "src", "ReceivingPage.tsx"),
    "utf8",
  );
  const gateSource = readFileSync(
    resolve(process.cwd(), "src", "VendorPinGate.tsx"),
    "utf8",
  );
  const receivingGate = receivingSource.match(
    /<VendorPinGate[\s\S]*?onCancel=\{resetFlow\}[\s\S]*?\/>/,
  )?.[0];
  assert.ok(receivingGate, "ReceivingPage standalone VendorPinGate missing");
  assert.doesNotMatch(
    receivingGate,
    /\bembedded\b/,
    "ReceivingPage must keep the default standalone shell",
  );
  assert.match(
    gateSource,
    /embedded = false/,
    "VendorPinGate embedded mode must default to false",
  );
  assert.match(
    gateSource,
    /min-h-\[100svh\][\s\S]*justify-center/,
    "VendorPinGate standalone full-viewport centered shell missing",
  );
}

const browser = await chromium.launch({ headless: true });

try {
  assertStandaloneContract();

  for (const viewport of viewports) {
    const { context, page } = await newMobilePage(
      browser,
      viewport.width,
      viewport.height,
    );
    await openNeutralPin(page);
    const layout = await assertNeutralLayout(page, viewport);
    if (viewport.screenshot) {
      const path = resolve(outDir, `after-neutral-pin-${viewport.name}.png`);
      await page.screenshot({ path, fullPage: false });
      console.log(`screenshot: ${path}`);
    }
    console.log(
      `PASS ${viewport.width}x${viewport.height}: gap=${layout.gap.toFixed(
        1,
      )}px keypad=${layout.keypadButton.width.toFixed(
        1,
      )}px verifyBottom=${layout.verify.bottom.toFixed(1)}px`,
    );
    await context.close();
  }

  {
    const { context, page } = await newMobilePage(browser);
    await openNeutralPin(page);
    await enterPin(page, "1234");
    assert.equal(
      await page.getByTestId("location-scan-pin-verify").isEnabled(),
      true,
      "Verify should be enabled after four digits",
    );
    await page.screenshot({
      path: resolve(outDir, "after-neutral-pin-390-4-digit.png"),
      fullPage: false,
    });
    await assertReadableTextContrast(page, contrastSpec);
    await context.close();
  }

  {
    const { context, page } = await newMobilePage(browser);
    await page.route("**/resolveLocationScanPin*", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await new Promise(() => {});
    });
    await openNeutralPin(page);
    await enterPin(page, "1234");
    await page.getByTestId("location-scan-pin-verify").click();
    await page
      .getByTestId("location-scan-pin-verifying")
      .waitFor({ state: "visible", timeout: 5_000 });
    await page.screenshot({
      path: resolve(outDir, "after-neutral-pin-390-verifying.png"),
      fullPage: false,
    });
    await context.close();
  }

  {
    const { context, page } = await newMobilePage(browser);
    await page.route("**/resolveLocationScanPin*", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          result: { success: false, message: "Invalid code." },
        }),
      });
    });
    await openNeutralPin(page);
    await enterPin(page, "1234");
    await page.getByTestId("location-scan-pin-verify").click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Invalid code." })
      .waitFor({ state: "visible", timeout: 10_000 });
    await page.screenshot({
      path: resolve(outDir, "after-neutral-pin-390-invalid.png"),
      fullPage: false,
    });
    await context.close();
  }

  console.log(
    "PASS: Neutral location-scan PIN layout, states, and standalone VendorPinGate contract verified.",
  );
} finally {
  await browser.close();
}

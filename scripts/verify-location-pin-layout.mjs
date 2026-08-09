/**
 * Location-scan embedded Vendor PIN responsive layout + state verification.
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
const outDir = resolve(process.cwd(), "screenshots", "pin-followup");
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
      name: "selected Vendor role",
      selector: '[data-testid="pin-role-selector"] button[aria-pressed="true"]',
    },
    {
      name: "unselected role",
      selector: '[data-testid="pin-role-selector"] button[aria-pressed="false"]',
    },
    {
      name: "Vendor PIN heading",
      selector: '[data-testid="vendor-pin-card"] h1',
      large: true,
    },
    {
      name: "Vendor PIN helper",
      selector: '[data-testid="vendor-pin-card"] h1 + p',
    },
    {
      name: "Vendor keypad digit",
      selector: '[data-testid="vendor-pin-keypad"] button:not([aria-label])',
      large: true,
    },
    {
      name: "Vendor Verify",
      selector: '[data-testid="vendor-pin-verify"]',
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

async function openVendorPin(page) {
  const url = `${baseUrl.replace(/\/$/, "")}/#/s?loc=G1&_t=${Date.now()}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page
    .getByRole("heading", {
      name: "Enter Job or Company PIN",
      exact: true,
    })
    .waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(150);
}

async function enterPin(page, pin) {
  for (const digit of pin) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
}

function parseRgba(color) {
  const values = color.match(/-?[\d.]+/g)?.map(Number) ?? [];
  assert.ok(values.length >= 3, `Unable to parse color: ${color}`);
  // Chromium may report Tailwind white-alpha as oklab(L a b / alpha).
  if (color.startsWith("oklab(")) {
    const lightness = values[0];
    const alpha = values[3] ?? 1;
    const nearWhite = lightness >= 0.95;
    return {
      red: nearWhite ? 255 : Math.round(lightness * 255),
      green: nearWhite ? 255 : Math.round(lightness * 255),
      blue: nearWhite ? 255 : Math.round(lightness * 255),
      alpha,
      space: "oklab",
    };
  }
  const channelScale = color.startsWith("color(srgb") ? 255 : 1;
  return {
    red: values[0] * channelScale,
    green: values[1] * channelScale,
    blue: values[2] * channelScale,
    alpha: values[3] ?? 1,
    space: "rgb",
  };
}

async function assertEmbeddedLayout(page, viewport) {
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
    const selectorElement = document.querySelector(
      '[data-testid="pin-role-selector"]',
    );
    if (!selectorElement) throw new Error("role selector missing");
    const roles = [
      ...selectorElement.querySelectorAll("button"),
    ].map((element) => {
      const style = getComputedStyle(element);
      return {
        text: element.textContent?.trim() ?? "",
        color: style.color,
        background: style.backgroundColor,
      };
    });
    return {
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      selector: rect('[data-testid="pin-role-selector"]'),
      selectorBackground: getComputedStyle(selectorElement).backgroundColor,
      card: rect('[data-testid="vendor-pin-card"]'),
      keypadButton: rect(
        '[data-testid="vendor-pin-keypad"] button:not([aria-label])',
      ),
      verify: rect('[data-testid="vendor-pin-verify"]'),
      roles,
    };
  });

  const selectorBackground = parseRgba(layout.selectorBackground);
  assert.equal(
    selectorBackground.red,
    255,
    `${viewport.name}: selector track is not a white-alpha surface`,
  );
  assert.equal(selectorBackground.green, 255);
  assert.equal(selectorBackground.blue, 255);
  assert.ok(
    selectorBackground.alpha > 0 && selectorBackground.alpha <= 0.08,
    `${viewport.name}: selector track alpha is ${selectorBackground.alpha}`,
  );

  const selectedRole = layout.roles.find((role) => role.text === "Vendor");
  assert.ok(selectedRole, `${viewport.name}: selected Vendor role missing`);
  assert.equal(
    selectedRole.background,
    "rgb(29, 78, 216)",
    `${viewport.name}: selected Vendor chip is not clear blue`,
  );
  for (const role of layout.roles.filter((item) => item.text !== "Vendor")) {
    assert.equal(
      parseRgba(role.background).alpha,
      0,
      `${viewport.name}: ${role.text} has an overlay background`,
    );
  }

  const gap = layout.card.top - layout.selector.bottom;
  assert.ok(
    gap >= 6 && gap <= 18,
    `${viewport.name}: selector-to-card gap is ${gap.toFixed(1)}px`,
  );
  assert.ok(
    layout.verify.top >= 0 && layout.verify.bottom <= layout.viewportHeight + 1,
    `${viewport.name}: Verify is outside viewport (${layout.verify.bottom.toFixed(
      1,
    )}/${layout.viewportHeight})`,
  );
  assert.ok(
    layout.card.left >= -1 && layout.card.right <= layout.viewportWidth + 1,
    `${viewport.name}: Vendor PIN card overflows horizontally`,
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
    await openVendorPin(page);
    const layout = await assertEmbeddedLayout(page, viewport);
    if (viewport.screenshot) {
      const path = resolve(
        outDir,
        `after-vendor-pin-${viewport.name}.png`,
      );
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
    await openVendorPin(page);
    await enterPin(page, "1234");
    assert.equal(
      await page.getByTestId("vendor-pin-verify").isEnabled(),
      true,
      "Verify should be enabled after four digits",
    );
    await page.screenshot({
      path: resolve(outDir, "after-vendor-pin-390-4-digit.png"),
      fullPage: false,
    });
    await assertReadableTextContrast(page, contrastSpec);
    await context.close();
  }

  {
    const { context, page } = await newMobilePage(browser);
    await page.route("**/verifyVendorPin*", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await new Promise(() => {});
    });
    await openVendorPin(page);
    await enterPin(page, "1234");
    await page.getByTestId("vendor-pin-verify").click();
    await page
      .getByTestId("vendor-pin-verifying")
      .waitFor({ state: "visible", timeout: 5_000 });
    await page.screenshot({
      path: resolve(outDir, "after-vendor-pin-390-verifying.png"),
      fullPage: false,
    });
    await context.close();
  }

  {
    const { context, page } = await newMobilePage(browser);
    await page.route("**/verifyVendorPin*", async (route) => {
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
    await openVendorPin(page);
    await enterPin(page, "1234");
    await page.getByTestId("vendor-pin-verify").click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Invalid code." })
      .waitFor({ state: "visible", timeout: 10_000 });
    await page.screenshot({
      path: resolve(outDir, "after-vendor-pin-390-invalid.png"),
      fullPage: false,
    });
    await context.close();
  }

  console.log(
    "PASS: Location Vendor PIN embedded layout, states, and standalone contract verified.",
  );
} finally {
  await browser.close();
}

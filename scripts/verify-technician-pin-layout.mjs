/**
 * Technician Pickup PIN responsive layout + visual-state verification.
 *
 * Usage:
 *   npm run dev
 *   node scripts/verify-technician-pin-layout.mjs
 *
 * (Not wired in package.json scripts — keep this PR fast-safe UI-only.)
 */

import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { assertReadableTextContrast } from "./lib/ui-text-contrast-lib.mjs";

const baseUrl =
  process.env.STAGEVERIFY_BASE_URL ??
  "http://127.0.0.1:5173/stageverify";
const outDir = resolve(
  process.cwd(),
  "screenshots",
  "tech-pin-polish",
);
mkdirSync(outDir, { recursive: true });

const viewports = [
  { name: "320", width: 320, height: 568, screenshot: true },
  { name: "375-short", width: 375, height: 664 },
  { name: "390-short", width: 390, height: 664 },
  { name: "390", width: 390, height: 844, screenshot: true },
  { name: "430", width: 430, height: 932, screenshot: true },
];

const contrastSpec = {
  rootSelector: "body",
  elements: [
    {
      name: "selected role",
      selector: '[data-testid="pin-role-selector"] button[aria-pressed="true"]',
    },
    {
      name: "unselected role",
      selector: '[data-testid="pin-role-selector"] button[aria-pressed="false"]',
    },
    {
      name: "PIN heading",
      selector: '[data-testid="technician-pin-card"] h1',
      large: true,
    },
    {
      name: "PIN helper",
      selector: '[data-testid="technician-pin-card"] h1 + p',
    },
    {
      name: "keypad digit",
      selector:
        '[data-testid="technician-pin-keypad"] button:not([aria-label])',
      large: true,
    },
  ],
};

async function openTechnicianPin(page) {
  const url = `${baseUrl.replace(/\/$/, "")}/#/s?loc=G1&_t=${Date.now()}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  const technician = page.getByRole("button", {
    name: "Technician",
    exact: true,
  });
  await technician.waitFor({ state: "visible", timeout: 30_000 });
  await technician.click();
  await page
    .getByRole("heading", { name: "Enter Technician PIN", exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(150);
}

async function enterPin(page, pin) {
  for (const digit of pin) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
}

async function assertResponsiveLayout(page, viewport) {
  const layout = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      assertElement(element, selector);
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
    const assertElement = (element, selector) => {
      if (!element) throw new Error(`${selector} missing`);
    };
    const roles = [
      ...document.querySelectorAll(
        '[data-testid="pin-role-selector"] button',
      ),
    ].map((element) => {
      const box = element.getBoundingClientRect();
      return {
        text: element.textContent?.trim() ?? "",
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        color: getComputedStyle(element).color,
        background: getComputedStyle(element).backgroundColor,
      };
    });
    const shell = document.querySelector(
      '[data-testid="technician-pin-shell"]',
    );
    assertElement(shell, "technician PIN shell");
    return {
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      selector: rect('[data-testid="pin-role-selector"]'),
      card: rect('[data-testid="technician-pin-card"]'),
      keypadButton: rect(
        '[data-testid="technician-pin-keypad"] button:not([aria-label])',
      ),
      verify: rect('[data-testid="technician-pin-verify"]'),
      roles,
      shellClientHeight: shell.clientHeight,
      shellScrollHeight: shell.scrollHeight,
    };
  });

  assert.ok(layout.roles.length >= 2, `${viewport.name}: role tabs missing`);
  for (const role of layout.roles) {
    assert.ok(
      role.left >= layout.selector.left - 1 &&
        role.right <= layout.selector.right + 1,
      `${viewport.name}: ${role.text} overflows role selector`,
    );
    assert.ok(
      role.color !== "rgba(0, 0, 0, 0)",
      `${viewport.name}: ${role.text} has no readable text color`,
    );
  }
  for (let index = 1; index < layout.roles.length; index += 1) {
    assert.ok(
      layout.roles[index - 1].right <= layout.roles[index].left,
      `${viewport.name}: role tabs overlap`,
    );
  }
  assert.ok(
    layout.card.top - layout.selector.bottom <= 18,
    `${viewport.name}: staging-to-card gap is ${Math.round(
      layout.card.top - layout.selector.bottom,
    )}px`,
  );
  assert.ok(
    layout.verify.top >= 0 && layout.verify.bottom <= layout.viewportHeight + 1,
    `${viewport.name}: Verify is outside viewport (${layout.verify.bottom.toFixed(
      1,
    )}/${layout.viewportHeight})`,
  );
  assert.ok(
    layout.card.right <= layout.viewportWidth + 1 && layout.card.left >= -1,
    `${viewport.name}: PIN card overflows horizontally`,
  );
  assert.ok(
    layout.keypadButton.width >= 52 &&
      layout.keypadButton.width <= 69 &&
      Math.abs(layout.keypadButton.width - layout.keypadButton.height) < 1,
    `${viewport.name}: keypad button is ${layout.keypadButton.width.toFixed(1)}px`,
  );
  // Vendor-like 8svh keypad floors at 52 on short phones; grows past 64 on tall.
  if (viewport.height >= 800) {
    assert.ok(
      layout.keypadButton.width > 64,
      `${viewport.name}: keypad did not grow beyond fixed 64px`,
    );
  }
  assert.ok(
    layout.shellScrollHeight <= layout.shellClientHeight + 1,
    `${viewport.name}: PIN shell unexpectedly scrolls (${layout.shellScrollHeight}/${layout.shellClientHeight})`,
  );

  await assertReadableTextContrast(page, contrastSpec);
  return layout;
}

async function newMobilePage(browser, width = 390, height = 844) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  return { context, page: await context.newPage() };
}

const browser = await chromium.launch({ headless: true });

try {
  for (const viewport of viewports) {
    const { context, page } = await newMobilePage(
      browser,
      viewport.width,
      viewport.height,
    );
    await openTechnicianPin(page);
    const layout = await assertResponsiveLayout(page, viewport);
    if (viewport.screenshot) {
      const path = resolve(
        outDir,
        `after-tech-pin-${viewport.name}.png`,
      );
      await page.screenshot({ path, fullPage: false });
      console.log(`screenshot: ${path}`);
    }
    console.log(
      `PASS ${viewport.width}x${viewport.height}: gap=${(
        layout.card.top - layout.selector.bottom
      ).toFixed(1)}px keypad=${layout.keypadButton.width.toFixed(
        1,
      )}px verifyBottom=${layout.verify.bottom.toFixed(1)}px`,
    );
    await context.close();
  }

  {
    const { context, page } = await newMobilePage(browser);
    await openTechnicianPin(page);
    await enterPin(page, "1234");
    assert.equal(
      await page
        .getByTestId("technician-pin-verify")
        .isEnabled(),
      true,
      "Verify should be enabled after four digits",
    );
    await page.screenshot({
      path: resolve(outDir, "after-tech-pin-390-4-digit.png"),
      fullPage: false,
    });
    await assertReadableTextContrast(page, {
      rootSelector: "body",
      elements: [
        ...contrastSpec.elements,
        {
          name: "enabled Verify",
          selector: '[data-testid="technician-pin-verify"]',
        },
      ],
    });
    await context.close();
  }

  {
    const { context, page } = await newMobilePage(browser);
    await page.route("**/verifyTechnicianPin*", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await new Promise(() => {});
    });
    await openTechnicianPin(page);
    await enterPin(page, "1234");
    await page.getByTestId("technician-pin-verify").click();
    await page
      .getByTestId("technician-pin-verifying")
      .waitFor({ state: "visible", timeout: 5_000 });
    await page.screenshot({
      path: resolve(outDir, "after-tech-pin-390-verifying.png"),
      fullPage: false,
    });
    await context.close();
  }

  {
    const { context, page } = await newMobilePage(browser);
    await page.route("**/verifyTechnicianPin*", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          data: { success: false, message: "Invalid code." },
        }),
      });
    });
    await openTechnicianPin(page);
    await enterPin(page, "1234");
    await page.getByTestId("technician-pin-verify").click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Invalid code." })
      .waitFor({ state: "visible", timeout: 10_000 });
    await page.screenshot({
      path: resolve(outDir, "after-tech-pin-390-invalid.png"),
      fullPage: false,
    });
    await context.close();
  }

  console.log("PASS: Technician PIN responsive layout and states verified.");
} finally {
  await browser.close();
}

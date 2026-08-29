/**
 * Catch-all quick sheet — phone viewports + desktop smoke.
 *
 * Usage:
 *   npm run dev
 *   node scripts/verify-catch-all-quick-sheet.mjs
 */

import { chromium } from "playwright";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  assertReadableTextContrast,
  MIN_TEXT_CONTRAST,
} from "./lib/ui-text-contrast-lib.mjs";
import { ensureAuthenticated, loadEnvLocal } from "./dispatcherVerifyHelpers.mjs";

loadEnvLocal();

const baseUrl =
  process.argv.find((a) => a.startsWith("--base-url="))?.split("=")[1] ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);

const CATCH_ALL_QUICK_SHEET_CONTRAST_SPEC = {
  rootSelector: '[data-testid="catch-all-quick-sheet"]',
  elements: [
    {
      name: "sheet title",
      selector: '[data-testid="catch-all-quick-sheet-title"]',
    },
    {
      name: "close button",
      selector: '[data-testid="catch-all-quick-sheet-close"]',
    },
    {
      name: "count line",
      selector: '[data-testid="catch-all-quick-sheet-count"]',
    },
    {
      name: "send alert",
      selector: '[data-testid="catch-all-quick-sheet-send-alert"]',
      optional: true,
    },
  ],
  minText: MIN_TEXT_CONTRAST,
};

const results = [];

function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const docOverflow = doc.scrollWidth > doc.clientWidth + 1;
    const panel = document.querySelector(
      '[data-testid="catch-all-quick-sheet-panel"]',
    );
    const panelOverflow = panel
      ? panel.scrollWidth > panel.clientWidth + 1
      : false;
    return { docOverflow, panelOverflow };
  });
  if (overflow.docOverflow || overflow.panelOverflow) {
    throw new Error(
      `${label}: horizontal overflow doc=${overflow.docOverflow} panel=${overflow.panelOverflow}`,
    );
  }
}

async function verifyDrawerCloseStripsOpenDelivery(page, appBase, width) {
  const btn = page.getByTestId("catch-all-delivery-btn");
  await btn.click();
  const sheet = page.getByTestId("catch-all-quick-sheet");
  await sheet.waitFor({ state: "visible", timeout: 10_000 });

  const row = page.getByTestId("catch-all-quick-sheet-row").first();
  const rowVisible = await row.isVisible().catch(() => false);

  if (rowVisible) {
    await row.click();
  } else {
    await page.getByTestId("catch-all-quick-sheet-close").click();
    await sheet.waitFor({ state: "detached", timeout: 10_000 });

    const deliveryId = await page.evaluate(() => {
      const badge = document.querySelector('[data-testid^="open-issue-badge-"]');
      const testId = badge?.getAttribute("data-testid") ?? "";
      const match = testId.match(/^open-issue-badge-(.+)$/);
      return match?.[1]?.trim() || null;
    });

    if (!deliveryId) {
      record(
        `${width}px: drawer close strips openDelivery`,
        false,
        "no catch-all row and no list delivery id for fallback",
      );
      return;
    }

    await page.goto(
      `${appBase}/#/dispatcher?openDelivery=${encodeURIComponent(deliveryId)}`,
      { waitUntil: "domcontentloaded", timeout: 45_000 },
    );
    await page.waitForTimeout(1500);
  }

  const drawer = page.getByTestId("delivery-detail-drawer");
  await drawer.waitFor({ state: "visible", timeout: 25_000 });
  record(`${width}px: delivery drawer opens from catch-all path`, true);

  const hashBefore = await page.evaluate(() => window.location.hash);
  record(
    `${width}px: openDelivery present before close`,
    hashBefore.includes("openDelivery"),
    hashBefore,
  );

  await page.getByTestId("delivery-drawer-close").click();
  await drawer.waitFor({ state: "detached", timeout: 10_000 });
  record(`${width}px: drawer closes on close button`, true);

  await page.waitForTimeout(500);
  const stillOpen = await drawer.isVisible().catch(() => false);
  record(
    `${width}px: drawer stays closed after 500ms`,
    !stillOpen,
    stillOpen ? "drawer re-opened" : "detached",
  );

  const hashAfter = await page.evaluate(() => window.location.hash);
  record(
    `${width}px: openDelivery stripped from hash`,
    !hashAfter.includes("openDelivery"),
    hashAfter,
  );
}

async function verifyPhoneViewport(browser, width) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  try {
    await ensureAuthenticated(page, appBase);
    await page.waitForTimeout(1500);

    const btn = page.getByTestId("catch-all-delivery-btn");
    await btn.waitFor({ state: "visible", timeout: 20_000 });
    record(`${width}px: catch-all button visible`, true);

    const badge = page.getByTestId("catch-all-delivery-count-badge");
    await badge.waitFor({ state: "visible", timeout: 10_000 });
    const badgeText = (await badge.textContent())?.trim() ?? "";
    record(`${width}px: badge visible`, /^\d+$/.test(badgeText), badgeText);

    let dialogSeen = false;
    page.on("dialog", () => {
      dialogSeen = true;
    });

    await btn.click();
    const sheet = page.getByTestId("catch-all-quick-sheet");
    await sheet.waitFor({ state: "visible", timeout: 10_000 });
    record(`${width}px: sheet opens on button click`, true);

    const countLine = page.getByTestId("catch-all-quick-sheet-count");
    const countText = (await countLine.textContent()) ?? "";
    const countMatch = countText.match(/^(\d+)\s/);
    const sheetCount = countMatch?.[1] ?? "";
    record(
      `${width}px: sheet count matches badge`,
      sheetCount === badgeText,
      `badge=${badgeText} sheet=${sheetCount}`,
    );

    await assertReadableTextContrast(page, CATCH_ALL_QUICK_SHEET_CONTRAST_SPEC);
    record(`${width}px: D-42 readable text contrast`, true);

    await assertNoHorizontalOverflow(page, `${width}px sheet open`);

    await page.getByTestId("catch-all-quick-sheet-close").click();
    await sheet.waitFor({ state: "detached", timeout: 10_000 });
    record(`${width}px: close hides sheet`, true);
    record(
      `${width}px: no notify dialog on open/close`,
      dialogSeen === false,
      dialogSeen ? "unexpected dialog" : "none",
    );

    const badgeAfter = (await badge.textContent())?.trim() ?? "";
    record(
      `${width}px: badge unchanged after close`,
      badgeAfter === badgeText,
      `before=${badgeText} after=${badgeAfter}`,
    );

    await verifyDrawerCloseStripsOpenDelivery(page, appBase, width);
  } finally {
    await context.close();
  }
}

async function verifyDesktop(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  try {
    await ensureAuthenticated(page, appBase);
    await page.waitForTimeout(1500);

    const btn = page.getByTestId("catch-all-delivery-btn");
    await btn.waitFor({ state: "visible", timeout: 20_000 });
    record("desktop 1280: catch-all button present", true);

    await btn.click();
    const sheet = page.getByTestId("catch-all-quick-sheet");
    await sheet.waitFor({ state: "visible", timeout: 10_000 });
    record("desktop 1280: shared sheet opens", true);

    await page.getByTestId("catch-all-quick-sheet-close").click();
    await sheet.waitFor({ state: "detached", timeout: 10_000 });
  } finally {
    await context.close();
  }
}

(async () => {
  console.log(`Catch-all quick sheet verify — ${appBase}`);
  const browser = await chromium.launch({ headless: true });

  try {
    for (const width of [360, 375, 390]) {
      await verifyPhoneViewport(browser, width);
    }
    await verifyDesktop(browser);
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    for (const f of failed) {
      console.error(`  FAIL: ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    }
    process.exit(1);
  }
  process.exit(0);
})();

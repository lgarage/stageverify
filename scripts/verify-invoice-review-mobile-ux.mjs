/**
 * Playwright: mobile Invoice Review cancel + decision confirm + card collapse.
 * Usage: npm run verify:invoice-review-mobile-ux
 */
import { chromium } from "playwright";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { confirmInvoiceReviewDecision } from "./lib/invoice-review-decision-confirm.mjs";
import {
  ensureAuthenticated,
  loadEnvLocal,
} from "./dispatcherVerifyHelpers.mjs";

loadEnvLocal();

const baseUrl =
  process.argv.find((a) => a.startsWith("--base-url="))?.slice("--base-url=".length) ??
  (process.argv.includes("--base-url")
    ? process.argv[process.argv.indexOf("--base-url") + 1]
    : undefined) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);

const VIEWPORTS = [
  { width: 360, height: 780 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
];

async function openInspect(page) {
  const openBtn = page.locator('[data-testid^="invoice-review-mobile-open-"]').first();
  if (await openBtn.isVisible().catch(() => false)) {
    await openBtn.click();
  } else {
    const toggle = page.locator('[data-testid^="invoice-review-mobile-toggle-"]').first();
    await toggle.click();
    await page.locator('[data-testid^="invoice-review-mobile-open-"]').first().click();
  }
  await page.getByTestId("invoice-parsed-inspect-modal").waitFor({ timeout: 10_000 });
}

async function runViewport(browser, viewport) {
  const context = await browser.newContext({
    viewport,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await ensureAuthenticated(page, appBase);
  await page.goto(`${appBase}/#/invoice-review`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.getByTestId("invoice-review-panel").waitFor({ timeout: 30_000 });
  const rows = page.locator('[data-testid^="invoice-review-queue-row-"]');
  const count = await rows.count();
  if (count === 0) {
    console.log(`${viewport.width}: SKIP no invoice rows`);
    await context.close();
    return;
  }
  const firstExpanded = await rows.first().getAttribute("data-expanded");
  if (firstExpanded !== "false") {
    throw new Error(`${viewport.width}: first invoice card should start collapsed`);
  }
  await openInspect(page);
  await page.getByTestId("invoice-parsed-inspect-cancel").waitFor({ timeout: 5000 });
  await page.getByTestId("invoice-parsed-inspect-reject").waitFor({ timeout: 5000 });
  await page.getByTestId("invoice-parsed-inspect-approve").waitFor({ timeout: 5000 });
  console.log(`${viewport.width}: PASS footer Cancel / Reject / Approve visible`);

  const approveBtn = page.getByTestId("invoice-parsed-inspect-approve");
  if (!(await approveBtn.isDisabled())) {
    await approveBtn.click();
    await page.getByTestId("invoice-review-decision-confirm").waitFor({ timeout: 5000 });
    const title = (await page.getByTestId("invoice-review-decision-confirm-title").innerText()).trim();
    if (!title.includes("Approve this invoice")) {
      throw new Error(`${viewport.width}: expected approve confirm title, got ${title}`);
    }
    if (await page.getByTestId("invoice-approve-fulfillment-choice").isVisible().catch(() => false)) {
      throw new Error(`${viewport.width}: fulfillment choice before confirm`);
    }
    await page.getByTestId("invoice-review-decision-confirm-cancel").click();
    await page.getByTestId("invoice-review-decision-confirm").waitFor({
      state: "hidden",
      timeout: 5000,
    });
    console.log(`${viewport.width}: PASS approve confirm cancel`);

    await approveBtn.click();
    await confirmInvoiceReviewDecision(page);
    await page.getByTestId("invoice-approve-fulfillment-choice").waitFor({ timeout: 5000 });
    await page.getByTestId("invoice-approve-fulfillment-cancel").click();
    console.log(`${viewport.width}: PASS approve confirm continues existing wizard`);
  } else {
    console.log(`${viewport.width}: SKIP approve confirm (disabled)`);
  }

  const rejectBtn = page.getByTestId("invoice-parsed-inspect-reject");
  if (await rejectBtn.isVisible().catch(() => false)) {
    await rejectBtn.click();
    await page.getByTestId("invoice-review-decision-confirm").waitFor({ timeout: 5000 });
    if (await page.getByTestId("invoice-reject-reason-dialog").isVisible().catch(() => false)) {
      throw new Error(`${viewport.width}: reason dialog before reject confirm`);
    }
    await page.getByTestId("invoice-review-decision-confirm-cancel").click();
    await page.getByTestId("invoice-review-decision-confirm").waitFor({
      state: "hidden",
      timeout: 5000,
    });
    console.log(`${viewport.width}: PASS reject confirm cancel`);
  }

  await page.getByTestId("invoice-parsed-inspect-cancel").click();
  await page.getByTestId("invoice-parsed-inspect-modal").waitFor({
    state: "hidden",
    timeout: 5000,
  });
  await page.getByTestId("invoice-review-queue").waitFor({ timeout: 10_000 });
  console.log(`${viewport.width}: PASS footer Cancel closes inspect`);
  await context.close();
}

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of VIEWPORTS) {
    await runViewport(browser, viewport);
  }
  console.log("verify-invoice-review-mobile-ux: PASS");
} finally {
  await browser.close();
}

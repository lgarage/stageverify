/**
 * Playwright: Review Vendor Email shows source-email fields, not PDF OCR.
 * Default: local Vite. Prod: STAGEVERIFY_BASE_URL or --base-url=
 *
 * Does not send email. View Original PDF may open a new tab (read-only).
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { openDeliveryDrawerByDeepLink } from "./dispatcherVerifyHelpers.mjs";
import { assertReadableTextContrast } from "./lib/ui-text-contrast-lib.mjs";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  }
}

const argBase = process.argv.find((a) => a.startsWith("--base-url="));
const baseUrl =
  argBase?.slice("--base-url=".length) ||
  process.env.STAGEVERIFY_BASE_URL ||
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);

const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;
if (!email || !password) {
  throw new Error("Set STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD");
}

const DELIVERY_ID = "delivery-vii-vii-19fa0263965d0c96-page-3";
const ATTACHMENT = "siouxfalls_0018114_20260725_10274869_4860472266.pdf";
const outDir = resolve(process.cwd(), "screenshots");

async function ensureAuthenticated(page) {
  await page.goto(`${appBase}/#/dispatcher`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(1200);
  if (!page.url().includes("/login")) return;
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/#\/(dispatcher|settings|hub|zones|vendors)/, {
    timeout: 25_000,
  });
}

const CONTRAST = {
  rootSelector: '[data-testid="review-vendor-email-modal-panel"]',
  elements: [
    {
      name: "modal title",
      selector: '[data-testid="review-vendor-email-modal-title"]',
      large: true,
    },
    {
      name: "from",
      selector: '[data-testid="review-vendor-email-from"]',
    },
    {
      name: "date",
      selector: '[data-testid="review-vendor-email-date"]',
    },
    {
      name: "subject",
      selector: '[data-testid="review-vendor-email-subject"]',
    },
    {
      name: "empty body",
      selector: '[data-testid="review-vendor-email-empty-body"]',
    },
    {
      name: "attachments",
      selector: '[data-testid="review-vendor-email-attachments"]',
    },
    {
      name: "view original pdf",
      selector: '[data-testid="review-vendor-email-view-original-pdf"]',
    },
    {
      name: "close",
      selector: '[data-testid="review-vendor-email-modal-close"]',
    },
  ],
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
mkdirSync(outDir, { recursive: true });

try {
  await ensureAuthenticated(page);
  await openDeliveryDrawerByDeepLink(page, appBase, DELIVERY_ID);

  const emailVendor = page.getByTestId("delivery-basics-email-vendor");
  if (!(await emailVendor.isVisible().catch(() => false))) {
    throw new Error("FAIL: Email Vendor button must remain visible on 6168008.");
  }

  const reviewBtn = page.getByTestId("drawer-action-review-vendor-email");
  await reviewBtn.waitFor({ state: "visible", timeout: 15_000 });
  await reviewBtn.click();
  await page.getByTestId("review-vendor-email-modal").waitFor({
    state: "visible",
    timeout: 15_000,
  });

  const from = (await page.getByTestId("review-vendor-email-from").innerText()).trim();
  const subject = (
    await page.getByTestId("review-vendor-email-subject").innerText()
  ).trim();
  const date = (await page.getByTestId("review-vendor-email-date").innerText()).trim();
  const empty = (
    await page.getByTestId("review-vendor-email-empty-body").innerText()
  ).trim();
  const attachments = (
    await page.getByTestId("review-vendor-email-attachments").innerText()
  ).trim();
  const modalText = (
    await page.getByTestId("review-vendor-email-modal-body").innerText()
  ).trim();

  if (from !== "dan.day@usaheatingcooling.com") {
    throw new Error(`FAIL From: expected live sender, got "${from}"`);
  }
  if (!/Johnstone Supply-Sioux Falls are Attached/i.test(subject)) {
    throw new Error(`FAIL Subject: got "${subject}"`);
  }
  if (!date) {
    throw new Error("FAIL Date: empty");
  }
  if (empty !== "No message body was included with this email.") {
    throw new Error(`FAIL empty body copy: "${empty}"`);
  }
  if (!attachments.includes(ATTACHMENT)) {
    throw new Error(`FAIL attachment: got "${attachments}"`);
  }
  if (/CREDIT\s+Page 1\/1/i.test(modalText) || /Sold To Ship To/i.test(modalText)) {
    throw new Error("FAIL: parsed PDF/OCR dump must not appear in Review Vendor Email.");
  }
  if (await page.getByTestId("review-vendor-email-to").count()) {
    throw new Error("FAIL: To must be omitted when inbound has no stored To.");
  }
  if (await page.getByTestId("email-evidence-invoice-source-body-inbound-19fa0263965d0c96").count()) {
    throw new Error("FAIL: old invoice-source OCR body must not render in this modal.");
  }

  const pdfBtn = page.getByTestId("review-vendor-email-view-original-pdf");
  if (!(await pdfBtn.isVisible().catch(() => false))) {
    throw new Error("FAIL: View Original PDF button missing.");
  }

  await assertReadableTextContrast(page, CONTRAST);

  const popupPromise = page.waitForEvent("popup", { timeout: 20_000 });
  await pdfBtn.click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded").catch(() => {});
  const popupUrl = popup.url();
  if (!popupUrl || popupUrl === "about:blank") {
    await popup.waitForTimeout(1500);
  }
  const finalPopupUrl = popup.url();
  if (!/blob:|application\/pdf|\.pdf/i.test(finalPopupUrl) && !finalPopupUrl.startsWith("blob:")) {
    const popupTitle = await popup.title().catch(() => "");
    if (!/pdf/i.test(popupTitle) && !finalPopupUrl.startsWith("blob:")) {
      throw new Error(
        `FAIL View Original PDF: expected PDF tab, got url="${finalPopupUrl}" title="${popupTitle}"`,
      );
    }
  }
  await popup.close();

  if (await page.getByTestId("vendor-comms-send").isVisible().catch(() => false)) {
    throw new Error("FAIL: Email Vendor compose must not open from Review Vendor Email.");
  }
  if (!(await emailVendor.isVisible().catch(() => false))) {
    throw new Error("FAIL: Email Vendor must stay available behind the review modal.");
  }

  await page.screenshot({
    path: resolve(outDir, "review-vendor-email-source-6168008.png"),
  });
  console.log(
    "PASS Review Vendor Email source: 6168008 headers + honest empty body + attachment + PDF tab; no OCR dump; Email Vendor untouched",
  );
} finally {
  await browser.close();
}

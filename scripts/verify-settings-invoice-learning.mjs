/**
 * Playwright: Settings → Invoice Learning (C3-D.1 read-only).
 *
 * Usage:
 *   npm run dev   (another terminal)
 *   npm run verify:settings-invoice-learning
 *
 * Credentials from .env.local (STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD).
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  assertNoElementOverlap,
  assertReadableTextContrast,
} from "./lib/ui-text-contrast-lib.mjs";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  }
}

const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;
const authState = resolve(process.cwd(), "playwright/.auth/state.json");
const outDir = resolve(process.cwd(), "screenshots");
mkdirSync(outDir, { recursive: true });

const appBase = resolveAppBase(baseUrl);

const FORBIDDEN_ACTION_RE =
  /\b(Activate|Reject|Suspend|Reactivate|Edit Pattern|Approve Lesson|Check for New Lessons)\b/i;

const INVOICE_LEARNING_CONTRAST_SPEC = {
  rootSelector: '[data-testid="invoice-learning-panel"]',
  elements: [
    {
      name: "panel explanation",
      selector: "p",
    },
    {
      name: "proposed count",
      selector: '[data-testid="invoice-learning-proposed-count"]',
      large: true,
    },
    {
      name: "suspended count",
      selector: '[data-testid="invoice-learning-suspended-count"]',
      large: true,
    },
    {
      name: "active count",
      selector: '[data-testid="invoice-learning-active-count"]',
      large: true,
    },
  ],
};

async function ensureAuthenticated(page) {
  await page.goto(`${appBase}/#/settings`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(1500);

  if (!page.url().includes("/login")) return;

  if (!email || !password) {
    throw new Error(
      "Redirected to login — set STAGEVERIFY_TEST_EMAIL/PASSWORD in .env.local",
    );
  }

  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/#\/(settings|dispatcher|hub)/, { timeout: 20_000 });

  if (!page.url().includes("/settings")) {
    await page.goto(`${appBase}/#/settings`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  }
}

function assertNoLifecycleActions(rootText) {
  const match = rootText.match(FORBIDDEN_ACTION_RE);
  if (match) {
    throw new Error(`Forbidden lifecycle action control found: ${match[0]}`);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const contextOptions = {
    viewport: { width: 1280, height: 900 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  };
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  const firestoreLessonReads = [];
  page.on("request", (req) => {
    const url = req.url();
    // Direct Firestore document/collection REST paths only — not the callable name.
    if (
      /firestore\.googleapis\.com.*vendorInvoiceFieldLessons/i.test(url) ||
      /\/documents\/vendorInvoiceFieldLessons/i.test(url)
    ) {
      firestoreLessonReads.push(url);
    }
  });

  console.log(`Opening ${appBase}/#/settings`);
  await ensureAuthenticated(page);

  const panel = page.getByTestId("invoice-learning-panel");
  await panel.waitFor({ timeout: 30_000 });
  await panel.scrollIntoViewIfNeeded();

  await page
    .getByRole("heading", { name: "Settings", exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByText("Invoice Learning", { exact: true }).first().waitFor({
    timeout: 10_000,
  });

  await page.getByTestId("invoice-learning-summary").waitFor({ timeout: 15_000 });
  const activeCount = (
    await page.getByTestId("invoice-learning-active-count").innerText()
  ).trim();
  if (activeCount !== "0") {
    throw new Error(`Expected Active count 0, got ${activeCount}`);
  }

  // Wait until load settles: empty, lessons, error alert, or manager-denied.
  await page.waitForFunction(
    () => {
      const root = document.querySelector('[data-testid="invoice-learning-panel"]');
      if (!root) return false;
      if (root.querySelector('[data-testid="invoice-learning-empty"]')) return true;
      if (root.querySelector('[data-testid^="invoice-learning-lesson-"]')) return true;
      if (root.querySelector('[role="alert"]')) return true;
      const text = root.textContent || "";
      if (/Manager access required/i.test(text)) return true;
      if (/Loading invoice lessons/i.test(text)) return false;
      return false;
    },
    null,
    { timeout: 30_000 },
  );

  const panelText = await panel.innerText();
  if (!panelText.includes("do not affect invoice parsing yet")) {
    throw new Error("Missing safety explanation copy");
  }
  assertNoLifecycleActions(panelText);

  // No lifecycle action buttons/links inside the panel
  const forbiddenControls = panel.locator(
    "button, a, [role='button']",
  );
  const controlCount = await forbiddenControls.count();
  for (let i = 0; i < controlCount; i++) {
    const label = (
      (await forbiddenControls.nth(i).innerText()) ||
      (await forbiddenControls.nth(i).getAttribute("aria-label")) ||
      ""
    ).trim();
    if (FORBIDDEN_ACTION_RE.test(label)) {
      throw new Error(`Forbidden control label: ${label}`);
    }
  }

  const empty = page.getByTestId("invoice-learning-empty");
  const lessonCards = page.locator('[data-testid^="invoice-learning-lesson-"]');
  const emptyVisible = await empty.isVisible().catch(() => false);
  const lessonCount = await lessonCards.count();

  if (!emptyVisible && lessonCount === 0) {
    // Manager denied path still shows panel with access message
    if (!panelText.includes("Manager access required")) {
      throw new Error("Expected empty state, lessons, or Manager access message");
    }
    console.log("Manager access required path — summary still rendered");
  }

  if (emptyVisible) {
    const emptyText = await empty.innerText();
    if (!emptyText.includes("No proposed invoice lessons yet")) {
      throw new Error("Empty state missing primary copy");
    }
    if (!emptyText.includes("three distinct qualifying documents")) {
      throw new Error("Empty state missing C3-D.1 threshold copy");
    }
    console.log("Empty state OK");
  }

  if (lessonCount > 0) {
    const first = lessonCards.first();
    const firstText = await first.innerText();
    const hasFriendlyField =
      firstText.includes("Customer PO / Reference") ||
      firstText.includes("Sales Order #") ||
      firstText.includes("Invoice #");
    if (!hasFriendlyField) {
      throw new Error("Lesson card missing friendly field name");
    }
    const hasFriendlyCapture =
      firstText.includes("Value appears beside the label") ||
      firstText.includes("Value appears directly below the label");
    if (!hasFriendlyCapture) {
      throw new Error("Lesson card missing friendly capture relationship");
    }
    if (!/distinct/i.test(firstText)) {
      throw new Error("Lesson card missing distinct document count");
    }

    await first.click();
    const detail = page.getByTestId("invoice-learning-detail");
    await detail.waitFor({ timeout: 10_000 });
    const evidence = page.getByTestId("invoice-learning-evidence");
    await evidence.waitFor({ timeout: 10_000 });
    const detailText = await detail.innerText();
    assertNoLifecycleActions(detailText);
    if (!detailText.includes("Supporting evidence")) {
      throw new Error("Detail missing Supporting evidence section");
    }
    await page.getByRole("button", { name: /close/i }).click();
    await detail.waitFor({ state: "hidden", timeout: 10_000 });
    console.log(`Lesson list + detail OK (${lessonCount} lesson(s))`);
  }

  await assertReadableTextContrast(page, INVOICE_LEARNING_CONTRAST_SPEC);
  await assertNoElementOverlap(page, {
    containerSelector: '[data-testid="invoice-learning-panel"]',
    elementSelectors: [
      {
        name: "explanation",
        selector: "p",
      },
      {
        name: "summary",
        selector: '[data-testid="invoice-learning-summary"]',
      },
    ],
  });

  await page.screenshot({
    path: resolve(outDir, "settings-invoice-learning.png"),
    fullPage: true,
  });

  // Narrow / mobile usability
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="invoice-learning-panel"]');
    el?.scrollIntoView({ block: "center", inline: "nearest" });
  });
  await page.waitForTimeout(400);
  const mobileVisible = await panel.isVisible();
  if (!mobileVisible) {
    throw new Error("Invoice Learning panel not visible at mobile width");
  }
  const mobileBox = await panel.boundingBox();
  if (mobileBox && mobileBox.width < 260) {
    throw new Error(
      `Invoice Learning panel too narrow at mobile width (${mobileBox.width}px)`,
    );
  }
  await page.screenshot({
    path: resolve(outDir, "settings-invoice-learning-mobile.png"),
    fullPage: true,
  });
  console.log("Mobile/narrow OK");

  if (firestoreLessonReads.length > 0) {
    throw new Error(
      `Browser issued direct lesson collection request(s): ${firestoreLessonReads[0]}`,
    );
  }
  console.log("No direct Firestore lesson-collection reads");

  console.log("PASS verify:settings-invoice-learning");
  await browser.close();
  process.exit(0);
})().catch(async (err) => {
  console.error("FAIL verify:settings-invoice-learning:", err);
  process.exit(1);
});

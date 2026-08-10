/**
 * Playwright: Settings → Invoice Learning lifecycle review (C3-D.2).
 *
 * Usage:
 *   npm run dev   (another terminal)
 *   node scripts/verify-settings-invoice-learning.mjs
 *   node scripts/verify-settings-invoice-learning.mjs --base-url=https://lgarage.github.io/stageverify
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

const ROW_FORBIDDEN_ACTION_RE =
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
    {
      name: "rejected count",
      selector: '[data-testid="invoice-learning-rejected-count"]',
      large: true,
    },
  ],
};

const INVOICE_LEARNING_DETAIL_CONTRAST_SPEC = {
  rootSelector: '[data-testid="invoice-learning-detail"]',
  elements: [
    {
      name: "lesson detail title",
      selector: "#invoice-learning-detail-title",
      large: true,
    },
    {
      name: "lesson status",
      selector: '[data-testid="invoice-learning-status"]',
    },
    {
      name: "supporting evidence heading",
      selector: '[data-testid="invoice-learning-evidence"] h4',
    },
    {
      name: "manager decision heading",
      selector: '[data-testid="invoice-learning-lifecycle"] h4',
    },
    {
      name: "status lifecycle action",
      selector: '[data-testid="invoice-learning-lifecycle"] button',
      optional: true,
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

function assertNoListRowLifecycleActions(rootText) {
  const match = rootText.match(ROW_FORBIDDEN_ACTION_RE);
  if (match) {
    throw new Error(`List-row lifecycle action found: ${match[0]}`);
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
  if (
    !panelText.includes(
      "These are deterministic extraction patterns StageVerify has learned from verified invoice evidence.",
    ) ||
    !panelText.includes("Parser application is not live yet.")
  ) {
    throw new Error("Missing safety explanation copy");
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
    const expectedCounts = {
      proposed: 0,
      active: 0,
      suspended: 0,
      rejected: 0,
    };

    for (let index = 0; index < lessonCount; index++) {
      const card = lessonCards.nth(index);
      const status = await card.getAttribute("data-status");
      if (!status || !(status in expectedCounts)) {
        throw new Error(`Lesson card ${index + 1} has invalid status: ${status}`);
      }
      expectedCounts[status] += 1;

      const cardText = await card.innerText();
      assertNoListRowLifecycleActions(cardText);
      const hasFriendlyField =
        cardText.includes("Customer PO / Reference") ||
        cardText.includes("Sales Order #") ||
        cardText.includes("Invoice #");
      if (!hasFriendlyField) {
        throw new Error("Lesson card missing friendly field name");
      }
      const hasFriendlyCapture =
        cardText.includes("Value appears beside the label") ||
        cardText.includes("Value appears directly below the label");
      if (!hasFriendlyCapture) {
        throw new Error("Lesson card missing friendly capture relationship");
      }
      if (!/distinct/i.test(cardText)) {
        throw new Error("Lesson card missing distinct document count");
      }

      await card.click();
      const detail = page.getByTestId("invoice-learning-detail");
      await detail.waitFor({ timeout: 10_000 });
      const evidence = page.getByTestId("invoice-learning-evidence");
      await evidence.waitFor({ timeout: 10_000 });
      const detailText = await detail.innerText();
      if (!detailText.includes("Supporting evidence")) {
        throw new Error("Detail missing Supporting evidence section");
      }
      await assertReadableTextContrast(
        page,
        INVOICE_LEARNING_DETAIL_CONTRAST_SPEC,
      );

      const activate = detail.getByRole("button", {
        name: "Activate",
        exact: true,
      });
      const reject = detail.getByRole("button", {
        name: "Reject",
        exact: true,
      });
      const suspend = detail.getByRole("button", {
        name: "Suspend",
        exact: true,
      });
      const reactivate = detail.getByRole("button", {
        name: "Reactivate",
        exact: true,
      });

      if (status === "proposed") {
        if ((await reject.count()) !== 1) {
          throw new Error("Proposed lesson detail must show Reject");
        }
        const contradiction = await detail
          .getByTestId("invoice-learning-conflict")
          .isVisible()
          .catch(() => false);
        if (contradiction) {
          if ((await activate.count()) !== 0) {
            throw new Error(
              "Contradictory proposed lesson must hide Activate",
            );
          }
        } else if ((await activate.count()) !== 1) {
          throw new Error("Proposed lesson detail must show Activate");
        }
      } else if (status === "active") {
        if ((await suspend.count()) !== 1) {
          throw new Error("Active lesson detail must show Suspend");
        }
      } else if (status === "suspended") {
        if ((await reactivate.count()) !== 1) {
          throw new Error("Suspended lesson detail must show Reactivate");
        }
      } else if (status === "rejected" && (await activate.count()) !== 0) {
        throw new Error("Rejected lesson detail must not show Activate");
      }

      await detail.getByRole("button", { name: "Close", exact: true }).click();
      await detail.waitFor({ state: "hidden", timeout: 10_000 });
    }

    for (const [status, expected] of Object.entries(expectedCounts)) {
      const displayed = Number(
        (
          await page
            .getByTestId(`invoice-learning-${status}-count`)
            .innerText()
        ).trim(),
      );
      if (displayed !== expected) {
        throw new Error(
          `${status} summary count ${displayed} does not match ${expected} lesson card(s)`,
        );
      }
    }
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

/**
 * Playwright: dispatcher invoice review UI (/invoice-review).
 *
 * Usage:
 *   npm run dev
 *   node scripts/playwright-auth-setup.mjs   (if token expired)
 *   npm run verify:invoice-review
 *   STAGEVERIFY_BASE_URL=https://lgarage.github.io/stageverify npm run verify:invoice-review:prod
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrlIdx = args.indexOf("--base-url");
const baseUrl =
  baseUrlFlag?.slice("--base-url=".length) ??
  (baseUrlIdx >= 0 ? args[baseUrlIdx + 1] : undefined) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const authState = resolve(process.cwd(), "playwright/.auth/state.json");
const screenshotDir = resolve(process.cwd(), "screenshots/invoice-review-verify");

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  }
}

const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;

async function ensureAuthenticated(page) {
  await page.goto(`${appBase}/#/invoice-review`, {
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
  await page.waitForURL(/\/#\/(invoice-review|dispatcher|settings|hub|zones|vendors)/, {
    timeout: 20_000,
  });

  if (!page.url().includes("/invoice-review")) {
    await page.goto(`${appBase}/#/invoice-review`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  }
}

async function main() {
  if (!existsSync(authState)) {
    console.log("No auth state — run: node scripts/playwright-auth-setup.mjs");
  }

  mkdirSync(screenshotDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const page = await context.newPage();

  try {
    console.log(`verify-invoice-review @ ${appBase}/#/invoice-review`);

    await ensureAuthenticated(page);

    await page.getByTestId("invoice-review-page").waitFor({ timeout: 20_000 });
    console.log("PASS: invoice-review-page visible");

    await page.getByTestId("invoice-review-panel").waitFor({ timeout: 15_000 });
    console.log("PASS: invoice-review-panel visible");

    await page.getByTestId("invoice-review-queue").waitFor({ timeout: 15_000 });
    console.log("PASS: invoice-review-queue visible");

    const sidebarLink = page.getByRole("link", { name: "Invoice Review" });
    if (await sidebarLink.isVisible().catch(() => false)) {
      console.log("PASS: Invoice Review sidebar nav link visible");
    } else {
      throw new Error("Invoice Review sidebar link not visible");
    }

    const heading = page.getByRole("heading", { name: "Invoice import review" });
    await heading.waitFor({ timeout: 10_000 });
    console.log("PASS: page heading visible");

    const detailPane = page.getByTestId("invoice-review-detail");
    if (await detailPane.count()) {
      throw new Error("Split detail pane should be removed — invoice-review-detail still present");
    }
    console.log("PASS: split detail pane removed (row-card layout)");

    const queueRows = page.locator('[data-testid^="invoice-review-queue-row-"]');
    const emptyState = page.getByTestId("invoice-review-empty");
    await page.waitForFunction(
      () => {
        const panel = document.querySelector('[data-testid="invoice-review-panel"]');
        if (!panel) return false;
        const panelText = panel.textContent ?? "";
        const loading = panelText.includes("Loading…");
        const rows = panel.querySelectorAll('[data-testid^="invoice-review-queue-row-"]').length;
        const empty = panel.querySelector('[data-testid="invoice-review-empty"]');
        return !loading && (rows > 0 || !!empty);
      },
      { timeout: 30_000 },
    );
    const rowCount = await queueRows.count();
    const hasEmpty = await emptyState.isVisible().catch(() => false);

    if (rowCount === 0 && !hasEmpty) {
      throw new Error("Expected queue rows or empty-state message");
    }
    if (rowCount > 0) {
      console.log(`PASS: ${rowCount} import row(s) visible`);
      const firstRow = queueRows.first();
      const inspectBtn = firstRow.getByRole("button", { name: "Inspect parsed data" });
      if (await inspectBtn.count()) {
        throw new Error("Inspect parsed data button should be removed — use row click");
      }
      console.log("PASS: Inspect parsed data button removed");
    } else {
      console.log("PASS: empty queue state renders");
    }

    const panelText = await page.getByTestId("invoice-review-panel").innerText();
    if (/Confidence/i.test(panelText)) {
      throw new Error("Confidence column should not appear in invoice review");
    }
    console.log("PASS: Confidence column not shown");

    await page.getByTestId("dispatcher-refresh-now").waitFor({ timeout: 10_000 });
    console.log("PASS: shared dispatcher Refresh Now visible on Invoice Review");

    await page.getByRole("button", { name: "+ New Delivery" }).waitFor({ timeout: 10_000 });
    console.log("PASS: shared dispatcher + New Delivery visible on Invoice Review");

    const rowContent = page.locator('[data-testid^="invoice-review-row-content-"]').first();
    if (await rowContent.isVisible().catch(() => false)) {
      await rowContent.click();
      await page.getByTestId("invoice-parsed-inspect-modal").waitFor({ timeout: 10_000 });
      await page.getByTestId("invoice-parsed-inspect-summary").waitFor({ timeout: 10_000 });
      console.log("PASS: row click opens inspect modal");

      await page.getByTestId("invoice-parsed-inspect-doc-type").waitFor({ timeout: 5000 });
      const docType = await page.getByTestId("invoice-parsed-inspect-doc-type").innerText();
      if (!docType.trim()) {
        throw new Error("Document type should be populated in inspect summary");
      }
      console.log(`PASS: document type shown (${docType.trim()})`);

      await page.getByTestId("invoice-parsed-inspect-approval").waitFor({ timeout: 5000 });
      console.log("PASS: approval eligibility shown in inspect summary");

      await page.getByTestId("invoice-parsed-inspect-lines").waitFor({ timeout: 5000 });
      console.log("PASS: parsed lines table visible in inspect modal");

      const expectedFields = page.getByTestId("invoice-parsed-inspect-expected-fields");
      if (await expectedFields.count()) {
        throw new Error("Expected-vs-actual checklist removed — inspect modal should not show it");
      }
      console.log("PASS: redundant expected-vs-actual checklist removed");

      await page.getByTestId("invoice-delivery-match-section").waitFor({ timeout: 10_000 });
      console.log("PASS: delivery match section at top of inspect modal");

      const approvePrompt = page.getByTestId("invoice-parsed-inspect-approve-prompt");
      if (await approvePrompt.count()) {
        throw new Error("Delivery ID approve prompt should be removed — approve works without linkage");
      }
      console.log("PASS: no delivery ID gate on approve");

      const modalApproveBtn = page.getByTestId("invoice-parsed-inspect-approve");
      if (await modalApproveBtn.isVisible().catch(() => false)) {
        const modalApproveDisabled = await modalApproveBtn.isDisabled();
        const panelTextForIssue = await page.getByTestId("invoice-review-panel").innerText();
        if (modalApproveDisabled && /issue import/i.test(panelTextForIssue)) {
          console.log("PASS: modal Approve disabled only for issue imports");
        } else if (!modalApproveDisabled) {
          console.log("PASS: modal Approve enabled without delivery ID selection");
        } else {
          throw new Error("Modal Approve should be enabled for non-issue pending imports without delivery ID");
        }
      }

      const rowMatchToggle = page.locator('[data-testid^="invoice-review-match-toggle-"]');
      if (await rowMatchToggle.count()) {
        throw new Error("Row-level Match to delivery toggle should be removed");
      }
      console.log("PASS: row-level match toggle removed");

      const approveBtn = page.getByTestId("invoice-review-approve");
      if (await approveBtn.isVisible().catch(() => false)) {
        const disabled = await approveBtn.isDisabled();
        if (disabled) {
          const panelText = await page.getByTestId("invoice-review-panel").innerText();
          if (/issue import/i.test(panelText)) {
            console.log("PASS: Approve disabled only for issue imports");
          } else {
            throw new Error("Approve should be enabled for non-issue pending imports without auto-match");
          }
        } else {
          console.log("PASS: Approve enabled without delivery ID or auto-match");
        }
      }

      await page.getByTestId("invoice-parsed-inspect-close").click();
      await page.getByTestId("invoice-parsed-inspect-modal").waitFor({
        state: "hidden",
        timeout: 5000,
      });
    } else {
      console.log("SKIP: no queue items — inspect modal not exercised");
    }

    await page.screenshot({
      path: resolve(screenshotDir, "invoice-review-page.png"),
      fullPage: true,
    });
    console.log(`Screenshot: screenshots/invoice-review-verify/invoice-review-page.png`);

    console.log("\nverify-invoice-review: PASS");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`\nverify-invoice-review: FAIL — ${err.message}`);
  process.exit(1);
});

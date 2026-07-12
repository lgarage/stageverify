/**
 * Playwright: invoice import review on Delivery Overview Needs Review.
 * Deep link `#/invoice-review` redirects to `/dispatcher?focus=needs-review`.
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

  // Always re-hit deep link so redirect lands on Needs Review focus.
  await page.goto(`${appBase}/#/invoice-review`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
}

async function assertViewOriginalPdfButton(page) {
  const viewOriginalPdfBtn = page.getByTestId("invoice-parsed-inspect-view-original-pdf");
  await viewOriginalPdfBtn.waitFor({ timeout: 5000 });
  const closeBtn = page.getByTestId("invoice-parsed-inspect-close");
  const pdfBeforeClose = (await viewOriginalPdfBtn.boundingBox())?.x ?? 0;
  const closeX = (await closeBtn.boundingBox())?.x ?? 0;
  if (pdfBeforeClose >= closeX) {
    throw new Error("View original PDF button should appear left of Close");
  }
  console.log("PASS: View original PDF button left of Close in modal header");
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
    console.log(`verify-invoice-review @ ${appBase}/#/invoice-review → Needs Review`);

    await ensureAuthenticated(page);

    await page.waitForURL(/\/#\/dispatcher/, { timeout: 20_000 });
    if (!page.url().includes("focus=needs-review")) {
      throw new Error(
        `Expected redirect to dispatcher?focus=needs-review, got ${page.url()}`,
      );
    }
    console.log("PASS: #/invoice-review redirects to dispatcher Needs Review");

    await page.getByTestId("needs-review-section").waitFor({ timeout: 20_000 });
    console.log("PASS: needs-review-section visible on Delivery Overview");

    await page.getByTestId("needs-review-invoice-block").waitFor({ timeout: 10_000 });
    await page.getByTestId("needs-review-invoice-heading").waitFor({ timeout: 10_000 });
    console.log("PASS: invoice imports block in Needs Review");

    await page.getByTestId("invoice-review-panel").waitFor({ timeout: 15_000 });
    console.log("PASS: invoice-review-panel visible");

    await page.getByTestId("invoice-review-queue").waitFor({ timeout: 15_000 });
    console.log("PASS: invoice-review-queue visible");

    const sidebarLink = page.getByRole("link", { name: "Invoice Review" });
    if (await sidebarLink.isVisible().catch(() => false)) {
      throw new Error("Invoice Review sidebar link should be removed");
    }
    console.log("PASS: Invoice Review sidebar nav link absent");

    const heading = page.getByTestId("needs-review-invoice-heading");
    await heading.waitFor({ timeout: 10_000 });
    const headingText = (await heading.innerText()).trim();
    if (headingText !== "Invoice imports") {
      throw new Error(`Unexpected invoice heading: ${headingText}`);
    }
    console.log("PASS: Invoice imports heading visible");

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
    console.log("PASS: shared dispatcher Refresh Now visible on Delivery Overview");

    await page.getByRole("button", { name: "+ New Delivery" }).waitFor({ timeout: 10_000 });
    console.log("PASS: shared dispatcher + New Delivery visible on Delivery Overview");

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

      await assertViewOriginalPdfButton(page);

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
        const approvalEligibleText = (
          await page.getByTestId("invoice-parsed-inspect-approval").innerText()
        ).trim();
        const modalApproveDisabled = await modalApproveBtn.isDisabled();
        if (/^no$/i.test(approvalEligibleText) && modalApproveDisabled) {
          console.log("PASS: modal Approve disabled when approval eligibility is No");
        } else if (/^yes$/i.test(approvalEligibleText) && !modalApproveDisabled) {
          console.log("PASS: modal Approve enabled without delivery ID selection");
        } else if (/^yes$/i.test(approvalEligibleText) && modalApproveDisabled) {
          throw new Error(
            "Modal Approve should be enabled when approval eligibility is Yes (without delivery ID)",
          );
        } else {
          console.log(
            `SKIP: modal Approve state (${approvalEligibleText}, disabled=${modalApproveDisabled})`,
          );
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
        const approvalEligibleText = (
          await page.getByTestId("invoice-parsed-inspect-approval").innerText()
        ).trim();
        if (/^no$/i.test(approvalEligibleText) && disabled) {
          console.log("PASS: row Approve disabled when approval eligibility is No");
        } else if (/^yes$/i.test(approvalEligibleText) && !disabled) {
          console.log("PASS: row Approve enabled without delivery ID or auto-match");
        } else if (/^yes$/i.test(approvalEligibleText) && disabled) {
          throw new Error(
            "Row Approve should be enabled when approval eligibility is Yes (without delivery ID)",
          );
        } else {
          console.log(`SKIP: row Approve state (eligible=${approvalEligibleText}, disabled=${disabled})`);
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

    const approvedLink = page.getByTestId("invoice-review-approved-link");
    const rejectedLink = page.getByTestId("invoice-review-rejected-link");
    await approvedLink.waitFor({ timeout: 10_000 });
    await rejectedLink.waitFor({ timeout: 10_000 });

    const approvedLabel = (await approvedLink.innerText()).trim();
    const rejectedLabel = (await rejectedLink.innerText()).trim();
    if (!approvedLabel.startsWith("Approved invoices")) {
      throw new Error(`Unexpected approved button label: ${approvedLabel}`);
    }
    if (!rejectedLabel.startsWith("Rejected invoices")) {
      throw new Error(`Unexpected rejected button label: ${rejectedLabel}`);
    }

    const sideBySide = await page.evaluate(() => {
      const approved = document.querySelector('[data-testid="invoice-review-approved-link"]');
      const rejected = document.querySelector('[data-testid="invoice-review-rejected-link"]');
      if (!approved || !rejected) return { ok: false, reason: "missing buttons" };
      const parent = approved.parentElement;
      if (parent !== rejected.parentElement) return { ok: false, reason: "different parents" };
      const style = window.getComputedStyle(parent);
      if (style.flexDirection === "column") return { ok: false, reason: "stacked column" };
      const aRect = approved.getBoundingClientRect();
      const rRect = rejected.getBoundingClientRect();
      if (Math.abs(aRect.top - rRect.top) > 8) return { ok: false, reason: "not same row" };
      return { ok: true };
    });
    if (!sideBySide.ok) {
      throw new Error(`Archive nav buttons not side-by-side: ${sideBySide.reason}`);
    }
    console.log("PASS: Approved and Rejected invoices buttons side-by-side with correct labels");

    await approvedLink.click();
    console.log("PASS: Approved invoices navigation clicked");

    await page.getByTestId("invoice-review-approved-list").waitFor({ timeout: 15_000 });
    console.log("PASS: approved invoices list visible");

    const approvedHeading = page.getByText("Approved invoices", { exact: true });
    const approvedHeadingCount = await approvedHeading.count();
    if (approvedHeadingCount < 1) {
      throw new Error("Expected Approved invoices section heading");
    }
    console.log("PASS: Approved invoices heading visible");

    await page.waitForFunction(
      () => {
        const list = document.querySelector('[data-testid="invoice-review-approved-list"]');
        if (!list) return false;
        const loading = list.textContent?.includes("Loading…");
        const rows = list.querySelectorAll('[data-testid^="invoice-review-queue-row-"]').length;
        const empty = list.querySelector('[data-testid="invoice-review-approved-empty"]');
        return !loading && (rows > 0 || !!empty);
      },
      { timeout: 30_000 },
    );

    const approvedRows = page.locator('[data-testid^="invoice-review-queue-row-"]');
    const approvedRowCount = await approvedRows.count();
    const approvedEmpty = page.getByTestId("invoice-review-approved-empty");
    const hasApprovedEmpty = await approvedEmpty.isVisible().catch(() => false);

    if (approvedRowCount === 0 && !hasApprovedEmpty) {
      throw new Error("Expected approved rows or approved empty-state message");
    }

    if (approvedRowCount > 0) {
      console.log(`PASS: ${approvedRowCount} approved row(s) visible`);
      const linkedBadge = approvedRows.first().getByTestId("invoice-review-linked-badge");
      await linkedBadge.waitFor({ timeout: 5000 });
      const badgeText = (await linkedBadge.innerText()).trim();
      if (!/^(Linked|Not linked to delivery)$/.test(badgeText)) {
        throw new Error(`Unexpected linked delivery badge: ${badgeText}`);
      }
      console.log(`PASS: linked delivery badge shown (${badgeText})`);

      await page.locator('[data-testid^="invoice-review-row-content-"]').first().click();
      await page.getByTestId("invoice-parsed-inspect-modal").waitFor({ timeout: 10_000 });
      const modalApprove = page.getByTestId("invoice-parsed-inspect-approve");
      if (await modalApprove.count()) {
        throw new Error("Approved archive inspect modal should not show Approve");
      }
      console.log("PASS: approved row opens read-only inspect modal");
      await assertViewOriginalPdfButton(page);
      await page.getByTestId("invoice-parsed-inspect-close").click();
      await page.getByTestId("invoice-parsed-inspect-modal").waitFor({
        state: "hidden",
        timeout: 5000,
      });
    } else {
      console.log("PASS: approved empty state renders");
    }

    await page.getByTestId("invoice-review-back-to-queue").click();
    await page.getByTestId("invoice-review-queue").waitFor({ timeout: 10_000 });
    console.log("PASS: back to review queue navigation");

    await rejectedLink.waitFor({ timeout: 10_000 });
    await rejectedLink.click();
    console.log("PASS: Rejected invoices navigation clicked");

    await page.getByTestId("invoice-review-rejected-list").waitFor({ timeout: 15_000 });
    console.log("PASS: rejected invoices list visible");

    const rejectedHeading = page.getByText("Rejected invoices", { exact: true });
    const rejectedHeadingCount = await rejectedHeading.count();
    if (rejectedHeadingCount < 1) {
      throw new Error("Expected Rejected invoices section heading");
    }
    console.log("PASS: Rejected invoices heading visible");

    await page.waitForFunction(
      () => {
        const list = document.querySelector('[data-testid="invoice-review-rejected-list"]');
        if (!list) return false;
        const loading = list.textContent?.includes("Loading…");
        const rows = list.querySelectorAll('[data-testid^="invoice-review-queue-row-"]').length;
        const empty = list.querySelector('[data-testid="invoice-review-rejected-empty"]');
        return !loading && (rows > 0 || !!empty);
      },
      { timeout: 30_000 },
    );

    const rejectedRows = page.locator('[data-testid^="invoice-review-queue-row-"]');
    const rejectedRowCount = await rejectedRows.count();
    const rejectedEmpty = page.getByTestId("invoice-review-rejected-empty");
    const hasRejectedEmpty = await rejectedEmpty.isVisible().catch(() => false);

    if (rejectedRowCount === 0 && !hasRejectedEmpty) {
      throw new Error("Expected rejected rows or rejected empty-state message");
    }

    if (rejectedRowCount > 0) {
      console.log(`PASS: ${rejectedRowCount} rejected row(s) visible`);
      await page.locator('[data-testid^="invoice-review-row-content-"]').first().click();
      await page.getByTestId("invoice-parsed-inspect-modal").waitFor({ timeout: 10_000 });
      const modalReject = page.getByTestId("invoice-parsed-inspect-reject");
      if (await modalReject.count()) {
        throw new Error("Rejected archive inspect modal should not show Reject");
      }
      console.log("PASS: rejected row opens inspect modal without Reject action");
      await page.getByTestId("invoice-parsed-inspect-close").click();
      await page.getByTestId("invoice-parsed-inspect-modal").waitFor({
        state: "hidden",
        timeout: 5000,
      });
    } else {
      console.log("PASS: rejected empty state renders");
    }

    await page.getByTestId("invoice-review-back-to-queue").click();
    await page.getByTestId("invoice-review-queue").waitFor({ timeout: 10_000 });
    console.log("PASS: back to review queue from rejected list");

    console.log("\nverify-invoice-review: PASS");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`\nverify-invoice-review: FAIL — ${err.message}`);
  process.exit(1);
});

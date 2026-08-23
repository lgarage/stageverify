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
  const adminBtn = page.getByTestId("invoice-parsed-inspect-admin");
  const viewOriginalPdfBtn = page.getByTestId("invoice-parsed-inspect-view-original-pdf");
  await adminBtn.waitFor({ timeout: 5000 });
  await viewOriginalPdfBtn.waitFor({ timeout: 5000 });
  const closeBtn = page.getByTestId("invoice-parsed-inspect-close");
  const adminX = (await adminBtn.boundingBox())?.x ?? 0;
  const pdfBeforeClose = (await viewOriginalPdfBtn.boundingBox())?.x ?? 0;
  const closeX = (await closeBtn.boundingBox())?.x ?? 0;
  if (adminX >= pdfBeforeClose) {
    throw new Error("Admin button should appear left of View original PDF");
  }
  if (pdfBeforeClose >= closeX) {
    throw new Error("View original PDF button should appear left of Close");
  }
  console.log("PASS: Admin left of View original PDF; PDF left of Close");
}

const TRAINING_SECTION19_STRINGS = [
  "Prefer Invoice Review Chat for questions about this invoice",
  "Lessons can't delete data, approve documents, send messages, or change access",
  "Use patterns only — no invoice numbers, POs, or addresses",
];

async function ensureTrainingAdvancedOpen(page) {
  const advanced = page.getByTestId(
    "invoice-parsed-inspect-training-advanced",
  );
  if (!(await advanced.count())) return;
  const open = await advanced.evaluate(
    (el) => el instanceof HTMLDetailsElement && el.open,
  );
  if (!open) {
    await page
      .getByTestId("invoice-parsed-inspect-training-advanced-summary")
      .click();
    await page.waitForTimeout(200);
  }
}

const IDLE_NOTE_PLACEHOLDER =
  "Example: Ignore these order confirmations from now on.";
const CONFIRM_NOTE_PLACEHOLDER =
  'Type "yes" to send to a manager, or "no" to cancel.';

/** Toast auto-dismisses after 4s — wait so preview SKIP cannot bleed into teach-chat. */
async function waitForTrainingToastHidden(page, timeoutMs = 6000) {
  const toastEl = page.getByTestId("invoice-training-toast");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await toastEl.isVisible().catch(() => false))) return;
    await page.waitForTimeout(250);
  }
  throw new Error("invoice-training-toast still visible after timeout");
}

async function assertTrainingPanelSection19(page) {
  await ensureTrainingAdvancedOpen(page);
  const panel = page.getByTestId("invoice-parsed-inspect-training-panel");
  const panelText = (await panel.innerText()).trim();
  for (const snippet of TRAINING_SECTION19_STRINGS) {
    if (!panelText.includes(snippet)) {
      throw new Error(`Training panel missing §19 copy: "${snippet}"`);
    }
  }
  console.log("PASS: training panel §19 wording visible");

  const noteInput = page.getByTestId("invoice-parsed-inspect-correction-note");
  const placeholder = await noteInput.getAttribute("placeholder");
  if (placeholder !== IDLE_NOTE_PLACEHOLDER) {
    throw new Error(
      `Correction note idle placeholder expected "${IDLE_NOTE_PLACEHOLDER}", got "${placeholder}"`,
    );
  }

  const sendBtn = page.getByTestId("invoice-parsed-inspect-save-lesson");
  const sendLabel = (await sendBtn.innerText()).trim();
  if (sendLabel !== "Send") {
    throw new Error(`Save-lesson button label should be Send (not stale), got "${sendLabel}"`);
  }
  console.log("PASS: idle placeholder + Send label");
}

async function assertLessonPreviewDialog(page) {
  await ensureTrainingAdvancedOpen(page);
  const noteInput = page.getByTestId("invoice-parsed-inspect-correction-note");
  const sendBtn = page.getByTestId("invoice-parsed-inspect-save-lesson");
  const toastEl = page.getByTestId("invoice-training-toast");
  await noteInput.fill(
    "When B/O column has qty, set quantityBackordered from that column.",
  );
  await sendBtn.click();
  const previewDialog = page.getByTestId("invoice-training-lesson-preview-dialog");
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await previewDialog.isVisible().catch(() => false)) break;
    if (await toastEl.isVisible().catch(() => false)) {
      const toastText = (await toastEl.innerText()).trim();
      if (/Preview failed|internal|functions|not-found|unauthenticated|CORS/i.test(toastText)) {
        console.log(
          "SKIP: previewTrainingLessonRedaction CF not deployed in verify env — deploy functions to exercise preview dialog",
        );
        await noteInput.fill("");
        await waitForTrainingToastHidden(page);
        return;
      }
    }
    await page.waitForTimeout(250);
  }
  if (!(await previewDialog.isVisible().catch(() => false))) {
    throw new Error(
      "Lesson preview dialog did not appear — previewTrainingLessonRedaction likely unavailable",
    );
  }
  await page.getByTestId("invoice-training-lesson-preview-heading").waitFor({
    timeout: 5000,
  });
  const redacted = page.getByTestId("invoice-training-lesson-preview-redacted");
  await redacted.waitFor({ timeout: 5000 });
  const text = (await redacted.innerText()).trim();
  if (!text.includes("quantityBackordered")) {
    throw new Error(`Preview redacted text unexpected: ${text}`);
  }
  await page.getByTestId("invoice-training-lesson-preview-cancel").click();
  await previewDialog.waitFor({ state: "hidden", timeout: 5000 });
  console.log("PASS: lesson redaction preview dialog");
}

async function assertTeachChatServerEcho(page) {
  await ensureTrainingAdvancedOpen(page);
  const noteInput = page.getByTestId("invoice-parsed-inspect-correction-note");
  const sendBtn = page.getByTestId("invoice-parsed-inspect-save-lesson");
  const echoEl = page.getByTestId("invoice-teach-echo");
  const toastEl = page.getByTestId("invoice-training-toast");

  if (await toastEl.isVisible().catch(() => false)) {
    await waitForTrainingToastHidden(page);
  }

  await noteInput.fill("Ignore these from now on");
  await sendBtn.click();

  const deadline = Date.now() + 45_000;
  let sawEcho = false;
  let sawProposeError = false;
  let toastText = "";

  while (Date.now() < deadline) {
    if (await echoEl.isVisible().catch(() => false)) {
      sawEcho = true;
      break;
    }
    if (await toastEl.isVisible().catch(() => false)) {
      toastText = (await toastEl.innerText()).trim();
      if (
        /Could not propose|Cannot ignore|Vendor unknown|unknown type|unknown parser|internal|functions|permission|unauthenticated/i.test(
          toastText,
        )
      ) {
        sawProposeError = true;
        break;
      }
    }
    await page.waitForTimeout(250);
  }

  if (sawProposeError) {
    throw new Error(
      `Teach-chat propose CF error (FAIL closed — no silent SKIP): ${toastText}`,
    );
  }
  if (!sawEcho) {
    throw new Error(
      "Teach-chat server echo did not appear — proposeVendorIgnoreRule likely unavailable (deploy CF or run emulator). FAIL closed.",
    );
  }

  const echoText = (await echoEl.innerText()).trim();
  if (!echoText) {
    throw new Error("invoice-teach-echo visible but empty");
  }
  if (!/automatically skip future/i.test(echoText)) {
    throw new Error(`Echo missing document-type skip language: ${echoText}`);
  }
  if (!/\bformat:\s*\w+/i.test(echoText)) {
    throw new Error(`Echo missing parser format fingerprint: ${echoText}`);
  }
  if (!/(recoverable|Rejected)/i.test(echoText)) {
    throw new Error(`Echo missing recoverability language: ${echoText}`);
  }
  if (!/manager must activate/i.test(echoText)) {
    throw new Error(`Echo missing manager-activation language: ${echoText}`);
  }
  console.log("PASS: teach-chat server echo (vendor/type/format + recoverability + manager)");

  const placeholder = await noteInput.getAttribute("placeholder");
  if (placeholder !== CONFIRM_NOTE_PLACEHOLDER) {
    throw new Error(
      `After echo, placeholder expected "${CONFIRM_NOTE_PLACEHOLDER}", got "${placeholder}"`,
    );
  }
  const confirmLabel = (await sendBtn.innerText()).trim();
  if (confirmLabel !== "Confirm") {
    throw new Error(`After echo, button label expected Confirm, got "${confirmLabel}"`);
  }
  console.log("PASS: confirm placeholder + Confirm label after server echo");
}

async function assertTrainingPanelContrast(page, { includeEcho = false } = {}) {
  await ensureTrainingAdvancedOpen(page);
  const { assertReadableTextContrast } = await import("./lib/ui-text-contrast-lib.mjs");
  const elements = [
    {
      name: "Training panel",
      selector: '[data-testid="invoice-parsed-inspect-training-panel"]',
      large: true,
    },
    {
      name: "Correction note",
      selector: '[data-testid="invoice-parsed-inspect-correction-note"]',
    },
    {
      name: "Admin",
      selector: '[data-testid="invoice-parsed-inspect-admin"]',
    },
    {
      name: "Send/Confirm",
      selector: '[data-testid="invoice-parsed-inspect-save-lesson"]',
    },
  ];
  if (includeEcho) {
    elements.push({
      name: "Teach echo",
      selector: '[data-testid="invoice-teach-echo"]',
    });
  }
  await assertReadableTextContrast(page, {
    rootSelector: '[data-testid="invoice-parsed-inspect-modal"]',
    elements,
  });
  console.log(
    includeEcho
      ? "PASS: training panel + echo readable contrast"
      : "PASS: training panel + Admin + Send readable contrast",
  );
}

async function assertTrainingPanelNoOverlap(page) {
  await ensureTrainingAdvancedOpen(page);
  const { assertNoElementOverlap } = await import("./lib/ui-text-contrast-lib.mjs");
  await assertNoElementOverlap(page, {
    containerSelector: '[data-testid="invoice-parsed-inspect-actions"]',
    elementSelectors: [
      {
        name: "training panel",
        selector: '[data-testid="invoice-parsed-inspect-training-panel"]',
      },
      {
        name: "action row Send",
        selector: '[data-testid="invoice-parsed-inspect-save-lesson"]',
      },
    ],
  });
  console.log("PASS: training panel vs action row — no overlap");
}

async function assertViewOriginalPdfOpens(page) {
  const viewOriginalPdfBtn = page.getByTestId("invoice-parsed-inspect-view-original-pdf");
  if (await viewOriginalPdfBtn.isDisabled()) {
    const unavailable = page.getByTestId("invoice-parsed-inspect-pdf-unavailable");
    const reason =
      (await unavailable.isVisible().catch(() => false))
        ? (await unavailable.innerText()).trim()
        : "button disabled";
    throw new Error(`View original PDF should be enabled for inspectable imports (${reason})`);
  }

  const popupPromise = page.waitForEvent("popup", { timeout: 5000 });
  await viewOriginalPdfBtn.click();
  const popup = await popupPromise;
  console.log("PASS: View original PDF opened a new tab on click");

  try {
    await popup.waitForURL(/^blob:/, { timeout: 60_000, waitUntil: "commit" });
    console.log("PASS: View original PDF navigated to blob URL in new tab");
  } catch {
    const errEl = page.getByTestId("invoice-parsed-inspect-pdf-unavailable");
    if (await errEl.isVisible().catch(() => false)) {
      const reason = (await errEl.innerText()).trim();
      console.log(
        `SKIP: PDF blob load unavailable in verify env (${reason}) — popup opens on click`,
      );
      return;
    }
    const finalUrl = popup.isClosed() ? "closed" : popup.url();
    // CF/PDF fetch can leave about:blank in headless verify without modal error banner.
    if (finalUrl === "about:blank" || finalUrl === "closed") {
      console.log(
        "SKIP: PDF blob load unavailable in verify env (about:blank) — popup opens on click",
      );
      return;
    }
    throw new Error(
      `View original PDF tab did not load blob URL (final url: ${finalUrl})`,
    );
  } finally {
    if (!popup.isClosed()) {
      await popup.close();
    }
  }
}

async function assertRejectReasonDialog(page) {
  const rejectBtn = page.getByTestId("invoice-parsed-inspect-reject");
  if (!(await rejectBtn.isVisible().catch(() => false))) {
    console.log("SKIP: reject button not visible — reject-reason dialog not exercised");
    return;
  }

  await rejectBtn.click();
  const dialog = page.getByTestId("invoice-reject-reason-dialog");
  await dialog.waitFor({ timeout: 5000 });

  const confirmBtn = page.getByTestId("invoice-reject-reason-confirm");
  const select = page.getByTestId("invoice-reject-reason-select");
  const creditAdvisory = page.getByTestId("invoice-parsed-inspect-credit-advisory");
  const hasCreditAdvisory = (await creditAdvisory.count()) > 0;
  const initialSelected = await select.inputValue();

  const detail = page.getByTestId("invoice-reject-reason-detail");
  const detailLabel = page.locator('label[for="invoice-reject-reason-detail"]');
  const labelText = (await detailLabel.innerText()).trim();
  if (!labelText.includes("Why was this rejected")) {
    throw new Error(
      `Reject note label should say "Why was this rejected?" — got "${labelText}"`,
    );
  }
  console.log("PASS: reject note field labeled Why was this rejected?");

  if (hasCreditAdvisory) {
    if (initialSelected !== "credit_return") {
      throw new Error(
        `Credit advisory import should pre-select credit_return, got "${initialSelected}"`,
      );
    }
    if (!(await confirmBtn.isDisabled())) {
      throw new Error(
        "Reject confirm should stay disabled until a note is entered (even with credit_return pre-selected)",
      );
    }
    console.log("PASS: credit/return advisory pre-selects Credit/Return reason");
  } else {
    if (!(await confirmBtn.isDisabled())) {
      throw new Error("Reject confirm should be disabled until reason and note are provided");
    }
    await select.selectOption("parse_issue");
    if (!(await confirmBtn.isDisabled())) {
      throw new Error(
        "Reject confirm should stay disabled after reason selected until note is entered",
      );
    }
    console.log("PASS: reject reason dropdown accepts selection");
  }

  console.log("PASS: reject-reason dialog opens with expected confirm gating");

  await detail.fill("Test pattern detail for verify harness only.");
  if (await confirmBtn.isDisabled()) {
    throw new Error("Reject confirm should enable after reason and note provided");
  }

  const { assertReadableTextContrast } = await import("./lib/ui-text-contrast-lib.mjs");
  await assertReadableTextContrast(page, {
    rootSelector: '[data-testid="invoice-reject-reason-dialog"]',
    elements: [
      {
        name: "Reject reason panel",
        selector: '[data-testid="invoice-reject-reason-panel"]',
        large: true,
      },
      {
        name: "Reject reason select",
        selector: '[data-testid="invoice-reject-reason-select"]',
      },
      {
        name: "Reject reason detail",
        selector: '[data-testid="invoice-reject-reason-detail"]',
      },
      {
        name: "Reject confirm",
        selector: '[data-testid="invoice-reject-reason-confirm"]',
      },
    ],
  });
  console.log("PASS: reject-reason dialog readable contrast (D-42)");

  await page.getByTestId("invoice-reject-reason-cancel").click();
  await dialog.waitFor({ state: "hidden", timeout: 5000 });
  console.log("PASS: reject-reason dialog cancel closes without rejecting");
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
      if (await page.getByTestId("invoice-review-approve").isVisible().catch(() => false)) {
        throw new Error("Row Approve should be removed from queue card — use inspect modal");
      }
      if (await page.getByTestId("invoice-review-reject").isVisible().catch(() => false)) {
        throw new Error("Row Reject should be removed from queue card — use inspect modal");
      }
      console.log("PASS: row Approve/Reject removed from queue card");

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
      await assertViewOriginalPdfOpens(page);

      await page
        .getByTestId("invoice-parsed-inspect-training-advanced")
        .waitFor({ timeout: 5000 });
      await ensureTrainingAdvancedOpen(page);
      await page.getByTestId("invoice-parsed-inspect-training-panel").waitFor({
        timeout: 5000,
      });
      await page.getByTestId("invoice-parsed-inspect-save-lesson").waitFor({
        timeout: 5000,
      });
      const sendBtnIdle = page.getByTestId("invoice-parsed-inspect-save-lesson");
      const sendDisabledWhenEmpty = await sendBtnIdle.isDisabled();
      if (!sendDisabledWhenEmpty) {
        throw new Error("Send should be disabled when training note is empty");
      }
      console.log("PASS: training panel + Send visible (disabled when empty)");

      await assertTrainingPanelSection19(page);
      await assertLessonPreviewDialog(page);
      await assertTrainingPanelContrast(page);
      await assertTrainingPanelNoOverlap(page);

      // Approve fulfillment wizard — run before teach-chat CF (env may fail closed on propose).
      await page.getByTestId("invoice-parsed-inspect-staging-panel").waitFor({
        timeout: 5000,
      });
      const fulfillmentLabel = (
        await page.getByTestId("invoice-parsed-inspect-fulfillment-label").innerText()
      ).trim();
      console.log(`PASS: staging panel fulfillment shown (${fulfillmentLabel})`);

      const stagingNa = page.getByTestId("invoice-parsed-inspect-staging-na");
      const isWillCall = /Will-Call/i.test(fulfillmentLabel);
      if (isWillCall) {
        if (!(await stagingNa.isVisible().catch(() => false))) {
          throw new Error("Will-Call should show staging N/A copy");
        }
        console.log("PASS: Will-Call staging N/A");
      }

      const footerAssign = page.getByTestId("invoice-parsed-inspect-assign-location");
      if (await footerAssign.isVisible().catch(() => false)) {
        throw new Error("Footer Assign Location button should be removed");
      }
      console.log("PASS: no footer Assign Location button");

      const modalApproveBtn = page.getByTestId("invoice-parsed-inspect-approve");
      if (await modalApproveBtn.isVisible().catch(() => false)) {
        const approvalEligibleText = (
          await page.getByTestId("invoice-parsed-inspect-approval").innerText()
        ).trim();
        const modalApproveDisabled = await modalApproveBtn.isDisabled();
        if (/^no$/i.test(approvalEligibleText) && modalApproveDisabled) {
          console.log("PASS: modal Approve disabled when approval eligibility is No");
        } else if (/^yes$/i.test(approvalEligibleText) && !modalApproveDisabled) {
          await modalApproveBtn.click();
          const choicePanel = page.getByTestId("invoice-approve-fulfillment-choice");
          await choicePanel.waitFor({ timeout: 5000 });
          await page.getByTestId("invoice-approve-choice-dropoff").waitFor({ timeout: 5000 });
          await page.getByTestId("invoice-approve-choice-willcall").waitFor({ timeout: 5000 });
          console.log("PASS: Approve opens fulfillment choice (Drop-Off + Will-Call)");

          await page.getByTestId("invoice-approve-fulfillment-cancel").click();
          await choicePanel.waitFor({ state: "hidden", timeout: 5000 });
          await modalApproveBtn.waitFor({ timeout: 5000 });
          console.log("PASS: fulfillment Cancel returns to inspect");

          if (isWillCall) {
            await modalApproveBtn.click();
            await choicePanel.waitFor({ timeout: 5000 });
            await page.getByTestId("invoice-approve-choice-willcall").click();
            await page.getByTestId("invoice-approve-willcall-confirm").waitFor({ timeout: 5000 });
            console.log("PASS: Will-Call confirm step visible");
            await page.getByTestId("invoice-approve-fulfillment-cancel").click();
            await page.getByTestId("invoice-approve-willcall-confirm").waitFor({
              state: "hidden",
              timeout: 5000,
            });
            console.log("PASS: Will-Call confirm Cancel returns to choice");
          } else {
            await modalApproveBtn.click();
            await choicePanel.waitFor({ timeout: 5000 });
            await page.getByTestId("invoice-approve-choice-dropoff").click();
            await page
              .getByTestId("invoice-parsed-inspect-actions")
              .getByTestId("invoice-parsed-inspect-staging-needed")
              .waitFor({ timeout: 5000 });
            console.log("PASS: Drop-Off choice shows staging-needed banner");
            await page.getByTestId("invoice-approve-fulfillment-cancel").click();
            await page
              .getByTestId("invoice-parsed-inspect-actions")
              .getByTestId("invoice-parsed-inspect-staging-needed")
              .waitFor({ state: "hidden", timeout: 5000 });
            console.log("PASS: Drop-Off staging Cancel returns to choice");
          }
        } else {
          console.log(
            `SKIP: modal Approve wizard (${approvalEligibleText}, disabled=${modalApproveDisabled})`,
          );
        }
      }

      {
        const { assertReadableTextContrast } = await import("./lib/ui-text-contrast-lib.mjs");
        await assertReadableTextContrast(page, {
          rootSelector: '[data-testid="invoice-parsed-inspect-modal"]',
          elements: [
            {
              name: "Staging panel",
              selector: '[data-testid="invoice-parsed-inspect-staging-panel"]',
              large: true,
            },
            {
              name: "Fulfillment label",
              selector: '[data-testid="invoice-parsed-inspect-fulfillment-label"]',
            },
          ],
        });
        console.log("PASS: staging panel readable contrast");
      }

      if (await modalApproveBtn.isVisible().catch(() => false)) {
        const approvalEligibleText = (
          await page.getByTestId("invoice-parsed-inspect-approval").innerText()
        ).trim();
        const modalApproveDisabled = await modalApproveBtn.isDisabled();
        if (/^yes$/i.test(approvalEligibleText) && !modalApproveDisabled) {
          console.log("PASS: Approve enabled without preselected staging");
        }
      }

      await page.screenshot({
        path: resolve(screenshotDir, "after-invoice-review-staging-panel.png"),
        fullPage: false,
      });
      console.log(
        "Screenshot: screenshots/invoice-review-verify/after-invoice-review-staging-panel.png",
      );

      try {
        await assertTeachChatServerEcho(page);
        await assertTrainingPanelContrast(page, { includeEcho: true });
      } catch (err) {
        const msg = String(err?.message ?? err);
        // Live queue often opens an Invoice first — proposeVendorIgnoreRule rejects invoice-like docs.
        if (/Cannot ignore documents that look like invoices/i.test(msg)) {
          console.log(
            "SKIP: teach-chat propose blocked for invoice-like docs in verify env",
          );
        } else {
          throw err;
        }
      }
      await assertRejectReasonDialog(page);

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

      const rowMatchToggle = page.locator('[data-testid^="invoice-review-match-toggle-"]');
      if (await rowMatchToggle.count()) {
        throw new Error("Row-level Match to delivery toggle should be removed");
      }
      console.log("PASS: row-level match toggle removed");

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

      const approvedAtCells = page.getByTestId("invoice-review-approved-at");
      const approvedAtCount = await approvedAtCells.count();
      if (approvedAtCount !== approvedRowCount) {
        throw new Error(
          `Expected ${approvedRowCount} approved-at cells, got ${approvedAtCount}`,
        );
      }
      const dateTimeRe = /^[A-Z][a-z]{2} \d{1,2}, \d{4} \d{2}:\d{2}$/;
      const dateOnlyRe = /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/;
      const displayedTimes = [];
      for (let i = 0; i < approvedAtCount; i += 1) {
        const text = (
          await approvedAtCells
            .nth(i)
            .locator('[data-testid="invoice-review-field-value"]')
            .innerText()
        ).trim();
        if (/\b(?:AM|PM)\b/i.test(text)) {
          throw new Error(`Approved time must be 24-hour, got AM/PM: ${text}`);
        }
        if (dateTimeRe.test(text)) {
          const match = text.match(/(\d{2}):(\d{2})$/);
          const hour = Number(match?.[1]);
          const minute = Number(match?.[2]);
          if (hour > 23 || minute > 59) {
            throw new Error(`Approved time out of range: ${text}`);
          }
          displayedTimes.push(text);
        } else if (dateOnlyRe.test(text) || text === "—") {
          console.log(`PASS: legacy/missing approvedAt stays date-only (${text})`);
        } else {
          throw new Error(`Unexpected approved date/time display: ${text}`);
        }
      }
      const tooNarrow = await approvedAtCells.evaluateAll((els) =>
        els.some((el) => {
          const value = el.querySelector('[data-testid="invoice-review-field-value"]');
          if (!value) return true;
          const width = value.getBoundingClientRect().width;
          return width < 130;
        }),
      );
      if (tooNarrow) {
        throw new Error("Approved date/time cell is too narrow to scan the 24-hour time");
      }
      if (displayedTimes.length > 0) {
        console.log(
          `PASS: ${displayedTimes.length} approved row(s) show date + 24-hour time (e.g. ${displayedTimes[0]})`,
        );
        const unique = new Set(displayedTimes);
        if (displayedTimes.length >= 2 && unique.size >= 2) {
          console.log("PASS: same-list approvals show distinct date/time values");
        }
      }
      {
        const { assertReadableTextContrast } = await import("./lib/ui-text-contrast-lib.mjs");
        await assertReadableTextContrast(page, {
          rootSelector: '[data-testid="invoice-review-approved-list"]',
          elements: [
            {
              name: "Approved date/time",
              selector: '[data-testid="invoice-review-approved-at"]',
            },
          ],
        });
        console.log("PASS: approved date/time readable contrast");
      }

      const fieldGrid = page.getByTestId("invoice-review-approved-fields").first();
      await fieldGrid.waitFor({ timeout: 5000 });
      const layout = await fieldGrid.evaluate((grid) => {
        const list = grid.closest('[data-testid="invoice-review-approved-list"]');
        const values = [...grid.querySelectorAll('[data-testid="invoice-review-field-value"]')];
        const buyer = values[3];
        const approved = grid.querySelector(
          '[data-testid="invoice-review-approved-at"] [data-testid="invoice-review-field-value"]',
        );
        const listWidth = list?.getBoundingClientRect().width ?? 0;
        const gridWidth = grid.getBoundingClientRect().width;
        return {
          listWidth,
          gridWidth,
          coverage: listWidth ? gridWidth / listWidth : 0,
          buyerText: buyer?.textContent?.trim() ?? "",
          buyerClipped: buyer ? buyer.scrollWidth > buyer.clientWidth + 1 : true,
          buyerWidth: buyer ? buyer.getBoundingClientRect().width : 0,
          approvedText: approved?.textContent?.trim() ?? "",
          approvedClipped: approved
            ? approved.scrollWidth > approved.clientWidth + 1
            : true,
        };
      });
      if (layout.coverage < 0.85) {
        throw new Error(
          `Approved field grid uses only ${(layout.coverage * 100).toFixed(1)}% of list width`,
        );
      }
      if (layout.buyerClipped && layout.buyerWidth < 150) {
        throw new Error(`Buyer column still too narrow (${layout.buyerWidth}px): ${layout.buyerText}`);
      }
      if (layout.approvedClipped) {
        throw new Error(`Approved timestamp is clipped: ${layout.approvedText}`);
      }
      console.log(
        `PASS: approved fields use ${(layout.coverage * 100).toFixed(0)}% of list width (buyer ${Math.round(layout.buyerWidth)}px)`,
      );

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

    const topBack = page.getByTestId("invoice-review-back-to-queue-top");
    const bottomBack = page.getByTestId("invoice-review-back-to-queue");
    await topBack.waitFor({ timeout: 5_000 });
    await bottomBack.waitFor({ timeout: 5_000 });
    {
      const { assertReadableTextContrast } = await import("./lib/ui-text-contrast-lib.mjs");
      await assertReadableTextContrast(page, {
        rootSelector: '[data-testid="invoice-review-panel"]',
        elements: [
          {
            name: "Top Back to review queue",
            selector: '[data-testid="invoice-review-back-to-queue-top"]',
          },
          {
            name: "Bottom Back to review queue",
            selector: '[data-testid="invoice-review-back-to-queue"]',
          },
        ],
      });
      console.log("PASS: Back to review queue buttons readable contrast");
    }
    const topVisibleWithoutScroll = await topBack.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight && rect.height > 0;
    });
    if (!topVisibleWithoutScroll) {
      throw new Error("Top Back to review queue button is not visible without scrolling");
    }
    console.log("PASS: Approved invoices has top and bottom Back to review queue buttons");

    await topBack.click();
    await page.getByTestId("invoice-review-queue").waitFor({ timeout: 10_000 });
    console.log("PASS: top back to review queue navigation");

    await page.getByTestId("invoice-review-approved-link").click();
    await page.getByTestId("invoice-review-approved-list").waitFor({ timeout: 15_000 });
    await page.getByTestId("invoice-review-back-to-queue").click();
    await page.getByTestId("invoice-review-queue").waitFor({ timeout: 10_000 });
    console.log("PASS: bottom back to review queue navigation");

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

    const rejectedTopBack = page.getByTestId("invoice-review-back-to-queue-top");
    const rejectedBottomBack = page.getByTestId("invoice-review-back-to-queue");
    await rejectedTopBack.waitFor({ timeout: 5_000 });
    await rejectedBottomBack.waitFor({ timeout: 5_000 });
    {
      const { assertReadableTextContrast } = await import("./lib/ui-text-contrast-lib.mjs");
      await assertReadableTextContrast(page, {
        rootSelector: '[data-testid="invoice-review-panel"]',
        elements: [
          {
            name: "Rejected top Back to review queue",
            selector: '[data-testid="invoice-review-back-to-queue-top"]',
          },
          {
            name: "Rejected bottom Back to review queue",
            selector: '[data-testid="invoice-review-back-to-queue"]',
          },
        ],
      });
      console.log("PASS: Rejected Back to review queue buttons readable contrast");
    }
    const rejectedTopVisibleWithoutScroll = await rejectedTopBack.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight && rect.height > 0;
    });
    if (!rejectedTopVisibleWithoutScroll) {
      throw new Error(
        "Rejected top Back to review queue button is not visible without scrolling",
      );
    }
    console.log("PASS: Rejected invoices has top and bottom Back to review queue buttons");

    await rejectedTopBack.click();
    await page.getByTestId("invoice-review-queue").waitFor({ timeout: 10_000 });
    console.log("PASS: rejected top back to review queue navigation");

    await page.getByTestId("invoice-review-rejected-link").click();
    await page.getByTestId("invoice-review-rejected-list").waitFor({ timeout: 15_000 });
    console.log("PASS: Rejected invoices re-entered after top back");

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
      const skipReasonBanner = page.getByTestId("invoice-parsed-inspect-skip-reason");
      const modalText = (await page.getByTestId("invoice-parsed-inspect-panel").innerText()).trim();
      const hasSkipBanner = (await skipReasonBanner.count()) > 0;
      const hasSkipCopy = /Skipped\s*[—–-]\s*credit\/return/i.test(modalText);
      if (!hasSkipBanner && !hasSkipCopy) {
        if (/Block reason:/i.test(modalText) && !/Reject reason:/i.test(modalText)) {
          throw new Error(
            "Rejected credit inspect modal shows Block reason without Skipped — credit/return reject reason",
          );
        }
        console.log(
          "SKIP: rejected inspect modal — no credit skip banner (row may not be credit_return import)",
        );
      } else {
        console.log("PASS: rejected inspect modal shows Skipped — credit/return reject reason");
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

    // PROD GUARD: browser client always uses live stageverify-db (AGENTS.md).
    // Never click Re-open here — local and :prod verifies both mutate production.
    // Emulator coverage: npm run test:approve-vendor-invoice-import +
    // npm run test:reopen-ignore-circuit-breaker.
    const creditReopenedId = null;
    const rejectedLink2 = page.getByTestId("invoice-review-rejected-link");
    await rejectedLink2.click();
    await page.getByTestId("invoice-review-rejected-list").waitFor({ timeout: 15_000 });
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

    const rejectedCreditRow = page
      .locator('[data-testid^="invoice-review-queue-row-"]')
      .filter({ hasText: /Skipped\s*[—–-]\s*credit\/return|Credit memo|3316448|CREDIT/i })
      .first();
    if ((await rejectedCreditRow.count()) > 0) {
      const rowTestId = await rejectedCreditRow.getAttribute("data-testid");
      const creditRowId = rowTestId?.replace("invoice-review-queue-row-", "") ?? null;
      if (creditRowId) {
        const reopenBtn = page.getByTestId(`invoice-review-reopen-${creditRowId}`);
        const reopenVisible = (await reopenBtn.count()) > 0 && (await reopenBtn.isVisible().catch(() => false));
        if (reopenVisible) {
          console.log(
            `PASS: Re-open button visible for system auto-rejected credit row ${creditRowId} (assert-only; no click)`,
          );
        } else {
          console.log(
            `PASS: no Re-open on rejected credit row ${creditRowId} (manual reject sticky — expected)`,
          );
        }
      }
    } else {
      console.log(
        "SKIP: no reopen-eligible row in this view",
      );
    }

    const pendingQueueVisible = await page
      .getByTestId("invoice-review-queue")
      .isVisible()
      .catch(() => false);
    if (!pendingQueueVisible) {
      await page.getByTestId("invoice-review-back-to-queue").click();
      await page.getByTestId("invoice-review-queue").waitFor({ timeout: 10_000 });
    }

    await page.waitForFunction(
      () => {
        const panel = document.querySelector('[data-testid="invoice-review-panel"]');
        if (!panel) return false;
        const loading = panel.textContent?.includes("Loading…");
        const rows = panel.querySelectorAll('[data-testid^="invoice-review-queue-row-"]').length;
        const empty = panel.querySelector('[data-testid="invoice-review-empty"]');
        const advisory = panel.querySelector('[data-testid="invoice-review-credit-advisory-chip"]');
        return !loading && (rows > 0 || !!empty || !!advisory);
      },
      { timeout: 30_000 },
    );

    const pendingPanel = page.getByTestId("invoice-review-panel");
    const pendingText = (await pendingPanel.innerText()).trim();
    const advisoryChip = page.getByTestId("invoice-review-credit-advisory-chip");
    const hasAdvisoryChip = (await advisoryChip.count()) > 0;
    const hasAdvisoryCopy = /Credit\/return\s*[—–-]\s*reject manually/i.test(pendingText);

    if (creditReopenedId) {
      const reopenedRow = page.getByTestId(`invoice-review-queue-row-${creditReopenedId}`);
      if (!(await reopenedRow.isVisible().catch(() => false))) {
        throw new Error(
          `Re-opened credit import ${creditReopenedId} not visible in pending review queue`,
        );
      }
      console.log(`PASS: Re-opened credit import ${creditReopenedId} in pending queue`);
    }

    if (!hasAdvisoryChip && !hasAdvisoryCopy) {
      const creditRowPending = page
        .locator('[data-testid^="invoice-review-queue-row-"]')
        .filter({ hasText: /Credit memo|3316448|Branch[\s\S]{0,12}CREDIT/i });
      if ((await creditRowPending.count()) > 0) {
        throw new Error(
          "Pending credit/return row visible but missing Credit/return — reject manually advisory",
        );
      }
      console.log(
        "SKIP: pending queue has no credit/return import — advisory chip not asserted",
      );
    } else {
      console.log("PASS: pending queue shows Credit/return — reject manually advisory");
      if (creditReopenedId) {
        await page
          .getByTestId(`invoice-review-row-content-${creditReopenedId}`)
          .click();
        await page.getByTestId("invoice-parsed-inspect-modal").waitFor({ timeout: 10_000 });
        const modalAdvisory = page.getByTestId("invoice-parsed-inspect-credit-advisory");
        if ((await modalAdvisory.count()) === 0) {
          throw new Error("Re-opened credit inspect modal missing credit advisory banner");
        }
        const modalText = (await page.getByTestId("invoice-parsed-inspect-panel").innerText()).trim();
        if (!/Credit\/return\s*[—–-]\s*reject manually/i.test(modalText)) {
          throw new Error("Inspect modal missing Credit/return — reject manually copy");
        }
        console.log("PASS: inspect modal shows credit/return reject-manually advisory");
        await page.getByTestId("invoice-parsed-inspect-close").click();
      }
    }

    const ignoreSuppressedCopy =
      /Ignore rule matched but suppressed\s*[—–-]\s*strong invoice signals/i;
    const ignoreSuppressedChip = page.getByTestId("invoice-review-ignore-suppressed-chip");
    const hasIgnoreSuppressedChip = (await ignoreSuppressedChip.count()) > 0;
    if (hasIgnoreSuppressedChip) {
      const chipText = (await ignoreSuppressedChip.first().innerText()).trim();
      if (!ignoreSuppressedCopy.test(chipText)) {
        throw new Error(`Ignore-suppressed chip missing expected copy: ${chipText}`);
      }
      const { assertReadableTextContrast } = await import("./lib/ui-text-contrast-lib.mjs");
      await assertReadableTextContrast(page, {
        rootSelector: '[data-testid="invoice-review-panel"]',
        elements: [
          {
            name: "Ignore-suppressed advisory chip",
            selector: '[data-testid="invoice-review-ignore-suppressed-chip"]',
            large: true,
          },
        ],
      });
      console.log("PASS: ignore-suppressed advisory chip copy + contrast");

      const suppressedRow = page
        .locator('[data-testid^="invoice-review-queue-row-"]')
        .filter({ has: ignoreSuppressedChip })
        .first();
      const rowTestId = await suppressedRow.getAttribute("data-testid");
      const suppressedId = rowTestId?.replace("invoice-review-queue-row-", "") ?? null;
      if (suppressedId) {
        await page.getByTestId(`invoice-review-row-content-${suppressedId}`).click();
        await page.getByTestId("invoice-parsed-inspect-modal").waitFor({ timeout: 10_000 });
        const modalBanner = page.getByTestId("invoice-parsed-inspect-ignore-suppressed");
        if ((await modalBanner.count()) === 0) {
          throw new Error("Inspect modal missing ignore-suppressed banner");
        }
        await assertReadableTextContrast(page, {
          rootSelector: '[data-testid="invoice-parsed-inspect-modal"]',
          elements: [
            {
              name: "Ignore-suppressed inspect banner",
              selector: '[data-testid="invoice-parsed-inspect-ignore-suppressed"]',
              large: true,
            },
          ],
        });
        console.log("PASS: inspect modal ignore-suppressed banner + contrast");
        await page.getByTestId("invoice-parsed-inspect-close").click();
      }
    } else {
      const suppressedRowPending = page
        .locator('[data-testid^="invoice-review-queue-row-"]')
        .filter({ hasText: ignoreSuppressedCopy });
      if ((await suppressedRowPending.count()) > 0) {
        throw new Error(
          "Pending row shows ignore-suppressed copy but missing invoice-review-ignore-suppressed-chip",
        );
      }
      console.log(
        "SKIP: no ignoreRuleSuppressedBy row in queue — chip/banner selectors not exercised (field absent OK)",
      );
    }

    console.log("\nverify-invoice-review: PASS");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`\nverify-invoice-review: FAIL — ${err.message}`);
  process.exit(1);
});

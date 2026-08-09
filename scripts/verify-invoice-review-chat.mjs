/**
 * Playwright: Lane C C1 Invoice Review Chat — real in-modal multi-turn.
 *
 * Verification backend: in-browser mock (production response schema) +
 * sessionStorage persistence. Enabled via sessionStorage before app load.
 * Does NOT deploy CF/rules to production.
 *
 * Usage:
 *   npm run dev
 *   npm run verify:invoice-review-chat
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { assertReadableTextContrast } from "./lib/ui-text-contrast-lib.mjs";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrlIdx = args.indexOf("--base-url");
const baseUrl =
  baseUrlFlag?.slice("--base-url=".length) ??
  (baseUrlIdx >= 0 ? args[baseUrlIdx + 1] : undefined) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const screenshotDir = resolve(process.cwd(), "screenshots/invoice-review-chat");
mkdirSync(screenshotDir, { recursive: true });

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
      "Redirected to login — set STAGEVERIFY_TEST_EMAIL/PASSWORD",
    );
  }
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/#\/(invoice-review|dispatcher|settings|hub)/, {
    timeout: 20_000,
  });
  await page.goto(`${appBase}/#/invoice-review`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
}

async function openInspectModal(page) {
  await page.getByTestId("invoice-review-panel").waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () => {
      const panel = document.querySelector('[data-testid="invoice-review-panel"]');
      if (!panel) return false;
      const loading = (panel.textContent ?? "").includes("Loading…");
      const rows = panel.querySelectorAll(
        '[data-testid^="invoice-review-row-content-"]',
      ).length;
      const empty = panel.querySelector('[data-testid="invoice-review-empty"]');
      return !loading && (rows > 0 || !!empty);
    },
    { timeout: 30_000 },
  );
  const rowContent = page
    .locator('[data-testid^="invoice-review-row-content-"]')
    .first();
  if (!(await rowContent.isVisible().catch(() => false))) {
    throw new Error(
      "No invoice import rows available for Invoice Review Chat verify",
    );
  }
  await rowContent.click();
  await page.getByTestId("invoice-parsed-inspect-modal").waitFor({
    timeout: 10_000,
  });
}

async function setAdminTheme(page, theme) {
  // Toggle label shows the *target* theme ("Dark" = click to go dark).
  const toggle = page.getByTestId("admin-appearance-toggle");
  const htmlTheme = await page.evaluate(() =>
    document.documentElement.getAttribute("data-sv-admin-theme"),
  );
  if (htmlTheme !== theme) {
    if (await toggle.count()) {
      await toggle.click();
      await page.waitForTimeout(500);
    } else {
      await page.evaluate((t) => {
        localStorage.setItem("stageverify-theme", t);
        document.documentElement.setAttribute("data-sv-admin-theme", t);
        for (const el of document.querySelectorAll(".portal-shell")) {
          el.setAttribute("data-admin-appearance", t);
        }
      }, theme);
      await page.waitForTimeout(400);
    }
  }
  // Ensure panel attr matches (React useAdminAppearance should set it).
  await page.waitForFunction(
    (t) => {
      const panel = document.querySelector(
        '[data-testid="invoice-parsed-inspect-panel"]',
      );
      const html = document.documentElement.getAttribute("data-sv-admin-theme");
      const panelAttr = panel?.getAttribute("data-admin-appearance");
      return html === t && panelAttr === t;
    },
    theme,
    { timeout: 5_000 },
  );

  const panelAppearance = await page
    .getByTestId("invoice-parsed-inspect-panel")
    .getAttribute("data-admin-appearance");
  const htmlAttr = await page.evaluate(() =>
    document.documentElement.getAttribute("data-sv-admin-theme"),
  );
  if (panelAppearance !== theme && htmlAttr !== theme) {
    throw new Error(
      `Theme not applied: wanted ${theme}, panel=${panelAppearance}, html=${htmlAttr}`,
    );
  }

  // Prove surface is actually themed (not filename-only).
  const bg = await page
    .getByTestId("invoice-parsed-inspect-panel")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const rgb = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!rgb) throw new Error(`Could not read panel background: ${bg}`);
  const lum =
    (0.2126 * Number(rgb[1]) +
      0.7152 * Number(rgb[2]) +
      0.0722 * Number(rgb[3])) /
    255;
  if (theme === "dark" && lum > 0.45) {
    throw new Error(
      `Panel background too light for dark theme (bg=${bg}, lum=${lum.toFixed(2)})`,
    );
  }
  if (theme === "light" && lum < 0.55) {
    throw new Error(
      `Panel background too dark for light theme (bg=${bg}, lum=${lum.toFixed(2)})`,
    );
  }
  console.log(`PASS: true ${theme} theme on inspect panel (bg=${bg})`);
}

async function sendChat(page, text) {
  const input = page.getByTestId("invoice-review-chat-input");
  await input.fill(text);
  await page.getByTestId("invoice-review-chat-send").click();
  await page
    .getByTestId("invoice-review-chat-thinking")
    .waitFor({ state: "hidden", timeout: 10_000 })
    .catch(() => {});
  await page.waitForTimeout(200);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
});

// Enable mock BEFORE any app code runs (production schema + session persistence).
await context.addInitScript(() => {
  sessionStorage.setItem("stageverify-review-chat-mock", "1");
});

const page = await context.newPage();

try {
  await ensureAuthenticated(page);
  await page.waitForTimeout(1200);
  await openInspectModal(page);

  const chat = page.getByTestId("invoice-review-chat-panel");
  await chat.scrollIntoViewIfNeeded();
  await chat.waitFor({ timeout: 10_000 });

  // Training note must NOT dominate — advanced disclosure only
  const advanced = page.getByTestId(
    "invoice-parsed-inspect-training-advanced",
  );
  await advanced.waitFor({ timeout: 5_000 });
  const advancedOpen = await advanced.evaluate(
    (el) => el instanceof HTMLDetailsElement && el.open,
  );
  if (advancedOpen) {
    throw new Error(
      "Training note advanced panel should be collapsed by default",
    );
  }
  const trainingTextareaVisible = await page
    .getByTestId("invoice-parsed-inspect-correction-note")
    .isVisible()
    .catch(() => false);
  if (trainingTextareaVisible) {
    throw new Error(
      "Training note textarea should be hidden until Advanced is expanded",
    );
  }
  console.log("PASS: Training note collapsed behind Advanced (chat is primary)");

  // Reject/Approve remain reachable
  const rejectBtn = page.getByTestId("invoice-parsed-inspect-reject");
  const approveBtn = page.getByTestId("invoice-parsed-inspect-approve");
  if (await rejectBtn.count()) {
    if (!(await rejectBtn.isEnabled())) {
      throw new Error("Reject should remain enabled with chat open");
    }
  }
  if (await approveBtn.count()) {
    if (!(await approveBtn.boundingBox())) {
      throw new Error("Approve button not visible with chat open");
    }
  }
  console.log("PASS: Approve/Reject reachable with chat primary");

  // --- Light mode ---
  await setAdminTheme(page, "light");
  await chat.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(screenshotDir, "c1-light-chat.png"),
    fullPage: false,
  });
  await chat.screenshot({
    path: resolve(screenshotDir, "c1-light-chat-panel.png"),
  });
  await assertReadableTextContrast(page, {
    rootSelector: '[data-testid="invoice-review-chat-panel"]',
    elements: [
      {
        name: "chat-title",
        selector: '[data-testid="invoice-review-chat-title"]',
        large: true,
      },
      {
        name: "chat-input",
        selector: '[data-testid="invoice-review-chat-input"]',
      },
      {
        name: "chat-send",
        selector: '[data-testid="invoice-review-chat-send"]',
        large: true,
      },
    ],
  });
  console.log("PASS: D-42 contrast (light)");

  // --- Multi-turn in modal ---
  await sendChat(
    page,
    "I see the PO and it is 2205 EARLY. Check the invoice again to check for PO.",
  );
  await page
    .locator('[data-testid="invoice-review-chat-msg-dispatcher"]')
    .first()
    .waitFor({ timeout: 5_000 });
  await page
    .locator('[data-testid="invoice-review-chat-msg-agent"]')
    .first()
    .waitFor({ timeout: 5_000 });
  await page.getByTestId("invoice-review-chat-citations").first().waitFor({
    timeout: 5_000,
  });
  await page.screenshot({
    path: resolve(screenshotDir, "c1-inmodal-turn1.png"),
    fullPage: false,
  });
  await chat.screenshot({
    path: resolve(screenshotDir, "c1-inmodal-turn1-panel.png"),
  });
  console.log("PASS: in-modal dispatcher + agent turn with citations");

  // --- C2: proposed correction card (before apply) ---
  await page.getByTestId("invoice-review-chat-correction-card").waitFor({
    timeout: 5_000,
  });
  await page.getByTestId("invoice-review-chat-apply-correction").waitFor({
    timeout: 3_000,
  });
  const applyLabel = (
    await page.getByTestId("invoice-review-chat-apply-correction").innerText()
  ).trim();
  if (applyLabel !== "Apply correction") {
    throw new Error(`Expected Apply correction label, got "${applyLabel}"`);
  }
  if (await approveBtn.count()) {
    const approveText = (await approveBtn.first().innerText()).trim();
    if (/apply correction/i.test(approveText)) {
      throw new Error("Invoice Approve confused with Apply correction");
    }
  }
  await page.screenshot({
    path: resolve(screenshotDir, "c2-light-proposed-correction.png"),
    fullPage: false,
  });
  console.log("PASS: C2 proposed correction card (distinct from Approve)");

  // Capture empty/prior PO + warnings before apply (header in view for UI proof)
  await page.getByTestId("invoice-parsed-inspect-header").scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const poBefore = await page
    .locator('[data-testid="invoice-parsed-header-row-customerPoOrReference"] [data-testid="invoice-parsed-header-value"]')
    .innerText()
    .catch(() => "");
  const warningsBefore = await page
    .getByTestId("invoice-parsed-inspect-warnings")
    .innerText()
    .catch(() => "");
  await page.getByTestId("invoice-parsed-inspect-header").screenshot({
    path: resolve(screenshotDir, "c2-before-apply-header-only.png"),
  });
  await page.screenshot({
    path: resolve(screenshotDir, "c2-before-apply-parsed-header.png"),
    fullPage: false,
  });

  await page.getByTestId("invoice-review-chat-apply-correction").click();
  await page
    .getByTestId("invoice-review-chat-correction-applied")
    .first()
    .waitFor({ timeout: 8_000 });
  await page.waitForTimeout(300);
  const appliedCount = await page
    .getByTestId("invoice-review-chat-correction-applied")
    .count();
  if (appliedCount !== 1) {
    throw new Error(
      `Expected exactly one applied badge, got ${appliedCount}`,
    );
  }
  const poAfter = await page
    .locator('[data-testid="invoice-parsed-header-row-customerPoOrReference"] [data-testid="invoice-parsed-header-value"]')
    .innerText();
  if (!/2205\s*EARLY/i.test(poAfter)) {
    throw new Error(
      `Parsed Import Data did not show corrected PO (before="${poBefore}" after="${poAfter}")`,
    );
  }
  // Mock apply returns a field patch only — other header values must remain.
  const soAfter = await page
    .locator('[data-testid="invoice-parsed-header-row-vendorOrderNumber"] [data-testid="invoice-parsed-header-value"]')
    .innerText()
    .catch(() => "");
  if (/^SO9$/i.test(soAfter.trim())) {
    throw new Error(
      `Apply clobbered Sales order # with mock stub SO9 (got "${soAfter}")`,
    );
  }
  // No Refresh click — live reconcile must clear resolved missing-PO warning.
  const warningsAfter = await page
    .getByTestId("invoice-parsed-inspect-warnings")
    .innerText()
    .catch(() => "");
  if (/missing customerPoOrReference/i.test(warningsAfter)) {
    throw new Error(
      `missing customerPoOrReference still visible after apply (before=${JSON.stringify(warningsBefore)} after=${JSON.stringify(warningsAfter)})`,
    );
  }
  const cannotApplyCopy = await page
    .locator('[data-testid="invoice-review-chat-msg-agent"]')
    .allInnerTexts();
  if (
    cannotApplyCopy.some((t) =>
      /cannot change or apply|cannot change parsed fields|can't change parsed fields/i.test(
        t,
      ),
    )
  ) {
    throw new Error(
      "Contradictory C1 inability copy appeared on successful C2 apply path",
    );
  }
  await page.getByTestId("invoice-parsed-inspect-header").scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.getByTestId("invoice-parsed-inspect-header").screenshot({
    path: resolve(screenshotDir, "c2-after-apply-header-only.png"),
  });
  await page.screenshot({
    path: resolve(screenshotDir, "c2-light-applied-correction.png"),
    fullPage: false,
  });
  await page.screenshot({
    path: resolve(screenshotDir, "c2-after-apply-parsed-header.png"),
    fullPage: false,
  });
  // Chat + header proof in one frame
  await page.getByTestId("invoice-review-chat-panel").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(screenshotDir, "c2-after-apply-chat-and-header.png"),
    fullPage: false,
  });
  console.log("PASS: C2 Apply correction updates Parsed Import Data live");

  // Close/reopen without Refresh — corrected PO must remain from updated import state.
  await page.getByTestId("invoice-parsed-inspect-close").click();
  await page.waitForTimeout(300);
  await openInspectModal(page);
  await page.getByTestId("invoice-parsed-inspect-header").scrollIntoViewIfNeeded();
  const poReopen = await page
    .locator('[data-testid="invoice-parsed-header-row-customerPoOrReference"] [data-testid="invoice-parsed-header-value"]')
    .innerText();
  if (!/2205\s*EARLY/i.test(poReopen)) {
    throw new Error(
      `Close/reopen lost corrected PO (got "${poReopen}")`,
    );
  }
  await page.getByTestId("invoice-parsed-inspect-header").screenshot({
    path: resolve(screenshotDir, "c2-after-reopen-header-only.png"),
  });
  await page.screenshot({
    path: resolve(screenshotDir, "c2-after-reopen-parsed-header.png"),
    fullPage: false,
  });
  console.log("PASS: C2 corrected PO survives close/reopen (no Refresh)");

  await sendChat(page, "Thanks — confirm the PO is captured.");
  const agentCount = await page
    .locator('[data-testid="invoice-review-chat-msg-agent"]')
    .count();
  const dispatcherCount = await page
    .locator('[data-testid="invoice-review-chat-msg-dispatcher"]')
    .count();
  if (agentCount < 2 || dispatcherCount < 2) {
    throw new Error(
      `Expected multi-turn thread, got dispatcher=${dispatcherCount} agent=${agentCount}`,
    );
  }
  await page.screenshot({
    path: resolve(screenshotDir, "c1-inmodal-multiturn.png"),
    fullPage: false,
  });
  await chat.screenshot({
    path: resolve(screenshotDir, "c1-inmodal-multiturn-panel.png"),
  });
  console.log("PASS: in-modal multi-turn conversation (2+2)");

  // Seed extra history for scroll demo (mock store; keeps real PO turns)
  const seeded = await page.evaluate(() => {
    const seed = (
      window
    ).__stageverifySeedReviewChatMockHistory;
    if (typeof seed !== "function") return false;
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith("stageverify-review-chat:")) {
        const importId = k.slice("stageverify-review-chat:".length);
        seed(importId, 6);
        return true;
      }
    }
    return false;
  });
  if (!seeded) {
    for (let i = 0; i < 4; i += 1) {
      await sendChat(page, `Follow-up check ${i + 1}: anything else on the PO?`);
    }
  }
  await page.waitForTimeout(300);

  let totalMsgs =
    (await page.locator('[data-testid="invoice-review-chat-msg-dispatcher"]').count()) +
    (await page.locator('[data-testid="invoice-review-chat-msg-agent"]').count());
  if (totalMsgs < 6) {
    for (let i = totalMsgs; i < 8; i += 1) {
      await sendChat(page, `Extra scroll message ${i}`);
    }
  }
  totalMsgs =
    (await page.locator('[data-testid="invoice-review-chat-msg-dispatcher"]').count()) +
    (await page.locator('[data-testid="invoice-review-chat-msg-agent"]').count());

  await page.getByTestId("invoice-review-chat-history").evaluate((el) => {
    el.scrollTop = 0;
  });
  const scrollTop = await page
    .getByTestId("invoice-review-chat-history")
    .evaluate((el) => el.scrollTop);
  const scrollHeight = await page
    .getByTestId("invoice-review-chat-history")
    .evaluate((el) => el.scrollHeight - el.clientHeight);
  if (scrollHeight <= 0) {
    throw new Error("Chat history did not overflow — cannot prove vertical scroll");
  }
  await page.screenshot({
    path: resolve(screenshotDir, "c1-inmodal-scrolled.png"),
    fullPage: false,
  });
  await chat.screenshot({
    path: resolve(screenshotDir, "c1-inmodal-scrolled-panel.png"),
  });
  // Scroll back to bottom
  await page.getByTestId("invoice-review-chat-history").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  console.log(
    `PASS: history scrolls (msgs=${totalMsgs}, overflow=${scrollHeight}, topWas=${scrollTop})`,
  );

  // Close / reopen — sessionStorage mock persistence
  const priorAgents = await page
    .locator('[data-testid="invoice-review-chat-msg-agent"]')
    .count();
  await page.getByTestId("invoice-parsed-inspect-close").click();
  await page.waitForTimeout(400);
  await openInspectModal(page);
  await page.getByTestId("invoice-review-chat-panel").waitFor({ timeout: 10_000 });
  const afterReopenAgents = await page
    .locator('[data-testid="invoice-review-chat-msg-agent"]')
    .count();
  if (afterReopenAgents < priorAgents) {
    throw new Error(
      `History not persisted on reopen: before=${priorAgents} after=${afterReopenAgents}`,
    );
  }
  await page.screenshot({
    path: resolve(screenshotDir, "c1-inmodal-reopen.png"),
    fullPage: false,
  });
  await page.getByTestId("invoice-review-chat-panel").screenshot({
    path: resolve(screenshotDir, "c1-inmodal-reopen-panel.png"),
  });
  console.log("PASS: close/reopen preserves in-modal history");

  // Refresh — same sessionStorage
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await openInspectModal(page);
  const afterRefreshAgents = await page
    .locator('[data-testid="invoice-review-chat-msg-agent"]')
    .count();
  if (afterRefreshAgents < 2) {
    throw new Error(
      `History not persisted on refresh: agents=${afterRefreshAgents}`,
    );
  }
  console.log("PASS: refresh preserves in-modal history (mock session store)");

  // --- Dark mode (true panel theme) ---
  await setAdminTheme(page, "dark");
  const chatDark = page.getByTestId("invoice-review-chat-panel");
  await chatDark.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(screenshotDir, "c1-dark-chat.png"),
    fullPage: false,
  });
  await chatDark.screenshot({
    path: resolve(screenshotDir, "c1-dark-chat-panel.png"),
  });
  await assertReadableTextContrast(page, {
    rootSelector: '[data-testid="invoice-review-chat-panel"]',
    elements: [
      {
        name: "chat-title-dark",
        selector: '[data-testid="invoice-review-chat-title"]',
        large: true,
      },
      {
        name: "chat-send-dark",
        selector: '[data-testid="invoice-review-chat-send"]',
        large: true,
      },
      {
        name: "agent-bubble-dark",
        selector: '[data-testid="invoice-review-chat-msg-agent"]',
      },
    ],
  });
  console.log("PASS: D-42 contrast (dark) + true dark panel");

  // Dark multi-turn still visible
  await page.screenshot({
    path: resolve(screenshotDir, "c1-dark-multiturn.png"),
    fullPage: false,
  });

  // --- C2 dark: propose + apply on a fresh import chat seed ---
  await page.evaluate(() => {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const k = sessionStorage.key(i);
      if (
        k &&
        (k.startsWith("stageverify-review-chat:") ||
          k.startsWith("stageverify-review-chat-header:"))
      ) {
        sessionStorage.removeItem(k);
      }
    }
  });
  await page.getByTestId("invoice-parsed-inspect-close").click();
  await page.waitForTimeout(400);
  await openInspectModal(page);
  await setAdminTheme(page, "dark");
  const chatDark2 = page.getByTestId("invoice-review-chat-panel");
  await chatDark2.scrollIntoViewIfNeeded();
  await sendChat(
    page,
    "I see the PO and it is 2205 EARLY. Check the invoice again.",
  );
  await page.getByTestId("invoice-review-chat-correction-card").waitFor({
    timeout: 5_000,
  });
  await page.screenshot({
    path: resolve(screenshotDir, "c2-dark-proposed-correction.png"),
    fullPage: false,
  });
  await page.getByTestId("invoice-review-chat-apply-correction").click();
  await page
    .getByTestId("invoice-review-chat-correction-applied")
    .first()
    .waitFor({ timeout: 8_000 });
  await assertReadableTextContrast(page, {
    rootSelector: '[data-testid="invoice-review-chat-panel"]',
    elements: [
      {
        name: "correction-applied-dark",
        selector: '[data-testid="invoice-review-chat-correction-applied"]',
        large: true,
      },
    ],
  });
  await page.screenshot({
    path: resolve(screenshotDir, "c2-dark-applied-correction.png"),
    fullPage: false,
  });
  console.log("PASS: C2 dark proposed + applied correction");

  console.log("VERIFY_BACKEND=mock+sessionStorage (production response schema)");
  console.log("PASS: verify-invoice-review-chat");
} finally {
  await browser.close();
}

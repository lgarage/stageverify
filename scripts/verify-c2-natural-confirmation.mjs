/**
 * Playwright: Lane C C2 natural confirmation ("Yes, apply it.") — no Apply click.
 *
 * Usage:
 *   npm run dev
 *   npm run verify:c2-natural-confirmation
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
      const panel = document.querySelector(
        '[data-testid="invoice-review-panel"]',
      );
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
    throw new Error("No invoice import rows for natural-confirm verify");
  }
  await rowContent.click();
  await page.getByTestId("invoice-parsed-inspect-modal").waitFor({
    timeout: 10_000,
  });
}

async function sendChat(page, text) {
  const input = page.getByTestId("invoice-review-chat-input");
  await input.fill(text);
  await page.getByTestId("invoice-review-chat-send").click();
  await page
    .getByTestId("invoice-review-chat-thinking")
    .waitFor({ state: "hidden", timeout: 15_000 })
    .catch(() => {});
  await page
    .getByTestId("invoice-review-chat-auto-applying")
    .waitFor({ state: "hidden", timeout: 15_000 })
    .catch(() => {});
  await page.waitForTimeout(250);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
});
await context.addInitScript(() => {
  sessionStorage.setItem("stageverify-review-chat-mock", "1");
});
const page = await context.newPage();

try {
  await ensureAuthenticated(page);
  await page.waitForTimeout(1000);
  await openInspectModal(page);

  const chat = page.getByTestId("invoice-review-chat-panel");
  await chat.scrollIntoViewIfNeeded();

  // Clear any prior mock chat for a clean natural-confirm path
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
  await page.waitForTimeout(300);
  await openInspectModal(page);
  await page.getByTestId("invoice-review-chat-panel").waitFor({ timeout: 10_000 });

  // Propose — do NOT click Apply
  await sendChat(
    page,
    "I see the PO is 2205 EARLY. Check the invoice again.",
  );
  await page.getByTestId("invoice-review-chat-correction-card").waitFor({
    timeout: 8_000,
  });
  if (
    await page
      .getByTestId("invoice-review-chat-correction-applied")
      .count()
  ) {
    throw new Error("Correction applied before natural confirmation");
  }
  const applyBtnVisible = await page
    .getByTestId("invoice-review-chat-apply-correction")
    .isVisible();
  if (!applyBtnVisible) {
    throw new Error("Expected Apply correction button on proposal (unused)");
  }
  console.log("PASS: proposal card present; Apply not clicked");

  await page.screenshot({
    path: resolve(screenshotDir, "c2-natural-before-confirm.png"),
    fullPage: false,
  });

  // Natural confirmation
  await sendChat(page, "Yes, apply it.");
  await page
    .getByTestId("invoice-review-chat-correction-applied")
    .first()
    .waitFor({ timeout: 10_000 });

  const confirmingCopy = (
    await page.locator('[data-testid="invoice-review-chat-msg-agent"]').allInnerTexts()
  ).join("\n");
  if (/Confirmed\.\s*Applying Customer PO/i.test(confirmingCopy) === false) {
    throw new Error(
      `Expected "Confirmed. Applying Customer PO…" copy, got: ${confirmingCopy.slice(-400)}`,
    );
  }
  if (
    /cannot change or apply|cannot change parsed fields|I cannot change/i.test(
      confirmingCopy,
    )
  ) {
    throw new Error("Natural confirm path must not claim inability to apply");
  }

  const poAfter = await page
    .locator(
      '[data-testid="invoice-parsed-header-row-customerPoOrReference"] [data-testid="invoice-parsed-header-value"]',
    )
    .innerText();
  if (!/2205\s*EARLY/i.test(poAfter)) {
    throw new Error(`Parsed Import not updated after natural confirm: ${poAfter}`);
  }
  const warningsAfter = await page
    .getByTestId("invoice-parsed-inspect-warnings")
    .innerText()
    .catch(() => "");
  if (/missing customerPoOrReference/i.test(warningsAfter)) {
    throw new Error(
      "missing customerPoOrReference still visible after natural confirm (no Refresh)",
    );
  }

  // Approve still separate / not auto-triggered
  const approveBtn = page.getByTestId("invoice-parsed-inspect-approve");
  if (await approveBtn.count()) {
    const enabled = await approveBtn.isEnabled();
    if (!enabled) {
      // still fine — just must not have approved away
    }
  }
  const statusChip = await page
    .locator('[data-testid="invoice-review-status-chip"]')
    .first()
    .innerText()
    .catch(() => "");
  if (/^Approved$/i.test(statusChip.trim())) {
    throw new Error("Natural confirm must not approve the invoice");
  }

  await page.getByTestId("invoice-parsed-inspect-header").scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.getByTestId("invoice-parsed-inspect-header").screenshot({
    path: resolve(screenshotDir, "c2-natural-after-header-only.png"),
  });
  await chat.scrollIntoViewIfNeeded();
  const shot = resolve(screenshotDir, "c2-natural-confirmation-apply.png");
  await page.screenshot({ path: shot, fullPage: false });
  console.log("Wrote", shot);
  console.log("PASS: natural confirmation applied; Parsed Import shows 2205 EARLY");

  // Idempotency — second Yes
  await sendChat(page, "Yes, apply it.");
  const appliedCount = await page
    .getByTestId("invoice-review-chat-correction-applied")
    .count();
  if (appliedCount < 1) {
    throw new Error("Expected applied badge to remain after second Yes");
  }
  const poAgain = await page
    .locator(
      '[data-testid="invoice-parsed-header-row-customerPoOrReference"] [data-testid="invoice-parsed-header-value"]',
    )
    .innerText();
  if (!/2205\s*EARLY/i.test(poAgain)) {
    throw new Error("PO changed unexpectedly after repeated Yes");
  }
  console.log("PASS: repeated Yes, apply it. is safe (idempotent UI)");

  console.log("PASS: verify-c2-natural-confirmation");
} finally {
  await browser.close();
}

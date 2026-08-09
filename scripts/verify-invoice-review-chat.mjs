/**
 * Playwright: Lane C C1 Invoice Review Chat panel in Parsed import data.
 * Asserts panel chrome, history region, Approve/Reject reachability, themes.
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

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem("stageverify-theme", t);
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.classList.toggle("theme-dark", t === "dark");
    document.documentElement.classList.toggle("theme-light", t === "light");
    window.dispatchEvent(new Event("storage"));
  }, theme);
  await page.waitForTimeout(400);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
});
const page = await context.newPage();

try {
  await ensureAuthenticated(page);
  await page.waitForTimeout(1500);
  await openInspectModal(page);

  const chat = page.getByTestId("invoice-review-chat-panel");
  await chat.scrollIntoViewIfNeeded();
  await chat.waitFor({ timeout: 10_000 });
  await page.getByTestId("invoice-review-chat-title").waitFor();
  await page.getByTestId("invoice-review-chat-history").waitFor();
  await page.getByTestId("invoice-review-chat-input").waitFor();
  await page.getByTestId("invoice-review-chat-send").waitFor();
  console.log("PASS: Invoice Review Chat panel chrome present");

  const rejectBtn = page.getByTestId("invoice-parsed-inspect-reject");
  const approveBtn = page.getByTestId("invoice-parsed-inspect-approve");
  if (await rejectBtn.count()) {
    if (!(await rejectBtn.isEnabled())) {
      throw new Error("Reject should remain enabled with chat open");
    }
    console.log("PASS: Reject reachable/enabled with chat open");
  }
  if (await approveBtn.count()) {
    const box = await approveBtn.boundingBox();
    if (!box) throw new Error("Approve button not visible with chat open");
    console.log("PASS: Approve visible with chat open");
  }

  await setTheme(page, "light");
  await chat.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(screenshotDir, "c1-empty-chat-light.png"),
    fullPage: false,
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
  console.log("PASS: D-42 contrast (light) on chat controls");

  await setTheme(page, "dark");
  await chat.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(screenshotDir, "c1-empty-chat-dark.png"),
    fullPage: false,
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
    ],
  });
  console.log("PASS: D-42 contrast (dark) on chat controls");

  await setTheme(page, "light");
  const input = page.getByTestId("invoice-review-chat-input");
  await input.fill(
    "I see the PO and it is 2205 EARLY. Check the invoice again to check for PO.",
  );
  await page.screenshot({
    path: resolve(screenshotDir, "c1-dispatcher-draft.png"),
    fullPage: false,
  });

  await page.getByTestId("invoice-review-chat-send").click();
  await page.waitForTimeout(3500);
  const thinkingVisible = await page
    .getByTestId("invoice-review-chat-thinking")
    .isVisible()
    .catch(() => false);
  if (thinkingVisible) throw new Error("thinking state stuck");
  const hasError =
    (await page.getByTestId("invoice-review-chat-send-error").count()) > 0;
  const hasAgent =
    (await page.locator('[data-testid="invoice-review-chat-msg-agent"]').count()) >
    0;
  if (!hasError && !hasAgent) {
    throw new Error(
      "Expected agent message or fail-closed send error after Send",
    );
  }
  console.log(
    hasAgent
      ? "PASS: agent message appeared after Send"
      : "PASS: fail-closed send error shown (CF not deployed on this branch)",
  );

  await page.screenshot({
    path: resolve(screenshotDir, "c1-after-send.png"),
    fullPage: false,
  });

  await page.getByTestId("invoice-review-chat-history").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({
    path: resolve(screenshotDir, "c1-history-scrolled.png"),
    fullPage: false,
  });
  console.log("PASS: history scroll exercised");

  await page.getByTestId("invoice-parsed-inspect-close").click();
  await page.waitForTimeout(400);
  await openInspectModal(page);
  await page.getByTestId("invoice-review-chat-panel").waitFor({ timeout: 10_000 });
  await page.screenshot({
    path: resolve(screenshotDir, "c1-reopen.png"),
    fullPage: false,
  });
  console.log("PASS: chat panel present after modal reopen");

  console.log("PASS: verify-invoice-review-chat");
} finally {
  await browser.close();
}

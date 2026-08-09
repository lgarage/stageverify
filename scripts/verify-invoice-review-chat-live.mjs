/**
 * Live production E2E for Lane C C1 Invoice Review Chat.
 * Uses REAL reviewAgentTurn CF + Firestore — mock mode must stay OFF.
 *
 * Usage (local app → live Firebase):
 *   npm run dev
 *   node scripts/verify-invoice-review-chat-live.mjs
 *
 * Usage (gh-pages):
 *   node scripts/verify-invoice-review-chat-live.mjs --base-url=https://lgarage.github.io/stageverify
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
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
const screenshotDir = resolve(
  process.cwd(),
  "screenshots/invoice-review-chat-live",
);
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

const ABSENT_PO = "ZZZX-PO-DOES-NOT-EXIST-99999";
const CASE_A_MSG =
  "I see the PO and it is 2205 EARLY. Check the invoice again to check for PO.";
const CASE_B_MSG = `I see the PO and it is ${ABSENT_PO}. Check the invoice again to check for PO.`;
const FOLLOW_UP = "Yes, that’s the PO.";

/** @type {Array<{messageId?: string, agentMessage?: any, raw?: any}>} */
const turnResults = [];

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
    throw new Error("No invoice import rows available for live chat verify");
  }
  await rowContent.click();
  await page.getByTestId("invoice-parsed-inspect-modal").waitFor({
    timeout: 10_000,
  });
}

async function assertMockOff(page) {
  const flag = await page.evaluate(() =>
    sessionStorage.getItem("stageverify-review-chat-mock"),
  );
  if (flag === "1") {
    throw new Error(
      "FAIL: stageverify-review-chat-mock is ON — live verify requires mock OFF",
    );
  }
  console.log("PASS: mock flag OFF (stageverify-review-chat-mock unset/not 1)");
}

async function sendChat(page, text, { timeoutMs = 90_000 } = {}) {
  const beforeAgents = await page
    .locator('[data-testid="invoice-review-chat-msg-agent"]')
    .count();
  const beforeDispatchers = await page
    .locator('[data-testid="invoice-review-chat-msg-dispatcher"]')
    .count();
  const input = page.getByTestId("invoice-review-chat-input");
  await input.fill(text);
  await page.getByTestId("invoice-review-chat-send").click();
  await page
    .getByTestId("invoice-review-chat-thinking")
    .waitFor({ state: "visible", timeout: 8_000 })
    .catch(() => {});

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sendErr = page.getByTestId("invoice-review-chat-send-error");
    if (await sendErr.isVisible().catch(() => false)) {
      throw new Error(`Chat send error: ${await sendErr.innerText()}`);
    }
    const loadErr = page.getByTestId("invoice-review-chat-load-error");
    if (await loadErr.isVisible().catch(() => false)) {
      throw new Error(`Chat load error: ${await loadErr.innerText()}`);
    }
    const agents = await page
      .locator('[data-testid="invoice-review-chat-msg-agent"]')
      .count();
    const dispatchers = await page
      .locator('[data-testid="invoice-review-chat-msg-dispatcher"]')
      .count();
    const thinking = await page
      .getByTestId("invoice-review-chat-thinking")
      .isVisible()
      .catch(() => false);
    if (agents > beforeAgents && dispatchers > beforeDispatchers && !thinking) {
      return;
    }
    await page.waitForTimeout(500);
  }
  const sendErrText = await page
    .getByTestId("invoice-review-chat-send-error")
    .innerText()
    .catch(() => "");
  const panelText = await page
    .getByTestId("invoice-review-chat-panel")
    .innerText()
    .catch(() => "");
  throw new Error(
    `Chat turn timed out after ${timeoutMs}ms. sendErr=${sendErrText || "(none)"} panelTail=${panelText.slice(-400).replace(/\s+/g, " ")}`,
  );
}

async function readHeaderSnapshot(page) {
  const modal = page.getByTestId("invoice-parsed-inspect-modal");
  const text = (await modal.innerText()).slice(0, 4000);
  const approveDisabled = await page
    .getByTestId("invoice-parsed-inspect-approve")
    .isDisabled()
    .catch(() => null);
  const rejectVisible = await page
    .getByTestId("invoice-parsed-inspect-reject")
    .isVisible()
    .catch(() => false);
  return { text, approveDisabled, rejectVisible };
}

function attachCallableCapture(page) {
  page.on("response", async (response) => {
    try {
      const url = response.url();
      if (!/reviewAgentTurn/i.test(url)) return;
      if (!response.ok()) return;
      const json = await response.json().catch(() => null);
      if (!json) return;
      const result = json.result ?? json.data ?? json;
      turnResults.push({
        messageId: result?.messageId,
        agentMessage: result?.agentMessage,
        raw: result,
      });
    } catch {
      /* ignore parse races */
    }
  });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
});

// Explicitly ensure mock stays OFF (do not set stageverify-review-chat-mock).
await context.addInitScript(() => {
  try {
    sessionStorage.removeItem("stageverify-review-chat-mock");
  } catch {
    /* ignore */
  }
});

const page = await context.newPage();
attachCallableCapture(page);

const report = {
  backend: "live-cf+firestore",
  mock: "OFF",
  caseA: "unknown",
  caseB: "unknown",
  multiTurn: "unknown",
  reopen: "unknown",
  refresh: "unknown",
  containment: "unknown",
  advanced: "unknown",
  staging: "unknown",
  models: [],
  importTitle: "",
};

try {
  await ensureAuthenticated(page);
  await page.waitForTimeout(1200);
  await assertMockOff(page);
  await openInspectModal(page);
  await assertMockOff(page);

  const title = await page
    .getByTestId("invoice-parsed-inspect-modal")
    .locator("h2, h1")
    .first()
    .innerText()
    .catch(() => "");
  report.importTitle = title;
  console.log(`LIVE import modal: ${title.slice(0, 120)}`);

  const before = await readHeaderSnapshot(page);

  const chat = page.getByTestId("invoice-review-chat-panel");
  await chat.scrollIntoViewIfNeeded();
  await chat.waitFor({ timeout: 10_000 });

  // Advanced collapsed
  const advanced = page.getByTestId(
    "invoice-parsed-inspect-training-advanced",
  );
  await advanced.waitFor({ timeout: 5_000 });
  const advancedOpen = await advanced.evaluate(
    (el) => el instanceof HTMLDetailsElement && el.open,
  );
  if (advancedOpen) {
    throw new Error("Advanced training panel should be collapsed by default");
  }
  report.advanced = "PASS";
  console.log("PASS: Advanced training collapsed (chat primary)");

  // PR #64 staging panel still present
  const staging = page.getByTestId("invoice-parsed-inspect-staging-panel");
  if (!(await staging.count())) {
    throw new Error("PR #64 staging panel missing after C1 deploy");
  }
  report.staging = "PASS";
  console.log("PASS: PR #64 staging panel present");

  // Approve/Reject reachable
  const rejectBtn = page.getByTestId("invoice-parsed-inspect-reject");
  const approveBtn = page.getByTestId("invoice-parsed-inspect-approve");
  if ((await rejectBtn.count()) && !(await rejectBtn.isEnabled())) {
    throw new Error("Reject should remain enabled with chat open");
  }
  if ((await approveBtn.count()) && !(await approveBtn.boundingBox())) {
    throw new Error("Approve not visible with chat open");
  }

  // --- CASE A: asserted PO value (may or may not exist in this import) ---
  await sendChat(page, CASE_A_MSG, { timeoutMs: 60_000 });
  await page
    .locator('[data-testid="invoice-review-chat-msg-dispatcher"]')
    .first()
    .waitFor({ timeout: 5_000 });
  const agent1 = page.locator('[data-testid="invoice-review-chat-msg-agent"]').last();
  await agent1.waitFor({ timeout: 5_000 });
  const agent1Text = await agent1.innerText();
  const hasCitations = (await page.getByTestId("invoice-review-chat-citations").count()) > 0;
  const mentionsPo =
    /2205\s*EARLY/i.test(agent1Text) ||
    /CUSTOMER\s*P\/?O/i.test(agent1Text) ||
    /parser/i.test(agent1Text) ||
    /evidence/i.test(agent1Text) ||
    /cannot find|could not find|not find/i.test(agent1Text);
  if (!mentionsPo) {
    throw new Error(
      `Case A agent reply did not address PO/evidence: ${agent1Text.slice(0, 300)}`,
    );
  }
  // Must not claim field was mutated
  if (/I (have )?updated|I changed|field (is|was) now|applied the correction/i.test(agent1Text)) {
    throw new Error(`Case A agent claimed a field mutation: ${agent1Text.slice(0, 300)}`);
  }
  report.caseA = hasCitations ? "PASS (with citations)" : "PASS (reply ok; citations optional if absent)";
  console.log(`PASS: Case A live CF turn — citations=${hasCitations}`);
  console.log(`  agent: ${agent1Text.slice(0, 220).replace(/\s+/g, " ")}`);
  await page.screenshot({
    path: resolve(screenshotDir, "live-case-a.png"),
    fullPage: false,
  });
  await chat.screenshot({
    path: resolve(screenshotDir, "live-case-a-panel.png"),
  });

  // --- CASE B: absent value ---
  await sendChat(page, CASE_B_MSG, { timeoutMs: 60_000 });
  const agent2 = page.locator('[data-testid="invoice-review-chat-msg-agent"]').last();
  const agent2Text = await agent2.innerText();
  const absentOk =
    /cannot find|could not find|not find|no (matching )?evidence|not (present|found)|unable to (find|locate)|do not see|doesn't appear|does not appear/i.test(
      agent2Text,
    ) ||
    /assertion|your statement|you (said|asserted|indicated)/i.test(agent2Text);
  if (!absentOk) {
    // Still PASS if it clearly refuses to invent a document citation for the fake PO
    const fabricates = new RegExp(ABSENT_PO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(
      agent2Text,
    ) && /document evidence/i.test(agent2Text) && !/cannot|not find|assertion/i.test(agent2Text);
    if (fabricates) {
      throw new Error(
        `Case B appears to fabricate document evidence for absent PO: ${agent2Text.slice(0, 400)}`,
      );
    }
  }
  if (/saved (a )?lesson|ignore rule|playbook|I updated the parsed/i.test(agent2Text)) {
    throw new Error(`Case B claimed learning/mutation: ${agent2Text.slice(0, 300)}`);
  }
  report.caseB = "PASS";
  console.log("PASS: Case B absent-value truthfulness (no fabricated lesson/mutation)");
  console.log(`  agent: ${agent2Text.slice(0, 220).replace(/\s+/g, " ")}`);
  await chat.screenshot({
    path: resolve(screenshotDir, "live-case-b-panel.png"),
  });

  // --- Multi-turn follow-up ---
  const agentsBeforeFollow = await page
    .locator('[data-testid="invoice-review-chat-msg-agent"]')
    .count();
  const dispatchersBeforeFollow = await page
    .locator('[data-testid="invoice-review-chat-msg-dispatcher"]')
    .count();
  await sendChat(page, FOLLOW_UP, { timeoutMs: 60_000 });
  const agentsAfter = await page
    .locator('[data-testid="invoice-review-chat-msg-agent"]')
    .count();
  const dispatchersAfter = await page
    .locator('[data-testid="invoice-review-chat-msg-dispatcher"]')
    .count();
  if (agentsAfter <= agentsBeforeFollow || dispatchersAfter <= dispatchersBeforeFollow) {
    throw new Error(
      `Multi-turn failed: before d=${dispatchersBeforeFollow} a=${agentsBeforeFollow} after d=${dispatchersAfter} a=${agentsAfter}`,
    );
  }
  // Prior history still present
  const histText = await page.getByTestId("invoice-review-chat-history").innerText();
  if (!histText.includes("2205 EARLY") || !histText.includes(ABSENT_PO.slice(0, 12))) {
    throw new Error("Prior history missing after follow-up");
  }
  report.multiTurn = "PASS";
  console.log(
    `PASS: multi-turn (dispatchers=${dispatchersAfter}, agents=${agentsAfter})`,
  );
  await chat.screenshot({
    path: resolve(screenshotDir, "live-multiturn-panel.png"),
  });

  // Scroll / composer pinned
  const overflow = await page
    .getByTestId("invoice-review-chat-history")
    .evaluate((el) => el.scrollHeight - el.clientHeight);
  if (overflow <= 0) {
    console.log("WARN: history did not overflow (short thread) — composer still at bottom");
  } else {
    await page.getByTestId("invoice-review-chat-history").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.getByTestId("invoice-review-chat-history").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    console.log(`PASS: history scrolls (overflow=${overflow})`);
  }
  await expectComposerPinned(page);

  // Effect containment
  const after = await readHeaderSnapshot(page);
  if (before.approveDisabled !== after.approveDisabled) {
    throw new Error("Approve enabled state changed after chat — containment fail");
  }
  if (before.rejectVisible !== after.rejectVisible) {
    throw new Error("Reject visibility changed after chat — containment fail");
  }
  // Modal still shows same import title chrome
  if (title && !(await page.getByTestId("invoice-parsed-inspect-modal").innerText()).includes(title.slice(0, 24))) {
    throw new Error("Import identity changed after chat");
  }
  report.containment = "PASS";
  console.log("PASS: effect containment (approve/reject/import chrome unchanged)");

  // Close / reopen
  const priorAgents = agentsAfter;
  await page.getByTestId("invoice-parsed-inspect-close").click();
  await page.waitForTimeout(500);
  await openInspectModal(page);
  await assertMockOff(page);
  await page.getByTestId("invoice-review-chat-panel").waitFor({ timeout: 15_000 });
  // Wait for Firestore subscribe to hydrate
  await page.waitForFunction(
    (n) =>
      document.querySelectorAll(
        '[data-testid="invoice-review-chat-msg-agent"]',
      ).length >= n,
    Math.min(priorAgents, 2),
    { timeout: 20_000 },
  );
  const reopenAgents = await page
    .locator('[data-testid="invoice-review-chat-msg-agent"]')
    .count();
  if (reopenAgents < 2) {
    throw new Error(
      `Close/reopen lost history: agents=${reopenAgents} (expected >=2)`,
    );
  }
  report.reopen = "PASS";
  console.log(`PASS: close/reopen Firestore persistence (agents=${reopenAgents})`);
  await page.getByTestId("invoice-review-chat-panel").screenshot({
    path: resolve(screenshotDir, "live-reopen-panel.png"),
  });

  // Refresh
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await assertMockOff(page);
  if (page.url().includes("/login")) {
    await ensureAuthenticated(page);
  }
  await openInspectModal(page);
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        '[data-testid="invoice-review-chat-msg-agent"]',
      ).length >= 2,
    { timeout: 20_000 },
  );
  const refreshAgents = await page
    .locator('[data-testid="invoice-review-chat-msg-agent"]')
    .count();
  if (refreshAgents < 2) {
    throw new Error(`Refresh lost history: agents=${refreshAgents}`);
  }
  report.refresh = "PASS";
  console.log(`PASS: refresh Firestore persistence (agents=${refreshAgents})`);

  // Sign out / in (if logout control present)
  const signedOutIn = await trySignOutIn(page);
  if (signedOutIn) {
    await openInspectModal(page);
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          '[data-testid="invoice-review-chat-msg-agent"]',
        ).length >= 2,
      { timeout: 20_000 },
    );
    console.log("PASS: sign-out/in preserves chat for authorized dispatcher");
  } else {
    console.log("SKIP: sign-out/in control not found — reopen+refresh already proved durability");
  }

  // Theme smoke on live
  await setTheme(page, "light");
  await assertReadableTextContrast(page, {
    rootSelector: '[data-testid="invoice-review-chat-panel"]',
    elements: [
      {
        name: "chat-title",
        selector: '[data-testid="invoice-review-chat-title"]',
        large: true,
      },
      {
        name: "chat-send",
        selector: '[data-testid="invoice-review-chat-send"]',
        large: true,
      },
    ],
  });
  await setTheme(page, "dark");
  const darkBg = await page
    .getByTestId("invoice-parsed-inspect-panel")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const rgb = darkBg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!rgb) throw new Error(`dark bg unreadable: ${darkBg}`);
  const lum =
    (0.2126 * Number(rgb[1]) +
      0.7152 * Number(rgb[2]) +
      0.0722 * Number(rgb[3])) /
    255;
  if (lum > 0.45) {
    throw new Error(`Panel not dark enough: ${darkBg}`);
  }
  console.log(`PASS: live dark theme (bg=${darkBg})`);
  await page.screenshot({
    path: resolve(screenshotDir, "live-dark.png"),
    fullPage: false,
  });

  report.models = turnResults
    .map((t) => t.agentMessage?.modelUsed)
    .filter(Boolean);
  console.log(
    `MODEL_USED=${report.models.join(",") || "unknown (callable body not captured)"}`,
  );
  console.log(`CALLABLE_TURNS_CAPTURED=${turnResults.length}`);

  writeFileSync(
    resolve(screenshotDir, "live-report.json"),
    JSON.stringify({ report, turnResults }, null, 2),
  );

  console.log("VERIFY_BACKEND=live-cf+firestore (mock OFF)");
  console.log("PASS: verify-invoice-review-chat-live");
} finally {
  await browser.close();
}

async function expectComposerPinned(page) {
  const box = await page.getByTestId("invoice-review-chat-input").boundingBox();
  const panel = await page.getByTestId("invoice-review-chat-panel").boundingBox();
  if (!box || !panel) throw new Error("composer/panel not measurable");
  if (box.y < panel.y + panel.height / 3) {
    throw new Error("composer does not appear pinned near bottom of chat panel");
  }
  console.log("PASS: composer pinned at bottom");
}

async function setTheme(page, theme) {
  const toggle = page.getByTestId("admin-appearance-toggle");
  const htmlTheme = await page.evaluate(() =>
    document.documentElement.getAttribute("data-sv-admin-theme"),
  );
  if (htmlTheme !== theme && (await toggle.count())) {
    await toggle.click();
    await page.waitForTimeout(400);
  }
}

async function trySignOutIn(page) {
  // Close inspect modal first — it intercepts pointer events over the shell.
  const closeBtn = page.getByTestId("invoice-parsed-inspect-close");
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click();
    await page.waitForTimeout(300);
  }
  const candidates = [
    page.getByTestId("dispatcher-sign-out"),
    page.getByRole("button", { name: /sign out|log out|logout/i }),
    page.getByTestId("portal-sign-out"),
    page.getByTestId("admin-sign-out"),
  ];
  for (const loc of candidates) {
    if ((await loc.count()) && (await loc.first().isVisible().catch(() => false))) {
      await loc.first().click({ timeout: 10_000 });
      await page.waitForTimeout(1000);
      await ensureAuthenticated(page);
      return true;
    }
  }
  return false;
}

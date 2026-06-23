/**
 * Playwright: Phase 5 email UI — Needs Review strip + drawer Email Evidence.
 *
 * Usage:
 *   npm run dev
 *   node scripts/playwright-auth-setup.mjs   (if token expired)
 *   npm run verify:phase5-email
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";

const baseUrl = process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const authState = resolve(process.cwd(), "playwright/.auth/state.json");

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
  await page.goto(`${appBase}/#/dispatcher`, {
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
  await page.waitForURL(/\/#\/(dispatcher|settings|hub|zones|vendors)/, {
    timeout: 20_000,
  });

  if (!page.url().includes("/dispatcher")) {
    await page.goto(`${appBase}/#/dispatcher`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const page = await context.newPage();

  console.log("Opening dispatcher Needs Review email strip…");
  await ensureAuthenticated(page);
  await page.getByRole("heading", { name: "Delivery Overview" }).waitFor({
    timeout: 30_000,
  });

  if (await page.getByTestId("proposed-email-updates-panel").count()) {
    throw new Error(
      "Proposed Email Updates panel must be retired — found proposed-email-updates-panel",
    );
  }

  await page.getByTestId("needs-review-email-strip").waitFor({ timeout: 30_000 });
  const countEl = page.getByTestId("needs-review-email-count");
  const countText = (await countEl.innerText()) ?? "";
  const needsMatch = countText.match(/Needs Review \((\d+)\)/);
  const needsCount = needsMatch ? Number(needsMatch[1]) : 0;
  if (needsCount < 1) {
    throw new Error(`Expected at least 1 needs-review email, got: ${countText}`);
  }
  console.log(`Needs Review strip: ${needsCount} item(s)`);

  const matchedRowTestId = page.locator('[data-testid^="proposed-email-row-"]');
  if ((await matchedRowTestId.count()) > 0) {
    throw new Error("Matched emails must not appear in dashboard table rows");
  }

  if (await page.getByTestId("email-evidence-list").isVisible().catch(() => false)) {
    throw new Error("Email Evidence must be collapsed by default on dashboard load");
  }

  console.log("Delivery drawer: Email Evidence section (before strip expand)…");
  const search = page.locator('input[placeholder*="Job #, name, PO"]');
  await search.waitFor({ state: "visible", timeout: 30_000 });
  const ordersWithFixtureEvidence = [
    "ORD-1007",
    "ORD-7712",
    "ORD-8821",
    "ORD-1010",
    "ORD-9102",
  ];
  let viewReady = false;
  for (const orderNumber of ordersWithFixtureEvidence) {
    await search.fill(orderNumber);
    await page.waitForTimeout(1200);
    const btn = page.locator("button").filter({ hasText: /^View$/ }).first();
    if (await btn.isVisible().catch(() => false)) {
      viewReady = true;
      break;
    }
  }
  if (!viewReady) {
    await search.fill("");
    await page.waitForTimeout(800);
  }
  const firstViewBtn = page.locator("button").filter({ hasText: /^View$/ }).first();
  await firstViewBtn.waitFor({ state: "visible", timeout: 30_000 });
  if (await firstViewBtn.isVisible().catch(() => false)) {
    await firstViewBtn.scrollIntoViewIfNeeded();
    await firstViewBtn.click();
    await page.waitForTimeout(800);
    const evidencePanel = page.getByTestId("readiness-evidence-panel");
    await evidencePanel.waitFor({ timeout: 15_000 });
    await page.getByTestId("readiness-evidence-condition1").waitFor({ timeout: 10_000 });
    await page.getByTestId("readiness-evidence-condition2").waitFor({ timeout: 10_000 });
    await page.getByTestId("readiness-evidence-blockers").waitFor({ timeout: 10_000 });
    await page.getByTestId("readiness-evidence-condition1-note").waitFor({ timeout: 10_000 });
    const noteText = await page.getByTestId("readiness-evidence-condition1-note").innerText();
    if (!/does not determine readiness/i.test(noteText)) {
      throw new Error(`Condition 1 note missing disclaimer: ${noteText}`);
    }

    await page.getByTestId("drawer-action-banner").waitFor({ timeout: 10_000 });
    const bannerSummary = await page.getByTestId("drawer-action-banner-summary").innerText();
    if (!/\d+ of \d+ items ordered/i.test(bannerSummary) && !/Ready for Pickup/i.test(bannerSummary)) {
      throw new Error(`Action banner summary unexpected: ${bannerSummary}`);
    }
    console.log("Drawer action banner PASS: receipt summary or all-clear visible.");

    console.log("Vendor Communications placeholder (away-066)…");
    await page.getByTestId("vendor-communications-panel").waitFor({ timeout: 10_000 });
    if (await page.getByTestId("vendor-communications-empty").isVisible().catch(() => false)) {
      throw new Error("Vendor Communications empty state must be collapsed by default");
    }
    await page.getByTestId("vendor-communications-toggle").click();
    await page.getByTestId("vendor-communications-empty").waitFor({ timeout: 10_000 });
    const vendorCommsEmpty = await page.getByTestId("vendor-communications-empty").innerText();
    if (!/No messages yet/i.test(vendorCommsEmpty) || !/connect Gmail in Settings/i.test(vendorCommsEmpty)) {
      throw new Error(`Vendor Communications empty state unexpected: ${vendorCommsEmpty}`);
    }
    console.log("PASS: Vendor Communications read-only placeholder.");

    const callVendorBtn = page.getByTestId("drawer-action-call-vendor");
    if (await callVendorBtn.getAttribute("href")) {
      throw new Error("Call Vendor banner must be button, not tel: link");
    }
    await callVendorBtn.click();
    await page.getByTestId("call-vendor-modal").waitFor({ timeout: 10_000 });
    await page.getByTestId("call-vendor-close").click();
    await page.waitForTimeout(300);

    if ((await page.getByTestId("drawer-action-need-more-info").count()) > 0) {
      throw new Error("Need More Info banner button must be removed (away-065)");
    }

    const resolveBtn = page.getByTestId("drawer-action-resolve-issue");
    if (await resolveBtn.isEnabled().catch(() => false)) {
      await resolveBtn.click();
      await page.getByTestId("resolve-issue-modal").waitFor({ timeout: 10_000 });
      await page.getByTestId("resolution-type-select").selectOption("need_more_information");
      await page.getByTestId("resolve-need-more-info-section").waitFor({ timeout: 10_000 });
      const emailVendorBtn = page.getByTestId("resolve-email-vendor");
      if (!(await emailVendorBtn.isVisible())) {
        throw new Error("Email Vendor button missing in resolve modal");
      }
      if (await emailVendorBtn.isEnabled()) {
        throw new Error("Email Vendor must stay disabled until real OAuth provider (away-066)");
      }
      await page.getByRole("button", { name: "Cancel" }).click();
      await page.waitForTimeout(300);
    }
    console.log("Drawer modals PASS: Call Vendor modal; Need More Information in resolve modal.");

    const outDir = resolve(process.cwd(), "screenshots");
    mkdirSync(outDir, { recursive: true });
    await page.screenshot({
      path: resolve(outDir, "phase5-drawer-action-banner.png"),
      fullPage: false,
    });

    await page.getByTestId("email-evidence-section").waitFor({ timeout: 10_000 });
    if (await page.getByTestId("email-evidence-list").isVisible()) {
      throw new Error("Email Evidence list must be collapsed by default");
    }

    await page.getByTestId("email-evidence-toggle").click();
    await page.getByTestId("email-evidence-list").waitFor({ timeout: 10_000 });

    const card = page.locator('[data-testid^="email-evidence-card-"]').first();
    if (await card.isVisible().catch(() => false)) {
      const cardTestId = await card.getAttribute("data-testid");
      const cardId = cardTestId?.replace("email-evidence-card-", "") ?? "";
      if (cardId) {
        if (await page.getByTestId(`email-evidence-original-${cardId}`).isVisible()) {
          throw new Error("Drawer original email visible before View Original Email");
        }
        await page.getByTestId(`email-evidence-view-original-${cardId}`).click();
        await page.getByTestId(`email-evidence-original-body-${cardId}`).waitFor({
          timeout: 10_000,
        });
        const drawerBody = await page
          .getByTestId(`email-evidence-original-body-${cardId}`)
          .innerText();
        if (drawerBody.trim().length < 10) {
          throw new Error(`Drawer original body too short: ${drawerBody}`);
        }
      }
      console.log("Drawer Email Evidence PASS: collapsed default + View Original Email");
    } else {
      const empty = page.getByTestId("email-evidence-empty");
      if (await empty.isVisible().catch(() => false)) {
        console.log(
          "Drawer Email Evidence: no fixture-matched orders in Firestore — empty state OK.",
        );
      } else {
        throw new Error("Email Evidence expanded but no cards or empty state");
      }
    }

    const statusEl = page.getByTestId("readiness-evidence-condition1-status");
    if (await statusEl.isVisible().catch(() => false)) {
      const statusText = await statusEl.innerText();
      if (!/Complete|Review Required/i.test(statusText)) {
        throw new Error(`Condition 1 status unexpected: ${statusText}`);
      }
      console.log(`Drawer Condition 1 status: ${statusText.trim()}`);
    }

    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  } else {
    throw new Error("Expected at least one delivery View button for drawer email evidence test");
  }

  console.log("Expand Needs Review strip…");
  await page.getByTestId("needs-review-email-toggle").click();
  await page.getByTestId("needs-review-email-list").waitFor({ timeout: 10_000 });

  const firstItem = page.locator('[data-testid^="needs-review-email-item-"]').first();
  const itemTestId = await firstItem.getAttribute("data-testid");
  if (!itemTestId) throw new Error("No needs-review email item found");
  const messageId = itemTestId.replace("needs-review-email-item-", "");

  const reasonEl = page.getByTestId(`needs-review-email-reason-${messageId}`);
  const reasonText = await reasonEl.innerText();
  if (/confidence low/i.test(reasonText)) {
    throw new Error(`Review reason must not say confidence low: ${reasonText}`);
  }
  if (!/Review Required/i.test(reasonText)) {
    throw new Error(`Expected Review Required label: ${reasonText}`);
  }

  console.log("View Original Email hidden until click…");
  if (await page.getByTestId(`needs-review-original-${messageId}`).isVisible()) {
    throw new Error("Original email visible before View Original Email click");
  }
  await page.getByTestId(`needs-review-view-original-${messageId}`).click();
  await page.getByTestId(`needs-review-original-${messageId}`).waitFor({
    timeout: 10_000,
  });
  const originalBody = page.getByTestId(`needs-review-original-${messageId}`);
  const bodyText = await originalBody.innerText();
  if (bodyText.trim().length < 10) {
    throw new Error(`Original email body too short: ${bodyText}`);
  }
  console.log("Needs Review strip PASS");

  await browser.close();
  console.log("verify:phase5-email PASS");
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

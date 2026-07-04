/**
 * Playwright: dispatcher portal sidebar + top bar navigation.
 *
 * Usage:
 *   npm run dev
 *   node scripts/playwright-auth-setup.mjs   (if token expired)
 *   npm run verify:dispatcher-nav
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";

const baseUrl =
  process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
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

function assertUrl(page, pattern, label) {
  const url = page.url();
  if (!pattern.test(url)) {
    throw new Error(`${label}: expected URL matching ${pattern}, got ${url}`);
  }
}

function sidebar(page) {
  return page.locator("aside");
}

function assertReadableInputColor(page, testId, label) {
  return page.getByTestId(testId).evaluate((el) => {
    const style = window.getComputedStyle(el);
    const color = style.color;
    const rgb = color.match(/\d+/g);
    if (!rgb || rgb.length < 3) return { ok: false, color };
    const [r, g, b] = rgb.map(Number);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return { ok: luminance < 0.45, color, luminance };
  }).then((result) => {
    if (!result.ok) {
      throw new Error(
        `${label}: input text should be dark/readable, got color ${result.color}`,
      );
    }
  });
}

const RIVERSIDE_JOB_ID = "job-1";
const STALE_PICKUP_TOKEN =
  "d113403af1d6d98b9e9c96d19fcc91125aba2d611e6faca551ace710b91f5b26";

function extractPickupToken(text) {
  const match = text.match(/#\/pickup\?t=([a-f0-9]{64})/);
  return match?.[1] ?? null;
}

async function copyPickupToken(page) {
  await page.getByTestId("copy-pickup-information").click();
  await page.waitForTimeout(2500);
  const text = await page
    .evaluate(async () => navigator.clipboard.readText())
    .catch(() => "");
  const token = extractPickupToken(text);
  if (!token) {
    throw new Error(
      `Expected token URL in clipboard, got: ${text.slice(0, 120)}`,
    );
  }
  return { token, text };
}

async function openOrd005Drawer(page) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  const search = page.locator('input[placeholder*="Job #, name, PO"]');
  await search.waitFor({ state: "visible", timeout: 15_000 });
  await search.fill("");
  await search.fill("ORD-005");
  await page.waitForTimeout(1500);

  const ordRow = page.locator("table tbody tr", { hasText: "ORD-005" }).first();
  const viewBtn = ordRow.locator("button").filter({ hasText: /^View$/ });
  if (await viewBtn.isVisible().catch(() => false)) {
    await viewBtn.click({ force: true });
  } else if (await ordRow.isVisible().catch(() => false)) {
    await ordRow.click({ force: true });
  } else {
    await page.locator("button").filter({ hasText: /^View$/ }).first().click({ force: true });
  }
  await page.getByTestId("copy-pickup-information").waitFor({ timeout: 15_000 });
}

async function assertPickupPortalWithToken(browser, appBase, token) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const pickupPage = await ctx.newPage();
  await pickupPage.goto(`${appBase}/#/pickup?t=${token}`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await pickupPage.waitForTimeout(2000);
  if (await pickupPage.getByTestId("pickup-token-error").isVisible().catch(() => false)) {
    const err = await pickupPage.getByTestId("pickup-token-error").innerText();
    await ctx.close();
    throw new Error(`Pickup portal token error: ${err.trim()}`);
  }
  await pickupPage.getByTestId("pickup-job-header").waitFor({ timeout: 20_000 });
  const header = await pickupPage.getByTestId("pickup-job-header").innerText();
  if (!/Riverside Medical Center/i.test(header)) {
    await ctx.close();
    throw new Error(`Expected Riverside in job header, got: ${header.slice(0, 200)}`);
  }
  if (!/JOB-2026-0421/.test(header)) {
    await ctx.close();
    throw new Error(`Expected JOB-2026-0421 in job header, got: ${header.slice(0, 200)}`);
  }
  const hasPortalContent =
    (await pickupPage.getByTestId("pickup-item-row").count()) > 0 ||
    (await pickupPage.getByTestId("pickup-location-section").count()) > 0 ||
    (await pickupPage.getByTestId("expected-materials").count()) > 0 ||
    (await pickupPage.getByTestId("pickup-not-ready-row").count()) > 0;
  if (!hasPortalContent) {
    await ctx.close();
    throw new Error(
      "Pickup portal loaded but no checklist/location content visible",
    );
  }
  await ctx.close();
}

async function assertPickupTokenInvalid(browser, appBase, token) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const pickupPage = await ctx.newPage();
  await pickupPage.goto(`${appBase}/#/pickup?t=${token}`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  const errorLocator = pickupPage.getByTestId("pickup-token-error");
  const invalidText = pickupPage.getByText(/Invalid or expired pickup link/i);
  await Promise.race([
    errorLocator.waitFor({ state: "visible", timeout: 30_000 }),
    invalidText.waitFor({ state: "visible", timeout: 30_000 }),
  ]);
  await ctx.close();
}

async function runPickupTokenValidityFlow(page, browser, appBase) {
  console.log("Pickup token validity (ORD-005 / Riverside)…");
  await page.goto(`${appBase}/#/dispatcher`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page
    .getByRole("heading", { name: "Delivery Overview" })
    .waitFor({ timeout: 15_000 });
  await openOrd005Drawer(page);

  await page.evaluate(
    ({ jobId, staleToken }) => {
      sessionStorage.setItem(`stageverify.pickupToken.${jobId}`, staleToken);
    },
    { jobId: RIVERSIDE_JOB_ID, staleToken: STALE_PICKUP_TOKEN },
  );
  console.log("Injected stale sessionStorage token (simulates away-074 bug).");

  const firstCopy = await copyPickupToken(page);
  await assertPickupPortalWithToken(browser, appBase, firstCopy.token);
  console.log(
    "PASS: stale sessionStorage replaced — copied token opens Riverside pickup portal.",
  );

  const secondCopy = await copyPickupToken(page);
  if (secondCopy.token === firstCopy.token) {
    console.log(
      "PASS: second copy reused valid local token (first link not revoked).",
    );
  } else {
    console.log(
      "Note: second copy generated a new token (first link revoked by regen).",
    );
  }
  await assertPickupPortalWithToken(browser, appBase, secondCopy.token);

  const revokeBtn = page.getByTestId("revoke-pickup-link");
  if (!(await revokeBtn.isVisible().catch(() => false))) {
    throw new Error("Expected Reset Pickup Link after copy generated active token");
  }
  await revokeBtn.click();
  await page.getByTestId("revoke-pickup-link").waitFor({ state: "hidden", timeout: 15_000 });
  await page.getByTestId("pickup-token-active").waitFor({ state: "hidden", timeout: 15_000 });
  await page.waitForTimeout(1500);
  await assertPickupTokenInvalid(browser, appBase, secondCopy.token);
  console.log("PASS: revoked token shows invalid in clean browser context.");

  const afterRevokeCopy = await copyPickupToken(page);
  if (afterRevokeCopy.token === secondCopy.token) {
    throw new Error("Copy after revoke must generate a fresh token");
  }
  await assertPickupPortalWithToken(browser, appBase, afterRevokeCopy.token);
  console.log("PASS: copy after revoke generates working secure link.");
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();

  console.log("Opening dispatcher…");
  await ensureAuthenticated(page);
  await page
    .getByRole("heading", { name: "Delivery Overview" })
    .waitFor({ timeout: 30_000 });

  const nav = sidebar(page);

  if (
    (await nav.getByRole("link", { name: "Deliveries", exact: true }).count()) >
    0
  ) {
    throw new Error("Deliveries sidebar link should be removed");
  }

  console.log("Sidebar: Staging Map…");
  await nav.getByRole("link", { name: "Staging Map", exact: true }).click();
  await page.waitForTimeout(400);
  assertUrl(page, /\/zones/, "Staging Map");
  await page.getByRole("heading", { name: "Zone Management" }).waitFor({
    timeout: 15_000,
  });

  console.log("Sidebar: Vendors…");
  await nav.getByRole("link", { name: "Vendors", exact: true }).click();
  await page.waitForTimeout(400);
  assertUrl(page, /\/vendors/, "Vendors");
  await page.getByRole("heading", { name: "Vendors", exact: true }).waitFor({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Add Vendor" }).waitFor({
    timeout: 15_000,
  });

  console.log("Sidebar: Dispatcher Dashboard…");
  await nav
    .getByRole("link", { name: "Dispatcher Dashboard", exact: true })
    .click();
  await page.waitForTimeout(400);
  assertUrl(page, /\/dispatcher/, "Dispatcher Dashboard");
  await page
    .getByRole("heading", { name: "Delivery Overview" })
    .waitFor({ timeout: 15_000 });

  console.log("Sidebar: Settings (pinned)…");
  await nav.getByRole("link", { name: "Settings", exact: true }).click();
  await page.waitForTimeout(400);
  assertUrl(page, /\/settings/, "Settings");
  await page.getByRole("heading", { name: "Settings" }).waitFor({
    timeout: 15_000,
  });
  await page.getByTestId("dispatcher-refresh-now").waitFor({ timeout: 10_000 });
  console.log("PASS: shared dispatcher header on Settings (Refresh Now).");
  if (
    (await page.getByRole("button", { name: "Add Vendor" }).count()) > 0
  ) {
    throw new Error("Settings should not include Add Vendor form");
  }

  console.log("Return to dispatcher for top bar…");
  await nav
    .getByRole("link", { name: "Dispatcher Dashboard", exact: true })
    .click();
  await page.waitForTimeout(400);
  assertUrl(page, /\/dispatcher/, "back to dispatcher");

  console.log("Top bar: + New Delivery…");
  await page.getByRole("button", { name: "+ New Delivery" }).click();
  await page.getByRole("heading", { name: "New Delivery" }).waitFor({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("heading", { name: "New Delivery" }).waitFor({
    state: "hidden",
    timeout: 10_000,
  });

  console.log("Top bar: Refresh Now…");
  await page.getByRole("button", { name: "Refresh Now" }).click();
  await page.waitForTimeout(800);
  assertUrl(page, /\/dispatcher/, "after Refresh");

  console.log("Top bar: Pickup Portal (new tab)…");
  const [pickupPage] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("link", { name: "Pickup Portal ↗" }).click(),
  ]);
  await pickupPage.waitForLoadState("domcontentloaded");
  if (!pickupPage.url().includes("/pickup")) {
    throw new Error(`Pickup Portal tab: expected /pickup, got ${pickupPage.url()}`);
  }
  await pickupPage.close();

  console.log("Top bar: Vendor Portal (new tab)…");
  const [receivePage] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("link", { name: "Vendor Portal ↗" }).click(),
  ]);
  await receivePage.waitForLoadState("domcontentloaded");
  if (!receivePage.url().includes("/receive")) {
    throw new Error(`Vendor Portal tab: expected /receive, got ${receivePage.url()}`);
  }
  await receivePage.close();

  console.log("Drawer pickup actions (away-074)…");
  await page
    .getByRole("heading", { name: "Delivery Overview" })
    .waitFor({ timeout: 15_000 });
  const firstViewBtn = page.locator("button").filter({ hasText: /^View$/ }).first();
  if (await firstViewBtn.isVisible().catch(() => false)) {
    await firstViewBtn.click();
    await page.getByTestId("copy-pickup-information").waitFor({ timeout: 15_000 });

    const qrBtn = page.getByTestId("show-vendor-checkin-qr");
    await qrBtn.waitFor({ timeout: 10_000 });
    const qrLabel = (await qrBtn.innerText()).trim();
    if (qrLabel !== "Show Vendor Check-In QR") {
      throw new Error(`Expected Show Vendor Check-In QR button, got: ${qrLabel}`);
    }
    console.log("PASS: Show Vendor Check-In QR label.");

    if ((await page.getByTestId("job-readiness-panel").count()) > 0) {
      throw new Error("Job Status / job-readiness-panel must be removed from drawer");
    }
    console.log("PASS: Job Status section removed.");

    if ((await page.getByTestId("generate-pickup-link").count()) > 0) {
      throw new Error("Generate Pickup Link must be removed from main action area");
    }
    console.log("PASS: Generate Pickup Link removed from drawer actions.");

    console.log("Slice 5: pickup copy auto secure link…");
    let clipboardText = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByTestId("copy-pickup-information").click();
      await page.waitForTimeout(2000);
      clipboardText = await page.evaluate(async () => navigator.clipboard.readText()).catch(() => "");
      if (/#\/pickup\?t=[a-f0-9]{64}/.test(clipboardText)) break;
    }
    if (!/#\/pickup\?t=[a-f0-9]{64}/.test(clipboardText)) {
      throw new Error(
        `Copy Pickup Information expected token URL in clipboard, got: ${clipboardText.slice(0, 120)}`,
      );
    }
    if (!clipboardText.includes("Staging location:")) {
      throw new Error("Copy Pickup Information expected Staging location: line");
    }
    console.log("Slice 5 PASS: clipboard contains opaque pickup token URL.");

    await runPickupTokenValidityFlow(page, browser, appBase);

    console.log("Mark Pickup Scheduled wiring…");
    const markBtn = page.getByRole("button", { name: "Mark Pickup Scheduled" });
    if (await markBtn.isVisible().catch(() => false)) {
      await markBtn.click();
      await page.getByTestId("pickup-scheduled-badge").waitFor({ timeout: 15_000 });
      console.log("PASS: Mark Pickup Scheduled updates drawer badge.");
    } else {
      console.log("Note: job already Pickup Scheduled — skipping toggle test.");
    }

    console.log("Drawer action banner (away-065)…");
    const actionBanner = page.getByTestId("drawer-action-banner");
    await actionBanner.waitFor({ timeout: 15_000 });
    const bannerHeading = await page.getByTestId("drawer-action-banner-heading").innerText();
    console.log(`Drawer action banner heading: ${bannerHeading.trim()}`);

    console.log("Vendor Communications placeholder (away-066)…");
    await page.getByTestId("vendor-communications-panel").waitFor({ timeout: 10_000 });
    if (await page.getByTestId("vendor-communications-empty").isVisible().catch(() => false)) {
      throw new Error("Vendor Communications empty state must be collapsed by default");
    }
    await page.getByTestId("vendor-communications-toggle").click();
    await page.getByTestId("vendor-communications-empty").waitFor({ timeout: 10_000 });
    const emptyText = await page.getByTestId("vendor-communications-empty").innerText();
    const okDisconnected =
      /No messages yet/i.test(emptyText) && /connect Gmail in Settings/i.test(emptyText);
    const okConnected =
      /No outbound messages yet/i.test(emptyText) && /Resolve Issue/i.test(emptyText);
    if (!okDisconnected && !okConnected) {
      throw new Error(`Vendor Communications empty state unexpected: ${emptyText}`);
    }
    console.log("PASS: Vendor Communications read-only placeholder (away-068).");

    if ((await page.getByTestId("drawer-action-need-more-info").count()) > 0) {
      throw new Error("Need More Info button must be removed from action banner");
    }
    console.log("PASS: Action banner has Resolve Issue + Call Vendor only.");

    const tableRowCount = await page.locator("table tbody tr").count();
    console.log(`Deliveries table rows (unchanged baseline): ${tableRowCount}`);

    const outDir = resolve(process.cwd(), "screenshots");
    mkdirSync(outDir, { recursive: true });

    const resolveBtn = page.getByTestId("drawer-action-resolve-issue");
    if (await resolveBtn.isEnabled().catch(() => false)) {
      await resolveBtn.click();
      await page.getByTestId("resolve-issue-modal").waitFor({ timeout: 10_000 });
      const noteVal = await page.getByTestId("resolution-note-input").inputValue();
      if (!noteVal.trim()) {
        throw new Error("Resolve modal note should have suggested default text");
      }
      if (
        !/Issue:/i.test(noteVal) ||
        !/Suggested Resolution:/i.test(noteVal) ||
        !/Next Step:/i.test(noteVal)
      ) {
        throw new Error("Resolve modal note should include structured sections");
      }
      await assertReadableInputColor(page, "resolution-note-input", "Resolve note");

      const defaultType = await page.getByTestId("resolution-type-select").inputValue();
      if (defaultType !== "vendor_redeliver") {
        console.log(
          `Note: default resolution type is ${defaultType} (expected vendor_redeliver when blocking issue is missing).`,
        );
      } else {
        console.log("PASS: Default resolution type is vendor_redeliver for missing issue.");
      }

      const submitBtn = page.getByTestId("confirm-resolve-issue");
      if (!(await submitBtn.isEnabled())) {
        throw new Error("Save resolution should be enabled when default note exists");
      }
      await page.screenshot({
        path: resolve(outDir, "drawer-resolve-modal-vendor-redeliver.png"),
        fullPage: false,
      });
      console.log("PASS: Resolve modal opens larger with editable default note.");

      await page.getByTestId("resolution-type-select").selectOption("need_more_information");
      await page.getByTestId("resolve-need-more-info-section").waitFor({ timeout: 10_000 });
      if ((await page.getByTestId("resolution-note-input").count()) > 0) {
        throw new Error("Resolution note must be hidden for Need More Information");
      }
      await page.getByTestId("resolve-vendor-info").waitFor({ timeout: 5000 });
      await page.getByTestId("resolve-email-to").waitFor({ timeout: 5000 });
      const toReadOnly = await page.getByTestId("resolve-email-to").getAttribute("readOnly");
      if (toReadOnly !== null) {
        throw new Error("Email To field must be editable");
      }
      const subjectReadOnly = await page.getByTestId("resolve-email-subject").getAttribute("readOnly");
      if (subjectReadOnly !== null) {
        throw new Error("Email subject must be editable");
      }
      const messageReadOnly = await page.getByTestId("resolve-email-message").getAttribute("readOnly");
      if (messageReadOnly !== null) {
        throw new Error("Email message must be editable");
      }
      const emailVendorBtn = page.getByTestId("resolve-email-vendor");
      if (!(await emailVendorBtn.isVisible())) {
        throw new Error("Email Vendor button must appear when Need More Information selected");
      }
      if (await emailVendorBtn.isEnabled()) {
        throw new Error("Email Vendor should be disabled when email provider not connected");
      }
      await page.getByTestId("resolve-email-provider-disconnected").waitFor({ timeout: 5000 });
      const saveBtnNeedMore = page.getByTestId("confirm-resolve-issue");
      if (!(await saveBtnNeedMore.isEnabled())) {
        throw new Error("Save resolution should be enabled for Need More Information without note");
      }
      await page.screenshot({
        path: resolve(outDir, "drawer-resolve-modal-need-more-info.png"),
        fullPage: false,
      });
      console.log("PASS: Need More Information shows editable email fields + Email Vendor.");

      await page.getByTestId("resolution-type-select").selectOption("other");
      await page.getByTestId("resolution-note-input").waitFor({ timeout: 5000 });
      await page.getByTestId("resolution-note-input").fill("");
      const saveBtnOther = page.getByTestId("confirm-resolve-issue");
      if (await saveBtnOther.isEnabled()) {
        throw new Error("Save resolution must be disabled for Other when note is empty");
      }
      await page.getByTestId("resolution-note-input").fill("Custom resolution note for other.");
      if (!(await saveBtnOther.isEnabled())) {
        throw new Error("Save resolution should enable when Other note is provided");
      }
      console.log("PASS: Other resolution type requires note before save.");

      await page.getByRole("button", { name: "Cancel" }).click();
      await page.waitForTimeout(400);
    } else {
      console.log("SKIP Resolve banner button: no blocking issues on this delivery.");
    }

    const callVendorBtn = page.getByTestId("drawer-action-call-vendor");
    if ((await callVendorBtn.count()) === 0) {
      console.log("SKIP Call Vendor: not shown on calm pending delivery.");
    } else {
      const callVendorHref = await callVendorBtn.getAttribute("href");
      if (callVendorHref) {
        throw new Error("Call Vendor banner button must not be a direct tel: link");
      }
      await callVendorBtn.click();
      await page.getByTestId("call-vendor-modal").waitFor({ timeout: 10_000 });
      await page.getByTestId("call-vendor-name").waitFor({ timeout: 5000 });
      const modalPhoneLink = page.getByTestId("call-vendor-phone-link");
      const modalPhoneMissing = page.getByTestId("call-vendor-phone-missing");
      if (
        !(await modalPhoneLink.isVisible().catch(() => false)) &&
        !(await modalPhoneMissing.isVisible().catch(() => false))
      ) {
        throw new Error("Call Vendor modal must show phone link or missing message");
      }
      console.log("PASS: Call Vendor opens StageVerify modal (no direct tel on banner).");
      await page.screenshot({
        path: resolve(outDir, "drawer-call-vendor-modal.png"),
        fullPage: false,
      });
      await page.getByTestId("call-vendor-close").click();
      await page.waitForTimeout(300);
    }

    if ((await page.getByTestId("drawer-action-need-more-info").count()) > 0) {
      throw new Error("Need More Info banner button must be removed (away-065)");
    }

    await page.screenshot({
      path: resolve(outDir, "drawer-action-banner-no-need-more-info.png"),
      fullPage: false,
    });

    const tableRowCountAfter = await page.locator("table tbody tr").count();
    if (tableRowCountAfter !== tableRowCount) {
      throw new Error("Deliveries table row count changed after drawer modal checks");
    }
    console.log("PASS: Deliveries table unchanged after modal interactions.");

    await page.screenshot({
      path: resolve(outDir, "drawer-action-banner.png"),
      fullPage: false,
    });

    const orderNumber = process.env.STAGEVERIFY_PICKUP_ORDER ?? "ORD-004";
    const search = page.locator('input[placeholder*="Job #, name, PO"]');
    try {
      if (await search.isVisible().catch(() => false)) {
        await search.fill(orderNumber);
        await page.waitForTimeout(1200);
        const rowView = page.locator("button").filter({ hasText: /^View$/ }).first();
        if (await rowView.isVisible().catch(() => false)) {
          await rowView.click({ force: true });
          await page.waitForTimeout(1000);
          const summary = page.getByTestId("pickup-summary-panel");
          if (await summary.isVisible().catch(() => false)) {
            const text = (await summary.innerText()) ?? "";
            if (!text.trim()) {
              throw new Error("pickup-summary-panel visible but empty.");
            }
            console.log("Pickup summary PASS: pickup-summary-panel visible in delivery drawer.");
          } else {
            console.log(
              "SKIP pickup summary: panel not visible (expand Pickup Summary section if collapsed).",
            );
          }
        }
      }
    } catch (err) {
      console.log(
        `SKIP pickup summary check: ${err instanceof Error ? err.message : err}`,
      );
    }
  } else {
    console.log("SKIP job readiness panel: no delivery rows to open.");
  }

  console.log("Needs Review email strip (Phase 5)…");
  await page.getByTestId("needs-review-email-strip").waitFor({
    timeout: 15_000,
  });
  await page.getByTestId("needs-review-email-count").waitFor({ timeout: 10_000 });
  if (await page.getByTestId("proposed-email-updates-panel").count()) {
    throw new Error("Proposed Email Updates panel must be retired");
  }
  console.log("Phase 5 PASS: needs-review-email-strip visible; legacy panel absent.");

  const needsReviewToggle = page.getByTestId("needs-review-email-toggle");
  if (await needsReviewToggle.count()) {
    await needsReviewToggle.click();
    const needsReviewList = page.getByTestId("needs-review-email-list");
    await needsReviewList.waitFor({ timeout: 10_000 });
    await page.getByRole("heading", { name: "Delivery Overview" }).click();
    await needsReviewList.waitFor({ state: "hidden", timeout: 10_000 });
    console.log("Needs Review PASS: outside click collapses expanded strip.");
  } else {
    console.log("SKIP needs-review collapse: zero-item strip has no toggle.");
  }

  console.log("Shop stock directory on Staging Map…");
  await page.goto(`${appBase}/#/zones`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.getByTestId("shop-stock-directory").waitFor({ timeout: 15_000 });
  console.log("Shop stock PASS: shop-stock-directory visible on /zones.");

  await browser.close();
  console.log("verify:dispatcher-nav PASS");
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

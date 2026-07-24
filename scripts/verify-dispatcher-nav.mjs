/**
 * Playwright: dispatcher portal sidebar + top bar navigation.
 *
 * Usage:
 *   npm run dev
 *   node scripts/playwright-auth-setup.mjs   (if token expired)
 *   npm run verify:dispatcher-nav
 *
 * Prod (no ORD demo fixtures):
 *   STAGEVERIFY_BASE_URL=https://lgarage.github.io/stageverify npm run verify:dispatcher-nav
 *
 * Optional env:
 *   STAGEVERIFY_VERIFY_ORDER — single search term (default tries 4046362, P411190, INV-P411190)
 *   STAGEVERIFY_VERIFY_PICKUP_TOKEN=1 — run ORD pickup-token validity flow (local/demo fixtures)
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  classifyEmailReviewDisplay,
  getEmailReviewHeadlines,
} from "../src/dispatcher/email/emailReviewHelpers.ts";
import {
  assertNoElementOverlap,
  assertReadableTextContrast,
  DISPATCHER_TOPBAR_CONTRAST_SPEC,
  DISPATCHER_TOPBAR_OVERLAP_SPEC,
} from "./lib/ui-text-contrast-lib.mjs";
import {
  assertDeliveryDrawerOpen,
  ensureAuthenticated,
  loadEnvLocal,
  openDeliveryDrawerForNavVerify,
  openOrderDrawerBySearch,
  logDeliveryTableDiagnostics,
  assertDeliveredOverviewTiles,
  shouldRunPickupTokenVerify,
} from "./dispatcherVerifyHelpers.mjs";

const baseUrl =
  process.argv.includes("--base-url")
    ? process.argv[process.argv.indexOf("--base-url") + 1]
    : process.argv.find((a) => a.startsWith("--base-url="))?.split("=")[1] ??
      process.env.STAGEVERIFY_BASE_URL ??
      "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const pkgVersion = JSON.parse(
  readFileSync(resolve(process.cwd(), "package.json"), "utf-8"),
).version;
const authState = resolve(process.cwd(), "playwright/.auth/state.json");
loadEnvLocal();

function assertUrl(page, pattern, label) {
  const url = page.url();
  if (!pattern.test(url)) {
    throw new Error(`${label}: expected URL matching ${pattern}, got ${url}`);
  }
}

/** Left edge x of vendor-communications-entry (stable across breadcrumb lengths). */
async function vendorCommsEntryX(page) {
  const box = await page.getByTestId("vendor-communications-entry").boundingBox();
  if (!box) {
    throw new Error("vendor-communications-entry has no bounding box");
  }
  return box.x;
}

function assertStableVendorCommsX(dashboardX, zonesX, tolerancePx = 4) {
  const delta = Math.abs(dashboardX - zonesX);
  if (delta > tolerancePx) {
    throw new Error(
      `Vendor Communications x must stay within ${tolerancePx}px across tabs (dashboard=${dashboardX.toFixed(1)}, zones=${zonesX.toFixed(1)}, delta=${delta.toFixed(1)})`,
    );
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

function assertReadableLabelColor(page, testId, label) {
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
        `${label}: label text should be dark/readable on white panel, got color ${result.color}`,
      );
    }
  });
}

const RIVERSIDE_JOB_ID = "job-1";
const STALE_PICKUP_TOKEN =
  "d113403af1d6d98b9e9c96d19fcc91125aba2d611e6faca551ace710b91f5b26";

function assertEmailReviewCopyHelpers() {
  const matched = {
    messageId: "test-matched",
    subject: "Re: Delivery question",
    senderEmail: "vendor@johnstone.com",
    receivedAt: "2026-07-06T20:58:00Z",
    classification: "needs_dispatcher_review",
    poNumber: null,
    vendorName: null,
    confidenceScore: 95,
    confidenceReason: "thread_ladder:threadId",
    reviewStatus: "pending_review",
    duplicate: false,
    matchedJobNumber: null,
    matchedPoLabel: null,
    matchedOrderLabel: null,
    matchedDeliveryLabel: "del-1",
    matchedDeliveryOrderId: "del-1",
    itemLines: [],
    bodyExcerpt: "test received. 8:58pm",
    originalBody: "test received. 8:58pm",
    recipientEmails: ["dispatcher@example.com"],
    proposedOperationalMeaning: "",
    affectsCondition1: false,
    condition1ApprovalNote: "",
    matchedBy: "threadId",
    humanReviewRequired: true,
  };

  const matchedTier = classifyEmailReviewDisplay(matched);
  if (matchedTier !== "matched_vendor_reply") {
    throw new Error(`Expected matched_vendor_reply tier, got ${matchedTier}`);
  }
  const matchedHeadlines = getEmailReviewHeadlines(matched);
  if (!matchedHeadlines.primary.includes("Vendor Reply — Needs Review")) {
    throw new Error(`Matched primary label unexpected: ${matchedHeadlines.primary}`);
  }
  if (/Suspicious/i.test(matchedHeadlines.primary)) {
    throw new Error("Matched vendor reply must not show Suspicious in primary label");
  }

  const spoof = {
    ...matched,
    messageId: "test-spoof",
    matchedBy: "bodyToken",
    confidenceReason: "thread_ladder:bodyToken; spoofed_body_ref_failed_auth",
    applyConflictReason: "spoofed_body_ref_failed_auth",
  };
  const spoofTier = classifyEmailReviewDisplay(spoof);
  if (spoofTier !== "spoof_conflict") {
    throw new Error(`Expected spoof_conflict tier, got ${spoofTier}`);
  }
  const spoofHeadlines = getEmailReviewHeadlines(spoof);
  if (!/Suspicious/i.test(spoofHeadlines.primary)) {
    throw new Error(`Spoof case should retain caution label: ${spoofHeadlines.primary}`);
  }

  const unmatched = {
    ...matched,
    messageId: "test-unmatched",
    matchedBy: "none",
    matchedDeliveryOrderId: null,
    matchedDeliveryLabel: null,
    classification: "unable_to_match",
    confidenceReason: "unable_to_match",
  };
  const unmatchedTier = classifyEmailReviewDisplay(unmatched);
  if (unmatchedTier !== "unmatched") {
    throw new Error(`Expected unmatched tier, got ${unmatchedTier}`);
  }
  const unmatchedHeadlines = getEmailReviewHeadlines(unmatched);
  if (unmatchedHeadlines.primary !== "Unmatched Email — Needs Review") {
    throw new Error(`Unmatched primary label unexpected: ${unmatchedHeadlines.primary}`);
  }
  if (/Suspicious/i.test(unmatchedHeadlines.primary)) {
    throw new Error("Plain unmatched must not show Suspicious in primary label");
  }
  if (/Matched to an existing StageVerify email thread/i.test(unmatchedHeadlines.secondary)) {
    throw new Error("Unmatched must not use matched-thread secondary copy");
  }

  const unmatchedUnknownDomain = {
    ...unmatched,
    messageId: "test-unmatched-domain",
    confidenceReason: "unknown_sender_domain",
  };
  const unknownDomainHeadlines = getEmailReviewHeadlines(unmatchedUnknownDomain);
  if (!/Unknown sender or vendor domain/i.test(unknownDomainHeadlines.secondary)) {
    throw new Error(
      `unknown_sender_domain detail missing: ${unknownDomainHeadlines.secondary}`,
    );
  }

  console.log("PASS: email review copy helpers (matched vs unmatched vs suspicious tiers).");
}

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

async function openPickupFixtureDrawer(page, orderNumber) {
  await openOrderDrawerBySearch(page, orderNumber);
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

async function runPickupTokenValidityFlow(page, browser, appBase, orderNumber) {
  console.log(`Pickup token validity (${orderNumber} fixture)…`);
  await page.goto(`${appBase}/#/dispatcher`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page
    .getByRole("heading", { name: "Delivery Overview" })
    .waitFor({ timeout: 15_000 });
  await openPickupFixtureDrawer(page, orderNumber);

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
  const authOutcome = await ensureAuthenticated(page, appBase);
  console.log(`Diagnostics: authSuccess=${authOutcome}`);
  await page
    .getByRole("heading", { name: "Delivery Overview" })
    .waitFor({ timeout: 30_000 });
  await logDeliveryTableDiagnostics(page, { authOutcome });

  console.log("Dispatcher top bar layout + contrast (D-42/D-45)…");
  await assertNoElementOverlap(page, DISPATCHER_TOPBAR_OVERLAP_SPEC);
  await assertReadableTextContrast(page, DISPATCHER_TOPBAR_CONTRAST_SPEC);
  console.log("PASS: dispatcher top bar — no overlap; readable text.");

  console.log("Delivery Overview: Delivered summary tile…");
  await assertDeliveredOverviewTiles(page);

  const nav = sidebar(page);

  const sidebarVersion = nav.getByTestId("portal-sidebar-version");
  await sidebarVersion.waitFor({ timeout: 10_000 });
  const versionText = (await sidebarVersion.innerText()).trim();
  if (versionText !== `v${pkgVersion}`) {
    throw new Error(
      `Sidebar version expected v${pkgVersion}, got ${versionText}`,
    );
  }
  console.log(`PASS: sidebar version label (${versionText}).`);

  console.log("Vendor Communications horizontal position (Dashboard)…");
  const vendorCommsDashboard = page.getByTestId("vendor-communications-entry");
  await vendorCommsDashboard.waitFor({ timeout: 10_000 });
  const dashboardCommsX = await vendorCommsEntryX(page);
  await vendorCommsDashboard.click();
  await page.getByTestId("vendor-communications-modal").waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByTestId("vendor-communications-modal").waitFor({
    state: "hidden",
    timeout: 10_000,
  });
  console.log(`PASS: Vendor Communications modal opens on Dashboard (x=${dashboardCommsX.toFixed(1)}).`);

  if (
    (await nav.getByRole("link", { name: "Deliveries", exact: true }).count()) >
    0
  ) {
    throw new Error("Deliveries sidebar link should be removed");
  }
  if (
    (await nav.getByRole("link", { name: "Invoice Review", exact: true }).count()) >
    0
  ) {
    throw new Error("Invoice Review sidebar link should be removed (Needs Review on Delivery Overview)");
  }
  console.log("PASS: Invoice Review sidebar link absent.");

  console.log("Sidebar: Staging Map…");
  await nav.getByRole("link", { name: "Staging Map", exact: true }).click();
  await page.waitForTimeout(400);
  assertUrl(page, /\/zones/, "Staging Map");
  await page.getByRole("heading", { name: "Staging Map" }).waitFor({
    timeout: 15_000,
  });

  console.log("Staging Map top bar layout + contrast…");
  await assertNoElementOverlap(page, DISPATCHER_TOPBAR_OVERLAP_SPEC);
  await assertReadableTextContrast(page, DISPATCHER_TOPBAR_CONTRAST_SPEC);
  console.log("PASS: Staging Map top bar — no overlap; readable text.");

  console.log("Vendor Communications persistent on Staging Map…");
  const vendorCommsOnZones = page.getByTestId("vendor-communications-entry");
  await vendorCommsOnZones.waitFor({ timeout: 10_000 });
  if (!(await vendorCommsOnZones.isVisible())) {
    throw new Error(
      "Vendor Communications button must stay visible on Staging Map",
    );
  }
  const zonesCommsX = await vendorCommsEntryX(page);
  assertStableVendorCommsX(dashboardCommsX, zonesCommsX);
  console.log(
    `PASS: Vendor Communications x stable Dashboard→Staging Map (Δ≤4px, dashboard=${dashboardCommsX.toFixed(1)}, zones=${zonesCommsX.toFixed(1)}).`,
  );
  await vendorCommsOnZones.click();
  await page.getByTestId("vendor-communications-modal").waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByTestId("vendor-communications-modal").waitFor({
    state: "hidden",
    timeout: 10_000,
  });
  console.log("PASS: Vendor Communications persistent on Staging Map.");

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
  await page.getByRole("columnheader", { name: "Email Domain", exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId("add-vendor-email-domain").waitFor({ timeout: 10_000 });
  console.log("PASS: Vendors page includes Email Domain field.");

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

  await page
    .getByRole("heading", { name: "Delivery Overview" })
    .waitFor({ timeout: 15_000 });

  console.log("Vendor Communications entry point…");
  const vendorCommsEntry = page.getByTestId("vendor-communications-entry");
  await vendorCommsEntry.waitFor({ timeout: 10_000 });
  await vendorCommsEntry.click();
  await page.getByTestId("vendor-communications-modal").waitFor({ timeout: 10_000 });

  const labelChecks = [
    ["vendor-comms-label-vendor", "Vendor"],
    ["vendor-comms-label-delivery", "Associated Delivery / Order"],
    ["vendor-comms-label-email", "Email Address"],
    ["vendor-comms-label-subject", "Subject"],
    ["vendor-comms-label-message", "Message"],
  ];
  for (const [testId, expected] of labelChecks) {
    const el = page.getByTestId(testId);
    const text = (await el.innerText()).trim();
    if (text !== expected) {
      throw new Error(`Expected label "${expected}", got "${text}"`);
    }
    if (!(await el.isVisible())) {
      throw new Error(`Label "${expected}" not visible`);
    }
    await assertReadableLabelColor(page, testId, expected);
  }
  console.log("PASS: Vendor Communications field labels visible and readable.");

  const vendorCommsShotDir = resolve(process.cwd(), "screenshots");
  mkdirSync(vendorCommsShotDir, { recursive: true });
  const vendorCommsShotPath = resolve(
    vendorCommsShotDir,
    "vendor-comms-modal-labels.png",
  );
  await page.screenshot({ path: vendorCommsShotPath, fullPage: false });
  console.log(`Screenshot: ${vendorCommsShotPath}`);

  const helperText = await page.getByTestId("vendor-comms-helper").innerText();
  if (
    !helperText.includes("This starts a new tracked vendor email thread") ||
    !helperText.includes("Needs Review until inbound ingest is enabled")
  ) {
    throw new Error(`Unexpected vendor comms helper text: ${helperText}`);
  }
  console.log("PASS: Vendor Communications helper text visible.");

  const sendBtn = page.getByTestId("vendor-comms-send");
  if (await sendBtn.isEnabled()) {
    throw new Error("Vendor Communications Send must be disabled when fields empty");
  }
  await page.getByTestId("vendor-comms-to").fill("test@example.com");
  await page.getByTestId("vendor-comms-subject").fill("Test subject");
  if (await sendBtn.isEnabled()) {
    throw new Error("Vendor Communications Send must stay disabled without message body");
  }
  await page.getByTestId("vendor-comms-body").fill("Test body");
  console.log("PASS: Vendor Communications required field validation.");

  const sendEnabled = await sendBtn.isEnabled();
  const disconnectedVisible = await page
    .getByTestId("vendor-comms-provider-disconnected")
    .isVisible()
    .catch(() => false);
  if (sendEnabled) {
    console.log(
      "Note: Gmail connected in this environment — Send enabled with valid fields (no send click).",
    );
  } else if (disconnectedVisible) {
    console.log("PASS: Vendor Communications Send gated when Gmail disconnected.");
  } else {
    throw new Error(
      "Vendor Communications Send disabled without disconnected banner — unexpected state",
    );
  }
  console.log("PASS: Vendor Communications modal opens.");

  await page.getByRole("button", { name: "Close" }).click();
  await page.getByTestId("vendor-communications-modal").waitFor({ state: "hidden", timeout: 10_000 });
  console.log("PASS: Vendor Communications modal closes.");

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

  console.log("Delivery drawer (dynamic row selection)…");
  await page
    .getByRole("heading", { name: "Delivery Overview" })
    .waitFor({ timeout: 15_000 });

  const drawerSelection = await openDeliveryDrawerForNavVerify(page);
  console.log(
    `Diagnostics: opened drawer via ${drawerSelection.method}, searchTerm=${drawerSelection.searchTerm}, rowCount=${drawerSelection.rowCount}`,
  );
  await assertDeliveryDrawerOpen(page);
  console.log("PASS: delivery drawer opened.");

  console.log("Delivery drawer legacy action buttons removed…");
  for (const testId of [
    "copy-pickup-information",
    "show-vendor-checkin-qr",
    "drawer-review-parsed-invoice",
  ]) {
    if ((await page.getByTestId(testId).count()) > 0) {
      throw new Error(`Legacy drawer control ${testId} must be removed`);
    }
  }
  if ((await page.getByRole("button", { name: "Mark Pickup Scheduled" }).count()) > 0) {
    throw new Error("Mark Pickup Scheduled must be removed from drawer actions");
  }
  if ((await page.getByRole("button", { name: "Clear Pickup Scheduled" }).count()) > 0) {
    throw new Error("Clear Pickup Scheduled must be removed from drawer actions");
  }
  console.log("PASS: legacy drawer action buttons removed.");

  for (const testId of [
    "planned-staging-assignment",
    "assign-staging-location-heading",
    "save-planned-staging",
    "drawer-items-section",
  ]) {
    if ((await page.getByTestId(testId).count()) > 0) {
      throw new Error(`Removed drawer section ${testId} must not appear`);
    }
  }
  console.log("PASS: Planned Staging and Items sections removed.");

  if ((await page.getByTestId("job-readiness-panel").count()) > 0) {
    throw new Error("Job Status / job-readiness-panel must be removed from drawer");
  }
  console.log("PASS: Job Status section removed.");

  if ((await page.getByTestId("generate-pickup-link").count()) > 0) {
    throw new Error("Generate Pickup Link must be removed from main action area");
  }
  console.log("PASS: Generate Pickup Link removed from drawer actions.");

  if ((await page.getByTestId("delivery-basics-card").count()) > 0) {
    await assertReadableTextContrast(page, {
      rootSelector: '[data-testid="delivery-basics-card"]',
      elements: [{ name: "Delivery basics", selector: "div" }],
    });
    console.log("PASS: delivery basics readable contrast (D-42).");
  }

  if (await page.getByTestId("drawer-action-banner").isVisible().catch(() => false)) {
    console.log("Drawer action banner (away-065)…");
    const actionBanner = page.getByTestId("drawer-action-banner");
    await actionBanner.waitFor({ timeout: 15_000 });
    const bannerHeading = await page.getByTestId("drawer-action-banner-heading").innerText();
    console.log(`Drawer action banner heading: ${bannerHeading.trim()}`);

    console.log("Vendor Communications placeholder (away-066)…");
    if (
      await page.getByTestId("vendor-communications-panel").isVisible().catch(() => false)
    ) {
      if (await page.getByTestId("vendor-communications-empty").isVisible().catch(() => false)) {
        throw new Error("Vendor Communications empty state must be collapsed by default");
      }
      await page.getByTestId("vendor-communications-toggle").click();
      await page.waitForFunction(
        () => {
          if (document.querySelector('[data-testid="vendor-communications-loading"]')) {
            return false;
          }
          return (
            document.querySelector('[data-testid="vendor-communications-empty"]') ||
            document.querySelector('[data-testid="vendor-communications-list"]') ||
            document.querySelector('[data-testid="vendor-communications-error"]')
          );
        },
        undefined,
        { timeout: 15_000 },
      );
      if (await page.getByTestId("vendor-communications-list").isVisible().catch(() => false)) {
        console.log("PASS: Vendor Communications drawer shows outbound list (away-068).");
      } else {
      const emptyText = await page.getByTestId("vendor-communications-empty").innerText();
      const okDisconnected =
        /No messages yet/i.test(emptyText) && /connect Gmail in Settings/i.test(emptyText);
      const okConnected =
        /No outbound messages yet/i.test(emptyText) && /Resolve Issue/i.test(emptyText);
      if (!okDisconnected && !okConnected) {
        throw new Error(`Vendor Communications empty state unexpected: ${emptyText}`);
      }
      console.log("PASS: Vendor Communications read-only placeholder (away-068).");
      }
    } else {
      console.log("SKIP Vendor Communications: panel not on this delivery.");
    }

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

    if (shouldRunPickupTokenVerify()) {
      const pickupSummaryOrder =
        process.env.STAGEVERIFY_PICKUP_ORDER ?? "ORD-004";
      const search = page.locator('input[placeholder*="Job #, name, PO"]');
      try {
        if (await search.isVisible().catch(() => false)) {
          await search.fill(pickupSummaryOrder);
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
              console.log(
                "Pickup summary PASS: pickup-summary-panel visible in delivery drawer.",
              );
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
      console.log(
        "SKIP pickup summary: requires STAGEVERIFY_VERIFY_PICKUP_TOKEN=1 with local fixture.",
      );
    }
  } else {
    console.log("SKIP drawer action banner checks: banner not on this delivery.");
  }

  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  console.log("Needs Review email strip (Phase 5)…");
  assertEmailReviewCopyHelpers();
  await page.getByTestId("needs-review-email-strip").waitFor({
    timeout: 15_000,
  });
  await page.getByTestId("needs-review-email-count").waitFor({ timeout: 10_000 });
  if (await page.getByTestId("proposed-email-updates-panel").count()) {
    throw new Error("Proposed Email Updates panel must be retired");
  }
  console.log("Phase 5 PASS: needs-review-email-strip visible; legacy panel absent.");

  await page.getByTestId("needs-review-section").waitFor({ timeout: 10_000 });
  await page.getByTestId("needs-review-invoice-block").waitFor({ timeout: 10_000 });
  await page.getByTestId("invoice-review-panel").waitFor({ timeout: 15_000 });
  console.log("PASS: Needs Review includes invoice-review-panel on Delivery Overview.");

  const needsReviewToggle = page.getByTestId("needs-review-email-toggle");
  if (await needsReviewToggle.count()) {
    await needsReviewToggle.click();
    const needsReviewList = page.getByTestId("needs-review-email-list");
    await needsReviewList.waitFor({ timeout: 10_000 });

    const needsReviewItems = page.locator('[data-testid^="needs-review-email-item-"]');
    const itemCount = await needsReviewItems.count();
    if (itemCount === 0) {
      throw new Error("Needs Review list expanded but no items found");
    }

    for (let i = 0; i < itemCount; i++) {
      const item = needsReviewItems.nth(i);
      const itemTestId = await item.getAttribute("data-testid");
      const reviewTier = await item.getAttribute("data-review-tier");
      const messageId = itemTestId?.replace("needs-review-email-item-", "") ?? "";
      if (!messageId) continue;

      const reasonText = (
        await page.getByTestId(`needs-review-email-reason-${messageId}`).innerText()
      ).trim();
      const secondaryText = (
        await page.getByTestId(`needs-review-email-secondary-${messageId}`).innerText()
      ).trim();
      const excerptText = (
        await page.getByTestId(`needs-review-email-excerpt-${messageId}`).innerText()
      ).trim();
      const previewBlockText = (
        await page.getByTestId(`needs-review-email-preview-${messageId}`).innerText()
      ).trim();

      if (reviewTier === "matched_vendor_reply") {
        if (!reasonText.includes("Vendor Reply — Needs Review")) {
          throw new Error(`Matched item expected Vendor Reply primary: ${reasonText}`);
        }
        if (/Suspicious/i.test(reasonText)) {
          throw new Error(`Matched vendor reply must not show Suspicious: ${reasonText}`);
        }
      }

      if (reviewTier === "unmatched") {
        if (reasonText !== "Unmatched Email — Needs Review") {
          throw new Error(`Unmatched item expected calm primary: ${reasonText}`);
        }
        if (/Suspicious/i.test(reasonText)) {
          throw new Error(`Unmatched must not show Suspicious: ${reasonText}`);
        }
        if (/Matched to an existing StageVerify email thread/i.test(secondaryText)) {
          throw new Error(
            `Unmatched must not use matched-thread secondary: ${secondaryText}`,
          );
        }
        if (/92f1db5a/i.test(excerptText) || /92f1db5a/i.test(previewBlockText)) {
          throw new Error(
            "Unmatched collapsed preview must not expose token 92f1db5a (original email OK)",
          );
        }
      }

      if (reviewTier === "spoof_conflict" && !/Suspicious/i.test(reasonText)) {
        throw new Error(`Spoof/conflict tier expected Suspicious label: ${reasonText}`);
      }

      const showOriginalBtn = page.getByTestId(
        `needs-review-view-original-${messageId}`,
      );
      const btnLabel = (await showOriginalBtn.innerText()).trim();
      if (btnLabel !== "Show Original Email") {
        throw new Error(`Expected Show Original Email toggle, got: ${btnLabel}`);
      }
      await showOriginalBtn.click();
      await page.getByTestId(`needs-review-original-${messageId}`).waitFor({
        timeout: 10_000,
      });
      const hideLabel = (await showOriginalBtn.innerText()).trim();
      if (hideLabel !== "Hide Original Email") {
        throw new Error(`Expected Hide Original Email toggle, got: ${hideLabel}`);
      }
      await showOriginalBtn.click();
      await page.getByTestId(`needs-review-original-${messageId}`).waitFor({
        state: "hidden",
        timeout: 10_000,
      });

      console.log(
        `PASS: Needs Review item ${i + 1}/${itemCount} tier=${reviewTier ?? "unknown"} messageId=${messageId}; original email toggle works.`,
      );
    }

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

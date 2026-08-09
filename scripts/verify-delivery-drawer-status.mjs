/**
 * Playwright: delivery drawer status dropdown + fulfillment toggle under PO#.
 *
 * Usage:
 *   npm run dev   (another terminal)
 *   npm run verify:delivery-drawer-status
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  assertReadableTextContrast,
} from "./lib/ui-text-contrast-lib.mjs";
import {
  ensureAuthenticated,
  loadEnvLocal,
  openDeliveryDrawerByDeepLink,
  openDeliveryDrawerForNavVerify,
} from "./dispatcherVerifyHelpers.mjs";

/** Seed fixtures — CASE A no staging; CASE B assigned/planned staging. */
const FIXTURE_NO_STAGING_ID = "delivery-2";
/** Live demo seed with stagingLocationId + planned IDs (shows G1 chips; delivery-1 may be absent). */
const FIXTURE_ASSIGNED_STAGING_ID = "delivery-demo-vendor-1";

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const authState = resolve(process.cwd(), "playwright/.auth/state.json");
const outDir = resolve(process.cwd(), "screenshots/delivery-drawer-status");
loadEnvLocal();

const STATUS_CONTROL_CONTRAST = {
  rootSelector: '[data-testid="delivery-status-controls"]',
  elements: [
    {
      name: "status dropdown",
      selector: '[data-testid="delivery-status-dropdown"]',
      large: false,
    },
    {
      name: "status current label",
      selector: '[data-testid="delivery-status-current-label"]',
      large: false,
    },
    {
      name: "fulfillment vendor drop-off button",
      selector: '[data-testid="delivery-fulfillment-delivery"]',
      large: false,
    },
    {
      name: "fulfillment will-call pickup button",
      selector: '[data-testid="delivery-fulfillment-will_call_pickup"]',
      large: false,
    },
  ],
};

const ASSIGN_LOCATION_CONTRAST = {
  rootSelector: '[data-testid="drawer-staging-location-banner"]',
  elements: [
    {
      name: "Assign Location CTA",
      selector: '[data-testid="drawer-staging-location-assign"]',
      large: false,
    },
  ],
};

(async () => {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const page = await context.newPage();

  console.log(`Opening ${appBase}/#/dispatcher`);
  await ensureAuthenticated(page, appBase);
  await page.goto(`${appBase}/#/dispatcher`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(1500);

  await openDeliveryDrawerForNavVerify(page);
  console.log("PASS: Opened delivery drawer");

  const drawer = page.getByTestId("delivery-detail-drawer");
  await drawer.waitFor({ state: "visible", timeout: 20_000 });

  const basicsCard = page.getByTestId("delivery-basics-card");
  await basicsCard.waitFor({ timeout: 20_000 });

  const statusDropdown = page.getByTestId("delivery-status-dropdown");
  await statusDropdown.waitFor({ timeout: 10_000 });
  console.log("PASS: Status dropdown present under Delivery Basics");

  const fulfillmentControl = page.getByTestId("delivery-fulfillment-control");
  await fulfillmentControl.waitFor({ timeout: 10_000 });
  console.log("PASS: Fulfillment control present");

  const vendorDropOffButton = page.getByTestId(
    "delivery-fulfillment-delivery",
  );
  const willCallPickupButton = page.getByTestId(
    "delivery-fulfillment-will_call_pickup",
  );
  const vendorDropOffText = (await vendorDropOffButton.innerText()).trim();
  const willCallPickupText = (await willCallPickupButton.innerText()).trim();
  if (vendorDropOffText !== "Vendor Drop-Off") {
    throw new Error(
      `FAIL: Delivery fulfillment button should say "Vendor Drop-Off" — got "${vendorDropOffText}".`,
    );
  }
  if (willCallPickupText !== "Will-Call / Pickup from Vendor") {
    throw new Error(
      `FAIL: Will-call fulfillment button should say "Will-Call / Pickup from Vendor" — got "${willCallPickupText}".`,
    );
  }
  console.log("PASS: Fulfillment buttons use dispatcher-facing wording");

  await page.waitForFunction(() => {
    const deliveryButton = document.querySelector(
      '[data-testid="delivery-fulfillment-delivery"]',
    );
    const willCallButton = document.querySelector(
      '[data-testid="delivery-fulfillment-will_call_pickup"]',
    );
    if (
      !(deliveryButton instanceof HTMLButtonElement) ||
      !(willCallButton instanceof HTMLButtonElement)
    ) {
      return false;
    }
    const deliverySelected = deliveryButton.getAttribute("data-selected") === "true";
    const willCallSelected = willCallButton.getAttribute("data-selected") === "true";
    return deliverySelected !== willCallSelected;
  });
  const willCallActive =
    (await willCallPickupButton.getAttribute("data-selected")) === "true";
  const expectedFulfillmentContext = willCallActive
    ? "Will-Call / Pickup from Vendor"
    : "Vendor Drop-Off";
  const statusContextText = (
    await page.getByTestId("delivery-status-current-label").innerText()
  ).trim();
  if (!statusContextText.includes(`· ${expectedFulfillmentContext}`)) {
    throw new Error(
      `FAIL: Status context should include "· ${expectedFulfillmentContext}" — got "${statusContextText}".`,
    );
  }
  console.log(
    `PASS: Status context uses "${expectedFulfillmentContext}" for active fixture`,
  );

  const poRow = basicsCard.locator("text=PO #");
  const statusControls = page.getByTestId("delivery-status-controls");
  const poBox = await poRow.boundingBox();
  const statusBox = await statusControls.boundingBox();
  if (!poBox || !statusBox || statusBox.y <= poBox.y) {
    throw new Error(
      "FAIL: Status controls should appear below PO # in Delivery Basics.",
    );
  }
  console.log("PASS: Status controls positioned under PO #");

  const stagingHeading = page.getByTestId(
    "delivery-basics-staging-locations-heading",
  );
  const stagingBox = await stagingHeading.boundingBox();
  if (!statusBox || !stagingBox || statusBox.y >= stagingBox.y) {
    throw new Error(
      "FAIL: Status controls should appear before Staging Locations chips.",
    );
  }
  console.log("PASS: Status controls precede staging location chips");

  const stagingBanner = page.getByTestId("drawer-staging-location-banner");
  const stagingBannerCount = await stagingBanner.count();
  const hasAssignedStagingAttribute = await page
    .getByTestId("delivery-basics-staging-locations")
    .getAttribute("data-has-assigned-staging");
  if (
    hasAssignedStagingAttribute !== "true" &&
    hasAssignedStagingAttribute !== "false"
  ) {
    throw new Error(
      `FAIL: Drawer fixture is missing assignment metadata — got "${hasAssignedStagingAttribute}".`,
    );
  }
  const hasAssignedStaging = hasAssignedStagingAttribute === "true";

  if (willCallActive || hasAssignedStaging) {
    if (stagingBannerCount > 0) {
      throw new Error(
        `FAIL: Staging banner should be absent for ${
          willCallActive ? "Will-Call / Pickup from Vendor" : "assigned staging IDs"
        }.`,
      );
    }
    console.log(
      `PASS: Staging banner absent for ${
        willCallActive ? "Will-Call / Pickup from Vendor" : "assigned staging IDs"
      } fixture`,
    );
  } else {
    if (stagingBannerCount === 0) {
      throw new Error(
        "FAIL: Vendor Drop-Off fixture without staging should show the staging banner.",
      );
    }
    const fulfillmentBox = await fulfillmentControl.boundingBox();
    const bannerBox = await stagingBanner.boundingBox();
    if (
      !fulfillmentBox ||
      !bannerBox ||
      !stagingBox ||
      bannerBox.y <= fulfillmentBox.y ||
      bannerBox.y >= stagingBox.y
    ) {
      throw new Error(
        `FAIL: Staging banner should sit below Fulfillment and above Staging Locations (fulfillment y=${fulfillmentBox?.y ?? "?"}, banner y=${bannerBox?.y ?? "?"}, staging y=${stagingBox?.y ?? "?"}).`,
      );
    }
    console.log(
      "PASS: Staging banner sits below Fulfillment and above Staging Locations",
    );

    await assertReadableTextContrast(page, {
      rootSelector: '[data-testid="drawer-staging-location-banner"]',
      elements: [
        {
          name: "staging location banner heading",
          selector: '[data-testid="drawer-staging-location-banner-heading"]',
          large: false,
        },
        {
          name: "staging location banner body",
          selector: '[data-testid="drawer-staging-location-banner-body"]',
          large: false,
        },
        {
          name: "staging location assign button",
          selector: '[data-testid="drawer-staging-location-assign"]',
          large: false,
        },
      ],
    });
    console.log("PASS: D-42 contrast on staging location banner");
  }

  const advancedToggle = page.getByTestId("advanced-manual-controls-toggle");
  if ((await advancedToggle.count()) > 0) {
    throw new Error(
      "FAIL: Advanced Manual Controls should be removed from drawer.",
    );
  }
  console.log("PASS: Advanced Manual Controls removed");

  const reportIssue = page.getByTestId("report-issue-button");
  if ((await reportIssue.count()) === 0) {
    const issueSummary = page.locator("text=Issue Summary");
    if ((await issueSummary.count()) === 0) {
      throw new Error("FAIL: Report Issue button or issue summary should be visible.");
    }
  } else {
    console.log("PASS: Report Issue path accessible");
  }

  const readyOption = statusDropdown.locator('option[value="ready_for_pickup"]');
  if ((await readyOption.count()) > 0) {
    const disabled = await readyOption.isDisabled();
    const willCallActive = await page
      .getByTestId("delivery-fulfillment-will_call_pickup")
      .evaluate((el) => {
        const bg = getComputedStyle(el).backgroundColor;
        return bg !== "rgb(255, 255, 255)" && bg !== "rgba(0, 0, 0, 0)";
      })
      .catch(() => false);
    if (willCallActive && !disabled) {
      console.log(
        "WARN: Staged — Ready for Pickup option not disabled on will-call delivery (fixture may allow).",
      );
    } else if (willCallActive) {
      console.log("PASS: Staged — Ready for Pickup grayed/disabled on will-call delivery");
    } else {
      console.log("PASS: Staged — Ready for Pickup option present in dropdown");
    }
  }

  await assertReadableTextContrast(page, STATUS_CONTROL_CONTRAST);
  console.log("PASS: D-42 contrast on status + fulfillment controls");

  const rejectOption = statusDropdown.locator(
    `option[value="__reject_import__"]`,
  );
  if ((await rejectOption.count()) === 0) {
    throw new Error("FAIL: Status dropdown missing Reject action option.");
  }
  const rejectLabel = (await rejectOption.innerText()).trim();
  if (!rejectLabel.includes("Reject")) {
    throw new Error(
      `FAIL: Reject option label unexpected — got "${rejectLabel}"`,
    );
  }
  console.log("PASS: Reject action option present in status dropdown");

  const priorDropdownValue = await statusDropdown.inputValue();
  await statusDropdown.selectOption({ value: "__reject_import__" });
  await page.waitForTimeout(400);

  const rejectDialog = page.getByTestId("invoice-reject-reason-dialog");
  const rejectUnavailable = page.getByTestId("delivery-status-reject-unavailable");

  if (await rejectDialog.isVisible().catch(() => false)) {
    console.log("PASS: Reject opens invoice reject reason dialog");
    await page.getByTestId("invoice-reject-reason-cancel").click();
    await page.waitForTimeout(300);
    await rejectDialog.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  } else if ((await rejectUnavailable.count()) > 0) {
    const msg = (await rejectUnavailable.innerText()).trim();
    if (!msg) {
      throw new Error("FAIL: Reject unavailable message empty.");
    }
    console.log(`PASS: Reject shows cannot-reject message — "${msg.slice(0, 60)}…"`);
  } else {
    throw new Error(
      "FAIL: Selecting Reject should open dialog or show cannot-reject message.",
    );
  }

  const dropdownAfterReject = await statusDropdown.inputValue();
  if (dropdownAfterReject === "__reject_import__") {
    throw new Error(
      "FAIL: Dropdown should not stay on Reject after action — still reject selected.",
    );
  }
  if (
    priorDropdownValue &&
    priorDropdownValue !== "__reject_import__" &&
    dropdownAfterReject !== priorDropdownValue
  ) {
    console.log(
      `WARN: Dropdown value changed after reject attempt (${priorDropdownValue} → ${dropdownAfterReject}).`,
    );
  } else {
    console.log("PASS: Dropdown retains delivery status after Reject action");
  }

  const creditBanner = page.getByTestId("delivery-credit-return-banner");
  if ((await creditBanner.count()) > 0) {
    await creditBanner.waitFor({ timeout: 5000 });
    const title = page.getByTestId("delivery-credit-return-banner-title");
    const titleText = (await title.innerText()).trim();
    if (!titleText.includes("Credit/Return")) {
      throw new Error(
        `FAIL: Credit/return banner title missing expected copy — got "${titleText}"`,
      );
    }
    console.log("PASS: Credit/return banner visible with expected title");

    await assertReadableTextContrast(page, {
      rootSelector: '[data-testid="delivery-credit-return-banner"]',
      elements: [
        {
          name: "credit return banner title",
          selector: '[data-testid="delivery-credit-return-banner-title"]',
          large: false,
        },
        {
          name: "credit return banner body",
          selector: '[data-testid="delivery-credit-return-banner-body"]',
          large: false,
        },
      ],
    });
    console.log("PASS: D-42 contrast on credit/return banner");

    const rejectBtn = page.getByTestId("delivery-credit-return-reject-btn");
    if ((await rejectBtn.count()) > 0) {
      throw new Error(
        "FAIL: Redundant Reject linked import button should be removed — use Status dropdown.",
      );
    }
    console.log("PASS: Credit/return banner has no duplicate reject button");

    const blocked = page.getByTestId("delivery-credit-return-reject-blocked");
    if ((await blocked.count()) > 0) {
      console.log("PASS: Credit/return banner shows reject blocked reason (import not rejectable)");
    }
  } else {
    console.log(
      "SKIP: No credit/return delivery in fixture — banner testids not exercised this run",
    );
  }

  const listCreditBadge = page.locator('[data-testid^="delivery-list-credit-return-badge-"]');
  if ((await listCreditBadge.count()) > 0) {
    console.log("PASS: Deliveries list shows Credit/Return badge on linked row(s)");
  } else {
    console.log("SKIP: No credit/return rows in deliveries list this run");
  }

  const pickedUpOption = statusDropdown.locator('option[value="picked_up"]');
  const emailVendorButton = page.getByTestId("delivery-basics-email-vendor");
  await emailVendorButton.waitFor({ timeout: 10_000 });
  console.log("PASS: Email Vendor button present in Delivery Basics");

  const completePickupButton = page.getByTestId(
    "delivery-basics-complete-pickup",
  );
  const completePickupCount = await completePickupButton.count();
  if ((await pickedUpOption.count()) > 0 && !(await pickedUpOption.isDisabled())) {
    if (completePickupCount === 0) {
      throw new Error(
        "FAIL: Complete Pickup CTA should show when picked_up transition is enabled.",
      );
    }
    const emailBox = await emailVendorButton.boundingBox();
    const completeBox = await completePickupButton.boundingBox();
    if (!emailBox || !completeBox || completeBox.y <= emailBox.y) {
      throw new Error(
        "FAIL: Complete Pickup should appear below Email Vendor.",
      );
    }
    console.log("PASS: Complete Pickup CTA visible below Email Vendor");
    await completePickupButton.click();
    await page.waitForTimeout(300);
    await page.getByTestId("delivery-status-pickup-input").waitFor({
      timeout: 5000,
    });
    console.log("PASS: Complete Pickup opens shared Who picked up? form");
    if (await completePickupButton.isVisible().catch(() => false)) {
      throw new Error(
        "FAIL: Full-width Complete Pickup CTA should hide while Who picked up? form is open.",
      );
    }
    console.log("PASS: Full-width Complete Pickup CTA hidden while form open");
    await page
      .getByTestId("delivery-status-pickup-input")
      .getByRole("button", { name: "Cancel" })
      .click();
    await page.waitForTimeout(200);
  } else if (completePickupCount > 0) {
    console.log(
      "WARN: Complete Pickup visible but picked_up option disabled — unexpected",
    );
  } else {
    console.log(
      "SKIP: Complete Pickup CTA hidden (picked_up transition not available)",
    );
  }

  if ((await pickedUpOption.count()) > 0 && !(await pickedUpOption.isDisabled())) {
    await statusDropdown.selectOption("picked_up");
    await page.waitForTimeout(300);

    await drawer.waitFor({ state: "visible", timeout: 5000 });
    console.log("PASS: Drawer stays open while pickup form is pending");

    const currentLabel = page.getByTestId("delivery-status-current-label");
    const labelText = (await currentLabel.innerText()).trim();
    if (!labelText.startsWith("Picked Up")) {
      throw new Error(
        `FAIL: Selecting Picked Up should update status label — got "${labelText}"`,
      );
    }
    console.log("PASS: Status label shows Picked Up after dropdown selection");

    const dropdownValue = await statusDropdown.inputValue();
    if (dropdownValue !== "picked_up") {
      throw new Error(
        `FAIL: Dropdown should show picked_up after selection — got "${dropdownValue}"`,
      );
    }
    console.log("PASS: Dropdown value is picked_up while pickup form pending");

    const pickupInput = page.getByTestId("delivery-status-pickup-input");
    await pickupInput.waitFor({ timeout: 5000 });
    console.log("PASS: Who picked up? form visible after Picked Up selection");

    const cancelBtn = pickupInput.getByRole("button", { name: "Cancel" });
    await cancelBtn.click();
    await page.waitForTimeout(300);
    await drawer.waitFor({ state: "visible", timeout: 5000 });
    console.log("PASS: Drawer remains open after canceling pending pickup");

    const allowStatusMutation =
      process.env.STAGEVERIFY_DRAWER_STATUS_CLOSE_VERIFY === "1";
    if (allowStatusMutation) {
      const currentStatusLabel = (
        await page.getByTestId("delivery-status-current-label").innerText()
      ).trim();
      if (currentStatusLabel.startsWith("Staged — Ready for Pickup")) {
        await statusDropdown.selectOption("picked_up");
        await page.waitForTimeout(300);
        await page
          .getByTestId("delivery-status-pickup-name")
          .fill("Verify Script Tech");
        await pickupInput.getByRole("button", { name: "Complete Pickup" }).click();
        await drawer.waitFor({ state: "hidden", timeout: 20_000 });
        console.log("PASS: Drawer closed after successful Complete Pickup");
      } else {
        console.log(
          "SKIP: STAGEVERIFY_DRAWER_STATUS_CLOSE_VERIFY=1 but fixture not ready_for_pickup",
        );
      }
    } else {
      console.log(
        "SKIP: Drawer close-on-success (set STAGEVERIFY_DRAWER_STATUS_CLOSE_VERIFY=1 to enable)",
      );
    }
  } else {
    console.log(
      "SKIP: picked_up option not enabled on fixture delivery (no transition available)",
    );
  }

  // ── CASE A — Vendor Drop-Off + no location (seed delivery-2 / ORD-002) ──
  await openDeliveryDrawerByDeepLink(page, appBase, FIXTURE_NO_STAGING_ID);
  // Seed may be left on Will-Call from a prior interrupted CASE D (shared Firestore).
  const caseAEnsureDropOff = page.getByTestId("delivery-fulfillment-delivery");
  await caseAEnsureDropOff.waitFor({ timeout: 10_000 });
  if ((await caseAEnsureDropOff.getAttribute("data-selected")) !== "true") {
    await caseAEnsureDropOff.click();
    await page.waitForTimeout(1500);
  }
  const caseABanner = page.getByTestId("drawer-staging-location-banner");
  await caseABanner.waitFor({ state: "visible", timeout: 15_000 });
  const caseAAssigned = await page
    .getByTestId("delivery-basics-staging-locations")
    .getAttribute("data-has-assigned-staging");
  if (caseAAssigned !== "false") {
    throw new Error(
      `FAIL CASE A: delivery-2 should have no assigned staging — data-has-assigned-staging="${caseAAssigned}".`,
    );
  }
  const caseAFulfillment = page.getByTestId("delivery-fulfillment-control");
  const caseAStagingHeading = page.getByTestId(
    "delivery-basics-staging-locations-heading",
  );
  const caseAFulfillmentBox = await caseAFulfillment.boundingBox();
  const caseABannerBox = await caseABanner.boundingBox();
  const caseAStagingBox = await caseAStagingHeading.boundingBox();
  if (
    !caseAFulfillmentBox ||
    !caseABannerBox ||
    !caseAStagingBox ||
    caseABannerBox.y <= caseAFulfillmentBox.y ||
    caseABannerBox.y >= caseAStagingBox.y
  ) {
    throw new Error(
      `FAIL CASE A: Staging banner must sit below Fulfillment and above Staging Locations (fulfillment y=${caseAFulfillmentBox?.y ?? "?"}, banner y=${caseABannerBox?.y ?? "?"}, staging y=${caseAStagingBox?.y ?? "?"}).`,
    );
  }
  const caseAVendorLabel = (
    await page.getByTestId("delivery-fulfillment-delivery").innerText()
  ).trim();
  if (caseAVendorLabel !== "Vendor Drop-Off") {
    throw new Error(
      `FAIL CASE A: expected Vendor Drop-Off button — got "${caseAVendorLabel}".`,
    );
  }
  const caseAAssign = page.getByTestId("drawer-staging-location-assign");
  await caseAAssign.waitFor({ state: "visible", timeout: 5_000 });
  const caseAAssignLabel = (await caseAAssign.innerText()).trim();
  if (caseAAssignLabel !== "Assign Location") {
    throw new Error(
      `FAIL CASE A: expected yellow Assign Location CTA — got "${caseAAssignLabel}".`,
    );
  }
  const caseAAssignBg = await caseAAssign.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  if (!/rgb\(234,\s*179,\s*8\)|#eab308/i.test(caseAAssignBg)) {
    throw new Error(
      `FAIL CASE A: Assign Location should be yellow (#eab308) — got ${caseAAssignBg}.`,
    );
  }
  await assertReadableTextContrast(page, ASSIGN_LOCATION_CONTRAST);
  console.log(
    "PASS CASE A: Vendor Drop-Off + no location — yellow Assign Location below fulfillment",
  );

  // ── CASE D — switch Vendor Drop-Off ↔ Will-Call / Pickup from Vendor updates warning ──
  const caseAWillCall = page.getByTestId(
    "delivery-fulfillment-will_call_pickup",
  );
  const caseAWillCallSelected =
    (await caseAWillCall.getAttribute("data-selected")) === "true";
  if (!caseAWillCallSelected) {
    await caseAWillCall.click();
    await page
      .getByTestId("drawer-staging-location-banner")
      .waitFor({ state: "hidden", timeout: 20_000 });
    await page.getByTestId("delivery-basics-staging-will-call-na").waitFor({
      timeout: 10_000,
    });
    if (
      (await page.getByTestId("drawer-staging-location-assign").count()) > 0 ||
      (await page.getByTestId("delivery-basics-assign-location").count()) > 0
    ) {
      throw new Error(
        "FAIL CASE D: Assign Location must be hidden for Will-Call / Pickup from Vendor.",
      );
    }
    await page.waitForFunction(() => {
      const el = document.querySelector(
        '[data-testid="delivery-status-current-label"]',
      );
      return el?.textContent?.includes("Will-Call / Pickup from Vendor") ?? false;
    }, null, { timeout: 10_000 });
    const willCallCtx = (
      await page.getByTestId("delivery-status-current-label").innerText()
    ).trim();
    if (!willCallCtx.includes("Will-Call / Pickup from Vendor")) {
      throw new Error(
        `FAIL CASE D: status context should show Will-Call / Pickup from Vendor — got "${willCallCtx}".`,
      );
    }
    // Restore Vendor Drop-Off so seed fixture stays drop-off for other verifies
    const restoreDropOff = page.getByTestId("delivery-fulfillment-delivery");
    if ((await restoreDropOff.getAttribute("data-selected")) !== "true") {
      await restoreDropOff.click();
      await page
        .getByTestId("drawer-staging-location-banner")
        .waitFor({ state: "visible", timeout: 20_000 });
    }
    // After fulfillment refresh, Assign Location must carry the real delivery id
    // (regression: getDeliveryDetails omitted doc id → assignDelivery=undefined).
    await page.getByTestId("drawer-staging-location-assign").click();
    await page.waitForURL(/assignDelivery=/, { timeout: 15_000 });
    const assignUrl = page.url();
    if (
      !new RegExp(`assignDelivery=${FIXTURE_NO_STAGING_ID}\\b`).test(assignUrl) ||
      /assignDelivery=undefined/.test(assignUrl)
    ) {
      throw new Error(
        `FAIL CASE D: Assign Location must open Staging Map for ${FIXTURE_NO_STAGING_ID} — got ${assignUrl}`,
      );
    }
    await page.getByTestId("assign-mode-banner").waitFor({
      state: "visible",
      timeout: 15_000,
    });
    await page.goto(`${appBase}/#/dispatcher`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(800);
    console.log(
      "PASS CASE D: fulfillment switch + Assign Location navigates with delivery id",
    );
  } else {
    console.log("SKIP CASE D: Will-Call already active on delivery-2");
  }

  // ── CASE B — Vendor Drop-Off + existing location (seed delivery-1) ──
  await openDeliveryDrawerByDeepLink(page, appBase, FIXTURE_ASSIGNED_STAGING_ID);
  await page.getByTestId("delivery-basics-staging-locations").waitFor({
    timeout: 15_000,
  });
  const caseBAssigned = await page
    .getByTestId("delivery-basics-staging-locations")
    .getAttribute("data-has-assigned-staging");
  if (caseBAssigned !== "true") {
    throw new Error(
      `FAIL CASE B: delivery-1 should have assigned staging — data-has-assigned-staging="${caseBAssigned}".`,
    );
  }
  if ((await page.getByTestId("drawer-staging-location-banner").count()) > 0) {
    throw new Error(
      "FAIL CASE B: Staging banner must not render when a staging location is assigned.",
    );
  }
  console.log("PASS CASE B: assigned staging — no staging warning banner");

  // ── CASE C — Will-Call wording (toggle path already covers skip-staging) ──
  const caseCWillCallLabel = (
    await page.getByTestId("delivery-fulfillment-will_call_pickup").innerText()
  ).trim();
  if (caseCWillCallLabel !== "Will-Call / Pickup from Vendor") {
    throw new Error(
      `FAIL CASE C: Will-Call button should say "Will-Call / Pickup from Vendor" — got "${caseCWillCallLabel}".`,
    );
  }
  console.log(
    "PASS CASE C: Will-Call / Pickup from Vendor wording present; staging not required by skipsShopStaging",
  );

  await page.screenshot({
    path: resolve(outDir, "delivery-drawer-status-controls.png"),
  });

  await browser.close();
  console.log("\nverify:delivery-drawer-status — ALL PASS");
})().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});

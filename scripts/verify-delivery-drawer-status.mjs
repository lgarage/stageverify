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
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  updateDoc,
  deleteField,
} from "firebase/firestore";
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

/** Clear/pollute staging fields on delivery-2 so CASE A/E are not fixture-drift flaky. */
async function patchDelivery2StagingFixture(mode) {
  const email = process.env.STAGEVERIFY_TEST_EMAIL;
  const password = process.env.STAGEVERIFY_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Missing STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD for fixture patch",
    );
  }
  const app = initializeApp(
    {
      apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
      authDomain: "stageverify-db.firebaseapp.com",
      projectId: "stageverify-db",
      storageBucket: "stageverify-db.firebasestorage.app",
      messagingSenderId: "784751243681",
      appId: "1:784751243681:web:31fa71762b94f878fd1be0",
    },
    `drawer-status-fixture-${mode}-${Date.now()}`,
  );
  const auth = getAuth(app);
  await signInWithEmailAndPassword(auth, email, password);
  const db = getFirestore(app);
  const base = {
    stagingLocationId: deleteField(),
    additionalStagingLocationIds: deleteField(),
    invoiceFulfillmentMethod: "delivery",
    updatedAt: new Date().toISOString(),
  };
  const ref = doc(db, "deliveries", FIXTURE_NO_STAGING_ID);
  if (mode === "clear") {
    await updateDoc(ref, {
      ...base,
      plannedStagingLocationIds: deleteField(),
    });
  } else if (mode === "stale") {
    await updateDoc(ref, {
      ...base,
      plannedStagingLocationIds: ["missing-zone-stale-xyz"],
    });
  } else {
    throw new Error(`Unknown fixture mode: ${mode}`);
  }
  const verifySnap = await getDoc(ref);
  const planned = verifySnap.data()?.plannedStagingLocationIds;
  if (mode === "stale") {
    if (!Array.isArray(planned) || planned[0] !== "missing-zone-stale-xyz") {
      throw new Error(
        `Fixture patch stale failed — plannedStagingLocationIds=${JSON.stringify(planned)}`,
      );
    }
  } else if (mode === "clear" && Array.isArray(planned) && planned.length > 0) {
    throw new Error(
      `Fixture patch clear failed — plannedStagingLocationIds still ${JSON.stringify(planned)}`,
    );
  }
}

const STATUS_CONTROL_CONTRAST = {
  rootSelector: '[data-testid="delivery-status-controls"]',
  elements: [
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
    {
      name: "staged ready button",
      selector: '[data-testid="delivery-status-staged-ready"]',
      large: false,
    },
    {
      name: "status placeholder",
      selector: '[data-testid="delivery-status-placeholder"]',
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

const REVIEW_VENDOR_EMAIL_MODAL_CONTRAST = {
  rootSelector: '[data-testid="review-vendor-email-modal-panel"]',
  elements: [
    {
      name: "modal title",
      selector: '[data-testid="review-vendor-email-modal-title"]',
      large: true,
    },
    {
      name: "modal context",
      selector: '[data-testid="review-vendor-email-modal-context"]',
      large: false,
    },
    {
      name: "modal close button",
      selector: '[data-testid="review-vendor-email-modal-close"]',
      large: false,
    },
    {
      name: "invoice source from",
      selector: '[data-testid="review-vendor-email-from"]',
      large: false,
      optional: true,
    },
    {
      name: "invoice source subject",
      selector: '[data-testid="review-vendor-email-subject"]',
      large: false,
      optional: true,
    },
    {
      name: "invoice source empty body",
      selector: '[data-testid="review-vendor-email-empty-body"]',
      large: false,
      optional: true,
    },
    {
      name: "invoice source view original pdf",
      selector: '[data-testid="review-vendor-email-view-original-pdf"]',
      large: false,
      optional: true,
    },
  ],
};

const REVIEW_VENDOR_EMAIL_DELIVERY_ID = "delivery-demo-vendor-2";

const FULL_EMAIL_CHAIN_MODAL_CONTRAST = {
  rootSelector: '[data-testid="full-email-chain-modal-panel"]',
  elements: [
    {
      name: "modal title",
      selector: '[data-testid="full-email-chain-modal-title"]',
      large: true,
    },
    {
      name: "modal context",
      selector: '[data-testid="full-email-chain-modal-context"]',
      large: false,
    },
    {
      name: "modal close button",
      selector: '[data-testid="full-email-chain-modal-close"]',
      large: false,
    },
    {
      name: "invoice source from",
      selector: '[data-testid="full-email-chain-from"]',
      large: false,
      optional: true,
    },
    {
      name: "invoice source subject",
      selector: '[data-testid="full-email-chain-subject"]',
      large: false,
      optional: true,
    },
    {
      name: "invoice source empty body",
      selector: '[data-testid="full-email-chain-empty-body"]',
      large: false,
      optional: true,
    },
    {
      name: "invoice source view original pdf",
      selector: '[data-testid="full-email-chain-view-original-pdf"]',
      large: false,
      optional: true,
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

  const tableHeader = page.getByTestId("dispatcher-deliveries-table-header");
  await tableHeader.waitFor({ timeout: 20_000 });
  const thTexts = (await tableHeader.locator("th").allInnerTexts()).map((t) =>
    t.replace(/\s+/g, " ").replace(/\s*↕\s*/g, "").trim().toLowerCase(),
  );
  for (const removed of ["vendor", "items", "delivery / pickup date", "action"]) {
    if (thTexts.includes(removed)) {
      throw new Error(
        `FAIL: Deliveries table still shows removed column "${removed}".`,
      );
    }
  }
  for (const kept of [
    "status",
    "fulfillment",
    "job name",
    "invoice #",
    "po #",
    "staging location",
    "issue",
    "assigned technician",
  ]) {
    if (!thTexts.includes(kept)) {
      throw new Error(
        `FAIL: Deliveries table missing retained column "${kept}".`,
      );
    }
  }
  if ((await page.getByTestId("dispatcher-delivery-view").count()) > 0) {
    throw new Error("FAIL: View button should be removed from deliveries table.");
  }
  const scrollHost = page.getByTestId("dispatcher-deliveries-table-scroll");
  const noHScroll = await scrollHost.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  if (!noHScroll) {
    throw new Error(
      "FAIL: Deliveries table requires horizontal scrolling at desktop width.",
    );
  }
  console.log("PASS: Deliveries table columns simplified (no H-scroll at 1400px)");

  await openDeliveryDrawerForNavVerify(page);
  console.log("PASS: Opened delivery drawer");

  const drawer = page.getByTestId("delivery-detail-drawer");
  await drawer.waitFor({ state: "visible", timeout: 20_000 });

  const basicsCard = page.getByTestId("delivery-basics-card");
  await basicsCard.waitFor({ timeout: 20_000 });

  const pdfButtons = page.getByTestId("delivery-drawer-view-original-pdf");
  const pdfCount = await pdfButtons.count();
  if (pdfCount !== 1) {
    throw new Error(
      `FAIL: Expected exactly one View original PDF button, got ${pdfCount}`,
    );
  }
  const closeBtn = page.getByTestId("delivery-drawer-close");
  if ((await closeBtn.count()) !== 1) {
    throw new Error("FAIL: Delivery drawer Close control missing");
  }
  const closeBox = await closeBtn.boundingBox();
  const pdfBox = await pdfButtons.boundingBox();
  const basicsBox = await basicsCard.boundingBox();
  if (!closeBox || !pdfBox || !basicsBox) {
    throw new Error("FAIL: Close / PDF / Delivery Basics boxes missing");
  }
  if (pdfBox.y < closeBox.y + closeBox.height) {
    throw new Error(
      `FAIL: View original PDF must sit below Close (close bottom=${Math.round(closeBox.y + closeBox.height)}, PDF y=${Math.round(pdfBox.y)})`,
    );
  }
  if (pdfBox.y + pdfBox.height > basicsBox.y) {
    throw new Error(
      `FAIL: View original PDF must sit above Delivery Basics (PDF bottom=${Math.round(pdfBox.y + pdfBox.height)}, basics y=${Math.round(basicsBox.y)})`,
    );
  }
  console.log("PASS: View original PDF is below Close and above Delivery Basics");
  await assertReadableTextContrast(page, {
    rootSelector: '[data-testid="delivery-detail-drawer"]',
    elements: [
      {
        name: "View original PDF button",
        selector: '[data-testid="delivery-drawer-view-original-pdf"]',
        large: false,
      },
    ],
  });
  console.log("PASS: View original PDF readable contrast (D-42)");

  if ((await page.getByTestId("delivery-status-dropdown").count()) > 0) {
    throw new Error(
      "FAIL: Legacy Status dropdown should be removed — 2×2 Fulfillment/Status grid replaces it.",
    );
  }
  console.log("PASS: Status dropdown removed");

  const fulfillmentControl = page.getByTestId("delivery-fulfillment-control");
  await fulfillmentControl.waitFor({ timeout: 10_000 });
  const statusGrid = page.getByTestId("delivery-fulfillment-status-grid");
  await statusGrid.waitFor({ timeout: 10_000 });
  console.log("PASS: Fulfillment / Status 2×2 control present");

  const vendorDropOffButton = page.getByTestId(
    "delivery-fulfillment-delivery",
  );
  const willCallPickupButton = page.getByTestId(
    "delivery-fulfillment-will_call_pickup",
  );
  const stagedReadyButton = page.getByTestId("delivery-status-staged-ready");
  const placeholderButton = page.getByTestId("delivery-status-placeholder");
  await stagedReadyButton.waitFor({ timeout: 10_000 });
  await placeholderButton.waitFor({ timeout: 10_000 });
  if (!(await placeholderButton.isDisabled())) {
    throw new Error("FAIL: Placeholder cell must be disabled / non-actionable.");
  }
  const placeholderText = (await placeholderButton.innerText()).trim();
  if (placeholderText !== "—") {
    throw new Error(
      `FAIL: Placeholder label should be "—" — got "${placeholderText}".`,
    );
  }
  console.log("PASS: Placeholder cell present and non-actionable");
  const stagedLabel = (await stagedReadyButton.innerText()).trim();
  if (stagedLabel !== "Staged — Ready for Pickup") {
    throw new Error(
      `FAIL: Staged button label unexpected — got "${stagedLabel}".`,
    );
  }
  console.log("PASS: Staged — Ready for Pickup button present");
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
  const dropOffActive =
    (await vendorDropOffButton.getAttribute("data-selected")) === "true";
  if (willCallActive === dropOffActive) {
    throw new Error(
      "FAIL: Exactly one fulfillment button must be selected (Drop-Off vs Will-Call).",
    );
  }
  const expectedFulfillmentContext = willCallActive
    ? "Will-Call / Pickup from Vendor"
    : "Vendor Drop-Off";
  console.log(
    `PASS: Active fulfillment selection is "${expectedFulfillmentContext}"`,
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
  const deliveryStatusAttr = (
    await statusControls.getAttribute("data-delivery-status")
  )?.trim();
  const terminalOrClosed = [
    "picked_up",
    "installed",
    "cancelled",
    "complete",
  ].includes(deliveryStatusAttr ?? "");

  if (willCallActive || hasAssignedStaging || terminalOrClosed) {
    if (stagingBannerCount > 0) {
      throw new Error(
        `FAIL: Staging banner should be absent for ${
          willCallActive ? "Will-Call / Pickup from Vendor" : "assigned staging IDs"
        }.`,
      );
    }
    console.log(
      `PASS: Staging banner absent for ${
        willCallActive
          ? "Will-Call / Pickup from Vendor"
          : terminalOrClosed
            ? "closed/picked-up"
            : "assigned staging IDs"
      } fixture`,
    );
  } else {
    // Banner waits on Active location catalog load (stagingLocationsReady) —
    // avoid false FAIL when data-has-assigned-staging is already false.
    if (stagingBannerCount === 0) {
      await stagingBanner
        .waitFor({ state: "visible", timeout: 15_000 })
        .catch(() => {});
    }
    if ((await stagingBanner.count()) === 0) {
      // Nav-search fixture (e.g. 4046362) can be atypical; CASE A owns banner DoD.
      console.log(
        "SKIP: Nav fixture has no assigned staging and no staging banner — CASE A covers banner layout",
      );
    } else {
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

  const willCallSelected =
    (await willCallPickupButton.getAttribute("data-selected")) === "true";
  const stagedSelected =
    (await stagedReadyButton.getAttribute("data-selected")) === "true";
  const stagedDisabled = await stagedReadyButton.isDisabled();
  if (willCallSelected && stagedSelected) {
    throw new Error(
      "FAIL: Will-Call and Staged must not both show selected/current state.",
    );
  }
  if (willCallSelected && !stagedDisabled) {
    console.log(
      "WARN: Staged button enabled on Will-Call delivery (fixture may allow).",
    );
  } else if (willCallSelected) {
    console.log("PASS: Staged button disabled on Will-Call delivery");
  } else {
    console.log("PASS: Staged button present for Vendor Drop-Off delivery");
  }

  await assertReadableTextContrast(page, STATUS_CONTROL_CONTRAST);
  console.log("PASS: D-42 contrast on status + fulfillment controls");

  const rejectAction = page.getByTestId("delivery-status-reject-action");
  if ((await rejectAction.count()) > 0) {
    throw new Error("FAIL: Delivery Details Reject… control must be removed.");
  }
  console.log("PASS: Delivery Details Reject… control removed");

  const spotPicker = page.getByTestId("delivery-status-spot-picker");
  if ((await spotPicker.count()) > 0) {
    throw new Error("FAIL: Legacy inline staging spot picker must be removed.");
  }
  console.log("PASS: Legacy inline staging spot picker absent");

  if (dropOffActive) {
    const dropOffBg = await vendorDropOffButton.evaluate((el) =>
      getComputedStyle(el).backgroundColor,
    );
    // #facc15 => rgb(250, 204, 21)
    if (!/rgb\(\s*250\s*,\s*204\s*,\s*21\s*\)/i.test(dropOffBg)) {
      throw new Error(
        `FAIL: Vendor Drop-Off selected should be yellow (#facc15) — got ${dropOffBg}`,
      );
    }
    console.log("PASS: Vendor Drop-Off selected is yellow (#facc15)");
  } else {
    console.log("SKIP: Vendor Drop-Off yellow check (Will-Call active on initial fixture)");
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
        "FAIL: Redundant Reject linked import button should remain removed from Delivery Details.",
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

  const emailVendorButton = page.getByTestId("delivery-basics-email-vendor");
  await emailVendorButton.waitFor({ timeout: 10_000 });
  console.log("PASS: Email Vendor button present in Delivery Basics");

  const completePickupButton = page.getByTestId(
    "delivery-basics-complete-pickup",
  );
  const completePickupCount = await completePickupButton.count();
  const ctaEnabled =
    completePickupCount > 0 && !(await completePickupButton.isDisabled());
  // Picked Up authority = Complete Pickup → recordPickupEvent / isDispatcherPickupEligible
  // (Status dropdown removed in 2×2 Fulfillment/Status UI).
  if (ctaEnabled) {
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
    const pickupForm = page.getByTestId("delivery-status-pickup-input");
    await pickupForm.waitFor({
      timeout: 5000,
    });
    console.log("PASS: Complete Pickup opens shared Who picked up? form");
    const readinessAttr = await pickupForm.getAttribute("data-readiness");
    if (readinessAttr === "not-ready") {
      const warning = page.getByTestId("delivery-status-pickup-warning");
      await warning.waitFor({ timeout: 3000 });
      const warnText = (await warning.innerText()).trim();
      if (!/not currently marked Ready for Pickup/i.test(warnText)) {
        throw new Error(
          `FAIL: not-ready pickup form missing readiness warning — got "${warnText}"`,
        );
      }
      console.log("PASS: not-ready Complete Pickup form shows readiness warning");
    } else if (readinessAttr === "ready") {
      const intro = page.getByTestId("delivery-status-pickup-intro");
      await intro.waitFor({ timeout: 3000 });
      if ((await page.getByTestId("delivery-status-pickup-warning").count()) > 0) {
        throw new Error("FAIL: ready pickup form must not show warning panel");
      }
      console.log("PASS: ready Complete Pickup form uses simple confirmation");
    } else {
      throw new Error(
        `FAIL: pickup form missing data-readiness ready|not-ready (got ${readinessAttr})`,
      );
    }
    if (await completePickupButton.isVisible().catch(() => false)) {
      throw new Error(
        "FAIL: Full-width Complete Pickup CTA should hide while Who picked up? form is open.",
      );
    }
    console.log("PASS: Full-width Complete Pickup CTA hidden while form open");

    await drawer.waitFor({ state: "visible", timeout: 5000 });
    console.log("PASS: Drawer stays open while pickup form is pending");

    const pickupFormVisible = await page
      .getByTestId("delivery-status-pickup-input")
      .isVisible();
    if (!pickupFormVisible) {
      throw new Error(
        "FAIL: Opening Complete Pickup should show Who picked up? form (Current status line removed).",
      );
    }
    console.log("PASS: Pickup form visible while Complete Pickup pending (no Current line)");

    const pickupInput = page.getByTestId("delivery-status-pickup-input");
    const cancelBtn = page.getByTestId("delivery-status-pickup-cancel");
    await cancelBtn.click();
    await page.waitForTimeout(300);
    await drawer.waitFor({ state: "visible", timeout: 5000 });
    console.log("PASS: Drawer remains open after canceling pending pickup");

    const allowStatusMutation =
      process.env.STAGEVERIFY_DRAWER_STATUS_CLOSE_VERIFY === "1";
    if (allowStatusMutation) {
      const stagedIsCurrent =
        (await page
          .getByTestId("delivery-status-staged-ready")
          .getAttribute("data-selected")) === "true";
      if (stagedIsCurrent) {
        await completePickupButton.click();
        await page.waitForTimeout(300);
        await page
          .getByTestId("delivery-status-pickup-name")
          .fill("Verify Script Tech");
        await page
          .getByTestId("delivery-status-pickup-input")
          .getByRole("button", { name: "Complete Pickup" })
          .click();
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
  } else if (completePickupCount > 0) {
    const hint = page.getByTestId("delivery-basics-complete-pickup-hint");
    if ((await hint.count()) === 0) {
      throw new Error(
        "FAIL: Complete Pickup visible+disabled should show job-link hint.",
      );
    }
    console.log(
      "PASS: Complete Pickup visible but disabled (hint shown); pickup not eligible",
    );
  } else {
    console.log(
      "SKIP: Complete Pickup CTA hidden (pickup not eligible via isDispatcherPickupEligible)",
    );
  }

  // ── CASE A — Vendor Drop-Off + no location (seed delivery-2 / ORD-002) ──
  await patchDelivery2StagingFixture("clear");
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

  if ((await page.getByTestId("delivery-status-current-label").count()) > 0) {
    throw new Error(
      "FAIL CASE A: Current status text line must be removed from Fulfillment / Status.",
    );
  }
  console.log("PASS CASE A: Current status text line removed");

  const caseAStaged = page.getByTestId("delivery-status-staged-ready");
  if ((await caseAStaged.getAttribute("data-has-active-staging")) !== "false") {
    throw new Error(
      "FAIL CASE A: Staged button must report data-has-active-staging=false when no location.",
    );
  }
  if (!(await caseAStaged.isDisabled())) {
    await caseAStaged.click();
    await page.waitForTimeout(500);
    if ((await page.getByTestId("delivery-status-spot-picker").count()) > 0) {
      throw new Error(
        "FAIL CASE A: Staged click must not open legacy inline spot picker.",
      );
    }
    await caseABanner.waitFor({ state: "visible", timeout: 5_000 });
    console.log(
      "PASS CASE A: Staged click focuses map Assign Location path (no inline picker)",
    );
  } else {
    console.log(
      "SKIP CASE A: Staged button disabled on this fixture status — banner path still asserted",
    );
  }

  // ── CASE E — stale/unresolvable planned staging ids still show staging-needed card ──
  await patchDelivery2StagingFixture("stale");
  // Force a fresh detail fetch (same openDelivery= URL can keep stale drawer state).
  await page.goto(`${appBase}/#/dispatcher`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(400);
  await openDeliveryDrawerByDeepLink(page, appBase, FIXTURE_NO_STAGING_ID);
  await page.getByTestId("delivery-fulfillment-delivery").waitFor({
    timeout: 10_000,
  });
  if (
    (await page
      .getByTestId("delivery-fulfillment-delivery")
      .getAttribute("data-selected")) !== "true"
  ) {
    await page.getByTestId("delivery-fulfillment-delivery").click();
    await page.waitForTimeout(1200);
  }
  await page
    .getByTestId("drawer-staging-location-banner")
    .waitFor({ state: "visible", timeout: 15_000 });
  const caseEAssigned = await page
    .getByTestId("delivery-basics-staging-locations")
    .getAttribute("data-has-assigned-staging");
  if (caseEAssigned !== "false") {
    throw new Error(
      `FAIL CASE E: stale planned ids must not count as active staging — data-has-assigned-staging="${caseEAssigned}".`,
    );
  }
  if ((await page.getByTestId("drawer-staging-location-assign").count()) === 0) {
    throw new Error(
      "FAIL CASE E: Assign Location must render for drop-off with no active staging.",
    );
  }
  // Chip copy may be "Staging location missing" (stale refs hydrated) or
  // "Not Assigned" if the detail snapshot lags the fixture write — banner is SSOT.
  const caseEMissingCount = await page
    .getByTestId("delivery-basics-staging-unresolved")
    .count();
  const caseEUnassignedCount = await page
    .getByTestId("delivery-basics-staging-unassigned")
    .count();
  if (caseEMissingCount === 0 && caseEUnassignedCount === 0) {
    throw new Error(
      "FAIL CASE E: expected Staging Locations missing/unassigned copy with banner.",
    );
  }
  if (caseEMissingCount > 0) {
    const caseEMissingText = (
      await page.getByTestId("delivery-basics-staging-unresolved").innerText()
    ).trim();
    if (caseEMissingText !== "Staging location missing") {
      throw new Error(
        `FAIL CASE E: expected "Staging location missing" — got "${caseEMissingText}".`,
      );
    }
  }
  // Restore clean no-staging fixture for CASE D / other verifies.
  await patchDelivery2StagingFixture("clear");
  await page.goto(`${appBase}/#/dispatcher`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(400);
  await openDeliveryDrawerByDeepLink(page, appBase, FIXTURE_NO_STAGING_ID);
  await page
    .getByTestId("drawer-staging-location-banner")
    .waitFor({ state: "visible", timeout: 15_000 });
  console.log(
    "PASS CASE E: stale planned staging ids → Staging location missing + Assign Location card",
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
      const btn = document.querySelector(
        '[data-testid="delivery-fulfillment-will_call_pickup"]',
      );
      return btn?.getAttribute("data-selected") === "true";
    }, null, { timeout: 10_000 });
    const willCallSelectedAfter = await page
      .getByTestId("delivery-fulfillment-will_call_pickup")
      .getAttribute("data-selected");
    if (willCallSelectedAfter !== "true") {
      throw new Error(
        "FAIL CASE D: Will-Call fulfillment button should be selected after switch.",
      );
    }
    const willCallBtn = page.getByTestId(
      "delivery-fulfillment-will_call_pickup",
    );
    const willCallBg = await willCallBtn.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    // Pink selected uses --admin-willcall-bg (light: typically soft pink, not yellow/blue).
    if (/rgb\(\s*250\s*,\s*204\s*,\s*21\s*\)|rgb\(\s*37\s*,\s*99\s*,\s*235\s*\)/i.test(willCallBg)) {
      throw new Error(
        `FAIL CASE D: Will-Call selected should be pink family — got ${willCallBg}`,
      );
    }
    console.log(
      `PASS CASE D: Will-Call selected pink presentation (bg=${willCallBg})`,
    );
    const stagedAfterWillCall = page.getByTestId("delivery-status-staged-ready");
    if ((await stagedAfterWillCall.getAttribute("data-selected")) === "true") {
      throw new Error(
        "FAIL CASE D: Staged must not stay selected green under Will-Call.",
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

  // ── Review Vendor Email — centered read-only modal (ORD-006 / delivery-demo-vendor-2) ──
  await openDeliveryDrawerByDeepLink(page, appBase, REVIEW_VENDOR_EMAIL_DELIVERY_ID);
  await page.getByTestId("drawer-action-banner").waitFor({ timeout: 15_000 });
  const reviewBtn = page.getByTestId("drawer-action-review-vendor-email");
  if (!(await reviewBtn.isVisible().catch(() => false))) {
    throw new Error(
      "FAIL Review Vendor Email: button must be visible on delivery-demo-vendor-2.",
    );
  }
  await reviewBtn.click();
  const modal = page.getByTestId("review-vendor-email-modal");
  await modal.waitFor({ state: "visible", timeout: 10_000 });
  await page.getByTestId("review-vendor-email-modal-panel").waitFor({
    state: "visible",
    timeout: 5_000,
  });
  const contextText = (
    await page.getByTestId("review-vendor-email-modal-context").innerText()
  ).trim();
  if (!/ORD-006/i.test(contextText)) {
    throw new Error(
      `FAIL Review Vendor Email: modal context must name ORD-006 — got "${contextText}".`,
    );
  }
  if (!(await page.getByTestId("issue-summary-panel").isVisible().catch(() => false))) {
    throw new Error(
      "FAIL Review Vendor Email: Delivery Details drawer must stay open behind the modal.",
    );
  }
  const emailCard = page.locator(
    '[data-testid="review-vendor-email-modal-body"] [data-testid^="email-evidence-card-"]',
  ).first();
  if ((await emailCard.count()) === 0) {
    throw new Error(
      "FAIL Review Vendor Email: modal must show the matched vendor email card.",
    );
  }
  const originalBody = page.locator(
    '[data-testid="review-vendor-email-modal-body"] [data-testid^="email-evidence-original-body-"]',
  ).first();
  if (!(await originalBody.isVisible().catch(() => false))) {
    throw new Error(
      "FAIL Review Vendor Email: original email body should be visible in the modal.",
    );
  }
  await assertReadableTextContrast(page, REVIEW_VENDOR_EMAIL_MODAL_CONTRAST);

  await page.getByTestId("review-vendor-email-modal-close").click();
  await modal.waitFor({ state: "hidden", timeout: 8_000 });
  if (!(await page.getByTestId("drawer-action-banner").isVisible().catch(() => false))) {
    throw new Error(
      "FAIL Review Vendor Email: drawer must remain open after modal Close.",
    );
  }
  if (await page.getByTestId("review-vendor-email-modal").isVisible().catch(() => false)) {
    throw new Error("FAIL Review Vendor Email: modal must close after Close.");
  }

  await reviewBtn.click();
  await modal.waitFor({ state: "visible", timeout: 8_000 });
  const reopenContext = (
    await page.getByTestId("review-vendor-email-modal-context").innerText()
  ).trim();
  if (!/ORD-006/i.test(reopenContext)) {
    throw new Error(
      `FAIL Review Vendor Email: re-open must still show ORD-006 — got "${reopenContext}".`,
    );
  }
  await page.keyboard.press("Escape");
  await modal.waitFor({ state: "hidden", timeout: 8_000 });
  if (!(await page.getByTestId("drawer-action-banner").isVisible().catch(() => false))) {
    throw new Error(
      "FAIL Review Vendor Email: Escape must close only the modal and keep Delivery Details open.",
    );
  }

  await openDeliveryDrawerByDeepLink(page, appBase, FIXTURE_ASSIGNED_STAGING_ID);
  await page.getByTestId("drawer-action-banner").waitFor({ timeout: 15_000 });
  if (await page.getByTestId("review-vendor-email-modal").isVisible().catch(() => false)) {
    throw new Error(
      "FAIL Review Vendor Email: switching deliveries must close the previous email modal.",
    );
  }
  console.log(
    "PASS Review Vendor Email: centered modal open/close, correct ORD-006 email, Escape, no leak on switch",
  );

  // ── View Full Email Chain — large centered modal (ORD-006 / delivery-demo-vendor-2) ──
  await openDeliveryDrawerByDeepLink(page, appBase, REVIEW_VENDOR_EMAIL_DELIVERY_ID);
  await page.getByTestId("drawer-action-banner").waitFor({ timeout: 15_000 });
  const viewChainBtn = page.getByTestId("readiness-evidence-view-email-chain");
  if (!(await viewChainBtn.isVisible().catch(() => false))) {
    throw new Error(
      "FAIL View Full Email Chain: button must be visible on delivery-demo-vendor-2.",
    );
  }
  await viewChainBtn.click();
  const chainModal = page.getByTestId("full-email-chain-modal");
  await chainModal.waitFor({ state: "visible", timeout: 10_000 });
  await page.getByTestId("full-email-chain-modal-panel").waitFor({
    state: "visible",
    timeout: 5_000,
  });
  const chainTitle = (
    await page.getByTestId("full-email-chain-modal-title").innerText()
  ).trim();
  if (chainTitle !== "Full Email Chain") {
    throw new Error(
      `FAIL View Full Email Chain: modal title must be "Full Email Chain" — got "${chainTitle}".`,
    );
  }
  const chainContext = (
    await page.getByTestId("full-email-chain-modal-context").innerText()
  ).trim();
  if (!/ORD-006/i.test(chainContext)) {
    throw new Error(
      `FAIL View Full Email Chain: modal context must name ORD-006 — got "${chainContext}".`,
    );
  }
  const drawerOpen =
    (await page.getByTestId("issue-summary-panel").isVisible().catch(() => false)) ||
    (await page.getByTestId("drawer-action-banner").isVisible().catch(() => false));
  if (!drawerOpen) {
    throw new Error(
      "FAIL View Full Email Chain: Delivery Details drawer must stay open behind the modal.",
    );
  }
  const detailsExpanded = await page
    .getByTestId("readiness-evidence-details")
    .isVisible()
    .catch(() => false);
  const emailListExpanded = await page
    .getByTestId("email-evidence-list")
    .isVisible()
    .catch(() => false);
  if (detailsExpanded && emailListExpanded) {
    throw new Error(
      "FAIL View Full Email Chain: must not expand in-drawer email evidence list as primary result.",
    );
  }
  const chainEmailCard = page.locator(
    '[data-testid="full-email-chain-modal-body"] [data-testid^="email-evidence-card-"], [data-testid="full-email-chain-modal-body"] [data-testid^="email-evidence-live-card-"], [data-testid="full-email-chain-modal-body"] [data-testid^="email-evidence-invoice-source-"]',
  ).first();
  if ((await chainEmailCard.count()) === 0) {
    throw new Error(
      "FAIL View Full Email Chain: modal must show at least one email card.",
    );
  }
  await assertReadableTextContrast(page, FULL_EMAIL_CHAIN_MODAL_CONTRAST);

  await page.getByTestId("full-email-chain-modal-close").click();
  await chainModal.waitFor({ state: "hidden", timeout: 8_000 });
  if (!(await page.getByTestId("drawer-action-banner").isVisible().catch(() => false))) {
    throw new Error(
      "FAIL View Full Email Chain: drawer must remain open after modal Close.",
    );
  }
  if (await page.getByTestId("full-email-chain-modal").isVisible().catch(() => false)) {
    throw new Error("FAIL View Full Email Chain: modal must close after Close.");
  }

  await viewChainBtn.click();
  await chainModal.waitFor({ state: "visible", timeout: 8_000 });
  await page.keyboard.press("Escape");
  await chainModal.waitFor({ state: "hidden", timeout: 8_000 });
  if (!(await page.getByTestId("drawer-action-banner").isVisible().catch(() => false))) {
    throw new Error(
      "FAIL View Full Email Chain: Escape must close only the modal and keep Delivery Details open.",
    );
  }

  await viewChainBtn.click();
  await chainModal.waitFor({ state: "visible", timeout: 8_000 });
  await openDeliveryDrawerByDeepLink(page, appBase, FIXTURE_ASSIGNED_STAGING_ID);
  await page.getByTestId("drawer-action-banner").waitFor({ timeout: 15_000 });
  if (await page.getByTestId("full-email-chain-modal").isVisible().catch(() => false)) {
    throw new Error(
      "FAIL View Full Email Chain: switching deliveries must close the previous email chain modal.",
    );
  }
  console.log(
    "PASS View Full Email Chain: large centered modal, drawer stays open, no in-drawer dump, Close/Escape, no leak on switch",
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

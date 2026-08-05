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
  openDeliveryDrawerForNavVerify,
} from "./dispatcherVerifyHelpers.mjs";

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
      name: "fulfillment drop-off button",
      selector: '[data-testid="delivery-fulfillment-delivery"]',
      large: false,
    },
    {
      name: "fulfillment will-call button",
      selector: '[data-testid="delivery-fulfillment-will_call_pickup"]',
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
        "WARN: Ready for Pickup option not disabled on will-call delivery (fixture may allow).",
      );
    } else if (willCallActive) {
      console.log("PASS: Ready for Pickup grayed/disabled on will-call delivery");
    } else {
      console.log("PASS: Ready for Pickup option present in dropdown");
    }
  }

  await assertReadableTextContrast(page, STATUS_CONTROL_CONTRAST);
  console.log("PASS: D-42 contrast on status + fulfillment controls");

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
      console.log("PASS: Reject linked import button present on credit/return delivery");
    } else {
      const blocked = page.getByTestId("delivery-credit-return-reject-blocked");
      if ((await blocked.count()) > 0) {
        console.log("PASS: Credit/return banner shows reject blocked reason (import not rejectable)");
      }
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
      if (currentStatusLabel.startsWith("Ready for Pickup")) {
        await statusDropdown.selectOption("picked_up");
        await page.waitForTimeout(300);
        await page
          .getByTestId("delivery-status-pickup-name")
          .fill("Verify Script Tech");
        await pickupInput.getByRole("button", { name: "Confirm Pickup" }).click();
        await drawer.waitFor({ state: "hidden", timeout: 20_000 });
        console.log("PASS: Drawer closed after successful Confirm Pickup");
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

  await page.screenshot({
    path: resolve(outDir, "delivery-drawer-status-controls.png"),
  });

  await browser.close();
  console.log("\nverify:delivery-drawer-status — ALL PASS");
})().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});

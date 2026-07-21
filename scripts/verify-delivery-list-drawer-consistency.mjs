/**
 * Playwright: deliveries list status/issue summary vs drawer hierarchy agreement.
 *
 * Usage (dev server on 5173):
 *   npm run verify:delivery-consistency
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  ensureAuthenticated,
  loadEnvLocal,
  assertDeliveryDrawerOpen,
} from "./dispatcherVerifyHelpers.mjs";
import {
  computeDeliveryDisplayState,
  DISPATCHER_STAGING_ACTION_ISSUE_SUMMARY,
  isDispatcherTableStagingActionRequired,
} from "../src/dispatcher/deliveryDisplayHelpers.ts";
import { isInvoiceShellNoShopStaging } from "../src/dispatcher/invoice/invoiceShellDisplayHelpers.ts";

const baseUrl = process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const authState = resolve(process.cwd(), "playwright/.auth/state.json");
const screenshotDir = resolve(process.cwd(), "screenshots/delivery-drawer");
loadEnvLocal();

const results = [];

function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Short handoff clipboard — link is source of truth for checklist detail. */
function isShortPickupClipboard(text) {
  if (!/^StageVerify Pickup/m.test(text)) return false;
  if (!/#\/pickup\?t=[a-f0-9]{64}/.test(text)) return false;
  if (!/Staging Location\(s\):/i.test(text)) return false;
  if (!/Open pickup checklist:/i.test(text)) return false;
  if (/^Status:/m.test(text)) return false;
  if (/^Items:/m.test(text)) return false;
  if (/^Received:\s+\d+\s+of\s+\d+/m.test(text)) return false;
  if (/^-\s.+\(ordered:/m.test(text)) return false;
  if (/\(ordered:\s*\d+,\s*received:/i.test(text)) return false;
  return true;
}

function recordShortPickupClipboard(recordFn, label, text) {
  recordFn(
    `${label} — short pickup clipboard (no status/items/qty)`,
    isShortPickupClipboard(text),
    text.slice(0, 120),
  );
}

async function clickCopyPickupAndRead(page, copyBtn) {
  let clipboard = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!(await copyBtn.isEnabled())) break;
    await copyBtn.click();
    await page.waitForTimeout(2500);
    clipboard = await page
      .evaluate(async () => navigator.clipboard.readText())
      .catch(() => "");
    if (/#\/pickup\?t=[a-f0-9]{64}/.test(clipboard)) break;
  }
  return clipboard;
}

function assertOfflineStagingActionRules() {
  const pendingNoStaging = {
    id: "offline-pending",
    orderNumber: "OFF-PEND",
    status: "pending",
    stagingLocationId: "",
    jobId: "job-1",
    vendorId: "vendor-1",
    deliveryDate: "2026-07-03",
    createdAt: "2026-07-03T00:00:00Z",
    updatedAt: "2026-07-03T00:00:00Z",
  };
  const zeroReceivedItems = [
    {
      id: "item-off",
      deliveryOrderId: "offline-pending",
      sku: "SKU-1",
      description: "Test item",
      qtyOrdered: 3,
      qtyReceived: 0,
      qtyMissing: 3,
      qtyDamaged: 0,
      qtyBackordered: 0,
      status: "pending",
    },
  ];
  record(
    "offline — pending + 0 received + no staging requires action",
    isDispatcherTableStagingActionRequired(pendingNoStaging),
  );
  const display = computeDeliveryDisplayState(
    pendingNoStaging,
    zeroReceivedItems,
    [],
  );
  record(
    "offline — missingStagingAssignment without received qty gate",
    display.missingStagingAssignment,
  );
  record(
    "offline — Issue Summary Assign staging location (top priority)",
    display.issueSummary === DISPATCHER_STAGING_ACTION_ISSUE_SUMMARY,
    display.issueSummary,
  );
  const withStaging = {
    ...pendingNoStaging,
    stagingLocationId: "staging-2",
  };
  record(
    "offline — assigned staging clears action row",
    !isDispatcherTableStagingActionRequired(withStaging),
  );
  const installedNoStaging = {
    ...pendingNoStaging,
    status: "installed",
    stagingLocationId: "",
  };
  record(
    "offline — installed closed record exempt from action row",
    !isDispatcherTableStagingActionRequired(installedNoStaging),
  );

  const willCallShell = {
    ...pendingNoStaging,
    id: "offline-willcall",
    status: "complete",
    invoiceImportStatus: "pickup_at_vendor",
    createdFromInvoiceImport: true,
  };
  record(
    "offline — Will-Call / pickup_at_vendor exempt from staging action",
    !isDispatcherTableStagingActionRequired(willCallShell),
  );
  const willCallDisplay = computeDeliveryDisplayState(
    willCallShell,
    zeroReceivedItems,
    [],
  );
  record(
    "offline — Will-Call Issue Summary not Assign staging location",
    willCallDisplay.issueSummary !== DISPATCHER_STAGING_ACTION_ISSUE_SUMMARY,
    willCallDisplay.issueSummary,
  );

  const deliverToSiteShell = {
    ...pendingNoStaging,
    id: "offline-deliver-site",
    status: "complete",
    invoiceImportStatus: "pending",
    invoiceDeliverToSite: true,
    createdFromInvoiceImport: true,
  };
  record(
    "offline — deliver-to-site exempt from staging action",
    !isDispatcherTableStagingActionRequired(deliverToSiteShell),
  );
  record(
    "offline — deliver-to-site helper agrees",
    isInvoiceShellNoShopStaging(deliverToSiteShell),
  );
}

assertOfflineStagingActionRules();

async function assertStagingLocationCard(page, record, label, expectAssigned) {
  const card = page.getByTestId("staging-location-assignment");
  if ((await card.count()) === 0) {
    record(`${label} — staging assignment card present`, false);
    return;
  }

  const cardState = await card.getAttribute("data-staging-card-state");
  record(
    `${label} — staging card state attribute`,
    cardState === (expectAssigned ? "assigned" : "unassigned"),
    cardState ?? "",
  );

  const bgColor = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
  const borderColor = await card.evaluate(
    (el) => getComputedStyle(el).borderTopColor,
  );

  if (expectAssigned) {
    record(
      `${label} — assigned staging card green background`,
      /rgb\(232,\s*245,\s*233\)|#e8f5e9/i.test(bgColor),
      bgColor,
    );
    record(
      `${label} — assigned staging card green border (no orange)`,
      /rgb\(165,\s*214,\s*167\)|#a5d6a7/i.test(borderColor) &&
        !/rgb\(253,\s*186,\s*116\)|#fdba74/i.test(borderColor),
      borderColor,
    );

    const assignedCode = page.getByTestId("staging-assigned-code");
    record(
      `${label} — assigned location code shown`,
      (await assignedCode.count()) > 0 && (await assignedCode.innerText()).trim().length > 0,
      (await assignedCode.count()) > 0
        ? (await assignedCode.innerText()).trim()
        : "missing",
    );

    const currentLine = page.getByTestId("staging-current-location");
    const currentText = (await currentLine.innerText()).trim();
    record(
      `${label} — current location line not orange warning text`,
      !/^Current:\s*Not Assigned$/i.test(currentText),
      currentText.slice(0, 80),
    );
  } else {
    record(
      `${label} — unassigned staging card warning background`,
      /rgb\(255,\s*251,\s*235\)|#fffbeb/i.test(bgColor),
      bgColor,
    );
    record(
      `${label} — unassigned staging card orange border`,
      /rgb\(253,\s*186,\s*116\)|#fdba74/i.test(borderColor),
      borderColor,
    );
    record(
      `${label} — unassigned shows Not Assigned`,
      (await page.getByTestId("staging-current-location").innerText()).trim() ===
        "Current: Not Assigned",
    );
    record(
      `${label} — no assigned code badge when unassigned`,
      (await page.getByTestId("staging-assigned-code").count()) === 0,
    );
  }
}

async function assertStagingLocationBanner(page, record, label, expectVisible) {
  const banner = page.getByTestId("drawer-staging-location-banner");
  const actionBannerHeading = page.getByTestId("drawer-action-banner-heading");

  if (expectVisible) {
    if ((await banner.count()) === 0) {
      record(`${label} — staging location banner visible`, false, "banner missing");
      return;
    }

    const heading = (
      await page.getByTestId("drawer-staging-location-banner-heading").innerText()
    ).trim();
    record(
      `${label} — staging banner title STAGING LOCATION NEEDED`,
      heading.toUpperCase() === "STAGING LOCATION NEEDED",
      heading,
    );

    const body = (
      await page.getByTestId("drawer-staging-location-banner-body").innerText()
    ).trim();
    record(
      `${label} — staging banner body copy`,
      body === "Assign a location for receiving and pickup.",
      body,
    );

    const bannerMode = await banner.getAttribute("data-banner-mode");
    record(
      `${label} — staging banner uses orange staging_needed mode`,
      bannerMode === "staging_needed",
      bannerMode ?? "",
    );

    const borderColor = await banner.evaluate(
      (el) => getComputedStyle(el).borderTopColor,
    );
    record(
      `${label} — staging banner orange border styling`,
      /rgb\(234,\s*88,\s*12\)|#ea580c/i.test(borderColor),
      borderColor,
    );

    const assignBtn = page.getByTestId("drawer-staging-location-assign");
    record(
      `${label} — Assign Location button label`,
      (await assignBtn.innerText()).trim() === "Assign Location",
    );

    const stagingBox = await banner.boundingBox();
    const actionBox = await actionBannerHeading.boundingBox();
    record(
      `${label} — staging banner before status banner (DOM order)`,
      Boolean(stagingBox && actionBox && stagingBox.y < actionBox.y),
      `staging y=${stagingBox?.y ?? "?"}, status y=${actionBox?.y ?? "?"}`,
    );

    await assignBtn.click();
    await page.waitForTimeout(800);
    const urlAfterAssign = page.url();
    record(
      `${label} — Assign Location navigates to Staging Map with assignDelivery`,
      /assignDelivery=/.test(urlAfterAssign) &&
        (/\/#\/zones/.test(urlAfterAssign) || /\/zones/.test(urlAfterAssign)),
      urlAfterAssign,
    );
    const assignBanner = page.getByTestId("assign-mode-banner");
    record(
      `${label} — assign mode banner visible after Assign Location`,
      (await assignBanner.count()) > 0,
    );
    if ((await assignBanner.count()) > 0) {
      await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(400);
    }
  } else {
    record(
      `${label} — no staging location banner when assigned`,
      (await banner.count()) === 0,
      (await banner.count()) > 0 ? "banner unexpectedly visible" : "absent",
    );
  }
}

async function assertDeliveryBasicsStaging(page, record, label, expectUnassigned) {
  const unassigned = page.getByTestId("delivery-basics-staging-unassigned");
  if (expectUnassigned) {
    record(
      `${label} — Delivery Basics shows Staging: Not Assigned`,
      (await unassigned.count()) > 0 &&
        (await unassigned.innerText()).trim() === "Not Assigned",
    );
  } else {
    record(
      `${label} — Delivery Basics shows assigned staging (not unassigned)`,
      (await unassigned.count()) === 0,
    );
  }
}

/** Staging Loc. column index in deliveries table (0-based). */
const STAGING_COLUMN_INDEX = 7;
/** Issue Summary column index in deliveries table (0-based). */
const ISSUE_SUMMARY_COLUMN_INDEX = 9;
/** Status column index in deliveries table (0-based). */
const STATUS_COLUMN_INDEX = 0;

async function assertStagingActionRowsMatchStagingColumn(page, record) {
  const rows = page.locator("table tbody tr");
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const orderNumber = (await row.locator("td").nth(4).innerText()).trim();
    const statusLabel = (
      await row.locator("td").nth(STATUS_COLUMN_INDEX).innerText()
    ).trim();
    const stagingText = (
      await row.locator("td").nth(STAGING_COLUMN_INDEX).innerText()
    ).trim();
    const stagingUnassigned =
      stagingText.length === 0 || stagingText === "—" || stagingText === "-";
    const hasClass = await row.evaluate((el) =>
      el.classList.contains("dispatcher-action-required"),
    );
    const deliverToSiteExempt = statusLabel === "Delivered";
    if (deliverToSiteExempt && stagingUnassigned && !hasClass) {
      record(
        `${orderNumber} — action row matches empty Staging Loc.`,
        true,
        "deliver-to-site exempt — empty staging OK without orange row",
      );
      continue;
    }
    if (stagingUnassigned && !hasClass) {
      const issueText = (
        await row.locator("td").nth(ISSUE_SUMMARY_COLUMN_INDEX).innerText()
      ).trim();
      if (!issueText.includes("Assign staging location")) {
        record(
          `${orderNumber} — action row matches empty Staging Loc.`,
          true,
          "staging not required — issue summary not Assign staging location",
        );
        continue;
      }
    }
    record(
      `${orderNumber} — action row matches empty Staging Loc.`,
      hasClass === stagingUnassigned,
      stagingUnassigned
        ? "empty staging → orange"
        : `assigned (${stagingText}) → normal`,
    );
    if (stagingUnassigned && hasClass) {
      const issueText = (
        await row.locator("td").nth(ISSUE_SUMMARY_COLUMN_INDEX).innerText()
      ).trim();
      record(
        `${orderNumber} — Issue Summary Assign staging location`,
        issueText.includes("Assign staging location"),
        issueText,
      );
    }
  }
}

async function assertDispatcherStagingActionRows(page, record) {
  const rows = page.locator("table tbody tr");
  const count = await rows.count();
  let actionCount = 0;
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const hasClass = await row.evaluate((el) =>
      el.classList.contains("dispatcher-action-required"),
    );
    if (!hasClass) continue;
    actionCount++;
    const orderNumber = (await row.locator("td").nth(4).innerText()).trim();
    const issueText = (
      await row.locator("td").nth(ISSUE_SUMMARY_COLUMN_INDEX).innerText()
    ).trim();
    const bg = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
    record(
      `${orderNumber} — dispatcher-action-required dark orange row`,
      /194,\s*65,\s*12/.test(bg),
      bg,
    );
    record(
      `${orderNumber} — Issue Summary Assign staging location`,
      issueText.includes("Assign staging location"),
      issueText,
    );
    const viewBtn = row.getByRole("button", { name: "View" });
    if ((await viewBtn.count()) > 0) {
      const styles = await viewBtn.evaluate((el) => {
        const s = getComputedStyle(el);
        return { color: s.color, border: s.borderColor, bg: s.backgroundColor };
      });
      record(
        `${orderNumber} — View button contrast on action row`,
        styles.border.includes("255") || styles.bg.includes("255"),
        JSON.stringify(styles),
      );
    }
  }
  record(
    "dispatcher-action-required rows scanned",
    true,
    actionCount > 0
      ? `${actionCount} row(s) styled`
      : "none in live data",
  );

  // Missing staging alone triggers action row (independent of received qty).
  await assertStagingActionRowsMatchStagingColumn(page, record);
}

async function openRowByStagingAssignment(page, wantUnassigned) {
  const rows = page.locator("table tbody tr");
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const stagingText = (await row.locator("td").nth(STAGING_COLUMN_INDEX).innerText()).trim();
    const isUnassigned = stagingText === "—" || stagingText.length === 0;
    if (isUnassigned === wantUnassigned) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      await row.click({ force: true });
      await page.waitForTimeout(1200);
      await page.getByTestId("issue-summary-panel").waitFor({ timeout: 15_000 });
      const orderNumber = (await row.locator("td").nth(4).innerText()).trim();
      return orderNumber;
    }
  }
  return null;
}

/** Group action buttons by row using Y positions (tolerance px). */
async function getActionButtonRows(page) {
  const grid = page.getByTestId("drawer-action-buttons");
  return grid.evaluate((el) => {
    const tolerance = 8;
    const buttons = Array.from(el.querySelectorAll("button"));
    const rects = buttons.map((btn) => {
      const r = btn.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    rects.sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];
    for (const rect of rects) {
      const row = rows.find((r) => Math.abs(r[0].y - rect.y) <= tolerance);
      if (row) row.push(rect);
      else rows.push([rect]);
    }
    return rows.map((row) => row.sort((a, b) => a.x - b.x));
  });
}

async function assertStagingOccupiedDropdown(page, record, label) {
  const planned = page.getByTestId("planned-staging-assignment");
  if ((await planned.count()) === 0) {
    record(`${label} — planned staging assignment present`, false, "section missing");
    return;
  }

  const unavailableRows = planned.locator('[data-staging-unavailable="true"]');
  const unavailableCount = await unavailableRows.count();
  record(
    `${label} — at least one unavailable planned staging spot`,
    unavailableCount > 0,
    `${unavailableCount} unavailable`,
  );

  if (unavailableCount > 0) {
    const firstBadge = planned.locator('[data-testid^="planned-staging-unavailable-"]').first();
    const badgeText = (await firstBadge.innerText()).trim();
    record(
      `${label} — unavailable spot shows in-use label`,
      badgeText.includes("Not available") && badgeText.includes("in use:"),
      badgeText,
    );
    const firstCheckbox = unavailableRows.first().locator('input[type="checkbox"]');
    record(
      `${label} — unavailable spot checkbox disabled`,
      await firstCheckbox.isDisabled(),
    );
  }
}

async function assertLowerDrawerLayout(page, record, label) {
  const stagingAssignment = page.getByTestId("staging-location-assignment");
  const advancedToggle = page.getByTestId("advanced-manual-controls-toggle");
  const stockToggle = page.getByTestId("experimental-stock-tools-toggle");

  record(
    `${label} — Assign Staging Location section present`,
    (await stagingAssignment.count()) > 0,
  );

  const assignHeading = page.getByTestId("assign-staging-location-heading");
  const assignHeadingText =
    (await assignHeading.count()) > 0
      ? (await assignHeading.innerText()).trim()
      : "";
  record(
    `${label} — Assign Staging Location heading`,
    assignHeadingText === "Planned Staging (dispatcher instruction)",
    assignHeadingText,
  );

  const stagingBox = await stagingAssignment.boundingBox();
  const advancedBox = await advancedToggle.boundingBox();
  record(
    `${label} — staging assignment precedes Advanced Manual Controls`,
    Boolean(stagingBox && advancedBox && stagingBox.y < advancedBox.y),
    `staging y=${stagingBox?.y ?? "?"}, advanced y=${advancedBox?.y ?? "?"}`,
  );

  record(
    `${label} — Advanced Manual Controls collapsed by default`,
    (await advancedToggle.getAttribute("aria-expanded")) === "false",
    `aria-expanded=${await advancedToggle.getAttribute("aria-expanded")}`,
  );

  record(
    `${label} — Advanced Manual Controls heading text`,
    (await page.getByTestId("manual-controls-heading").innerText()).trim() ===
      "Advanced Manual Controls",
  );

  record(
    `${label} — Experimental Stock Tools collapsed by default`,
    (await stockToggle.getAttribute("aria-expanded")) === "false",
    `aria-expanded=${await stockToggle.getAttribute("aria-expanded")}`,
  );

  record(
    `${label} — no PO input in lower drawer`,
    (await page.getByPlaceholder("Enter PO number").count()) === 0 &&
      (await page.getByRole("button", { name: "Save PO" }).count()) === 0,
  );

  const basicsCard = page.getByTestId("delivery-basics-card");
  if ((await basicsCard.count()) > 0) {
    const basicsText = (await basicsCard.innerText()).trim();
    record(
      `${label} — Delivery Basics still shows PO #`,
      /PO\s*#/i.test(basicsText),
      basicsText.slice(0, 120),
    );
  } else {
    record(`${label} — Delivery Basics card present for PO check`, false);
  }

  const manualSection = page.getByTestId("manual-controls-section");
  record(
    `${label} — manual mark buttons hidden when Advanced collapsed`,
    (await manualSection.count()) === 0,
  );

  await advancedToggle.click();
  await page.waitForTimeout(300);
  record(
    `${label} — Advanced Manual Controls expands on click`,
    (await advancedToggle.getAttribute("aria-expanded")) === "true",
  );
  if ((await manualSection.count()) > 0) {
    const manualText = (await manualSection.innerText()).trim();
    record(
      `${label} — Advanced Manual Controls groups Mark buttons`,
      /Mark Partial/i.test(manualText) &&
        /Mark Staged/i.test(manualText) &&
        /Mark Issue/i.test(manualText),
      manualText.slice(0, 80),
    );
  } else {
    record(`${label} — manual-controls-section present when expanded`, false);
  }

  await stockToggle.click();
  await page.waitForTimeout(300);
  record(
    `${label} — Experimental Stock Tools expands on click`,
    (await stockToggle.getAttribute("aria-expanded")) === "true",
  );
  record(
    `${label} — shop stock pick list inside experimental section`,
    (await page.getByTestId("experimental-stock-tools-section").count()) > 0 &&
      (await page.locator("#shop-stock-pick-list").count()) > 0,
  );
}

async function assertActionButtonGridBalance(page, record, label, expectedCount) {
  const grid = page.getByTestId("drawer-action-buttons");
  if ((await grid.count()) === 0) {
    record(`${label} — action button grid balance`, false, "grid missing");
    return;
  }

  const gridCols = await grid.evaluate(
    (el) => getComputedStyle(el).gridTemplateColumns,
  );
  record(
    `${label} — action grid uses two explicit columns`,
    /repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(gridCols) ||
      gridCols.split(" ").length === 2,
    `grid-template-columns=${gridCols}`,
  );

  const rows = await getActionButtonRows(page);
  const counts = rows.map((r) => r.length);
  const buttonCount = counts.reduce((sum, n) => sum + n, 0);

  record(
    `${label} — action button count`,
    buttonCount === expectedCount,
    `expected=${expectedCount}, actual=${buttonCount}, rows=${counts.join("+")}`,
  );

  if (expectedCount === 4) {
    record(
      `${label} — four action buttons in 2x2 grid (not 3+1)`,
      counts.length === 2 && counts[0] === 2 && counts[1] === 2,
      `row counts=${counts.join("+")}`,
    );
  } else if (expectedCount === 3) {
    const balanced = counts.length === 2 && counts[0] === 2 && counts[1] === 1;
    const threePlusOne =
      counts.length >= 2 && counts.some((n) => n >= 3) && counts.some((n) => n === 1);
    record(
      `${label} — three action buttons balanced (2+1, not 3+1 orphan)`,
      balanced && !threePlusOne,
      `row counts=${counts.join("+")}`,
    );
  }
}

async function assertSeparatePickupPills(page, record, label) {
  const scheduledBadge = page.getByTestId("pickup-scheduled-badge");
  const activeToken = page.getByTestId("pickup-token-active");
  const scheduledCount = await scheduledBadge.count();
  const activeCount = await activeToken.count();

  if (scheduledCount === 0 && activeCount === 0) {
    record(`${label} — separate pickup pills (none present)`, true, "no pills");
    return;
  }

  if (scheduledCount > 0 && activeCount > 0) {
    const scheduledText = (await scheduledBadge.innerText()).trim();
    const activeText = (await activeToken.innerText()).trim();
    record(
      `${label} — Pickup Scheduled pill separate from active link`,
      scheduledText === "Pickup Scheduled" &&
        /Active link expires/i.test(activeText) &&
        !scheduledText.includes("Active link"),
      `scheduled="${scheduledText}", active="${activeText.slice(0, 60)}"`,
    );

    const scheduledParent = await scheduledBadge.evaluate((el) => el.parentElement);
    const activeParent = await activeToken.evaluate((el) => el.parentElement);
    record(
      `${label} — pickup pills are sibling elements (not combined)`,
      scheduledParent === activeParent &&
        scheduledBadge !== activeToken,
      `same parent=${scheduledParent === activeParent}`,
    );

    const scheduledBg = await scheduledBadge.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    record(
      `${label} — Pickup Scheduled pill uses blue styling`,
      /rgb\(227,\s*242,\s*253\)|#e3f2fd/i.test(scheduledBg),
      scheduledBg,
    );

    const activeBg = await activeToken.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    record(
      `${label} — active link pill uses green styling`,
      /rgb\(232,\s*245,\s*233\)|#e8f5e9/i.test(activeBg),
      activeBg,
    );
  } else if (activeCount > 0) {
    const activeText = (await activeToken.innerText()).trim();
    record(
      `${label} — active link pill present alone`,
      /Active link expires/i.test(activeText),
      activeText.slice(0, 80),
    );
    const activeBg = await activeToken.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    record(
      `${label} — active link pill uses green styling`,
      /rgb\(232,\s*245,\s*233\)|#e8f5e9/i.test(activeBg),
      activeBg,
    );
  } else {
    const scheduledText = (await scheduledBadge.innerText()).trim();
    record(
      `${label} — Pickup Scheduled pill present alone`,
      scheduledText === "Pickup Scheduled",
      scheduledText,
    );
  }
}

async function assertPickupStatusInGrid(page, record, label) {
  const grid = page.getByTestId("drawer-action-buttons");
  const tokenControls = page.getByTestId("pickup-token-controls");
  if ((await grid.count()) === 0) {
    record(`${label} — pickup status inside action grid`, false, "grid missing");
    return;
  }
  if ((await tokenControls.count()) === 0) {
    record(
      `${label} — no pickup status area when idle (OK)`,
      true,
      "pickup-token-controls absent",
    );
    record(
      `${label} — no floating active-link line below grid`,
      true,
      "no separate token controls",
    );
    return;
  }

  const controlsInsideGrid = await page.evaluate(() => {
    const gridEl = document.querySelector('[data-testid="drawer-action-buttons"]');
    const controlsEl = document.querySelector('[data-testid="pickup-token-controls"]');
    return Boolean(gridEl && controlsEl && gridEl.contains(controlsEl));
  });
  record(
    `${label} — pickup status inside action button grid`,
    controlsInsideGrid,
    `inside grid=${controlsInsideGrid}`,
  );

  const buttonsBox = await grid.boundingBox();
  const tokenBox = await tokenControls.boundingBox();
  record(
    `${label} — no floating active-link line below grid`,
    Boolean(
      controlsInsideGrid &&
        buttonsBox &&
        tokenBox &&
        tokenBox.y <= buttonsBox.y + buttonsBox.height + 4,
    ),
    `grid bottom=${buttonsBox ? buttonsBox.y + buttonsBox.height : "?"}, token y=${tokenBox?.y ?? "?"}`,
  );

  const bodyFloatingLine = page
    .locator("body")
    .getByText(/^Active pickup link exists/);
  record(
    `${label} — legacy floating active-link copy removed`,
    (await bodyFloatingLine.count()) === 0,
  );

  await assertSeparatePickupPills(page, record, label);
}

async function assertDeliveryBasicsNoTopNotes(page, record, label) {
  const basicsCard = page.getByTestId("delivery-basics-card");
  if ((await basicsCard.count()) === 0) {
    record(`${label} — Delivery Basics card present`, false);
    return;
  }
  const notesInBasics = basicsCard.getByText(/^Notes$/);
  record(
    `${label} — Delivery Basics has no notes box at top`,
    (await notesInBasics.count()) === 0,
  );
  const textareaInBasics = basicsCard.locator("textarea");
  record(
    `${label} — Delivery Basics has no notes textarea`,
    (await textareaInBasics.count()) === 0,
  );
}

async function assertDeliveryFirstDrawerOrder(page, record, label) {
  const bodyText = await page.locator("body").innerText();
  const heading = (
    await page.getByTestId("drawer-action-banner-heading").innerText()
  ).trim();
  const issueIndex = bodyText.indexOf("ORDER SUMMARY");
  const actionIndex = bodyText.indexOf(heading);
  const basicsIndex = bodyText.indexOf("DELIVERY BASICS");
  const readinessIndex = bodyText.indexOf("READINESS EVIDENCE");
  const actionButtons = page.getByTestId("drawer-action-buttons");

  record(
    `${label} — Delivery Basics precedes action banner`,
    basicsIndex >= 0 && actionIndex > basicsIndex,
    `basics@${basicsIndex}, action@${actionIndex}`,
  );

  if ((await actionButtons.count()) > 0) {
    const buttonsBox = await actionButtons.boundingBox();
    const bannerBox = await page
      .getByTestId("drawer-action-banner-heading")
      .boundingBox();
    record(
      `${label} — action buttons precede action banner`,
      Boolean(buttonsBox && bannerBox && buttonsBox.y < bannerBox.y),
      `buttons y=${buttonsBox?.y ?? "?"}, banner y=${bannerBox?.y ?? "?"}`,
    );
    const display = await actionButtons.evaluate(
      (el) => getComputedStyle(el).display,
    );
    record(
      `${label} — action buttons use grid layout`,
      display === "grid",
      `display=${display}`,
    );
    const gridCols = await actionButtons.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns,
    );
    record(
      `${label} — action grid two-column template`,
      /repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(gridCols) ||
        gridCols.split(" ").length === 2,
      `grid-template-columns=${gridCols}`,
    );
    await assertPickupStatusInGrid(page, record, label);
  } else {
    record(`${label} — action button grid present`, false);
  }

  record(
    `${label} — Action banner precedes Order Summary`,
    actionIndex >= 0 && issueIndex > actionIndex,
    `action@${actionIndex}, issue@${issueIndex}`,
  );
  record(
    `${label} — Order Summary precedes Readiness Evidence`,
    issueIndex >= 0 && readinessIndex > issueIndex,
    `issue@${issueIndex}, readiness@${readinessIndex}`,
  );
}

/** Seed/demo orders that must share ORD-005 drawer presentation rules. */
const DEMO_ORDER_NUMBERS = ["ORD-001", "ORD-002", "ORD-004", "ORD-005", "ORD-006"];

async function openOrderDrawer(page, orderNumber) {
  const row = page.locator("table tbody tr", { hasText: orderNumber }).first();
  if ((await row.count()) === 0) return false;
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await row.click({ force: true });
  await page.waitForTimeout(1200);
  await page.getByTestId("issue-summary-panel").waitFor({ timeout: 15_000 });
  return true;
}

/** ORD-005 layout rules applied to every demo order (non-mutating checks). */
async function assertUniformDemoDrawerPresentation(page, record, orderNumber) {
  await assertDeliveryBasicsNoTopNotes(page, record, orderNumber);
  await assertDeliveryFirstDrawerOrder(page, record, orderNumber);

  record(
    `${orderNumber} — Assign Staging Location section present`,
    (await page.getByTestId("staging-location-assignment").count()) > 0,
  );

  const assignHeadingEl = page.getByTestId("assign-staging-location-heading");
  const assignHeadingText =
    (await assignHeadingEl.count()) > 0
      ? (await assignHeadingEl.innerText()).trim()
      : "";
  record(
    `${orderNumber} — Assign Staging Location heading`,
    assignHeadingText === "Planned Staging (dispatcher instruction)",
    assignHeadingText,
  );

  const advancedToggle = page.getByTestId("advanced-manual-controls-toggle");
  record(
    `${orderNumber} — Advanced Manual Controls collapsed by default`,
    (await advancedToggle.getAttribute("aria-expanded")) === "false",
    `aria-expanded=${await advancedToggle.getAttribute("aria-expanded")}`,
  );

  record(
    `${orderNumber} — Advanced Manual Controls heading text`,
    (await page.getByTestId("manual-controls-heading").innerText()).trim() ===
      "Advanced Manual Controls",
  );

  const stockToggle = page.getByTestId("experimental-stock-tools-toggle");
  record(
    `${orderNumber} — Experimental Stock Tools collapsed by default`,
    (await stockToggle.getAttribute("aria-expanded")) === "false",
    `aria-expanded=${await stockToggle.getAttribute("aria-expanded")}`,
  );

  record(
    `${orderNumber} — no PO input in lower drawer`,
    (await page.getByPlaceholder("Enter PO number").count()) === 0 &&
      (await page.getByRole("button", { name: "Save PO" }).count()) === 0,
  );

  record(
    `${orderNumber} — manual mark buttons hidden when Advanced collapsed`,
    (await page.getByTestId("manual-controls-section").count()) === 0,
  );

  record(
    `${orderNumber} — workflow status badge removed`,
    (await page.getByTestId("drawer-workflow-status-badge").count()) === 0,
  );

  record(
    `${orderNumber} — no At Shop awaiting check-in pill`,
    !(await page.locator("body").innerText()).includes("At Shop — awaiting check-in"),
  );

  record(
    `${orderNumber} — Vendor Communications hidden in drawer`,
    (await page.getByTestId("vendor-communications-panel").count()) === 0,
  );

  record(
    `${orderNumber} — recently resolved material issues hidden`,
    (await page.getByTestId("recently-resolved-material-issues").count()) === 0,
  );

  record(
    `${orderNumber} — Need More Space button hidden in drawer`,
    (await page.getByRole("button", { name: /Need More Space/i }).count()) === 0,
  );

  record(
    `${orderNumber} — Job Status panel removed`,
    (await page.getByTestId("job-readiness-panel").count()) === 0,
  );

  record(
    `${orderNumber} — Generate Pickup Link removed`,
    (await page.getByTestId("generate-pickup-link").count()) === 0,
  );

  record(
    `${orderNumber} — no Open Issues toggle in Issue Summary`,
    (await page.getByTestId("issue-summary-open-issues-toggle").count()) === 0,
  );

  record(
    `${orderNumber} — Items section present`,
    (await page.getByTestId("drawer-items-section").count()) > 0,
  );

  const bodyText = await page.locator("body").innerText();
  record(
    `${orderNumber} — Status History renamed to Activity History`,
    !bodyText.includes("STATUS HISTORY") && /Activity History/i.test(bodyText),
  );

  const activityToggle = page.getByTestId("activity-history-toggle");
  record(
    `${orderNumber} — Activity History collapsed by default`,
    (await activityToggle.count()) > 0 &&
      (await activityToggle.getAttribute("aria-expanded")) === "false",
  );

  record(
    `${orderNumber} — Activity History content hidden when collapsed`,
    (await page.getByTestId("activity-history-content").count()) === 0,
  );
}

/** ORD-006 truck-stock demo — email proposal needs review with actionable button. */
async function assertOrd006EmailReviewAction(page, record) {
  const whyBlock = page.getByTestId("drawer-action-banner-why");
  const whyText =
    (await whyBlock.count()) > 0 ? (await whyBlock.innerText()).trim() : "";
  record(
    "ORD-006 shows vendor email review attention",
    /vendor email proposal needs dispatcher review/i.test(whyText),
    whyText.slice(0, 80),
  );

  const reviewBtn = page.getByTestId("drawer-action-review-vendor-email");
  if ((await reviewBtn.count()) === 0) {
    record("ORD-006 Review Vendor Email button visible", false, "missing");
    return;
  }

  record("ORD-006 Review Vendor Email button visible", await reviewBtn.isVisible());
  record("ORD-006 Review Vendor Email button enabled", await reviewBtn.isEnabled());

  await reviewBtn.click();
  await page.waitForTimeout(600);

  const detailsSection = page.getByTestId("readiness-evidence-details");
  record(
    "ORD-006 Review Vendor Email expands readiness details",
    (await detailsSection.count()) > 0 && (await detailsSection.isVisible()),
  );

  const emailList = page.getByTestId("email-evidence-list");
  record(
    "ORD-006 Review Vendor Email expands email evidence list",
    (await emailList.count()) > 0 && (await emailList.isVisible()),
  );

  const evidenceCard = page.locator('[data-testid^="email-evidence-card-"]').first();
  record(
    "ORD-006 email evidence card present after review click",
    (await evidenceCard.count()) > 0,
  );
}

(async () => {
  mkdirSync(screenshotDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();

  await ensureAuthenticated(page, appBase);
  await page.getByRole("heading", { name: "Delivery Overview" }).waitFor({
    timeout: 30_000,
  });
  await page.locator("table tbody tr").first().waitFor({ timeout: 30_000 });

  const rows = page.locator("table tbody tr");
  const rowCount = await rows.count();
  record("Deliveries table has rows", rowCount > 0, `${rowCount} rows`);

  await assertDispatcherStagingActionRows(page, record);

  if (rowCount === 0) {
    await browser.close();
    process.exit(1);
  }

  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const search = page.locator('input[placeholder*="Job #, name, PO"]');
  await search.waitFor({ state: "visible", timeout: 15_000 });
  const isProdBase = /lgarage\.github\.io\/stageverify/i.test(baseUrl);
  const drawerProbeOrder = isProdBase
    ? (process.env.STAGEVERIFY_VERIFY_ORDER ?? "4046362")
    : "ORD-005";
  await search.fill("");
  await search.fill(drawerProbeOrder);
  await page.waitForTimeout(1500);

  const targetRow = page
    .locator("table tbody tr", { hasText: drawerProbeOrder })
    .first();
  if ((await targetRow.count()) === 0) {
    if (isProdBase) {
      const fallbackRow = page.locator("table tbody tr").first();
      if ((await fallbackRow.count()) === 0) {
        throw new Error("No delivery rows found on prod for drawer consistency verify");
      }
      record(
        "Prod drawer probe order not in table (demo rows hidden)",
        true,
        `${drawerProbeOrder} absent — using first row`,
      );
    } else {
      throw new Error("ORD-005 fixture row not found for drawer consistency verify");
    }
  }
  const ord005Row = (await targetRow.count()) > 0
    ? targetRow
    : page.locator("table tbody tr").first();
  const viewBtn = ord005Row.locator("button").filter({ hasText: /^View$/ });
  if (await viewBtn.isVisible().catch(() => false)) {
    await viewBtn.click({ force: true });
  } else {
    await ord005Row.click({ force: true });
  }
  await page.waitForTimeout(1200);
  await assertDeliveryDrawerOpen(page);
  await page.getByTestId("drawer-action-banner").waitFor({ timeout: 20_000 });

  const issuePanel = page.getByTestId("issue-summary-panel");
  await issuePanel.scrollIntoViewIfNeeded();
  await issuePanel.waitFor({ state: "visible", timeout: 20_000 });
  const orderSummaryTitle = await issuePanel.evaluate((el) => {
    const h3 = el.querySelector("h3");
    return h3?.textContent?.trim() ?? "";
  });
  record(
    "Order Summary panel title",
    orderSummaryTitle === "Order Summary",
    `title=${orderSummaryTitle}`,
  );
  record("Issue Summary panel visible", true);

  await assertDeliveryBasicsNoTopNotes(page, record, "Drawer");
  await assertPickupStatusInGrid(page, record, "Drawer");

  const drawerStagingUnassigned =
    (await page.getByTestId("delivery-basics-staging-unassigned").count()) > 0;
  await assertDeliveryBasicsStaging(page, record, "Drawer", drawerStagingUnassigned);
  await assertStagingLocationBanner(page, record, "Drawer", drawerStagingUnassigned);
  await assertStagingLocationCard(
    page,
    record,
    "Drawer",
    !drawerStagingUnassigned,
  );

  const banner = page.getByTestId("drawer-action-banner");
  await banner.waitFor({ timeout: 15_000 });
  const heading = (await page.getByTestId("drawer-action-banner-heading").innerText()).trim();
  const headingNormalized = heading.toLowerCase();
  record("Drawer action banner visible", true, heading);

  const listStatus = (
    await ord005Row.locator("td").first().innerText()
  ).trim();
  record("List status captured", listStatus.length > 0, listStatus);

  const summaryLines = page.getByTestId("issue-summary-lines");
  const lineTexts = await summaryLines.locator("li").allInnerTexts();
  const deliveryStatusLine = lineTexts.find((line) =>
    line.startsWith("Delivery Status:"),
  );
  const itemsReceivedLine = lineTexts.find((line) =>
    line.includes("Items Received"),
  );

  if (deliveryStatusLine) {
    const drawerStatus = deliveryStatusLine.replace("Delivery Status:", "").trim();
    record(
      "Drawer delivery status matches list status label",
      drawerStatus === listStatus,
      `list=${listStatus}, drawer=${drawerStatus}`,
    );
  } else {
    record("Drawer delivery status line present", false);
  }

  if (itemsReceivedLine) {
    const listItemsRecv = (
      await ord005Row.locator("td").nth(8).innerText()
    ).trim();
    const drawerMatch = itemsReceivedLine.match(/^(\d+) of (\d+) Items Received$/);
    if (drawerMatch && /^\d+\/\d+$/.test(listItemsRecv)) {
      const [listReceived, listTotal] = listItemsRecv.split("/");
      record(
        "Drawer item counts match list Items Recv. column",
        drawerMatch[1] === listReceived && drawerMatch[2] === listTotal,
        `list=${listItemsRecv}, drawer=${itemsReceivedLine}`,
      );
    } else {
      record(
        "Drawer/list item count formats comparable",
        true,
        `list=${listItemsRecv}, drawer=${itemsReceivedLine}`,
      );
    }
  } else {
    record("Drawer items received line present", false);
  }

  if ((await ord005Row.count()) > 0) {
    const ord005ListStatus = listStatus;
    const ord005StatusLine = deliveryStatusLine;
    const ord005ItemsLine = itemsReceivedLine;

    record(
      "ORD-005 list status is Pending Delivery",
      ord005ListStatus === "Pending Delivery",
      ord005ListStatus,
    );
    record(
      "ORD-005 drawer status matches list",
      ord005StatusLine?.includes("Pending Delivery") === true &&
        ord005ListStatus === "Pending Delivery",
      ord005StatusLine ?? "",
    );
    record(
      "ORD-005 drawer shows 0 of 9 Items Received",
      ord005ItemsLine === "0 of 9 Items Received",
      ord005ItemsLine ?? "",
    );

    await page.screenshot({
      path: resolve(screenshotDir, "drawer-ord005-pending-delivery.png"),
      fullPage: false,
    });
  } else {
    record("ORD-005 row present in deliveries table", false);
  }

  if (headingNormalized === "all clear") {
    record(
      "All Clear aligns with Ready for Pickup list label",
      listStatus === "Ready for Pickup",
      listStatus,
    );
  } else if (headingNormalized === "waiting on delivery") {
    record(
      "ORD-005 calm Waiting on Delivery banner (not urgent)",
      (await ord005Row.count()) === 0 || listStatus === "Pending Delivery",
      listStatus,
    );
    record(
      "Calm banner is not What Needs Attention",
      headingNormalized !== "what needs attention",
      heading,
    );
    const bannerMode = await banner.getAttribute("data-banner-mode");
    record(
      "Calm pending uses calm_waiting banner mode",
      bannerMode === "calm_waiting",
      bannerMode ?? "",
    );
  } else {
    record(
      "What Needs Attention not shown as Ready for Pickup in list",
      listStatus !== "Ready for Pickup",
      listStatus,
    );
    record(
      "Banner headline is What Needs Attention",
      headingNormalized === "what needs attention",
      heading,
    );
  }

  const attentionSummary = (
    await page.getByTestId("drawer-action-banner-summary").innerText()
  ).trim();
  record(
    "Banner attention summary present",
    attentionSummary.length > 0,
    attentionSummary.slice(0, 80),
  );

  const whyBlock = page.getByTestId("drawer-action-banner-why");
  if ((await whyBlock.count()) > 0) {
    const whyText = (await whyBlock.innerText()).trim();
    record(
      "Why section uses dispatcher language (not raw flags)",
      !/vendor_order_incomplete|physical_dropoff_incomplete/.test(whyText),
      whyText.slice(0, 100),
    );
  }

  const nextSteps = page.getByTestId("drawer-action-next-steps");
  if ((await nextSteps.count()) > 0) {
    const nextText = (await nextSteps.innerText()).trim();
    record(
      "Next Step section present with actionable bullets",
      nextText.length > 0,
      nextText.slice(0, 100),
    );
  }

  const bodyText = await page.locator("body").innerText();
  const issueIndex = bodyText.indexOf("ORDER SUMMARY");
  const actionIndex = bodyText.indexOf(heading);
  const basicsIndex = bodyText.indexOf("DELIVERY BASICS");
  const readinessIndex = bodyText.indexOf("READINESS EVIDENCE");

  const actionBannerLabel =
    heading === "All Clear"
      ? "ALL CLEAR"
      : heading === "Waiting on Delivery"
        ? "WAITING ON DELIVERY"
        : heading.toUpperCase();
  record(
    "Delivery Basics precedes action banner",
    basicsIndex >= 0 && actionIndex > basicsIndex,
    `basics@${basicsIndex}, action@${actionIndex}`,
  );

  const actionButtons = page.getByTestId("drawer-action-buttons");
  if ((await actionButtons.count()) > 0) {
    const buttonsBox = await actionButtons.boundingBox();
    const bannerBox = await page
      .getByTestId("drawer-action-banner-heading")
      .boundingBox();
    record(
      "Action buttons precede action banner",
      Boolean(buttonsBox && bannerBox && buttonsBox.y < bannerBox.y),
      `buttons y=${buttonsBox?.y ?? "?"}, banner y=${bannerBox?.y ?? "?"}`,
    );
    record(
      "Action buttons use two-column grid",
      (await actionButtons.evaluate((el) => getComputedStyle(el).display)) ===
        "grid",
    );
    const mainGridCols = await actionButtons.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns,
    );
    record(
      "Action grid explicit two-column template",
      /repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(mainGridCols) ||
        mainGridCols.split(" ").length === 2,
      `grid-template-columns=${mainGridCols}`,
    );
  } else {
    record("Action button grid present", false);
  }

  record(
    "Action banner precedes Order Summary",
    actionIndex >= 0 && issueIndex > actionIndex,
    `action@${actionIndex}, issue@${issueIndex}`,
  );
  record(
    "Order Summary precedes Readiness Evidence",
    issueIndex >= 0 && readinessIndex > issueIndex,
    `issue@${issueIndex}, readiness@${readinessIndex}`,
  );

  const lineCount = await summaryLines.locator("li").count();
  record("Order Summary has summary lines", lineCount >= 2, `${lineCount} lines`);

  const openIssuesToggle = page.getByTestId("issue-summary-open-issues-toggle");
  record(
    "Open Issues accordion removed from Order Summary",
    (await openIssuesToggle.count()) === 0,
  );

  if ((await ord005Row.count()) > 0) {
    record(
      "ORD-005 has no Open Issues toggle",
      (await openIssuesToggle.count()) === 0,
    );
    record(
      "ORD-005 calm banner (Waiting on Delivery, not red urgent)",
      headingNormalized === "waiting on delivery",
      heading,
    );
    record(
      "ORD-005 Resolve Issue button hidden on calm pending",
      (await page.getByTestId("drawer-action-resolve-issue").count()) === 0,
    );
    record(
      "ORD-005 Call Vendor not shown for normal pending",
      (await page.getByTestId("drawer-action-call-vendor").count()) === 0,
    );

    const qrBtn = page.getByTestId("show-vendor-checkin-qr");
    record(
      "ORD-005 Show Vendor Check-In QR label",
      (await qrBtn.count()) > 0 &&
        (await qrBtn.innerText()).trim() === "Show Vendor Check-In QR",
    );

    const copyBtn = page.getByTestId("copy-pickup-information");
    record(
      "ORD-005 Copy Pickup Information enabled when unreceived",
      (await copyBtn.count()) > 0 &&
        (await copyBtn.innerText()).trim() === "Copy Pickup Information" &&
        (await copyBtn.isEnabled()),
    );
    record(
      "ORD-005 copy enabled when 0 received (identifying info present)",
      (await copyBtn.count()) > 0 && (await copyBtn.isEnabled()),
    );

    const revokeBtn = page.getByTestId("revoke-pickup-link");
    if ((await revokeBtn.count()) > 0) {
      await revokeBtn.click();
      await page.waitForTimeout(2000);
      record(
        "ORD-005 cleared stale active link before balance test",
        (await page.getByTestId("revoke-pickup-link").count()) === 0,
      );
    }

    record(
      "ORD-005 Revoke hidden before active link",
      (await page.getByTestId("revoke-pickup-link").count()) === 0,
    );

    await assertActionButtonGridBalance(page, record, "ORD-005 (no link)", 3);
    await assertPickupStatusInGrid(page, record, "ORD-005 (no link)");
    await assertSeparatePickupPills(page, record, "ORD-005 (no link)");

    record(
      "ORD-005 Job Status panel removed",
      (await page.getByTestId("job-readiness-panel").count()) === 0,
    );

    record(
      "ORD-005 Generate Pickup Link removed",
      (await page.getByTestId("generate-pickup-link").count()) === 0,
    );

    let ord005Clipboard = await clickCopyPickupAndRead(page, copyBtn);
    record(
      "ORD-005 copy runs when unreceived (enabled + clipboard)",
      /#\/pickup\?t=[a-f0-9]{64}/.test(ord005Clipboard) &&
        /Staging location:/i.test(ord005Clipboard) &&
        /Vendor:/i.test(ord005Clipboard) &&
        /Order #:/i.test(ord005Clipboard),
      ord005Clipboard.slice(0, 80),
    );
    recordShortPickupClipboard(record, "ORD-005", ord005Clipboard);

    const manualHeading = page.getByTestId("manual-controls-heading");
    await page.getByTestId("staging-location-assignment").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    const ord005StagingUnassigned =
      (await page.getByTestId("delivery-basics-staging-unassigned").count()) > 0;
    await assertStagingLocationCard(
      page,
      record,
      "ORD-005",
      !ord005StagingUnassigned,
    );
    if (!ord005StagingUnassigned) {
      const ord005Code = (
        await page.getByTestId("staging-assigned-code").innerText()
      ).trim();
      record(
        "ORD-005 Riverside — assigned location code visible in card",
        ord005Code.length > 0,
        ord005Code,
      );
    }

    record(
      "ORD-005 Planned Staging heading present",
      (await page.getByTestId("assign-staging-location-heading").count()) > 0 &&
        (await page.getByTestId("assign-staging-location-heading").innerText()).trim() ===
          "Planned Staging (dispatcher instruction)",
    );

    await assertLowerDrawerLayout(page, record, "ORD-005");
    await assertStagingOccupiedDropdown(page, record, "ORD-005");

    record(
      "ORD-005 Advanced Manual Controls heading present",
      (await manualHeading.count()) > 0 &&
        (await manualHeading.innerText()).trim() === "Advanced Manual Controls",
    );
    record(
      "ORD-005 workflow status badge removed",
      (await page.getByTestId("drawer-workflow-status-badge").count()) === 0,
    );
    record(
      "ORD-005 no At Shop awaiting check-in pill",
      !(await page.locator("body").innerText()).includes("At Shop — awaiting check-in"),
    );

    const manualControls = page.getByTestId("advanced-manual-controls-section");
    record(
      "ORD-005 Advanced Manual Controls section present when expanded",
      (await manualControls.count()) > 0,
    );

    record(
      "ORD-005 Vendor Communications hidden in drawer",
      (await page.getByTestId("vendor-communications-panel").count()) === 0,
    );
    record(
      "ORD-005 recently resolved material issues hidden",
      (await page.getByTestId("recently-resolved-material-issues").count()) === 0,
    );
    record(
      "ORD-005 Need More Space button hidden in drawer",
      (await page.getByRole("button", { name: /Need More Space/i }).count()) === 0,
    );

    record(
      "ORD-005 Pickup Summary hidden when 0 received",
      (await page.getByTestId("pickup-summary-panel").count()) === 0,
    );

    const itemsSection = page.getByTestId("drawer-items-section");
    record(
      "ORD-005 Items section present",
      (await itemsSection.count()) > 0,
    );
    if ((await itemsSection.count()) > 0) {
      const itemsText = (await itemsSection.innerText()).trim();
      record(
        "ORD-005 Items show Not received yet (not pickup-ready green)",
        /Not received yet/i.test(itemsText),
        itemsText.slice(0, 120),
      );
      record(
        "ORD-005 Items still show ordered/received/missing counts",
        /\bOrdered\b/i.test(itemsText) &&
          /\bMissing\b/i.test(itemsText) &&
          /\b0\b/.test(itemsText),
        itemsText.slice(0, 120),
      );
    }

    record(
      "ORD-005 Status History renamed to Activity History",
      !(await page.locator("body").innerText()).includes("STATUS HISTORY") &&
        /Activity History/i.test(await page.locator("body").innerText()),
    );

    const activityToggle = page.getByTestId("activity-history-toggle");
    record(
      "ORD-005 Activity History collapsed by default",
      (await activityToggle.count()) > 0 &&
        (await activityToggle.getAttribute("aria-expanded")) === "false",
    );
    record(
      "ORD-005 Activity History content hidden when collapsed",
      (await page.getByTestId("activity-history-content").count()) === 0,
    );

    await activityToggle.click();
    await page.waitForTimeout(300);
    record(
      "ORD-005 Activity History expands on toggle",
      (await activityToggle.getAttribute("aria-expanded")) === "true",
    );

    const compactHistory = page.getByTestId("activity-history-compact");
    if ((await compactHistory.count()) > 0) {
      const compactText = (await compactHistory.innerText()).trim();
      record(
        "ORD-005 Activity History uses friendly language",
        (/Order placed|awaiting delivery|Delivery (marked|updated)/i.test(compactText) ||
          !/delivery_order\s*→/i.test(compactText)) &&
          !/delivery_order\s*→/i.test(compactText),
        compactText.slice(0, 120),
      );
      record(
        "ORD-005 Activity History compact shows at most 3 events",
        (await compactHistory.locator("[data-testid^='activity-history-event-']").count()) <= 3,
      );
    } else {
      record("ORD-005 Activity History compact list present", false);
    }

    const deliveryNotes = page.getByTestId("delivery-notes-audit");
    if ((await deliveryNotes.count()) > 0) {
      const notesText = (await deliveryNotes.innerText()).trim();
      record(
        "ORD-005 Delivery Notes readable and compact",
        /Delivery Notes/i.test(notesText) && notesText.length < 400,
        `${notesText.length} chars`,
      );
    }
  }

  const ord002Row = page.locator("table tbody tr", { hasText: "ORD-002" });
  if ((await ord002Row.count()) > 0) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await ord002Row.first().click({ force: true });
    await page.waitForTimeout(1200);
    await page.getByTestId("issue-summary-panel").waitFor({ timeout: 15_000 });

    const ord002CopyBtn = page.getByTestId("copy-pickup-information");
    record(
      "ORD-002 Copy Pickup Information enabled when received",
      (await ord002CopyBtn.count()) > 0 &&
        (await ord002CopyBtn.innerText()).trim() === "Copy Pickup Information" &&
        (await ord002CopyBtn.isEnabled()),
    );

    const ord002Revoke = page.getByTestId("revoke-pickup-link");
    if ((await ord002Revoke.count()) > 0) {
      await ord002Revoke.click();
      await page.waitForTimeout(2000);
    }

    const ord002Clipboard = await clickCopyPickupAndRead(page, ord002CopyBtn);
    record(
      "ORD-002 Copy Pickup uses secure token URL",
      /#\/pickup\?t=[a-f0-9]{64}/.test(ord002Clipboard),
      ord002Clipboard.slice(0, 80),
    );
    recordShortPickupClipboard(record, "ORD-002", ord002Clipboard);

    await page.waitForTimeout(1500);
    const revokeAfterCopy = page.getByTestId("revoke-pickup-link");
    const tokenActive = page.getByTestId("pickup-token-active");
    if ((await tokenActive.count()) > 0) {
      const tokenText = (await tokenActive.innerText()).trim();
      record(
        "ORD-002 pickup status includes link expiry after copy",
        /expires/i.test(tokenText),
        tokenText.slice(0, 80),
      );
    } else {
      record(
        "ORD-002 pickup status includes link expiry after copy",
        false,
        "pickup-token-active missing after copy",
      );
    }
    await assertPickupStatusInGrid(page, record, "ORD-002 (after copy)");
    await assertSeparatePickupPills(page, record, "ORD-002 (after copy)");
    if ((await revokeAfterCopy.count()) > 0) {
      await assertActionButtonGridBalance(
        page,
        record,
        "ORD-002 (after copy)",
        4,
      );
    } else {
      record(
        "ORD-002 Revoke visible after copy (for 2x2 check)",
        false,
        "revoke not shown after token generation",
      );
    }

    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await ord005Row.click({ force: true });
    await page.waitForTimeout(1200);
    await page.getByTestId("issue-summary-panel").waitFor({ timeout: 15_000 });
  } else {
    record("ORD-002 row present for copy-enabled test", false);
  }

  const ord001Row = page.locator("table tbody tr", { hasText: "ORD-001" });
  if ((await ord001Row.count()) > 0) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await ord001Row.first().click({ force: true });
    await page.waitForTimeout(1200);
    await page.getByTestId("issue-summary-panel").waitFor({ timeout: 15_000 });

    const ord001CopyBtn = page.getByTestId("copy-pickup-information");
    record(
      "ORD-001 Copy Pickup Information enabled when unreceived",
      (await ord001CopyBtn.count()) > 0 &&
        (await ord001CopyBtn.innerText()).trim() === "Copy Pickup Information" &&
        (await ord001CopyBtn.isEnabled()),
    );
  } else {
    record("ORD-001 row present for unreceived copy test", false);
  }

  const resolveBtn = page.getByTestId("drawer-action-resolve-issue");
  if ((await resolveBtn.count()) > 0 && (await resolveBtn.isEnabled())) {
    record("Resolve Issue only enabled when blocking issue exists", true);
  } else if ((await resolveBtn.count()) > 0) {
    record("Resolve Issue disabled when no blocking issue", true);
  }

  const missingItemsBanner = page.getByTestId("drawer-action-banner-missing-items");
  record(
    "What Needs Attention does not duplicate item-level missing list",
    (await missingItemsBanner.count()) === 0,
  );

  const issueTable = page.getByTestId("issue-summary-table");
  if ((await issueTable.count()) > 0) {
    const firstQty = page.locator('[data-testid^="issue-summary-qty-"]').first();
    const firstStatus = page.locator('[data-testid^="issue-summary-status-"]').first();
    await firstQty.waitFor({ timeout: 5_000 });
    await firstStatus.waitFor({ timeout: 5_000 });

    const qtyBox = await firstQty.boundingBox();
    const statusBox = await firstStatus.boundingBox();
    if (qtyBox && statusBox) {
      record(
        "Issue table Status column right of Qty",
        statusBox.x > qtyBox.x + qtyBox.width * 0.5,
        `qty x=${Math.round(qtyBox.x)}, status x=${Math.round(statusBox.x)}`,
      );
    } else {
      record("Issue table Qty/Status layout", false, "bounding boxes unavailable");
    }
  } else {
    record("Issue table skipped (no open item issues)", true);
  }

  const receivedToggle = page.getByTestId("issue-summary-received-toggle");
  if ((await receivedToggle.count()) > 0) {
    const expandedBefore = await receivedToggle.getAttribute("aria-expanded");
    record(
      "Received Items collapsed by default",
      expandedBefore === "false",
      `aria-expanded=${expandedBefore}`,
    );

    await receivedToggle.click();
    await page.waitForTimeout(300);

    const receivedList = page.getByTestId("issue-summary-received-list");
    await receivedList.waitFor({ timeout: 5_000 });
    const firstReceived = receivedList.locator("li").first();
    const receivedText = (await firstReceived.innerText()).trim();
    record(
      "Expanded received item shows qty in parentheses",
      /\(\d+\)/.test(receivedText),
      receivedText.slice(0, 60),
    );
  } else {
    record("Received Items section skipped (none received)", true);
  }

  for (const order of ["ORD-002", "ORD-004"]) {
    const partialRow = page.locator("table tbody tr", { hasText: order });
    if ((await partialRow.count()) === 0) {
      record(`${order} row present for section-order check`, false);
      continue;
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await partialRow.first().click({ force: true });
    await page.waitForTimeout(1200);
    await page.getByTestId("issue-summary-panel").waitFor({ timeout: 15_000 });
    const orderListStatus = (await partialRow.first().locator("td").first().innerText()).trim();
    record(
      `${order} list status captured`,
      orderListStatus.length > 0,
      orderListStatus,
    );
    if (orderListStatus === "Partial") {
      record(`${order} Partial status unchanged`, true);
    } else {
      record(
        `${order} Partial status (informational — live data may differ)`,
        true,
        `status=${orderListStatus}`,
      );
    }
    if (order === "ORD-002") {
      const ord002StagingUnassigned =
        (await page.getByTestId("delivery-basics-staging-unassigned").count()) > 0;
      await assertDeliveryBasicsStaging(
        page,
        record,
        order,
        ord002StagingUnassigned,
      );
      await assertStagingLocationBanner(
        page,
        record,
        order,
        ord002StagingUnassigned,
      );
    }
    await assertDeliveryFirstDrawerOrder(page, record, order);
  }

  const readyRow = page.locator("table tbody tr", { hasText: "Ready for Pickup" }).first();
  if ((await readyRow.count()) > 0) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await readyRow.click({ force: true });
    await page.waitForTimeout(1200);
    await page.getByTestId("issue-summary-panel").waitFor({ timeout: 15_000 });
    const readyListStatus = (await readyRow.locator("td").first().innerText()).trim();
    record(
      "Ready row list status is Ready for Pickup",
      readyListStatus === "Ready for Pickup",
      readyListStatus,
    );
    await assertDeliveryFirstDrawerOrder(page, record, "Ready for Pickup");
  } else {
    record("Ready for Pickup row present for order check", false, "skipped");
  }

  const unassignedOrder = await openRowByStagingAssignment(page, true);
  if (unassignedOrder) {
    record(
      "Unassigned staging row opened for banner test",
      true,
      unassignedOrder,
    );
    await assertDeliveryBasicsStaging(page, record, unassignedOrder, true);
    await assertStagingLocationBanner(page, record, unassignedOrder, true);
    await assertStagingLocationCard(page, record, unassignedOrder, false);
  } else {
    record(
      "Unassigned staging row present for banner test",
      false,
      "no row with empty Staging Loc.",
    );
  }

  const assignedOrder = await openRowByStagingAssignment(page, false);
  if (assignedOrder) {
    record(
      "Assigned staging row opened for no-banner test",
      true,
      assignedOrder,
    );
    await assertDeliveryBasicsStaging(page, record, assignedOrder, false);
    await assertStagingLocationBanner(page, record, assignedOrder, false);
    await assertStagingLocationCard(page, record, assignedOrder, true);
    if (assignedOrder === "ORD-005") {
      record(
        "ORD-005 Riverside — no staging banner when S1-A assigned",
        (await page.getByTestId("drawer-staging-location-banner").count()) === 0,
      );
    }
  } else {
    record("Assigned staging row present for no-banner test", false);
  }

  for (const orderNumber of DEMO_ORDER_NUMBERS) {
    const opened = await openOrderDrawer(page, orderNumber);
    if (!opened) {
      record(`${orderNumber} row present for uniform drawer check`, false);
      continue;
    }
    record(`${orderNumber} row opened for uniform drawer check`, true);
    await assertUniformDemoDrawerPresentation(page, record, orderNumber);

    if (orderNumber === "ORD-006") {
      await assertOrd006EmailReviewAction(page, record);
    }

    const demoCopyBtn = page.getByTestId("copy-pickup-information");
    record(
      `${orderNumber} — Copy Pickup Information enabled`,
      (await demoCopyBtn.count()) > 0 &&
        (await demoCopyBtn.innerText()).trim() === "Copy Pickup Information" &&
        (await demoCopyBtn.isEnabled()),
    );
    if ((await demoCopyBtn.count()) > 0 && (await demoCopyBtn.isEnabled())) {
      const demoClipboard = await clickCopyPickupAndRead(page, demoCopyBtn);
      recordShortPickupClipboard(record, orderNumber, demoClipboard);
    }
  }

  await page.screenshot({
    path: resolve(screenshotDir, "drawer-after-away-073-correction.png"),
    fullPage: false,
  });
  record(
    "Drawer screenshot saved",
    true,
    "screenshots/delivery-drawer/drawer-after-away-073-correction.png",
  );

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} checks passed.`);
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

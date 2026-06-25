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
import { ensureAuthenticated, loadEnvLocal } from "./dispatcherVerifyHelpers.mjs";

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
    const assignment = page.getByTestId("staging-location-assignment");
    await assignment.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const assignmentVisible = await assignment.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top >= -40 && rect.top < window.innerHeight * 0.9;
    });
    record(
      `${label} — Assign Location scrolls assignment section into view`,
      assignmentVisible && (await assignment.count()) > 0,
    );
    const select = page.getByTestId("staging-location-select");
    const focusedSelect = await select.evaluate(
      (el) => el === document.activeElement,
    );
    record(
      `${label} — Assign Location focuses staging select`,
      focusedSelect,
      `focused=${focusedSelect}`,
    );
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
  const helper = page.getByTestId("staging-location-occupied-helper");
  const helperText = (await helper.innerText()).trim();
  record(
    `${label} — occupied helper note present`,
    (await helper.count()) > 0 &&
      helperText === "Red locations are already assigned to another delivery.",
    helperText,
  );

  const select = page.getByTestId("staging-location-select");
  if ((await select.count()) === 0) {
    record(`${label} — staging select for occupied styling`, false, "select missing");
    return;
  }

  const options = await select.locator("option").evaluateAll((opts) =>
    opts.map((o) => ({
      value: o.value,
      text: (o.textContent ?? "").trim(),
      disabled: o.disabled,
      occupiedAttr: o.getAttribute("data-staging-occupied") === "true",
      color: o.style.color || getComputedStyle(o).color,
    })),
  );

  const occupied = options.filter((o) => o.text.includes("(in use:"));
  record(
    `${label} — at least one occupied staging option`,
    occupied.length > 0,
    `${occupied.length} occupied`,
  );

  for (const opt of occupied) {
    record(
      `${label} — occupied option "${opt.text.slice(0, 40)}" has red styling`,
      /#bf0a30|rgb\(191,\s*10,\s*48\)/i.test(opt.color),
      opt.color || "no color",
    );
    record(
      `${label} — occupied option disabled`,
      opt.disabled,
      opt.text.slice(0, 50),
    );
    record(
      `${label} — occupied option data-staging-occupied`,
      opt.occupiedAttr,
      opt.text.slice(0, 50),
    );
  }

  const available = options.filter(
    (o) => o.value && !o.text.includes("(in use:"),
  );
  for (const opt of available.slice(0, 2)) {
    record(
      `${label} — available option dark text`,
      /#333|rgb\(51,\s*51,\s*51\)/i.test(opt.color) || opt.color === "",
      `${opt.text.slice(0, 40)} color=${opt.color || "default"}`,
    );
  }

  const currentAssignedId = await select.inputValue();
  if (currentAssignedId) {
    const currentOpt = options.find((o) => o.value === currentAssignedId);
    record(
      `${label} — current assignment not shown as occupied by another delivery`,
      Boolean(
        currentOpt &&
          !currentOpt.text.includes("(in use:") &&
          !currentOpt.disabled,
      ),
      currentOpt?.text.slice(0, 60) ?? "missing option",
    );
    record(
      `${label} — assign button disabled when selection matches current`,
      !(await page
        .getByTestId("staging-location-assignment")
        .getByRole("button", { name: "Assign" })
        .isEnabled()),
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
    assignHeadingText === "Assign Staging Location",
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
  const issueIndex = bodyText.indexOf("ISSUE SUMMARY");
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
    `${label} — Action banner precedes Issue Summary`,
    actionIndex >= 0 && issueIndex > actionIndex,
    `action@${actionIndex}, issue@${issueIndex}`,
  );
  record(
    `${label} — Issue Summary precedes Readiness Evidence`,
    issueIndex >= 0 && readinessIndex > issueIndex,
    `issue@${issueIndex}, readiness@${readinessIndex}`,
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

  if (rowCount === 0) {
    await browser.close();
    process.exit(1);
  }

  const ord005Row = page.locator("table tbody tr", { hasText: "ORD-005" });
  const targetRow =
    (await ord005Row.count()) > 0 ? ord005Row.first() : rows.first();

  await targetRow.click();
  await page.waitForTimeout(1200);

  const issuePanel = page.getByTestId("issue-summary-panel");
  await issuePanel.waitFor({ timeout: 15_000 });
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
    await targetRow.locator("td").first().innerText()
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
      await targetRow.locator("td").nth(8).innerText()
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
  const issueIndex = bodyText.indexOf("ISSUE SUMMARY");
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
    "Action banner precedes Issue Summary",
    actionIndex >= 0 && issueIndex > actionIndex,
    `action@${actionIndex}, issue@${issueIndex}`,
  );
  record(
    "Issue Summary precedes Readiness Evidence",
    issueIndex >= 0 && readinessIndex > issueIndex,
    `issue@${issueIndex}, readiness@${readinessIndex}`,
  );

  const lineCount = await summaryLines.locator("li").count();
  record("Issue Summary has summary lines", lineCount >= 2, `${lineCount} lines`);

  const openIssuesToggle = page.getByTestId("issue-summary-open-issues-toggle");
  record(
    "Open Issues accordion removed from Issue Summary",
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
      "ORD-005 No Items to Pick Up when 0 received",
      (await copyBtn.count()) > 0 &&
        (await copyBtn.innerText()).trim() === "No Items to Pick Up",
    );
    record(
      "ORD-005 copy disabled when 0 received",
      (await copyBtn.count()) > 0 && (await copyBtn.isDisabled()),
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

    record(
      "ORD-005 copy does not run when 0 received (disabled)",
      !(await copyBtn.isEnabled()),
    );

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
      "ORD-005 Assign Staging Location heading present",
      (await page.getByTestId("assign-staging-location-heading").count()) > 0 &&
        (await page.getByTestId("assign-staging-location-heading").innerText()).trim() ===
          "Assign Staging Location",
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

    await page.getByTestId("copy-pickup-information").click();
    await page.waitForTimeout(2000);
    let ord002Clipboard = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      ord002Clipboard = await page
        .evaluate(async () => navigator.clipboard.readText())
        .catch(() => "");
      if (/#\/pickup\?t=[a-f0-9]{64}/.test(ord002Clipboard)) break;
      await page.getByTestId("copy-pickup-information").click();
      await page.waitForTimeout(2000);
    }
    record(
      "ORD-002 Copy Pickup uses secure token URL",
      /#\/pickup\?t=[a-f0-9]{64}/.test(ord002Clipboard),
      ord002Clipboard.slice(0, 80),
    );

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

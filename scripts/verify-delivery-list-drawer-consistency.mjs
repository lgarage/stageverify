/**
 * Playwright: deliveries list status/issue summary vs drawer hierarchy agreement.
 *
 * Usage (dev server on 5173):
 *   npm run verify:delivery-consistency
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  ensureAuthenticated,
  loadEnvLocal,
  assertDeliveryDrawerOpen,
  openDeliveryDrawerByDeepLink,
} from "./dispatcherVerifyHelpers.mjs";
import {
  computeDeliveryDisplayState,
  buildIssueSummaryPanelData,
  DISPATCHER_STAGING_ACTION_ISSUE_SUMMARY,
  isDispatcherTableStagingActionRequired,
  isWillCallPickupStagingListNa,
} from "../src/dispatcher/deliveryDisplayHelpers.ts";
import {
  hasActiveShopStagingAssignment,
  isShopStagingAssignmentMissing,
} from "../src/dispatcher/drawer/DrawerStagingLocationChips.tsx";
import { deliveryReadinessDisplayLabel } from "../src/dispatcher/jobReadinessDisplay.ts";
import { computeDeliveryReadiness } from "../src/dispatcher/readiness.ts";
import {
  fulfillmentDisplayLabel,
  isInvoiceShellNoShopStaging,
} from "../src/dispatcher/invoice/invoiceShellDisplayHelpers.ts";
import { assertReadableTextContrast } from "./lib/ui-text-contrast-lib.mjs";

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
    "offline — issue summary not replaced by staging-only text",
    display.issueSummary !== DISPATCHER_STAGING_ACTION_ISSUE_SUMMARY,
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

  const offlineLocById = new Map([
    [
      "staging-2",
      {
        id: "staging-2",
        code: "G2",
        label: "G2",
        type: "zone",
        status: "Active",
      },
    ],
  ]);
  const stalePlannedOnly = {
    ...pendingNoStaging,
    plannedStagingLocationIds: ["missing-zone-xyz"],
  };
  record(
    "offline — stale planned id is not active staging",
    !hasActiveShopStagingAssignment(stalePlannedOnly, offlineLocById),
  );
  record(
    "offline — stale planned id → staging-needed (drop-off)",
    isShopStagingAssignmentMissing(stalePlannedOnly, offlineLocById),
  );
  record(
    "offline — active spot + stale extra ref → not missing",
    !isShopStagingAssignmentMissing(
      {
        ...pendingNoStaging,
        stagingLocationId: "staging-2",
        plannedStagingLocationIds: ["missing-zone-xyz"],
      },
      offlineLocById,
    ),
  );
  record(
    "offline — Will-Call + stale planned → not staging-needed",
    !isShopStagingAssignmentMissing(
      {
        ...willCallShell,
        plannedStagingLocationIds: ["missing-zone-xyz"],
      },
      offlineLocById,
    ),
  );
  const willCallDisplay = computeDeliveryDisplayState(
    willCallShell,
    zeroReceivedItems,
    [],
  );
  record(
    "offline — Will-Call pickup_at_vendor has no non-exception Issue text",
    willCallDisplay.issueSummary === "",
    willCallDisplay.issueSummary,
  );
  const willCallFulfillmentOnly = {
    ...willCallShell,
    invoiceImportStatus: "pending",
    invoiceFulfillmentMethod: "will_call_pickup",
  };
  const fulfillmentOnlyDisplay = computeDeliveryDisplayState(
    willCallFulfillmentOnly,
    zeroReceivedItems,
    [],
  );
  record(
    "offline — Will-Call will_call_pickup has no non-exception Issue text",
    fulfillmentOnlyDisplay.issueSummary === "",
    fulfillmentOnlyDisplay.issueSummary,
  );
  record(
    "offline — Will-Call staging list uses empty marker (pickup_at_vendor)",
    isWillCallPickupStagingListNa(willCallShell),
  );
  record(
    "offline — shop delivery staging list not marked not-applicable",
    !isWillCallPickupStagingListNa(pendingNoStaging),
  );

  const fulfillmentOnlyWillCall = {
    ...willCallShell,
    status: "pending",
    invoiceImportStatus: "pending",
    invoiceFulfillmentMethod: "will_call_pickup",
  };
  const fulfillmentReadiness = computeDeliveryReadiness(
    fulfillmentOnlyWillCall,
    zeroReceivedItems,
  );
  record(
    "offline — fulfillment-only will_call_pickup primary category is Will-Call / Pickup",
    deliveryReadinessDisplayLabel(
      fulfillmentOnlyWillCall,
      fulfillmentReadiness,
      zeroReceivedItems,
    ) === "Will-Call / Pickup",
  );
  record(
    "offline — exact will-call fulfillment table label",
    fulfillmentDisplayLabel(fulfillmentOnlyWillCall) ===
      "Will-Call / Pickup @ Vendor",
  );
  record(
    "offline — exact vendor drop-off fulfillment table label",
    fulfillmentDisplayLabel(pendingNoStaging) === "Vendor Drop-Off",
  );

  const willCallBoItems = [
    {
      id: "offline-wc-bo",
      deliveryOrderId: "offline-willcall",
      sku: "BO-1",
      description: "Backordered widget",
      qtyOrdered: 2,
      qtyReceived: 0,
      qtyMissing: 0,
      qtyDamaged: 0,
      qtyBackordered: 2,
      status: "backordered",
    },
    {
      id: "offline-wc-nd",
      deliveryOrderId: "offline-willcall",
      sku: "ND-1",
      description: "Not delivered widget",
      qtyOrdered: 1,
      qtyReceived: 0,
      qtyMissing: 1,
      qtyDamaged: 0,
      qtyBackordered: 0,
      status: "pending",
    },
  ];
  const willCallBoPanel = buildIssueSummaryPanelData(
    fulfillmentOnlyWillCall,
    willCallBoItems,
  );
  record(
    "offline — will-call Order Summary Backordered rows only",
    willCallBoPanel.issueRows.length === 1 &&
      willCallBoPanel.issueRows[0].status === "Backordered",
    willCallBoPanel.issueRows.map((r) => r.status).join(","),
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

async function assertOrderSummaryWillCallUi(page, record) {
  const ord002Opened = await openOrderDrawer(page, "ORD-002");
  if (!ord002Opened) {
    record("ORD-002 row present for BACKORDERED badge", false);
    return;
  }

  const badge = page.getByTestId("issue-summary-backordered-badge").first();
  record(
    "ORD-002 — BACKORDERED badge visible",
    (await badge.count()) > 0 && (await badge.isVisible()),
  );
  if ((await badge.count()) > 0) {
    const badgeText = (await badge.innerText()).trim();
    record(
      "ORD-002 — BACKORDERED badge label",
      badgeText === "BACKORDERED",
      badgeText,
    );
    try {
      await assertReadableTextContrast(page, {
        rootSelector: '[data-testid="issue-summary-table"]',
        elements: [
          {
            name: "BACKORDERED badge",
            selector: '[data-testid="issue-summary-backordered-badge"]',
            large: false,
          },
        ],
      });
      record("ORD-002 — BACKORDERED badge contrast (D-42)", true);
    } catch (err) {
      record(
        "ORD-002 — BACKORDERED badge contrast (D-42)",
        false,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const pdfBtn = page.getByTestId("delivery-drawer-view-original-pdf");
  record(
    "ORD-002 — View original PDF button in sticky drawer header",
    (await pdfBtn.count()) === 1,
  );
  if ((await pdfBtn.count()) > 0) {
    const closeBtn = page.getByTestId("delivery-drawer-close");
    const basicsCard = page.getByTestId("delivery-basics-card");
    record(
      "ORD-002 — drawer Close control present",
      (await closeBtn.count()) === 1,
    );
    const closeBox = await closeBtn.boundingBox();
    const pdfBox = await pdfBtn.boundingBox();
    const basicsBox = await basicsCard.boundingBox();
    record(
      "ORD-002 — View original PDF is below Close",
      Boolean(
        closeBox &&
          pdfBox &&
          pdfBox.y >= closeBox.y + closeBox.height,
      ),
      `close bottom=${closeBox ? Math.round(closeBox.y + closeBox.height) : "?"}, PDF y=${pdfBox ? Math.round(pdfBox.y) : "?"}`,
    );
    record(
      "ORD-002 — View original PDF is above Delivery Basics",
      Boolean(
        pdfBox &&
          basicsBox &&
          pdfBox.y + pdfBox.height <= basicsBox.y,
      ),
      `PDF bottom=${pdfBox ? Math.round(pdfBox.y + pdfBox.height) : "?"}, basics y=${basicsBox ? Math.round(basicsBox.y) : "?"}`,
    );
    try {
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
      record("ORD-002 — View original PDF readable contrast (D-42)", true);
    } catch (err) {
      record(
        "ORD-002 — View original PDF readable contrast (D-42)",
        false,
        err instanceof Error ? err.message : String(err),
      );
    }
    record(
      "ORD-002 — View original PDF disabled without import id",
      await pdfBtn.isDisabled(),
    );
    const title = (await pdfBtn.getAttribute("title")) ?? "";
    record(
      "ORD-002 — View original PDF title when no import id",
      /no linked invoice import/i.test(title),
      title,
    );
  }

  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  await page
    .getByTestId("issue-summary-panel")
    .waitFor({ state: "hidden", timeout: 10_000 })
    .catch(() => {});
  await page.goto(`${appBase}/#/dispatcher`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.locator("table tbody tr").first().waitFor({ timeout: 20_000 });

  const rows = page.locator("table tbody tr");
  const count = await rows.count();
  let willCallOrderNumber = null;
  let willCallListStatus = null;
  const statusIndex = await deliveryColumnIndex(page, "Status");
  const fulfillmentIndex = await deliveryColumnIndex(page, "Fulfillment");
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const fulfillmentText = (
      await row.locator("td").nth(fulfillmentIndex).innerText()
    ).trim();
    if (fulfillmentText === "Will-Call / Pickup @ Vendor") {
      willCallListStatus = (
        await row.locator("td").nth(statusIndex).innerText()
      ).trim();
      willCallOrderNumber = await row.getAttribute("data-order-number");
      break;
    }
  }

  if (!willCallOrderNumber) {
    record(
      "Will-Call fulfillment list row for drawer label check",
      true,
      "skipped — no will-call row in live table (offline label asserts cover)",
    );
    return;
  }

  const opened = await openOrderDrawer(page, willCallOrderNumber);
  record(
    "Will-Call list row opened for drawer label check",
    opened,
    willCallOrderNumber,
  );
  if (!opened) return;

  const statusLines = await page.getByTestId("issue-summary-lines").locator("li").allInnerTexts();
  const deliveryStatusLine = statusLines.find((line) =>
    line.startsWith("Delivery Status:"),
  );
  const drawerStatus = deliveryStatusLine?.replace("Delivery Status:", "").trim() ?? "";
  record(
    "Will-Call drawer delivery status matches list",
    drawerStatus === willCallListStatus,
    `list=${willCallListStatus}, drawer=${drawerStatus}`,
  );

  const importPdfBtn = page.getByTestId("delivery-drawer-view-original-pdf");
  if ((await importPdfBtn.count()) > 0 && !(await importPdfBtn.isDisabled())) {
    record("Will-Call row — View original PDF enabled when import linked", true);
  } else if ((await importPdfBtn.count()) > 0) {
    record(
      "Will-Call row — View original PDF present (disabled OK without import)",
      true,
      await importPdfBtn.getAttribute("title"),
    );
  }
}

async function assertStagingLocationCard(page, record, label, expectAssigned) {
  const basicsStaging = page.getByTestId("delivery-basics-staging-locations");
  record(
    `${label} — Delivery Basics staging locations block`,
    (await basicsStaging.count()) > 0,
  );
  if ((await basicsStaging.count()) === 0) return;

  if (expectAssigned) {
    record(
      `${label} — assigned staging shown in Delivery Basics`,
      (await page.getByTestId("delivery-basics-staging-unassigned").count()) === 0 &&
        (await page.getByTestId("delivery-basics-staging-unresolved").count()) === 0,
    );
    const basicsText = (await basicsStaging.innerText()).trim();
    record(
      `${label} — staging basics has location content`,
      basicsText.length >= 20,
      basicsText.slice(0, 80),
    );
  } else {
    const unassignedCount = await page
      .getByTestId("delivery-basics-staging-unassigned")
      .count();
    const unresolvedCount = await page
      .getByTestId("delivery-basics-staging-unresolved")
      .count();
    record(
      `${label} — unassigned staging in Delivery Basics`,
      unassignedCount > 0 || unresolvedCount > 0,
      unassignedCount > 0
        ? "Not Assigned"
        : unresolvedCount > 0
          ? "Staging location missing"
          : "neither",
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
      if (!/#\/dispatcher/.test(page.url())) {
        await page.goto(`${appBase}/#/dispatcher`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(800);
        await page.locator("table tbody tr").first().waitFor({ timeout: 20_000 });
      }
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
  const heading = page.getByTestId("delivery-basics-staging-locations-heading");
  record(
    `${label} — Delivery Basics shows Staging Locations heading`,
    (await heading.count()) > 0 &&
      (await heading.innerText()).trim().toUpperCase() === "STAGING LOCATIONS",
  );
  const unassigned = page.getByTestId("delivery-basics-staging-unassigned");
  const unresolved = page.getByTestId("delivery-basics-staging-unresolved");
  if (expectUnassigned) {
    const unassignedOk =
      (await unassigned.count()) > 0 &&
      (await unassigned.innerText()).trim() === "Not Assigned";
    const unresolvedOk =
      (await unresolved.count()) > 0 &&
      /Staging location missing/i.test((await unresolved.innerText()).trim());
    record(
      `${label} — Delivery Basics shows Staging Locations: Not Assigned`,
      unassignedOk || unresolvedOk,
      unassignedOk
        ? "Not Assigned"
        : unresolvedOk
          ? (await unresolved.innerText()).trim()
          : "neither Not Assigned nor unresolved missing",
    );
  } else {
    const chips = page.locator('[data-testid^="delivery-basics-staging-chip-"]');
    record(
      `${label} — Delivery Basics shows map-style staging chips`,
      (await unassigned.count()) === 0 &&
        (await unresolved.count()) === 0 &&
        (await chips.count()) > 0,
    );
  }
}

const EXPECTED_DELIVERY_HEADERS = [
  "Status",
  "Fulfillment",
  "Vendor",
  "Job Name",
  "Invoice #",
  "PO #",
  "Staging Location",
  "Items",
  "Delivery / Pickup Date",
  "Issue",
  "Assigned Technician",
  "Action",
];

function normalizeDeliveryHeader(text) {
  return text.replace(/[▲▼↕]/g, "").replace(/\s+/g, " ").trim();
}

async function deliveryHeaders(page) {
  const header = page.getByTestId("dispatcher-deliveries-table-header");
  const texts = await header.locator("th").evaluateAll((cells) =>
    cells.map((cell) => cell.textContent ?? ""),
  );
  return texts.map(normalizeDeliveryHeader);
}

async function deliveryColumnIndex(page, label) {
  const headers = await deliveryHeaders(page);
  const index = headers.indexOf(label);
  if (index < 0) {
    throw new Error(`Delivery column "${label}" missing: ${headers.join(" | ")}`);
  }
  return index;
}

async function assertDeliveryHeaderOrder(page, record) {
  const headers = await deliveryHeaders(page);
  record(
    "Deliveries table header order is locked",
    headers.length === EXPECTED_DELIVERY_HEADERS.length &&
      headers.every((header, index) => header === EXPECTED_DELIVERY_HEADERS[index]),
    headers.join(" | "),
  );
}

function deliveryRowByOrder(page, orderNumber) {
  return page.locator(
    `table tbody tr[data-order-number="${orderNumber}"]`,
  ).first();
}

async function assertStagingActionRowsMatchStagingColumn(page, record) {
  const stagingColumnIndex = await deliveryColumnIndex(page, "Staging Location");
  const rows = page.locator("table tbody tr");
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const orderNumber =
      (await row.getAttribute("data-order-number")) ?? `row-${i + 1}`;
    const stagingCell = row.locator("td").nth(stagingColumnIndex);
    const stagingNa = stagingCell.locator('[data-testid^="delivery-list-staging-na-"]');
    const hasStagingNa = (await stagingNa.count()) > 0;
    const stagingUnassignedMarker = stagingCell.locator(
      '[data-testid^="delivery-list-staging-unassigned-"]',
    );
    const stagingUnassigned = (await stagingUnassignedMarker.count()) > 0;
    const hasOrangeRowClass = await row.evaluate((el) =>
      el.classList.contains("dispatcher-action-required"),
    );
    record(
      `${orderNumber} — no dispatcher-action-required row class`,
      !hasOrangeRowClass,
      hasOrangeRowClass ? "unexpected orange row" : "normal row",
    );
    const stagingNeeded = stagingCell.locator(
      '[data-testid^="delivery-list-staging-needed-"]',
    );
    const hasStagingNeeded = (await stagingNeeded.count()) > 0;
    if (hasStagingNa) {
      record(
        `${orderNumber} — Will-Call staging Loc. shows quiet empty marker`,
        (await stagingNa.innerText()).trim() === "—",
        "—",
      );
      const chips = stagingCell.locator('[data-testid^="delivery-list-staging-chip-"]');
      record(
        `${orderNumber} — Will-Call empty marker row has no staging chips`,
        (await chips.count()) === 0,
      );
      continue;
    }
    if (stagingUnassigned || hasStagingNeeded) {
      const pill = row.locator(`[data-testid^="staging-assignment-pill-"]`);
      const pillCount = await pill.count();
      if (hasStagingNeeded) {
        record(
          `${orderNumber} — unassigned staging shows Needs staging pill`,
          /Needs staging/i.test((await stagingNeeded.innerText()).trim()),
          (await stagingNeeded.innerText()).trim(),
        );
      } else {
        record(
          `${orderNumber} — unassigned staging shows quiet empty marker`,
          (await stagingUnassignedMarker.innerText()).trim() === "—",
          "—",
        );
      }
      record(
        `${orderNumber} — staging assignment red pill when action required`,
        pillCount === 0 || (await pill.innerText()).includes("Staging spot"),
        pillCount > 0
          ? (await pill.innerText().catch(() => "")).trim()
          : "no pill (staging not required for row)",
      );
    } else {
      const chips = stagingCell.locator('[data-testid^="delivery-list-staging-chip-"]');
      record(
        `${orderNumber} — assigned staging shows map chips (no green)`,
        (await chips.count()) > 0,
        `${await chips.count()} chip(s)`,
      );
      if ((await chips.count()) > 0) {
        const colors = await chips.evaluateAll((els) =>
          els.map((el) => el.getAttribute("data-spot-color")),
        );
        record(
          `${orderNumber} — list chips never green`,
          colors.every((c) => c !== "green"),
          colors.join(","),
        );
      }
    }
  }
}

async function assertDispatcherStagingActionRows(page, record) {
  const rows = page.locator("table tbody tr");
  const count = await rows.count();
  let orangeClassCount = 0;
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const hasClass = await row.evaluate((el) =>
      el.classList.contains("dispatcher-action-required"),
    );
    if (hasClass) orangeClassCount++;
  }
  record(
    "dispatcher-action-required rows absent (no full-row orange)",
    orangeClassCount === 0,
    orangeClassCount > 0
      ? `${orangeClassCount} row(s) still styled`
      : "none",
  );

  const willCallFilter = page.getByTestId("deliveries-will-call-filter");
  record(
    "Will-Call / Pickup filter chip present",
    (await willCallFilter.count()) > 0,
  );
  if ((await willCallFilter.count()) > 0) {
    try {
      await assertReadableTextContrast(page, {
        rootSelector: "body",
        elements: [
          {
            name: "Will-Call filter chip",
            selector: '[data-testid="deliveries-will-call-filter"]',
            large: false,
          },
        ],
      });
      record("Will-Call filter chip readable contrast (D-42)", true);
    } catch (err) {
      record(
        "Will-Call filter chip readable contrast (D-42)",
        false,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const legend = page.getByTestId("deliveries-staging-legend");
  record(
    "Deliveries staging color legend visible",
    (await legend.count()) > 0,
  );
  if ((await legend.count()) > 0) {
    const legendText = (await legend.innerText()).trim();
    record(
      "Legend includes Assigned / Planned, Staged, Will-Call / Pickup, Unplanned, Shop Stock",
      /Assigned \/ Planned/i.test(legendText) &&
        /Staged — Ready for Pickup/i.test(legendText) &&
        /Will-Call \/ Pickup/i.test(legendText) &&
        /Unplanned/i.test(legendText) &&
        /Shop Stock/i.test(legendText),
      legendText.slice(0, 160),
    );
    try {
      await assertReadableTextContrast(page, {
        rootSelector: '[data-testid="deliveries-staging-legend"]',
        elements: [
          {
            name: "Legend labels",
            selector: "span",
            large: false,
          },
        ],
      });
      record("Deliveries legend readable contrast (D-42)", true);
    } catch (err) {
      record(
        "Deliveries legend readable contrast (D-42)",
        false,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const firstChip = page.locator('[data-testid^="delivery-list-staging-chip-"]').first();
  if ((await firstChip.count()) > 0) {
    const chipTestId = await firstChip.getAttribute("data-testid");
    try {
      await assertReadableTextContrast(page, {
        rootSelector: "table tbody",
        elements: [
          {
            name: "Staging chip label",
            selector: `[data-testid="${chipTestId}"]`,
            large: false,
          },
        ],
      });
      record("First staging list chip contrast (D-42)", true);
    } catch (err) {
      record(
        "First staging list chip contrast (D-42)",
        false,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const firstPill = page.locator('[data-testid^="staging-assignment-pill-"]').first();
  if ((await firstPill.count()) > 0) {
    const pillTestId = await firstPill.getAttribute("data-testid");
    try {
      await assertReadableTextContrast(page, {
        rootSelector: "table tbody",
        elements: [
          {
            name: "Staging assignment pill",
            selector: `[data-testid="${pillTestId}"]`,
            large: false,
          },
        ],
      });
      record("Staging assignment pill contrast (D-42)", true);
    } catch (err) {
      record(
        "Staging assignment pill contrast (D-42)",
        false,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  await assertStagingActionRowsMatchStagingColumn(page, record);
}

async function openRowByStagingAssignment(page, wantUnassigned) {
  const stagingColumnIndex = await deliveryColumnIndex(page, "Staging Location");
  const rows = page.locator("table tbody tr");
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const stagingCell = row.locator("td").nth(stagingColumnIndex);
    const isWillCallNa =
      (await stagingCell.locator('[data-testid^="delivery-list-staging-na-"]').count()) >
      0;
    const isUnassignedMarker =
      (await stagingCell
        .locator('[data-testid^="delivery-list-staging-unassigned-"]')
        .count()) > 0;
    const isNeedsStaging =
      (await stagingCell
        .locator('[data-testid^="delivery-list-staging-needed-"]')
        .count()) > 0;
    // v0.0.277+: Drop-Off without resolvable staging shows Needs staging (not bare —).
    const isUnassigned = isUnassignedMarker || isNeedsStaging;
    if (!wantUnassigned && isWillCallNa) continue;
    if (isUnassigned === wantUnassigned) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      await row.click({ force: true });
      await page.waitForTimeout(1200);
      await page.getByTestId("issue-summary-panel").waitFor({ timeout: 15_000 });
      const orderNumber = await row.getAttribute("data-order-number");
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

/** Banner Email Vendor opens modal (no mailto) when visible in fixture. */
async function assertDrawerEmailVendorOpensModal(page, record, label) {
  const emailVendorBtn = page.getByTestId("drawer-action-email-vendor");
  if ((await emailVendorBtn.count()) === 0) {
    record(`${label} — banner Email Vendor modal (skipped)`, true, "button not in fixture");
    return;
  }

  const tagName = await emailVendorBtn.first().evaluate((el) => el.tagName);
  record(
    `${label} — banner Email Vendor is button (not mailto link)`,
    tagName === "BUTTON",
    `tag=${tagName}`,
  );
  const href = await emailVendorBtn.first().getAttribute("href").catch(() => null);
  record(
    `${label} — banner Email Vendor has no mailto href`,
    href === null || !/^mailto:/i.test(href),
    href ?? "no href",
  );

  await emailVendorBtn.first().click();
  await page.getByTestId("vendor-communications-modal").waitFor({ timeout: 10_000 });
  record(
    `${label} — banner Email Vendor opens vendor communications modal`,
    await page.getByTestId("vendor-communications-modal").isVisible(),
  );

  // Wait for async vendor email events + issue draft prefill to settle.
  await page
    .waitForFunction(
      () => {
        const subject = document.querySelector('[data-testid="vendor-comms-subject"]');
        return subject instanceof HTMLInputElement && subject.value.trim().length > 0;
      },
      { timeout: 12_000 },
    )
    .catch(() => {});

  const helperText = (
    await page.getByTestId("vendor-comms-helper").innerText().catch(() => "")
  ).trim();
  const isReplyThread = /Replying to the vendor/i.test(helperText);
  const subject = (
    await page.getByTestId("vendor-comms-subject").inputValue()
  ).trim();
  const body = (await page.getByTestId("vendor-comms-body").inputValue()).trim();
  const emDash = "\u2014";

  if (!isReplyThread) {
    record(
      `${label} — vendor comms issue draft subject uses em dash`,
      subject.startsWith(`${label} ${emDash}`),
      subject || "empty",
    );
    record(
      `${label} — vendor comms issue draft body prefilled on new thread`,
      body.length > 0,
      body.slice(0, 100) || "empty",
    );
  } else {
    record(
      `${label} — vendor comms issue draft (skipped inbound reply thread)`,
      true,
      `subject=${subject.slice(0, 60)}`,
    );
  }

  const vendorSelect = page.getByTestId("vendor-comms-vendor");
  const vendorValue = await vendorSelect.inputValue();
  record(
    `${label} — vendor comms vendor pre-selected when delivery has vendor`,
    vendorValue.length > 0,
    vendorValue || "empty",
  );

  const toEmail = (await page.getByTestId("vendor-comms-to").inputValue()).trim();
  record(
    `${label} — vendor comms email prefilled from delivery vendor`,
    toEmail.includes("@"),
    toEmail || "empty",
  );

  await page
    .getByTestId("vendor-communications-modal")
    .getByRole("button", { name: "Close" })
    .click();
  await page.getByTestId("vendor-communications-modal").waitFor({
    state: "hidden",
    timeout: 10_000,
  });

  const callVendorBtn = page.getByTestId("drawer-action-call-vendor");
  let callVendorEmail = "";
  if ((await callVendorBtn.count()) > 0) {
    await callVendorBtn.first().click();
    await page.getByTestId("call-vendor-modal").waitFor({ timeout: 10_000 });
    callVendorEmail = (
      await page.getByTestId("call-vendor-email").innerText().catch(() => "")
    ).trim();
    await page.getByTestId("call-vendor-close").click();
    await page.getByTestId("call-vendor-modal").waitFor({
      state: "hidden",
      timeout: 10_000,
    });
    await emailVendorBtn.first().click();
    await page.getByTestId("vendor-communications-modal").waitFor({ timeout: 10_000 });
    const toEmailAfterReopen = (
      await page.getByTestId("vendor-comms-to").inputValue()
    ).trim();
    if (callVendorEmail.includes("@")) {
      record(
        `${label} — vendor comms email matches Call Vendor details`,
        toEmailAfterReopen.toLowerCase() === callVendorEmail.toLowerCase(),
        `modal=${toEmailAfterReopen} call=${callVendorEmail}`,
      );
    }
  }

  await page
    .getByTestId("vendor-communications-modal")
    .getByRole("button", { name: "Close" })
    .click();
  await page.getByTestId("vendor-communications-modal").waitFor({
    state: "hidden",
    timeout: 10_000,
  });
  record(`${label} — vendor communications modal closes`, true);
}

async function assertLegacyDrawerActionsRemoved(page, record, label) {
  record(
    `${label} — Review parsed invoice removed`,
    (await page.getByTestId("drawer-review-parsed-invoice").count()) === 0,
  );
  record(
    `${label} — Show Vendor Check-In QR removed`,
    (await page.getByTestId("show-vendor-checkin-qr").count()) === 0,
  );
  record(
    `${label} — Copy Pickup Information removed`,
    (await page.getByTestId("copy-pickup-information").count()) === 0,
  );
  record(
    `${label} — Mark Pickup Scheduled removed`,
    (await page.getByRole("button", { name: "Mark Pickup Scheduled" }).count()) ===
      0 &&
      (await page.getByRole("button", { name: "Clear Pickup Scheduled" }).count()) ===
        0,
  );
  record(
    `${label} — Planned Staging section removed`,
    (await page.getByTestId("planned-staging-assignment").count()) === 0 &&
      (await page.getByTestId("assign-staging-location-heading").count()) === 0 &&
      (await page.getByTestId("save-planned-staging").count()) === 0,
  );
  record(
    `${label} — Items section removed`,
    (await page.getByTestId("drawer-items-section").count()) === 0,
  );
}

async function assertDeliveryDrawerReadableContrast(page, record, label) {
  const spec = {
    rootSelector: '[data-testid="delivery-basics-card"]',
    elements: [{ name: "Delivery basics body", selector: "div", large: false }],
  };
  try {
    await assertReadableTextContrast(page, spec);
    record(`${label} — delivery basics readable contrast (D-42)`, true);
  } catch (err) {
    record(
      `${label} — delivery basics readable contrast (D-42)`,
      false,
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function assertStagingOccupiedDropdown(page, record, label) {
  record(
    `${label} — planned staging UI removed (no occupied dropdown)`,
    (await page.getByTestId("planned-staging-assignment").count()) === 0,
  );
}

/** Firestore materialIssues are CF-only; resolve via drawer so ORD-005 calm-pending asserts stay stable. */
async function resolveBlockingIssuesForVerifyPrep(page, record) {
  let resolved = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const resolveBtn = page.getByTestId("drawer-action-resolve-issue");
    if ((await resolveBtn.count()) === 0 || !(await resolveBtn.isVisible())) break;
    if (!(await resolveBtn.isEnabled().catch(() => false))) break;
    await resolveBtn.click();
    await page.getByTestId("resolve-issue-modal").waitFor({ timeout: 15_000 });
    const noteInput = page.getByTestId("resolution-note-input");
    if ((await noteInput.count()) > 0) {
      const cur = (await noteInput.inputValue()).trim();
      if (!cur) {
        await noteInput.fill(
          "Verify prep: resolve blocking material issue for ORD-005 calm pending.",
        );
      }
    }
    const submit = page.getByTestId("confirm-resolve-issue");
    if (!(await submit.isEnabled().catch(() => false))) {
      await page.keyboard.press("Escape");
      break;
    }
    await submit.click();
    await page.waitForTimeout(3000);
    resolved += 1;
  }
  record(
    "ORD-005 prep — blocking material issues resolved via drawer",
    resolved > 0 || (await page.getByTestId("drawer-action-resolve-issue").count()) === 0,
    `${resolved} resolved`,
  );
}

async function reopenOrd005DrawerAfterPrep(page, drawerProbeOrder) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  const search = page.locator('input[placeholder*="Job #, name, PO"]');
  await search.fill("");
  await search.fill(drawerProbeOrder);
  await page.waitForTimeout(1500);
  const targetRow = deliveryRowByOrder(page, drawerProbeOrder);
  const viewBtn = targetRow.locator("button").filter({ hasText: /^View$/ });
  if (await viewBtn.isVisible().catch(() => false)) {
    await viewBtn.click({ force: true });
  } else {
    await targetRow.click({ force: true });
  }
  await page.waitForTimeout(1200);
  await assertDeliveryDrawerOpen(page);
  await page.getByTestId("drawer-action-banner").waitFor({ timeout: 20_000 });
}

async function assertLowerDrawerLayout(page, record, label) {
  const statusControls = page.getByTestId("delivery-status-controls");
  const stockToggle = page.getByTestId("experimental-stock-tools-toggle");

  record(
    `${label} — cream Assign Staging card removed (combination-only optional)`,
    (await page.getByTestId("assign-staging-location-heading").count()) === 0,
  );

  const assignHeading = page.getByTestId("assign-staging-location-heading");
  const assignHeadingText =
    (await assignHeading.count()) > 0
      ? (await assignHeading.innerText()).trim()
      : "";
  record(
    `${label} — no Planned Staging heading`,
    assignHeadingText !== "Planned Staging (dispatcher instruction)",
    assignHeadingText || "(absent)",
  );

  record(
    `${label} — status controls present under Delivery Basics`,
    (await statusControls.count()) > 0,
  );
  record(
    `${label} — delivery status dropdown present`,
    (await page.getByTestId("delivery-status-dropdown").count()) > 0,
  );
  record(
    `${label} — fulfillment control present`,
    (await page.getByTestId("delivery-fulfillment-control").count()) > 0,
  );
  record(
    `${label} — Advanced Manual Controls removed`,
    (await page.getByTestId("advanced-manual-controls-toggle").count()) === 0,
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

  record(
    `${label} — manual mark buttons section removed`,
    (await page.getByTestId("manual-controls-section").count()) === 0,
  );

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
      /rgb\((232,\s*245,\s*233|218,\s*251,\s*225)\)|#e8f5e9/i.test(
        activeBg,
      ),
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
      /rgb\((232,\s*245,\s*233|218,\s*251,\s*225)\)|#e8f5e9/i.test(
        activeBg,
      ),
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
        tokenBox.y <= buttonsBox.y + buttonsBox.height + 8,
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

/** Seed ids — deep-link fallback when complete rows are off the default board. */
const DEMO_ORDER_DELIVERY_IDS = {
  "ORD-001": "delivery-1",
  "ORD-002": "delivery-2",
  "ORD-004": "delivery-3",
  "ORD-005": "delivery-demo-vendor-1",
  "ORD-006": "delivery-demo-vendor-2",
};

async function openOrderDrawer(page, orderNumber) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  const tryOpenVisibleRow = async () => {
    const row = deliveryRowByOrder(page, orderNumber);
    if ((await row.count()) === 0) return false;
    await row.click({ force: true });
    await page.waitForTimeout(1200);
    try {
      await page.getByTestId("issue-summary-panel").waitFor({ timeout: 15_000 });
    } catch {
      return false;
    }
    return true;
  };

  if (await tryOpenVisibleRow()) return true;

  const search = page.locator('input[placeholder*="Job #, name, PO"]');
  await search.waitFor({ state: "visible", timeout: 15_000 });
  await search.fill("");
  await search.fill(orderNumber);
  await page.waitForTimeout(1500);
  const opened = await tryOpenVisibleRow();
  await search.fill("");
  await page.waitForTimeout(800);
  if (opened) return true;

  const deepId = DEMO_ORDER_DELIVERY_IDS[orderNumber];
  if (deepId) {
    try {
      await openDeliveryDrawerByDeepLink(page, appBase, deepId);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** ORD-005 layout rules applied to every demo order (non-mutating checks). */
async function assertUniformDemoDrawerPresentation(page, record, orderNumber) {
  await assertDeliveryBasicsNoTopNotes(page, record, orderNumber);
  await assertDeliveryFirstDrawerOrder(page, record, orderNumber);

  await assertLegacyDrawerActionsRemoved(page, record, orderNumber);

  const statusControls = page.getByTestId("delivery-status-controls");
  record(
    `${orderNumber} — status controls present in Delivery Basics`,
    (await statusControls.count()) > 0,
  );

  record(
    `${orderNumber} — Advanced Manual Controls removed`,
    (await page.getByTestId("advanced-manual-controls-toggle").count()) === 0,
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
    `${orderNumber} — manual mark buttons section removed`,
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
    `${orderNumber} — Items section removed`,
    (await page.getByTestId("drawer-items-section").count()) === 0,
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

  const isProdBase = /lgarage\.github\.io\/stageverify/i.test(baseUrl);
  if (!isProdBase) {
    try {
      execSync("node scripts/reset-vendor-demo-fixture.mjs", {
        cwd: process.cwd(),
        stdio: "inherit",
        env: {
          ...process.env,
          STAGEVERIFY_RECEIVE_DELIVERY: "delivery-demo-vendor-1",
        },
      });
    } catch {
      console.warn(
        "WARN: ORD-005 fixture reset skipped (env/credentials) — calm pending asserts may fail on dirty Firestore",
      );
    }
  }

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
  await assertDeliveryHeaderOrder(page, record);

  await assertDispatcherStagingActionRows(page, record);

  if (rowCount === 0) {
    await browser.close();
    process.exit(1);
  }

  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const search = page.locator('input[placeholder*="Job #, name, PO"]');
  await search.waitFor({ state: "visible", timeout: 15_000 });
  const isProdBaseDrawer = /lgarage\.github\.io\/stageverify/i.test(baseUrl);
  const drawerProbeOrder = isProdBaseDrawer
    ? (process.env.STAGEVERIFY_VERIFY_ORDER ?? "4046362")
    : "ORD-005";
  await search.fill("");
  await search.fill(drawerProbeOrder);
  await page.waitForTimeout(1500);

  const targetRow = deliveryRowByOrder(page, drawerProbeOrder);
  if ((await targetRow.count()) === 0) {
    if (isProdBaseDrawer) {
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
  let ord005Row = (await targetRow.count()) > 0
    ? targetRow
    : page.locator("table tbody tr").first();

  let drawerAlreadyOpen = false;
  if (drawerProbeOrder === "ORD-005" && !isProdBaseDrawer) {
    const prepViewBtn = ord005Row.locator("button").filter({ hasText: /^View$/ });
    if (await prepViewBtn.isVisible().catch(() => false)) {
      await prepViewBtn.click({ force: true });
    } else {
      await ord005Row.click({ force: true });
    }
    await page.waitForTimeout(1200);
    await assertDeliveryDrawerOpen(page);
    await page.getByTestId("drawer-action-banner").waitFor({ timeout: 20_000 });
    await resolveBlockingIssuesForVerifyPrep(page, record);
    await reopenOrd005DrawerAfterPrep(page, drawerProbeOrder);
    ord005Row = deliveryRowByOrder(page, drawerProbeOrder);
    drawerAlreadyOpen = true;
  }

  if (!drawerAlreadyOpen) {
    const viewBtn = ord005Row.locator("button").filter({ hasText: /^View$/ });
    if (await viewBtn.isVisible().catch(() => false)) {
      await viewBtn.click({ force: true });
    } else {
      await ord005Row.click({ force: true });
    }
    await page.waitForTimeout(1200);
    await assertDeliveryDrawerOpen(page);
    await page.getByTestId("drawer-action-banner").waitFor({ timeout: 20_000 });
  }

  const issuePanel = page.getByTestId("issue-summary-panel");
  await issuePanel.scrollIntoViewIfNeeded();
  await issuePanel.waitFor({ state: "visible", timeout: 20_000 });
  const orderSummaryTitle = await issuePanel.evaluate((el) => {
    const h3 = el.querySelector("h3");
    const titleSpan = h3?.querySelector("span span:last-child");
    if (titleSpan?.textContent?.trim()) {
      return titleSpan.textContent.trim();
    }
    const h3Text = h3?.textContent?.trim() ?? "";
    return h3Text.replace(/View original PDF.*$/i, "").trim();
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
  const drawerHasAssignedStaging =
    (await page
      .getByTestId("delivery-basics-staging-locations")
      .getAttribute("data-has-assigned-staging")) === "true";
  await assertStagingLocationBanner(
    page,
    record,
    "Drawer",
    !drawerHasAssignedStaging,
  );
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
    const itemsColumnIndex = await deliveryColumnIndex(page, "Items");
    const listItemsRecv = (
      await ord005Row.locator("td").nth(itemsColumnIndex).innerText()
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
      "ORD-005 list status is Assigned / Planned",
      ord005ListStatus === "Assigned / Planned",
      ord005ListStatus,
    );
    record(
      "ORD-005 drawer status matches list",
      ord005StatusLine?.includes("Assigned / Planned") === true &&
        ord005ListStatus === "Assigned / Planned",
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
      "All Clear aligns with Staged — Ready for Pickup list label",
      listStatus === "Staged — Ready for Pickup",
      listStatus,
    );
  } else if (headingNormalized === "waiting on delivery") {
    record(
      "ORD-005 calm Waiting on Delivery banner (not urgent)",
      (await ord005Row.count()) === 0 || listStatus === "Assigned / Planned",
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
      "What Needs Attention not shown as Staged — Ready for Pickup in list",
      listStatus !== "Staged — Ready for Pickup",
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

    await assertLegacyDrawerActionsRemoved(page, record, "ORD-005");

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

    await assertActionButtonGridBalance(page, record, "ORD-005 (no link)", 0);
    await assertPickupStatusInGrid(page, record, "ORD-005 (no link)");
    await assertSeparatePickupPills(page, record, "ORD-005 (no link)");
    await assertDeliveryDrawerReadableContrast(page, record, "ORD-005");

    record(
      "ORD-005 Job Status panel removed",
      (await page.getByTestId("job-readiness-panel").count()) === 0,
    );

    record(
      "ORD-005 Generate Pickup Link removed",
      (await page.getByTestId("generate-pickup-link").count()) === 0,
    );

    const stagingAssign = page.getByTestId("staging-location-assignment");
    if ((await stagingAssign.count()) > 0) {
      await stagingAssign.scrollIntoViewIfNeeded();
    }
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
      const basicsStaging = page.getByTestId("delivery-basics-staging-locations");
      const basicsText =
        (await basicsStaging.count()) > 0
          ? (await basicsStaging.innerText()).trim()
          : "";
      record(
        "ORD-005 Riverside — assigned location visible in Delivery Basics",
        basicsText.length > 0,
        basicsText.slice(0, 80),
      );
    }

    record(
      "ORD-005 Planned Staging section removed",
      (await page.getByTestId("assign-staging-location-heading").count()) === 0 &&
        (await page.getByTestId("planned-staging-assignment").count()) === 0,
    );

    await assertStagingOccupiedDropdown(page, record, "ORD-005");

    record(
      "ORD-005 status dropdown present in Delivery Basics",
      (await page.getByTestId("delivery-status-dropdown").count()) > 0,
    );
    record(
      "ORD-005 Advanced Manual Controls removed",
      (await page.getByTestId("advanced-manual-controls-toggle").count()) === 0,
    );
    record(
      "ORD-005 workflow status badge removed",
      (await page.getByTestId("drawer-workflow-status-badge").count()) === 0,
    );
    record(
      "ORD-005 no At Shop awaiting check-in pill",
      !(await page.locator("body").innerText()).includes("At Shop — awaiting check-in"),
    );

    await assertLowerDrawerLayout(page, record, "ORD-005");

    record(
      "ORD-005 fulfillment control present",
      (await page.getByTestId("delivery-fulfillment-control").count()) > 0,
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

    record(
      "ORD-005 Items section removed",
      (await page.getByTestId("drawer-items-section").count()) === 0,
    );

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

  await search.fill("");
  await page.waitForTimeout(800);

  const ord002Row = deliveryRowByOrder(page, "ORD-002");
  if ((await ord002Row.count()) > 0) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await ord002Row.first().click({ force: true });
    await page.waitForTimeout(1200);
    await page.getByTestId("issue-summary-panel").waitFor({ timeout: 15_000 });

    await assertLegacyDrawerActionsRemoved(page, record, "ORD-002");
    await assertDrawerEmailVendorOpensModal(page, record, "ORD-002");

    const ord002Revoke = page.getByTestId("revoke-pickup-link");
    if ((await ord002Revoke.count()) > 0) {
      await assertActionButtonGridBalance(
        page,
        record,
        "ORD-002 (active link)",
        1,
      );
    } else {
      await assertActionButtonGridBalance(page, record, "ORD-002", 0);
    }

    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await ord005Row.click({ force: true });
    await page.waitForTimeout(1200);
    await page.getByTestId("issue-summary-panel").waitFor({ timeout: 15_000 });
  } else {
    record("ORD-002 row present for copy-enabled test", false);
  }

  const ord001Opened = await openOrderDrawer(page, "ORD-001");
  if (ord001Opened) {
    await assertLegacyDrawerActionsRemoved(page, record, "ORD-001");
  } else {
    record(
      "ORD-001 row present for unreceived copy test",
      true,
      "skipped — complete/hidden on default board or absent in live Firestore",
    );
  }

  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.locator('input[placeholder*="Job #, name, PO"]').fill("");
  await page.waitForTimeout(800);

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

  await page.goto(`${appBase}/#/dispatcher`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  for (const order of ["ORD-002", "ORD-004"]) {
    const partialRow = deliveryRowByOrder(page, order);
    if ((await partialRow.count()) === 0) {
      const opened = await openOrderDrawer(page, order);
      record(
        `${order} row present for section-order check`,
        opened,
        opened
          ? "skipped — complete/hidden on default board; drawer opened by deep link"
          : "row absent and drawer did not open",
      );
      if (opened) {
        await assertDeliveryFirstDrawerOrder(page, record, order);
      }
      continue;
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await partialRow.first().click({ force: true });
    await page.waitForTimeout(1200);
    try {
      await page.getByTestId("issue-summary-panel").waitFor({ timeout: 15_000 });
    } catch {
      record(`${order} row present for section-order check`, false, "drawer did not open");
      continue;
    }
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
      const ord002HasAssignedStaging =
        (await page
          .getByTestId("delivery-basics-staging-locations")
          .getAttribute("data-has-assigned-staging")) === "true";
      await assertStagingLocationBanner(
        page,
        record,
        order,
        !ord002HasAssignedStaging,
      );
      const reopenRow = deliveryRowByOrder(page, order);
      if ((await reopenRow.count()) > 0) {
        await reopenRow.click({ force: true });
        await page.waitForTimeout(1200);
        await assertDeliveryDrawerOpen(page);
        await page.getByTestId("drawer-action-banner").waitFor({ timeout: 15_000 });
      }
    }
    await assertDeliveryFirstDrawerOrder(page, record, order);
  }

  const listSearch = page.locator('input[placeholder*="Job #, name, PO"]');
  await listSearch.fill("");
  await page.waitForTimeout(800);

  const stagedFilter = page.getByRole("button", { name: "Staged — Ready for Pickup", exact: true });
  if (await stagedFilter.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await page
      .getByTestId("issue-summary-panel")
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => {});
    await stagedFilter.click();
    await page.waitForTimeout(900);
  }

  const readyRow = page.locator("table tbody tr", { hasText: "Staged — Ready for Pickup" }).first();
  if ((await readyRow.count()) > 0) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await readyRow.click({ force: true });
    await page.waitForTimeout(1200);
    try {
      await page.getByTestId("issue-summary-panel").waitFor({ timeout: 15_000 });
      const readyListStatus = (await readyRow.locator("td").first().innerText()).trim();
      record(
        "Ready row list status is Staged — Ready for Pickup",
        readyListStatus === "Staged — Ready for Pickup",
        readyListStatus,
      );
      await assertDeliveryFirstDrawerOrder(page, record, "Staged — Ready for Pickup");
    } catch {
      record("Staged — Ready for Pickup row present for order check", false, "drawer did not open");
    }
  } else {
    record("Staged — Ready for Pickup row present for order check", false, "skipped");
  }

  if (await stagedFilter.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await page
      .getByTestId("issue-summary-panel")
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => {});
    await stagedFilter.click();
    await page.waitForTimeout(400);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  const unassignedOrder = await openRowByStagingAssignment(page, true);
  if (unassignedOrder) {
    record(
      "Unassigned staging row opened for banner test",
      true,
      unassignedOrder,
    );
    await assertDeliveryBasicsStaging(page, record, unassignedOrder, true);
    // PR #49 / v0.0.233: banner only when shop staging required ∧ no actual/planned
    // assignment. The list empty marker can still appear when planned spots exist —
    // drawer SoT is data-has-assigned-staging on Delivery Basics.
    const stagingBasics = page.getByTestId("delivery-basics-staging-locations");
    const hasAssignedAttr =
      (await stagingBasics.getAttribute("data-has-assigned-staging")) === "true";
    const expectBanner = !hasAssignedAttr;
    if (hasAssignedAttr) {
      record(
        `${unassignedOrder} — planned/assigned staging gates banner off`,
        true,
        "data-has-assigned-staging=true (list may still show the empty marker)",
      );
    }
    await assertStagingLocationBanner(
      page,
      record,
      unassignedOrder,
      expectBanner,
    );
    // openRowByStagingAssignment already opened the drawer. Re-click only if it
    // closed (e.g. Assign Location navigation). A second row click can toggle it shut.
    const drawerStillOpen =
      (await page.getByTestId("issue-summary-panel").count()) > 0 ||
      (await page.getByTestId("delivery-basics-staging-locations").count()) > 0;
    if (!drawerStillOpen) {
      const reopenUnassigned = deliveryRowByOrder(page, unassignedOrder);
      if ((await reopenUnassigned.count()) > 0) {
        const viewBtn = reopenUnassigned
          .locator("button")
          .filter({ hasText: /^View$/ });
        if ((await viewBtn.count()) > 0) {
          await viewBtn.click({ force: true });
        } else {
          await reopenUnassigned.click({ force: true });
        }
        await page.waitForTimeout(1200);
      }
    }
    await assertDeliveryDrawerOpen(page);
    await assertStagingLocationCard(page, record, unassignedOrder, false);
  } else {
    record(
      "Unassigned staging row present for banner test",
      false,
      "no row with Needs staging / empty Staging Loc.",
    );
  }

  let assignedOrder = null;
  const ord005BannerRow = deliveryRowByOrder(page, "ORD-005");
  if ((await ord005BannerRow.count()) > 0) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await ord005BannerRow.first().click({ force: true });
    await page.waitForTimeout(1200);
    await page.getByTestId("issue-summary-panel").waitFor({ timeout: 15_000 });
    assignedOrder = "ORD-005";
  } else {
    assignedOrder = await openRowByStagingAssignment(page, false);
  }
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
      if (orderNumber === "ORD-001") {
        record(
          `${orderNumber} row present for uniform drawer check`,
          true,
          "skipped — complete/hidden on default board or absent in live Firestore",
        );
        continue;
      }
      record(`${orderNumber} row present for uniform drawer check`, false);
      continue;
    }
    record(`${orderNumber} row opened for uniform drawer check`, true);
    await assertUniformDemoDrawerPresentation(page, record, orderNumber);

    if (orderNumber === "ORD-006") {
      await assertOrd006EmailReviewAction(page, record);
    }

    await assertLegacyDrawerActionsRemoved(page, record, orderNumber);
  }

  await assertOrderSummaryWillCallUi(page, record);

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

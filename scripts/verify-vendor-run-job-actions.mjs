/**
 * Company-run vendor job-detail actions (mocked callables).
 * No live PIN or Firestore writes. Phone viewport 390×844.
 *
 * Usage:
 *   npm run dev
 *   node scripts/verify-vendor-run-job-actions.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  assertReadableTextContrast,
  VENDOR_RUN_COMPLETED_DELIVERIES_CONTRAST_SPEC,
  VENDOR_RUN_DELIVERED_ROW_CONTRAST_SPEC,
  VENDOR_RUN_LAYOUT_CONTRAST_SPEC,
  VENDOR_RUN_PARTIAL_ROW_CONTRAST_SPEC,
} from "./lib/ui-text-contrast-lib.mjs";

const baseUrl = process.env.STAGEVERIFY_BASE_URL ?? "http://127.0.0.1:5173";
const appBase = resolveAppBase(baseUrl);
const outDir = resolve(process.cwd(), "screenshots", "vendor-run-job-actions");
mkdirSync(outDir, { recursive: true });

const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
}

async function enterPin(page, digits) {
  for (const digit of digits) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
}

function parseCallablePostData(route) {
  try {
    return JSON.parse(route.request().postData() ?? "{}");
  } catch {
    return {};
  }
}

async function fulfillCallableWarmupInvalidArgument(route) {
  await route.fulfill({
    status: 400,
    contentType: "application/json",
    body: JSON.stringify({
      error: {
        message: "invalid-argument",
        status: "INVALID_ARGUMENT",
      },
    }),
  });
}

(async () => {
  const hoursAgoIso = (hours) =>
    new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  let vendorRunRows = [
    {
      deliveryId: "verify-run-active-a",
      jobId: "job-a",
      jobName: "Riverside Medical Center",
      orderNumber: "ORDER-100",
      vendorInvoiceNumber: "INV-100",
      poNumber: "PO-100",
      stagingLocationCodes: ["G2"],
      hasAssignableSpot: true,
      vendorPhysicalDropoffConfirmed: false,
      items: [{ id: "item-a", description: "Air handler", qtyOrdered: 1 }],
    },
    {
      deliveryId: "verify-run-delivered-b",
      jobId: "job-b",
      jobName: "Oak Street Offices",
      orderNumber: "ORDER-200",
      vendorInvoiceNumber: "INV-200",
      poNumber: "PO-200",
      stagingLocationCodes: ["S1-A"],
      hasAssignableSpot: true,
      vendorPhysicalDropoffConfirmed: true,
      vendorPhysicalDropoffConfirmedAt: hoursAgoIso(1),
      items: [
        {
          id: "item-b",
          description: "Thermostat",
          qtyOrdered: 4,
          qtyReceived: 4,
          qtyBackordered: 0,
        },
      ],
    },
    {
      deliveryId: "verify-run-active-c",
      jobId: "job-c",
      jobName: "Northside School",
      orderNumber: "ORDER-300",
      vendorInvoiceNumber: "INV-300",
      poNumber: "PO-300",
      stagingLocationCodes: ["G1"],
      hasAssignableSpot: true,
      vendorPhysicalDropoffConfirmed: false,
      items: [{ id: "item-c", description: "Condensing unit", qtyOrdered: 1 }],
    },
    {
      deliveryId: "verify-run-partial-d",
      jobId: "job-d",
      jobName: "Partial Backorder Shop",
      orderNumber: "6168008",
      vendorInvoiceNumber: "6168008",
      poNumber: "PO-8008",
      stagingLocationCodes: ["S2"],
      hasAssignableSpot: true,
      vendorPhysicalDropoffConfirmed: true,
      status: "partial",
      items: [
        {
          id: "item-d-ok",
          description: "Air handler 3-ton",
          qtyOrdered: 1,
          qtyReceived: 1,
          qtyBackordered: 0,
        },
        {
          id: "item-d-bo",
          description: "TXV 5/8 ODM long description that wraps on a phone",
          qtyOrdered: 2,
          qtyReceived: 0,
          qtyBackordered: 2,
          status: "backordered",
        },
        {
          id: "item-d-missing",
          description: "Filter MERV 13",
          qtyOrdered: 8,
          qtyReceived: 0,
          qtyBackordered: 0,
        },
      ],
    },
    {
      deliveryId: "verify-run-completed-48h",
      jobId: "job-48h",
      jobName: "Completed 48h Shop",
      orderNumber: "ORDER-480",
      vendorInvoiceNumber: "INV-480",
      poNumber: "PO-480",
      stagingLocationCodes: ["G3"],
      hasAssignableSpot: true,
      vendorPhysicalDropoffConfirmed: true,
      vendorPhysicalDropoffConfirmedAt: hoursAgoIso(48),
      items: [
        {
          id: "item-48h",
          description: "Duct section",
          qtyOrdered: 1,
          qtyReceived: 1,
          qtyBackordered: 0,
        },
      ],
    },
    {
      deliveryId: "verify-run-completed-80h",
      jobId: "job-80h",
      jobName: "Hidden 80h Shop",
      orderNumber: "ORDER-800",
      vendorInvoiceNumber: "INV-800",
      poNumber: "PO-800",
      stagingLocationCodes: ["G4"],
      hasAssignableSpot: true,
      vendorPhysicalDropoffConfirmed: true,
      vendorPhysicalDropoffConfirmedAt: hoursAgoIso(80),
      items: [
        {
          id: "item-80h",
          description: "Old coil",
          qtyOrdered: 1,
          qtyReceived: 1,
          qtyBackordered: 0,
        },
      ],
    },
  ];
  let lastVendorRunCompleteIds = [];
  const materialIssueRequests = [];
  const vendorReceiveDetailsIds = [];
  let vendorReceiveDetailsFinished = 0;
  let pinResolveFulfilled = false;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  await page.route("**/getLocationPublicBranding", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          found: true,
          locationId: "staging-g2",
          code: "G2",
          label: "Ground 2",
          type: "ground",
        },
      }),
    });
  });
  await page.route("**/resolveLocationScanPin", async (route) => {
    const requestBody = parseCallablePostData(route);
    if (!requestBody.data?.pin) {
      await fulfillCallableWarmupInvalidArgument(route);
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1200));
    pinResolveFulfilled = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          success: true,
          accessType: "vendor",
          vendorId: "vendor-verify-run",
          vendorName: "Johnstone Supply",
          sessionToken: "verify-run-session",
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          scannedStagingLocationCode: "G2",
          sessionScope: "vendor",
          deliveryId: "verify-run-active-a",
        },
      }),
    });
  });
  await page.route("**/getVendorReceiveDetails", async (route) => {
    const requestBody = JSON.parse(route.request().postData() ?? "{}");
    const deliveryId = requestBody.data?.deliveryId ?? "";
    vendorReceiveDetailsIds.push(deliveryId);
    const row = vendorRunRows.find((entry) => entry.deliveryId === deliveryId);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    vendorReceiveDetailsFinished += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          delivery: {
            vendorPhysicalDropoffConfirmedAt:
              row?.vendorPhysicalDropoffConfirmedAt ?? null,
          },
          items: (row?.items ?? []).map((item) => ({
            ...item,
            qtyReceived: row?.vendorPhysicalDropoffConfirmed
              ? (item.qtyReceived ?? item.qtyOrdered ?? 0)
              : (item.qtyReceived ?? 0),
            qtyBackordered: item.qtyBackordered ?? 0,
          })),
        },
      }),
    });
  });
  let vendorRunDeliveriesFulfilled = false;
  await page.route("**/getVendorRunDeliveries", async (route) => {
    const requestBody = parseCallablePostData(route);
    if (!requestBody.data?.sessionToken) {
      await fulfillCallableWarmupInvalidArgument(route);
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 800));
    vendorRunDeliveriesFulfilled = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          vendorId: "vendor-verify-run",
          scannedStagingLocationCode: "G2",
          deliveries: vendorRunRows,
        },
      }),
    });
  });
  await page.route("**/markVendorDeliveriesBulk", async (route) => {
    const requestBody = JSON.parse(route.request().postData() ?? "{}");
    const deliveryIds = requestBody.data?.deliveryIds ?? [];
    lastVendorRunCompleteIds = deliveryIds;
    vendorRunRows = vendorRunRows.map((row) =>
      deliveryIds.includes(row.deliveryId)
        ? {
            ...row,
            vendorPhysicalDropoffConfirmed: true,
            vendorPhysicalDropoffConfirmedAt: new Date().toISOString(),
            items: row.items.map((item) => ({
              ...item,
              qtyReceived: item.qtyReceived ?? item.qtyOrdered ?? 0,
              qtyBackordered: item.qtyBackordered ?? 0,
            })),
          }
        : row,
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          results: deliveryIds.map((id) => ({
            deliveryId: id,
            success: true,
            vendorPhysicalDropoffConfirmed: true,
          })),
        },
      }),
    });
  });
  await page.route("**/createMaterialIssue", async (route) => {
    const requestBody = JSON.parse(route.request().postData() ?? "{}");
    const {
      deliveryOrderId,
      jobId,
      type,
      description,
    } = requestBody.data ?? {};
    materialIssueRequests.push({
      deliveryOrderId,
      jobId,
      type,
      description,
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          issueId: `issue-${materialIssueRequests.length}`,
          duplicate: false,
        },
      }),
    });
  });

  await page.goto(`${appBase}/#/s?loc=G2`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.getByRole("heading", { name: "Enter PIN" }).waitFor({
    timeout: 30_000,
  });
  record("PIN chrome visible before session", true);
  await enterPin(page, "9876");
  const verifyBtn = page.getByTestId("location-scan-pin-verify");
  if (await verifyBtn.isVisible().catch(() => false)) {
    await verifyBtn.click();
  }

  const shellDeadline = Date.now() + 5000;
  let pendingShellAsserted = false;
  while (Date.now() < shellDeadline && !pinResolveFulfilled) {
    const layoutVisible = await page
      .getByTestId("vendor-run-layout")
      .isVisible()
      .catch(() => false);
    if (layoutVisible) {
      pendingShellAsserted = true;
      record("pending shell visible before PIN CF returns", true);
      record(
        "vendor-deliveries-heading visible during pending shell",
        await page.getByTestId("vendor-deliveries-heading").isVisible(),
      );
      const pendingHeading =
        (await page.getByTestId("vendor-deliveries-heading").textContent()) ??
        "";
      record(
        "pending heading is generic DELIVERIES before PIN success",
        pendingHeading.trim() === "DELIVERIES",
        pendingHeading.trim(),
      );
      record(
        "skeleton visible during pending PIN verify",
        await page.getByTestId("vendor-run-list-skeleton").isVisible(),
      );
      record(
        "no delivery rows during pending PIN verify",
        (await page.locator('[data-testid^="vendor-run-row-"]').count()) === 0,
      );
      record(
        "empty-state CTA hidden during pending PIN verify",
        !(await page
          .getByTestId("vendor-unplanned-empty-state")
          .isVisible()
          .catch(() => false)),
      );
      record(
        "generic Loading… not shown during pending shell",
        !(await page
          .getByText("Loading…", { exact: true })
          .isVisible()
          .catch(() => false)),
      );
      break;
    }
    await page.waitForTimeout(50);
  }
  if (!pendingShellAsserted) {
    record(
      "pending shell visible before PIN CF returns",
      false,
      pinResolveFulfilled ? "PIN resolved before shell" : "timeout",
    );
  }

  const pinHeadingDeadline = Date.now() + 5000;
  let headingFromPinBeforeList = false;
  while (Date.now() < pinHeadingDeadline && !vendorRunDeliveriesFulfilled) {
    if (pinResolveFulfilled) {
      const headingText =
        (await page.getByTestId("vendor-deliveries-heading").textContent()) ??
        "";
      if (headingText.includes("JOHNSTONE SUPPLY DELIVERIES")) {
        headingFromPinBeforeList = true;
        break;
      }
    }
    await page.waitForTimeout(25);
  }
  record(
    "vendor heading from PIN before list CF returns (cold)",
    headingFromPinBeforeList,
  );

  await page.getByTestId("vendor-run-layout").waitFor({ timeout: 45_000 });
  record("company-run list lands after PIN", true);

  const headingDeadline = Date.now() + 15_000;
  let headingAfterPin = "";
  let headingShowsVendor = false;
  while (Date.now() < headingDeadline) {
    headingAfterPin =
      (await page.getByTestId("vendor-deliveries-heading").textContent()) ?? "";
    if (headingAfterPin.includes("JOHNSTONE SUPPLY DELIVERIES")) {
      headingShowsVendor = true;
      break;
    }
    await page.waitForTimeout(50);
  }
  record(
    "vendor heading shows company name after PIN success",
    headingShowsVendor,
    headingAfterPin.trim(),
  );
  record(
    "skeleton visible during initial list load",
    await page.getByTestId("vendor-run-list-skeleton").isVisible(),
  );
  record(
    "empty-state CTA hidden during initial list load",
    !(await page
      .getByTestId("vendor-unplanned-empty-state")
      .isVisible()
      .catch(() => false)),
  );
  const firstRow = page.getByTestId("vendor-run-row-verify-run-active-a");
  const pollDeadline = Date.now() + 20_000;
  let hydrationAfterFirstCard = false;
  let firstRowSeen = false;
  while (Date.now() < pollDeadline) {
    const visible = await firstRow.isVisible().catch(() => false);
    if (visible) {
      firstRowSeen = true;
      hydrationAfterFirstCard = vendorReceiveDetailsIds.length === 0;
      break;
    }
    await page.waitForTimeout(5);
  }
  if (!firstRowSeen) {
    await firstRow.waitFor({ timeout: pollDeadline - Date.now() });
  }
  record(
    "no detail fetches before first row paints (after-paint yield)",
    hydrationAfterFirstCard,
    `started=${vendorReceiveDetailsIds.length}`,
  );
  record(
    "skeleton hidden after list paints",
    !(await page
      .getByTestId("vendor-run-list-skeleton")
      .isVisible()
      .catch(() => false)),
  );
  record(
    "list paints before detail hydration settles",
    vendorReceiveDetailsFinished < vendorReceiveDetailsIds.length ||
      vendorReceiveDetailsFinished === 0,
    `finished=${vendorReceiveDetailsFinished} started=${vendorReceiveDetailsIds.length}`,
  );
  await page.waitForTimeout(400);
  const uniqueDetailIds = [...new Set(vendorReceiveDetailsIds)];
  record(
    "getVendorReceiveDetails once per missing-qty job",
    vendorReceiveDetailsIds.length === 2 &&
      uniqueDetailIds.sort().join(",") ===
        "verify-run-active-a,verify-run-active-c",
    vendorReceiveDetailsIds.join(","),
  );

  vendorRunDeliveriesFulfilled = false;
  pinResolveFulfilled = false;
  const page2 = await context.newPage();
  await page2.route("**/getLocationPublicBranding", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          found: true,
          locationId: "staging-g2",
          code: "G2",
          label: "Ground 2",
          type: "ground",
        },
      }),
    });
  });
  await page2.route("**/resolveLocationScanPin", async (route) => {
    const requestBody = parseCallablePostData(route);
    if (!requestBody.data?.pin) {
      await fulfillCallableWarmupInvalidArgument(route);
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1200));
    pinResolveFulfilled = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          success: true,
          accessType: "vendor",
          vendorId: "vendor-verify-run",
          vendorName: "Johnstone Supply",
          sessionToken: "verify-run-session-tab2",
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          scannedStagingLocationCode: "G2",
          sessionScope: "vendor",
          deliveryId: "verify-run-active-a",
        },
      }),
    });
  });
  await page2.route("**/getVendorRunDeliveries", async (route) => {
    const requestBody = parseCallablePostData(route);
    if (!requestBody.data?.sessionToken) {
      await fulfillCallableWarmupInvalidArgument(route);
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 800));
    vendorRunDeliveriesFulfilled = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          vendorId: "vendor-verify-run",
          scannedStagingLocationCode: "G2",
          deliveries: vendorRunRows,
        },
      }),
    });
  });
  await page2.goto(`${appBase}/#/s?loc=G2`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page2.getByRole("heading", { name: "Enter PIN" }).waitFor({
    timeout: 30_000,
  });
  await enterPin(page2, "9876");
  const verifyBtn2 = page2.getByTestId("location-scan-pin-verify");
  if (await verifyBtn2.isVisible().catch(() => false)) {
    await verifyBtn2.click();
  }
  const crossTabRowDeadline = Date.now() + 5000;
  let crossTabRowBeforePinResolve = false;
  const crossTabFirstRow = page2.getByTestId(
    "vendor-run-row-verify-run-active-a",
  );
  while (Date.now() < crossTabRowDeadline && !pinResolveFulfilled) {
    if (await crossTabFirstRow.isVisible().catch(() => false)) {
      crossTabRowBeforePinResolve = true;
      break;
    }
    await page2.waitForTimeout(25);
  }
  record(
    "cached first row visible before PIN CF returns (submit paint)",
    crossTabRowBeforePinResolve,
  );
  let crossTabRowBeforeList = false;
  while (Date.now() < crossTabRowDeadline && !vendorRunDeliveriesFulfilled) {
    if (await crossTabFirstRow.isVisible().catch(() => false)) {
      crossTabRowBeforeList = true;
      break;
    }
    await page2.waitForTimeout(25);
  }
  record(
    "cached first row visible before list CF returns (new tab / localStorage)",
    crossTabRowBeforeList,
  );
  await crossTabFirstRow.waitFor({ timeout: 20_000 });
  await page2.close();

  record(
    "helper is per-job review copy",
    ((await page.getByTestId("vendor-run-helper").textContent()) ?? "").includes(
      "Tap a job to review and complete delivery",
    ),
  );
  record(
    "no global bulk Delivered button",
    !(await page.getByTestId("vendor-run-bulk-deliver").isVisible().catch(() => false)),
  );

  const rowOrder = async () =>
    page
      .locator(
        '[data-testid="vendor-run-card-list"] > [data-testid^="vendor-run-row-"]',
      )
      .evaluateAll((rows) =>
        rows.map((row) =>
          (row.getAttribute("data-testid") ?? "").replace("vendor-run-row-", ""),
        ),
      );
  const expectedInitialOrder = [
    "verify-run-partial-d",
    "verify-run-active-a",
    "verify-run-active-c",
    "verify-run-delivered-b",
  ];
  record(
    "lifecycle main list: Partial then open then recent Delivered",
    JSON.stringify(await rowOrder()) === JSON.stringify(expectedInitialOrder),
    (await rowOrder()).join(" → "),
  );
  record(
    "48h completed job not in main list",
    !(await page
      .getByTestId("vendor-run-row-verify-run-completed-48h")
      .isVisible()
      .catch(() => false)),
  );
  record(
    "80h completed job not visible anywhere",
    !(await page
      .getByTestId("vendor-run-row-verify-run-completed-80h")
      .isVisible()
      .catch(() => false)),
  );
  record(
    "Completed deliveries section collapsed by default",
    (await page.getByTestId("vendor-run-completed-deliveries-toggle").isVisible()) &&
      (await page
        .getByTestId("vendor-run-completed-deliveries-toggle")
        .getAttribute("aria-expanded")) === "false",
  );
  await assertReadableTextContrast(
    page,
    VENDOR_RUN_COMPLETED_DELIVERIES_CONTRAST_SPEC,
  );
  record("D-42 completed deliveries toggle contrast", true);
  await page.getByTestId("vendor-run-completed-deliveries-toggle").click();
  const completedList = page.getByTestId("vendor-run-completed-deliveries-list");
  record(
    "expand Completed deliveries shows 24–72h jobs only",
    (await page
      .getByTestId("vendor-run-completed-deliveries-toggle")
      .getAttribute("aria-expanded")) === "true" &&
      (await completedList
        .getByTestId("vendor-run-row-verify-run-completed-48h")
        .isVisible()) &&
      !(await completedList
        .getByTestId("vendor-run-row-verify-run-completed-80h")
        .isVisible()
        .catch(() => false)) &&
      !(await completedList
        .getByTestId("vendor-run-row-verify-run-delivered-b")
        .isVisible()
        .catch(() => false)),
  );
  await page.getByTestId("vendor-run-completed-deliveries-toggle").click();

  const detailsA = page.getByTestId("vendor-run-details-verify-run-active-a");
  const detailsC = page.getByTestId("vendor-run-details-verify-run-active-c");
  await page.getByTestId("vendor-run-toggle-verify-run-active-a").click();
  record("unfinished job expands with Complete delivery", await detailsA.isVisible());
  record(
    "Complete delivery is inside the expanded job",
    await page.getByTestId("vendor-run-complete-verify-run-active-a").isVisible(),
  );
  record(
    "Cancel / Back is inside the expanded job",
    await page.getByTestId("vendor-run-cancel-verify-run-active-a").isVisible(),
  );
  record(
    "unfinished job exposes secondary Report an issue",
    await page
      .getByTestId("vendor-run-report-issue-verify-run-active-a")
      .isVisible(),
  );
  await assertReadableTextContrast(page, VENDOR_RUN_LAYOUT_CONTRAST_SPEC);
  record("D-42 expanded unfinished contrast", true);
  await page.screenshot({
    path: resolve(outDir, "expanded-complete-delivery.png"),
    fullPage: false,
  });

  await page
    .getByTestId("vendor-run-report-issue-verify-run-active-a")
    .click();
  await page.getByTestId("vendor-issue-modal").waitFor();
  record(
    "issue sheet exposes stable entry controls",
    (await page.getByTestId("vendor-issue-option-wrong_location").isVisible()) &&
      (await page.getByTestId("vendor-issue-option-damaged").isVisible()) &&
      (await page.getByTestId("vendor-issue-option-missing").isVisible()) &&
      (await page.getByTestId("vendor-issue-option-other").isVisible()) &&
      (await page.getByTestId("vendor-issue-note").isVisible()) &&
      (await page.getByTestId("vendor-issue-cancel").isVisible()) &&
      (await page.getByTestId("vendor-issue-submit").isVisible()),
  );
  await page.screenshot({
    path: resolve(outDir, "issue-entry.png"),
    fullPage: false,
  });
  await page.getByTestId("vendor-issue-cancel").click();
  await page.getByTestId("vendor-issue-modal").waitFor({ state: "detached" });
  record(
    "cancel issue entry writes nothing and keeps Job A expanded",
    materialIssueRequests.length === 0 && (await detailsA.isVisible()),
  );

  await page
    .getByTestId("vendor-run-report-issue-verify-run-active-a")
    .click();
  await page.getByTestId("vendor-issue-option-damaged").click();
  await page.getByTestId("vendor-issue-note").fill("Outer carton is crushed");
  await page.getByTestId("vendor-issue-submit").click();
  await page
    .getByTestId("vendor-run-issue-reported-verify-run-active-a")
    .waitFor();
  record(
    "Job A issue uses existing delivery-level payload",
    JSON.stringify(materialIssueRequests[0]) ===
      JSON.stringify({
        deliveryOrderId: "verify-run-active-a",
        jobId: "job-a",
        type: "damaged",
        description: "Outer carton is crushed",
      }),
    JSON.stringify(materialIssueRequests[0]),
  );
  record(
    "Job A submit stays expanded with scoped confirmation",
    (await detailsA.isVisible()) &&
      ((await page
        .getByTestId("vendor-run-issue-reported-verify-run-active-a")
        .textContent()) ?? "").includes("dispatcher notified"),
  );
  record(
    "Job B is unchanged after Job A issue submit",
    materialIssueRequests.every(
      (request) => request.deliveryOrderId !== "verify-run-delivered-b",
    ) &&
      (await page
        .getByTestId("vendor-run-row-verify-run-delivered-b")
        .getAttribute("data-delivered")) === "true" &&
      !(await page
        .getByTestId("vendor-run-issue-reported-verify-run-delivered-b")
        .isVisible()
        .catch(() => false)),
  );
  await page.screenshot({
    path: resolve(outDir, "issue-success.png"),
    fullPage: false,
  });

  await page.getByTestId("vendor-run-toggle-verify-run-active-c").click();
  record(
    "opening a second job closes the first",
    (await detailsC.isVisible()) &&
      !(await detailsA.isVisible().catch(() => false)),
  );
  record(
    "second job owns its own Complete delivery",
    await page.getByTestId("vendor-run-complete-verify-run-active-c").isVisible(),
  );

  await page.getByTestId("vendor-run-cancel-verify-run-active-c").click();
  record(
    "Cancel / Back collapses without writing",
    !(await detailsC.isVisible().catch(() => false)) &&
      lastVendorRunCompleteIds.length === 0,
  );

  await page.getByTestId("vendor-run-toggle-verify-run-active-a").click();
  await page.getByTestId("vendor-run-complete-verify-run-active-a").click();
  const expectedAfterComplete = [
    "verify-run-partial-d",
    "verify-run-active-c",
    "verify-run-active-a",
    "verify-run-delivered-b",
  ];
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="vendor-run-row-verify-run-active-a"]')
        ?.getAttribute("data-delivered") === "true",
    { timeout: 20_000 },
  );
  await page.waitForFunction(
    (expectedJson) => {
      const rows = [
        ...document.querySelectorAll(
          '[data-testid="vendor-run-card-list"] > [data-testid^="vendor-run-row-"]',
        ),
      ].map((row) =>
        (row.getAttribute("data-testid") ?? "").replace("vendor-run-row-", ""),
      );
      return JSON.stringify(rows) === expectedJson;
    },
    JSON.stringify(expectedAfterComplete),
    { timeout: 20_000 },
  );
  record(
    "complete sends only the expanded delivery id",
    JSON.stringify(lastVendorRunCompleteIds) ===
      JSON.stringify(["verify-run-active-a"]),
    lastVendorRunCompleteIds.join(", "),
  );
  record(
    "completed job moves into recent Delivered group on main list",
    JSON.stringify(await rowOrder()) === JSON.stringify(expectedAfterComplete),
    (await rowOrder()).join(" → "),
  );
  record(
    "other unfinished job stays unfinished",
    (await page
      .getByTestId("vendor-run-row-verify-run-active-c")
      .getAttribute("data-delivered")) === "false",
  );

  await page.getByTestId("vendor-run-toggle-verify-run-active-a").click();
  record(
    "delivered job shows drop-off complete and no Complete delivery",
    ((await page
      .getByTestId("vendor-run-complete-status-verify-run-active-a")
      .textContent()) ?? "").trim() === "Physical drop-off complete" &&
      !(await page
        .getByTestId("vendor-run-complete-verify-run-active-a")
        .isVisible()
        .catch(() => false)),
  );
  await assertReadableTextContrast(page, VENDOR_RUN_DELIVERED_ROW_CONTRAST_SPEC);
  record("D-42 delivered face contrast", true);
  await page.screenshot({
    path: resolve(outDir, "delivered-complete-status.png"),
    fullPage: false,
  });

  record(
    "fully delivered job still shows DELIVERED",
    ((await page
      .getByTestId("vendor-run-delivered-status-verify-run-delivered-b")
      .textContent()) ?? "").trim() === "DELIVERED",
  );
  record(
    "partial+backorder card shows PARTIAL not DELIVERED",
    ((await page
      .getByTestId("vendor-run-partial-status-verify-run-partial-d")
      .textContent()) ?? "").trim() === "PARTIAL" &&
      (await page
        .getByTestId("vendor-run-row-verify-run-partial-d")
        .getAttribute("data-fulfillment")) === "partial" &&
      (await page
        .getByTestId("vendor-run-row-verify-run-partial-d")
        .getAttribute("data-delivered")) === "true",
  );

  await page.getByTestId("vendor-run-toggle-verify-run-partial-d").click();
  record(
    "partial expanded keeps drop-off complete + Undo",
    ((await page
      .getByTestId("vendor-run-complete-status-verify-run-partial-d")
      .textContent()) ?? "").trim() === "Physical drop-off complete" &&
      ((await page.getByTestId("vendor-run-undo-verify-run-partial-d").textContent()) ?? "").includes("Undo drop-off") &&
      !(await page
        .getByTestId("vendor-run-complete-verify-run-partial-d")
        .isVisible()
        .catch(() => false)),
  );
  record(
    "partial expanded shows order-level Partial",
    ((await page
      .getByTestId("vendor-run-order-status-verify-run-partial-d")
      .textContent()) ?? "").includes("Partial"),
  );
  const backorderBadges = page
    .getByTestId("vendor-run-item-item-d-bo")
    .getByTestId("vendor-item-line-status");
  record(
    "backordered line shows BACKORDERED",
    ((await backorderBadges.textContent()) ?? "").trim() === "BACKORDERED",
  );
  record(
    "not-delivered line remains visible",
    ((await page
      .getByTestId("vendor-run-item-item-d-missing")
      .getByTestId("vendor-item-line-status")
      .textContent()) ?? "").trim() === "NOT DELIVERED",
  );
  const partialStateIsUnchanged = async () =>
    ((await page
      .getByTestId("vendor-run-complete-status-verify-run-partial-d")
      .textContent()) ?? "").trim() === "Physical drop-off complete" &&
    ((await page
      .getByTestId("vendor-run-order-status-verify-run-partial-d")
      .textContent()) ?? "").includes("Partial") &&
    ((await backorderBadges.textContent()) ?? "").trim() === "BACKORDERED" &&
    (await page
      .getByTestId("vendor-run-undo-verify-run-partial-d")
      .isVisible()) &&
    (await page
      .getByTestId("vendor-run-row-verify-run-partial-d")
      .getAttribute("data-delivered")) === "true";
  record(
    "partial delivered card exposes Report an issue",
    await page
      .getByTestId("vendor-run-report-issue-verify-run-partial-d")
      .isVisible(),
  );
  await page
    .getByTestId("vendor-run-report-issue-verify-run-partial-d")
    .click();
  await page.getByTestId("vendor-issue-modal").waitFor();
  record(
    "partial/backordered truth remains under open issue sheet",
    await partialStateIsUnchanged(),
  );
  await page.getByTestId("vendor-issue-submit").click();
  await page
    .getByTestId("vendor-run-issue-reported-verify-run-partial-d")
    .waitFor();
  record(
    "partial issue submit targets only its delivery",
    JSON.stringify(materialIssueRequests[1]) ===
      JSON.stringify({
        deliveryOrderId: "verify-run-partial-d",
        jobId: "job-d",
        type: "other",
        description: "Wrong location",
      }),
    JSON.stringify(materialIssueRequests[1]),
  );
  record(
    "partial/backordered truth remains after issue submit",
    await partialStateIsUnchanged(),
  );
  await assertReadableTextContrast(page, VENDOR_RUN_PARTIAL_ROW_CONTRAST_SPEC);
  record("D-42 partial face contrast", true);
  await page.screenshot({
    path: resolve(outDir, "partial-backorder-status.png"),
    fullPage: false,
  });

  await page
    .getByTestId("vendor-run-toggle-verify-run-delivered-b")
    .click();
  const deliveredBIssueCount = materialIssueRequests.length;
  record(
    "delivered job can open per-job issue sheet",
    await page
      .getByTestId("vendor-run-report-issue-verify-run-delivered-b")
      .isVisible(),
  );
  await page
    .getByTestId("vendor-run-report-issue-verify-run-delivered-b")
    .click();
  await page.getByTestId("vendor-issue-modal").waitFor();
  await page.getByTestId("vendor-issue-cancel").click();
  await page.getByTestId("vendor-issue-modal").waitFor({ state: "detached" });
  record(
    "delivered issue cancel does not undo drop-off",
    materialIssueRequests.length === deliveredBIssueCount &&
      (await page
        .getByTestId("vendor-run-row-verify-run-delivered-b")
        .getAttribute("data-delivered")) === "true" &&
      (await page
        .getByTestId("vendor-run-undo-verify-run-delivered-b")
        .isVisible()),
  );

  const uniqueDetailIdsFinal = [...new Set(vendorReceiveDetailsIds)];
  record(
    "complete/refresh does not add extra details fetches when list already has qty",
    vendorReceiveDetailsIds.length === 2 &&
      uniqueDetailIdsFinal.length === 2 &&
      uniqueDetailIdsFinal.sort().join(",") ===
        "verify-run-active-a,verify-run-active-c",
    vendorReceiveDetailsIds.join(","),
  );

  vendorRunDeliveriesFulfilled = false;
  pinResolveFulfilled = false;
  await page.getByTestId("vendor-run-back").click();
  await page.getByRole("heading", { name: "Enter PIN" }).waitFor({
    timeout: 30_000,
  });
  record("warm login returns to PIN after Back", true);
  await enterPin(page, "9876");
  if (await verifyBtn.isVisible().catch(() => false)) {
    await verifyBtn.click();
  }

  const warmRowDeadline = Date.now() + 5000;
  let warmRowBeforePinResolve = false;
  const warmFirstRow = page.getByTestId("vendor-run-row-verify-run-active-a");
  while (Date.now() < warmRowDeadline && !pinResolveFulfilled) {
    if (await warmFirstRow.isVisible().catch(() => false)) {
      warmRowBeforePinResolve = true;
      break;
    }
    await page.waitForTimeout(25);
  }
  record(
    "cached first row visible before PIN CF returns (warm submit paint)",
    warmRowBeforePinResolve,
  );

  const warmHeadingDeadline = Date.now() + 5000;
  let warmHeadingBeforeList = false;
  while (Date.now() < warmHeadingDeadline && !vendorRunDeliveriesFulfilled) {
    if (pinResolveFulfilled) {
      const warmHeading =
        (await page.getByTestId("vendor-deliveries-heading").textContent()) ??
        "";
      if (warmHeading.includes("JOHNSTONE SUPPLY DELIVERIES")) {
        warmHeadingBeforeList = true;
        break;
      }
    }
    await page.waitForTimeout(25);
  }
  record(
    "vendor heading from PIN before list CF returns (warm cache)",
    warmHeadingBeforeList,
  );

  const warmRowBeforeListDeadline = Date.now() + 5000;
  let warmRowBeforeList = false;
  while (Date.now() < warmRowBeforeListDeadline && !vendorRunDeliveriesFulfilled) {
    if (await warmFirstRow.isVisible().catch(() => false)) {
      warmRowBeforeList = true;
      break;
    }
    await page.waitForTimeout(25);
  }
  record(
    "cached first row visible before list CF returns (warm login)",
    warmRowBeforeList,
  );
  await warmFirstRow.waitFor({ timeout: 20_000 });
  await page.screenshot({
    path: resolve(process.cwd(), "screenshots", "vendor-run-job-actions", "instant-cards-from-cache.png"),
    fullPage: false,
  });

  pinResolveFulfilled = false;
  await page.unroute("**/resolveLocationScanPin");
  await page.route("**/resolveLocationScanPin", async (route) => {
    const requestBody = parseCallablePostData(route);
    if (!requestBody.data?.pin) {
      await fulfillCallableWarmupInvalidArgument(route);
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1200));
    pinResolveFulfilled = true;
    if (requestBody.data.pin === "0000") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: { success: false, message: "Invalid code." },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          success: true,
          accessType: "vendor",
          vendorId: "vendor-verify-run",
          vendorName: "Johnstone Supply",
          sessionToken: "verify-run-session-wrong-pin-test",
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          scannedStagingLocationCode: "G2",
          sessionScope: "vendor",
          deliveryId: "verify-run-active-a",
        },
      }),
    });
  });
  await page.getByTestId("vendor-run-back").click();
  await page.getByRole("heading", { name: "Enter PIN" }).waitFor({
    timeout: 30_000,
  });
  await enterPin(page, "0000");
  if (await verifyBtn.isVisible().catch(() => false)) {
    await verifyBtn.click();
  }
  await page.waitForTimeout(1500);
  record(
    "wrong PIN clears optimistic cached rows back to keypad",
    (await page.locator('[data-testid^="vendor-run-row-"]').count()) === 0 &&
      (await page.getByRole("heading", { name: "Enter PIN" }).isVisible()),
  );

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    process.exit(1);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

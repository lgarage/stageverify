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

(async () => {
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
  ];
  let lastVendorRunCompleteIds = [];
  const materialIssueRequests = [];
  const vendorReceiveDetailsIds = [];
  let vendorReceiveDetailsFinished = 0;

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
          items: (row?.items ?? []).map((item) => ({
            ...item,
            qtyReceived: item.qtyReceived ?? 0,
            qtyBackordered: item.qtyBackordered ?? 0,
          })),
        },
      }),
    });
  });
  await page.route("**/getVendorRunDeliveries", async (route) => {
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
        ? { ...row, vendorPhysicalDropoffConfirmed: true }
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

  await page.getByTestId("vendor-run-layout").waitFor({ timeout: 45_000 });
  record("company-run list lands after PIN", true);
  record(
    "list paints before detail hydration settles",
    vendorReceiveDetailsFinished < 2,
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
    page.locator('[data-testid^="vendor-run-row-"]').evaluateAll((rows) =>
      rows.map((row) =>
        (row.getAttribute("data-testid") ?? "").replace("vendor-run-row-", ""),
      ),
    );
  const expectedInitialOrder = [
    "verify-run-active-a",
    "verify-run-active-c",
    "verify-run-delivered-b",
    "verify-run-partial-d",
  ];
  record(
    "PR #173 unfinished-first delivered-last",
    JSON.stringify(await rowOrder()) === JSON.stringify(expectedInitialOrder),
    (await rowOrder()).join(" → "),
  );

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
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="vendor-run-row-verify-run-active-a"]')
        ?.getAttribute("data-delivered") === "true",
    { timeout: 20_000 },
  );
  record(
    "complete sends only the expanded delivery id",
    JSON.stringify(lastVendorRunCompleteIds) ===
      JSON.stringify(["verify-run-active-a"]),
    lastVendorRunCompleteIds.join(", "),
  );
  const expectedAfterComplete = [
    "verify-run-active-c",
    "verify-run-active-a",
    "verify-run-delivered-b",
    "verify-run-partial-d",
  ];
  record(
    "completed job moves into delivered-last group",
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

  record(
    "complete/refresh does not refetch cached details",
    vendorReceiveDetailsIds.length === 2,
    vendorReceiveDetailsIds.join(","),
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

/**
 * Focused company-run vendor job-details interaction verify.
 *
 * Uses mocked public callables so no live PIN or Firebase writes are required.
 * Requires the local StageVerify dev server.
 *
 * Usage:
 *   npm run verify:vendor-job-detail-actions
 */
import { chromium } from "playwright";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  assertReadableTextContrast,
  VENDOR_RUN_DELIVERED_ROW_CONTRAST_SPEC,
  VENDOR_RUN_LAYOUT_CONTRAST_SPEC,
} from "./lib/ui-text-contrast-lib.mjs";

const baseUrl =
  process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const results = [];

function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
}

async function enterPin(page, pin) {
  for (const digit of pin) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
}

function fixtureRows() {
  return [
    {
      deliveryId: "detail-active-a",
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
      deliveryId: "detail-delivered-b",
      jobId: "job-b",
      jobName: "Oak Street Offices",
      orderNumber: "ORDER-200",
      vendorInvoiceNumber: "INV-200",
      poNumber: "PO-200",
      stagingLocationCodes: ["S1-A"],
      hasAssignableSpot: true,
      vendorPhysicalDropoffConfirmed: true,
      items: [{ id: "item-b", description: "Thermostat", qtyOrdered: 4 }],
    },
    {
      deliveryId: "detail-active-c",
      jobId: "job-c",
      jobName: "Northside School",
      orderNumber: "ORDER-300",
      vendorInvoiceNumber: "INV-300",
      poNumber: "PO-300",
      stagingLocationCodes: [],
      hasAssignableSpot: false,
      vendorPhysicalDropoffConfirmed: false,
      items: [{ id: "item-c", description: "Condensing unit", qtyOrdered: 1 }],
    },
  ];
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
let vendorRunRows = fixtureRows();
const completedRequests = [];

try {
  await page.route("**/getLocationPublicBranding", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          found: true,
          locationId: "staging-g2",
          code: "G2",
          label: "Ground Spot 2",
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
        data: {
          success: true,
          accessType: "vendor",
          vendorId: "vendor-detail-actions",
          vendorName: "Johnstone Supply",
          sessionToken: "detail-actions-session",
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          scannedStagingLocationCode: "G2",
          sessionScope: "vendor",
          deliveryId: "detail-active-a",
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
          vendorId: "vendor-detail-actions",
          scannedStagingLocationCode: "G2",
          deliveries: vendorRunRows,
        },
      }),
    });
  });
  await page.route("**/markVendorDeliveriesBulk", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    const deliveryIds = body.data?.deliveryIds ?? [];
    completedRequests.push(deliveryIds);
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
          results: deliveryIds.map((deliveryId) => ({
            deliveryId,
            success: true,
            vendorPhysicalDropoffConfirmed: true,
          })),
        },
      }),
    });
  });

  await page.goto(`${appBase}/#/s?loc=G2`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.getByRole("heading", { name: "Enter PIN" }).waitFor({
    timeout: 30_000,
  });
  await enterPin(page, "1234");
  await page.getByTestId("location-scan-pin-verify").click();
  await page.getByTestId("vendor-run-layout").waitFor({
    state: "visible",
    timeout: 30_000,
  });

  const helper = (await page.getByTestId("vendor-run-helper").textContent()) ?? "";
  record(
    "helper uses per-job instruction",
    helper.includes("Tap a job to review it") && !helper.includes("Check each order"),
    helper.trim(),
  );
  record(
    "obsolete global batch controls are absent",
    (await page.getByTestId("vendor-run-bulk-deliver").count()) === 0 &&
      (await page.locator('input[type="checkbox"]').count()) === 0,
  );

  await page.getByTestId("vendor-run-toggle-detail-active-a").click();
  const detailsA = page.getByTestId("vendor-run-details-detail-active-a");
  const completeA = page.getByTestId("vendor-run-complete-detail-active-a");
  const cancelA = page.getByTestId("vendor-run-cancel-detail-active-a");
  record(
    "unfinished details contain Complete delivery and Cancel / Back",
    (await detailsA.isVisible()) &&
      (await detailsA.getByTestId("vendor-run-complete-detail-active-a").isVisible()) &&
      (await detailsA.getByTestId("vendor-run-cancel-detail-active-a").isVisible()),
  );
  await assertReadableTextContrast(page, VENDOR_RUN_LAYOUT_CONTRAST_SPEC);
  record("in-card action contrast passes D-42", true);

  await cancelA.click();
  record(
    "Cancel / Back collapses without a write",
    !(await detailsA.isVisible().catch(() => false)) && completedRequests.length === 0,
  );

  await page.getByTestId("vendor-run-toggle-detail-active-a").click();
  await page.getByTestId("vendor-run-toggle-detail-active-c").click();
  const detailsC = page.getByTestId("vendor-run-details-detail-active-c");
  record(
    "opening another job exclusively collapses the first",
    !(await detailsA.isVisible().catch(() => false)) &&
      (await detailsC.isVisible()) &&
      (await page.locator('[data-testid^="vendor-run-complete-"]').count()) === 1,
  );
  record(
    "no-spot job keeps warning and disables completion",
    (await page
      .getByTestId("vendor-run-row-detail-active-c")
      .getByText("No spot — ask dispatch", { exact: true })
      .isVisible()) &&
      (await page.getByTestId("vendor-run-complete-detail-active-c").isDisabled()),
  );

  await page.getByTestId("vendor-run-toggle-detail-active-a").click();
  await completeA.click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="vendor-run-row-detail-active-a"]')
        ?.getAttribute("data-delivered") === "true",
    { timeout: 20_000 },
  );
  const rowState = await page
    .locator('[data-testid^="vendor-run-row-"]')
    .evaluateAll((rows) =>
      rows.map((row) => ({
        id: (row.getAttribute("data-testid") ?? "").replace("vendor-run-row-", ""),
        delivered: row.getAttribute("data-delivered") === "true",
      })),
    );
  record(
    "Complete delivery sends only the expanded job id",
    JSON.stringify(completedRequests) === JSON.stringify([["detail-active-a"]]),
    JSON.stringify(completedRequests),
  );
  record(
    "only the completed job changes delivered state",
    rowState.find((row) => row.id === "detail-active-a")?.delivered === true &&
      rowState.find((row) => row.id === "detail-active-c")?.delivered === false &&
      rowState.find((row) => row.id === "detail-delivered-b")?.delivered === true,
  );
  record(
    "unfinished jobs remain first and delivered jobs group at bottom",
    JSON.stringify(rowState.map((row) => row.id)) ===
      JSON.stringify(["detail-active-c", "detail-active-a", "detail-delivered-b"]),
    rowState.map((row) => row.id).join(" → "),
  );
  record(
    "successful completion collapses the completed job",
    !(await detailsA.isVisible().catch(() => false)),
  );

  await page.getByTestId("vendor-run-toggle-detail-active-a").click();
  record(
    "delivered job keeps DELIVERED and Undo without Complete delivery",
    (await page
      .getByTestId("vendor-run-row-detail-active-a")
      .getByText("DELIVERED", { exact: true })
      .isVisible()) &&
      (await page.getByTestId("vendor-run-undo-detail-active-a").isVisible()) &&
      (await page.getByTestId("vendor-run-complete-detail-active-a").count()) === 0,
  );
  await assertReadableTextContrast(
    page,
    VENDOR_RUN_DELIVERED_ROW_CONTRAST_SPEC,
  );
  record("delivered job contrast passes D-42", true);
} catch (error) {
  record(
    "verify script completes",
    false,
    error instanceof Error ? error.message : String(error),
  );
} finally {
  await browser.close();
}

const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.error("FAILED:", failed.map((result) => result.name).join("; "));
  process.exit(1);
}
console.log("verify:vendor-job-detail-actions PASS");

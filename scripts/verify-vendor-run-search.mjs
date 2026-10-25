/**
 * Vendor company-run delivery list search (mocked callables, no live PIN).
 * iPhone 13 viewport; client-side filter only.
 *
 * Usage:
 *   npm run dev
 *   node scripts/verify-vendor-run-search.mjs
 */
import { chromium, devices } from "playwright";
import { resolveAppBase } from "./resolveAppBase.mjs";

const baseUrl = process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);

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

(async () => {
  const vendorRunRows = [
    {
      deliveryId: "verify-search-active-a",
      jobId: "job-a",
      jobName: "Riverside Medical Center",
      orderNumber: "ORDER-100",
      vendorInvoiceNumber: "INV-100",
      poNumber: "PF-Wausau",
      stagingLocationCodes: ["G2"],
      hasAssignableSpot: true,
      vendorPhysicalDropoffConfirmed: false,
      items: [{ id: "item-a", description: "Air handler", qtyOrdered: 1 }],
    },
    {
      deliveryId: "verify-search-active-b",
      jobId: "job-b",
      jobName: "Oak Street Offices",
      orderNumber: "ORDER-200",
      vendorInvoiceNumber: "INV-200",
      poNumber: "2533636",
      stagingLocationCodes: ["G1"],
      hasAssignableSpot: true,
      vendorPhysicalDropoffConfirmed: false,
      items: [{ id: "item-b", description: "Thermostat", qtyOrdered: 1 }],
    },
    {
      deliveryId: "verify-search-active-c",
      jobId: "job-c",
      jobName: "Northside School",
      orderNumber: "ORDER-300",
      vendorInvoiceNumber: "INV-300",
      poNumber: "po-2533636",
      stagingLocationCodes: ["G1"],
      hasAssignableSpot: true,
      vendorPhysicalDropoffConfirmed: false,
      items: [{ id: "item-c", description: "Condenser", qtyOrdered: 1 }],
    },
  ];

  const iPhone = devices["iPhone 13"];
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...iPhone,
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
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "invalid-argument", status: "INVALID_ARGUMENT" },
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
          vendorId: "vendor-verify-search",
          vendorName: "Johnstone Supply",
          sessionToken: "verify-search-session",
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          scannedStagingLocationCode: "G2",
          sessionScope: "vendor",
          deliveryId: "verify-search-active-a",
        },
      }),
    });
  });
  await page.route("**/getVendorReceiveDetails", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: { delivery: {}, items: [] } }),
    });
  });
  await page.route("**/getVendorRunDeliveries", async (route) => {
    const requestBody = parseCallablePostData(route);
    if (!requestBody.data?.sessionToken) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "invalid-argument", status: "INVALID_ARGUMENT" },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          vendorId: "vendor-verify-search",
          scannedStagingLocationCode: "G2",
          deliveries: vendorRunRows,
        },
      }),
    });
  });
  let bulkCompleteIds = [];
  await page.route("**/markVendorDeliveriesBulk", async (route) => {
    const requestBody = JSON.parse(route.request().postData() ?? "{}");
    bulkCompleteIds = requestBody.data?.deliveryIds ?? [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          results: bulkCompleteIds.map((id) => ({
            deliveryId: id,
            success: true,
            vendorPhysicalDropoffConfirmed: true,
          })),
        },
      }),
    });
  });

  try {
    await page.goto(`${appBase}/#/s?loc=G2&_t=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.getByRole("heading", { name: "Enter PIN" }).waitFor({
      timeout: 20_000,
    });
    await enterPin(page, "9876");
    const verifyBtn = page.getByTestId("location-scan-pin-verify");
    if (await verifyBtn.isVisible().catch(() => false)) {
      await verifyBtn.click();
    }
    await page.getByTestId("vendor-run-layout").waitFor({ timeout: 60_000 });
    await page.getByTestId("vendor-run-search").waitFor({ timeout: 20_000 });

    const fontSizePx = await page.getByTestId("vendor-run-search").evaluate((el) =>
      parseFloat(window.getComputedStyle(el).fontSize),
    );
    record("search input font-size >= 16px", fontSizePx >= 16, `${fontSizePx}px`);

    const search = page.getByTestId("vendor-run-search");
    await search.fill("oak");
    record(
      "filter shows matching row only",
      (await page.getByTestId("vendor-run-row-verify-search-active-b").count()) ===
        1 &&
        (await page.getByTestId("vendor-run-row-verify-search-active-a").count()) ===
          0,
    );

    await search.fill("zzznomatch");
    record(
      "no matches empty state",
      await page.getByTestId("vendor-run-search-no-matches").isVisible(),
    );

    await page.getByTestId("vendor-run-search-clear").click();
    record(
      "clear restores full list",
      (await page.getByTestId("vendor-run-row-verify-search-active-a").count()) ===
        1 &&
        (await page.getByTestId("vendor-run-row-verify-search-active-b").count()) ===
          1,
    );

    await search.fill("pf-wau");
    await page.getByTestId("vendor-run-toggle-verify-search-active-a").click();
    await page.getByTestId("vendor-run-complete-verify-search-active-a").click();
    await page
      .getByTestId("vendor-run-complete-confirm-yes-verify-search-active-a")
      .click();
    record(
      "complete works on filtered row",
      bulkCompleteIds.includes("verify-search-active-a"),
      bulkCompleteIds.join(","),
    );

    await search.press("Enter");
    record(
      "Enter dismisses keyboard without submitting",
      !(await page
        .getByTestId("vendor-run-complete-confirm-yes-verify-search-active-a")
        .isVisible()
        .catch(() => false)),
    );
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} checks passed.`);
})();

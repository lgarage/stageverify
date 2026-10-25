/**
 * Vendor company-run + job-scoped delivery list search (mocked callables, no live PIN).
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

const jobVendorRows = [
  {
    deliveryId: "verify-job-search-a",
    jobName: "Riverside Medical Center",
    orderNumber: "ORDER-100",
    vendorInvoiceNumber: "INV-JOB-100",
    poNumber: "PF-Wausau",
    vendorName: "Johnstone Supply",
    status: "pending",
    vendorPhysicalDropoffConfirmed: false,
    stagingLocationCodes: ["G2"],
  },
  {
    deliveryId: "verify-job-search-b",
    jobName: "Riverside Medical Center",
    orderNumber: "ORDER-200",
    vendorInvoiceNumber: "INV-JOB-200",
    poNumber: "2533636",
    vendorName: "Johnstone Supply",
    status: "pending",
    vendorPhysicalDropoffConfirmed: false,
    stagingLocationCodes: ["G2"],
  },
];

async function installSharedRoutes(page) {
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
}

async function installPinRoutes(page, { sessionExpiresAt } = {}) {
  const companyExpires =
    sessionExpiresAt ??
    new Date(Date.now() + 15 * 60_000).toISOString();
  await page.route("**/resolveLocationScanPin", async (route) => {
    const requestBody = parseCallablePostData(route);
    const pin = requestBody.data?.pin ?? "";
    if (!pin) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "invalid-argument", status: "INVALID_ARGUMENT" },
        }),
      });
      return;
    }
    if (pin === "1357") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            success: true,
            accessType: "vendor",
            sessionScope: "job",
            jobId: "job-verify-search",
            vendorId: "vendor-verify-job",
            vendorName: "Johnstone Supply",
            sessionToken: "verify-job-search-session",
            expiresAt: companyExpires,
            scannedStagingLocationCode: "G2",
          },
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
          expiresAt: companyExpires,
          scannedStagingLocationCode: "G2",
          sessionScope: "vendor",
          deliveryId: "verify-search-active-a",
        },
      }),
    });
  });
}

(async () => {
  const iPhone = devices["iPhone 13"];
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...iPhone,
  });
  await context.clock.install();
  const page = await context.newPage();

  await installSharedRoutes(page);
  await installPinRoutes(page);

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

  let jobListTappedDeliveryId = null;
  await page.route("**/getJobVendorDeliveries", async (route) => {
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
          jobId: "job-verify-search",
          scannedStagingLocationCode: "G2",
          deliveries: jobVendorRows,
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
  await page.route("**/recordVendorLocationScan", async (route) => {
    const requestBody = parseCallablePostData(route);
    jobListTappedDeliveryId = requestBody.data?.deliveryId ?? null;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: { ok: true, recorded: true } }),
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
    record("company search input font-size >= 16px", fontSizePx >= 16, `${fontSizePx}px`);

    const search = page.getByTestId("vendor-run-search");
    await search.fill("oak");
    record(
      "company filter shows matching row only",
      (await page.getByTestId("vendor-run-row-verify-search-active-b").count()) ===
        1 &&
        (await page.getByTestId("vendor-run-row-verify-search-active-a").count()) ===
          0,
    );

    await search.fill("zzznomatch");
    record(
      "company no matches empty state",
      await page.getByTestId("vendor-run-search-no-matches").isVisible(),
    );
    record(
      "company unplanned CTA visible on no-match",
      await page.getByTestId("vendor-unplanned-entry-cta").isVisible(),
    );

    await page.getByTestId("vendor-run-search-clear").click();
    record(
      "company clear restores full list",
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
      "company complete works on filtered row",
      bulkCompleteIds.includes("verify-search-active-a"),
      bulkCompleteIds.join(","),
    );

    await search.press("Enter");
    record(
      "company Enter dismisses keyboard without submitting",
      !(await page
        .getByTestId("vendor-run-complete-confirm-yes-verify-search-active-a")
        .isVisible()
        .catch(() => false)),
    );

    await search.fill("oak");
    await page.getByRole("button", { name: "← Back" }).click();
    await page.getByRole("heading", { name: "Enter PIN" }).waitFor({
      timeout: 20_000,
    });
    await enterPin(page, "9876");
    if (await verifyBtn.isVisible().catch(() => false)) {
      await verifyBtn.click();
    }
    await page.getByTestId("vendor-run-layout").waitFor({ timeout: 60_000 });
    await page.getByTestId("vendor-run-search").waitFor({ timeout: 20_000 });
    const searchAfterBack = await page.getByTestId("vendor-run-search").inputValue();
    record(
      "company search cleared after Back",
      searchAfterBack === "",
      searchAfterBack,
    );

    await search.fill("oak");
    await page.evaluate(() => {
      const key = "sv-vendor-run-pin:vendor-verify-search";
      const raw = sessionStorage.getItem(key);
      if (!raw) return;
      const session = JSON.parse(raw);
      session.expiresAt = new Date(Date.now() - 60_000).toISOString();
      sessionStorage.setItem(key, JSON.stringify(session));
    });
    await page.clock.fastForward(31_000);
    await page.getByRole("heading", { name: "Enter PIN" }).waitFor({
      timeout: 20_000,
    });
    await enterPin(page, "9876");
    if (await verifyBtn.isVisible().catch(() => false)) {
      await verifyBtn.click();
    }
    await page.getByTestId("vendor-run-layout").waitFor({ timeout: 60_000 });
    await page.getByTestId("vendor-run-search").waitFor({ timeout: 20_000 });
    const searchAfterExpiry = await page.getByTestId("vendor-run-search").inputValue();
    record(
      "company search cleared after PIN session expiry",
      searchAfterExpiry === "",
      searchAfterExpiry,
    );

    await page.getByRole("button", { name: "← Back" }).click();
    await page.getByRole("heading", { name: "Enter PIN" }).waitFor({
      timeout: 20_000,
    });
    await enterPin(page, "1357");
    if (await verifyBtn.isVisible().catch(() => false)) {
      await verifyBtn.click();
    }
    await page.getByTestId("vendor-job-deliveries").waitFor({ timeout: 60_000 });
    const jobSearch = page.getByTestId("vendor-run-search");
    await jobSearch.waitFor({ timeout: 20_000 });

    const jobFontPx = await jobSearch.evaluate((el) =>
      parseFloat(window.getComputedStyle(el).fontSize),
    );
    record("job search input font-size >= 16px", jobFontPx >= 16, `${jobFontPx}px`);

    await jobSearch.fill("inv-job-200");
    record(
      "job filter shows matching row only",
      (await page.getByTestId("vendor-job-delivery-verify-job-search-b").count()) ===
        1 &&
        (await page.getByTestId("vendor-job-delivery-verify-job-search-a").count()) ===
          0,
    );

    await jobSearch.fill("zzznomatch");
    record(
      "job no matches empty state",
      await page.getByTestId("vendor-run-search-no-matches").isVisible(),
    );
    record(
      "job list still shows Back footer on no-match",
      await page.getByRole("button", { name: "← Back" }).isVisible(),
    );

    await page.getByTestId("vendor-run-search-clear").click();
    record(
      "job clear restores full list",
      (await page.getByTestId("vendor-job-delivery-verify-job-search-a").count()) ===
        1 &&
        (await page.getByTestId("vendor-job-delivery-verify-job-search-b").count()) ===
          1,
    );

    await jobSearch.fill("inv-job-200");
    await page.getByTestId("vendor-job-delivery-verify-job-search-b").click();
    await page
      .waitForFunction(
        () =>
          window.location.hash.includes("verify-job-search-b") ||
          document.body.textContent?.includes("Could not open delivery"),
        { timeout: 15_000 },
      )
      .catch(() => {});
    record(
      "job tap opens only filtered row",
      jobListTappedDeliveryId === "verify-job-search-b",
      jobListTappedDeliveryId ?? "none",
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

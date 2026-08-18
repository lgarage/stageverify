/**
 * Phase-1 mobile load diagnosis against a live StageVerify URL.
 * Classifies network (static / Firestore / Functions / Auth / other)
 * and times login, dispatcher usable, invoice review, drawer, public routes.
 *
 * Run:
 *   STAGEVERIFY_BASE_URL=https://lgarage.github.io/stageverify \
 *     node scripts/measure-mobile-load-diagnosis.mjs
 */
import { chromium, devices } from "playwright";
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { loadEnvLocal, ensureAuthenticated } from "./dispatcherVerifyHelpers.mjs";

loadEnvLocal();

const baseUrl =
  process.env.STAGEVERIFY_BASE_URL ?? "https://lgarage.github.io/stageverify";
const appBase = resolveAppBase(baseUrl);
const outDir = resolve(process.cwd(), "artifacts");
mkdirSync(outDir, { recursive: true });

function classifyUrl(url) {
  const u = url.toLowerCase();
  if (
    u.includes("firestore.googleapis.com") ||
    u.includes("firestore.googleapis") ||
    u.includes("/google.firestore.") ||
    u.includes("listen/channel")
  ) {
    return "firestore";
  }
  if (
    u.includes("cloudfunctions.net") ||
    u.includes("cloudfunctions.googleapis.com") ||
    u.includes("/identify")
  ) {
    if (u.includes("identitytoolkit") || u.includes("securetoken")) return "auth";
    return "functions";
  }
  if (
    u.includes("identitytoolkit") ||
    u.includes("securetoken.googleapis.com") ||
    u.includes("accounts.google.com")
  ) {
    return "auth";
  }
  if (
    u.includes("lgarage.github.io") ||
    u.includes("localhost") ||
    u.endsWith(".js") ||
    u.endsWith(".css") ||
    u.endsWith(".svg") ||
    u.endsWith(".woff2")
  ) {
    return "static";
  }
  return "other";
}

function summarizeRequests(entries) {
  const byClass = {};
  const uniqueUrls = new Set();
  let transferred = 0;
  for (const e of entries) {
    byClass[e.cls] = (byClass[e.cls] ?? 0) + 1;
    uniqueUrls.add(e.url.split("?")[0]);
    transferred += e.size || 0;
  }
  const slowest = [...entries]
    .sort((a, b) => (b.duration || 0) - (a.duration || 0))
    .slice(0, 12)
    .map((e) => ({
      cls: e.cls,
      ms: Math.round(e.duration || 0),
      status: e.status,
      size: e.size,
      url: e.url.slice(0, 160),
    }));
  return {
    total: entries.length,
    uniqueUrls: uniqueUrls.size,
    byClass,
    transferredBytes: transferred,
    slowest,
  };
}

async function withCollector(page, fn) {
  const entries = [];
  const onReq = (req) => {
    req._svStart = Date.now();
  };
  const onFin = async (res) => {
    const req = res.request();
    const url = req.url();
    let size = 0;
    try {
      const body = await res.body();
      size = body.length;
    } catch {
      size = 0;
    }
    entries.push({
      url,
      cls: classifyUrl(url),
      method: req.method(),
      status: res.status(),
      size,
      duration: Date.now() - (req._svStart || Date.now()),
      resourceType: req.resourceType(),
    });
  };
  const onFail = (req) => {
    entries.push({
      url: req.url(),
      cls: classifyUrl(req.url()),
      method: req.method(),
      status: 0,
      size: 0,
      duration: Date.now() - (req._svStart || Date.now()),
      resourceType: req.resourceType(),
      failed: true,
    });
  };
  page.on("request", onReq);
  page.on("response", onFin);
  page.on("requestfailed", onFail);
  const t0 = Date.now();
  const result = await fn(t0);
  page.off("request", onReq);
  page.off("response", onFin);
  page.off("requestfailed", onFail);
  return { ...result, network: summarizeRequests(entries), elapsedMs: Date.now() - t0 };
}

async function waitMs(page, selector, timeout) {
  const t0 = Date.now();
  try {
    await page.locator(selector).first().waitFor({ state: "visible", timeout });
    return Date.now() - t0;
  } catch {
    return null;
  }
}

const report = {
  measuredAt: new Date().toISOString(),
  baseUrl: appBase,
  viewport: "iPhone 14",
  userAgent: devices["iPhone 14"].userAgent,
  phases: {},
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  ...devices["iPhone 14"],
  // First-visit phone: no HTTP cache, no prior auth.
});
await context.route("**/*", (route) => route.continue());
const page = await context.newPage();

// --- 1. Cold login / initial app ---
report.phases.initialLogin = await withCollector(page, async (t0) => {
  await page.goto(`${appBase}/#/login`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  const emailMs = await waitMs(page, "#email", 30_000);
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    const resources = performance
      .getEntriesByType("resource")
      .map((r) => ({
        name: r.name.slice(0, 160),
        dur: Math.round(r.duration),
        transfer: Math.round(r.transferSize || 0),
        encoded: Math.round(r.encodedBodySize || 0),
        decoded: Math.round(r.decodedBodySize || 0),
        type: r.initiatorType,
      }))
      .sort((a, b) => b.dur - a.dur)
      .slice(0, 20);
    return {
      domContentLoaded: n ? Math.round(n.domContentLoadedEventEnd) : null,
      loadEvent: n ? Math.round(n.loadEventEnd) : null,
      transferSize: n ? Math.round(n.transferSize || 0) : null,
      resources,
    };
  });
  return {
    emailFieldMs: emailMs,
    emailFieldFromStartMs: emailMs == null ? null : Date.now() - t0,
    navigation: nav,
  };
});

// --- 2. Public location-scan (technician/vendor door) ---
report.phases.locationScan = await withCollector(page, async (t0) => {
  await page.goto(`${appBase}/#/s?loc=G1`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  const pinMs = await waitMs(
    page,
    'input[inputmode="numeric"], input[type="password"], text=Enter PIN, text=PIN',
    25_000,
  );
  return {
    pinUiFromStartMs: Date.now() - t0,
    pinFieldWaitMs: pinMs,
    bodyPreview: (await page.locator("body").innerText().catch(() => "")).slice(0, 240),
  };
});

// --- 3. Vendor receive entry (unauthenticated) ---
report.phases.vendorReceiveBare = await withCollector(page, async (t0) => {
  await page.goto(`${appBase}/#/receive`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(2500);
  return {
    fromStartMs: Date.now() - t0,
    bodyPreview: (await page.locator("body").innerText().catch(() => "")).slice(0, 240),
  };
});

await browser.close();

// Fresh context for authenticated dispatcher (real phone session after login)
const browser2 = await chromium.launch({ headless: true });
const context2 = await browser2.newContext({
  ...devices["iPhone 14"],
});
const page2 = await context2.newPage();

report.phases.authAndDispatcherFirst = await withCollector(page2, async (t0) => {
  const authOutcome = await ensureAuthenticated(page2, appBase);
  const searchVisible = Date.now() - t0;
  const tableHeaderMs = await waitMs(
    page2,
    '[data-testid="dispatcher-deliveries-table"]',
    45_000,
  );
  // Wait until loading spinner gone / rows or empty
  let usableMs = null;
  try {
    await page2.waitForFunction(
      () => {
        const table = document.querySelector(
          '[data-testid="dispatcher-deliveries-table"]',
        );
        if (!table) return false;
        const section = table.closest(".admin-section") ?? table.parentElement;
        const loading = Boolean(
          section &&
            [...section.querySelectorAll("span")].some(
              (s) => s.textContent === "Loading…",
            ),
        );
        const empty = document.body.innerText.includes("No deliveries");
        return (
          !loading &&
          (empty ||
            document.querySelector('[data-testid^="dispatcher-delivery-row-"]'))
        );
      },
      { timeout: 60_000 },
    );
    usableMs = Date.now() - t0;
  } catch {
    usableMs = Date.now() - t0;
  }
  const invoiceHeading = await waitMs(
    page2,
    '[data-testid="needs-review-invoice-heading"]',
    15_000,
  );
  const rowCount = await page2
    .locator('[data-testid^="dispatcher-delivery-row-"]')
    .count()
    .catch(() => 0);
  return {
    authOutcome,
    searchVisibleMs: searchVisible,
    tableHeaderWaitMs: tableHeaderMs,
    dashboardUsableMs: usableMs,
    invoiceHeadingWaitMs: invoiceHeading,
    visibleRowCount: rowCount,
  };
});

// --- 4. Authenticated reload (session already live; still no HTTP cache) ---
report.phases.dispatcherReload = await withCollector(page2, async (t0) => {
  await page2.goto(`${appBase}/#/dispatcher`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  let usableMs = null;
  try {
    await page2.waitForFunction(
      () => {
        const table = document.querySelector(
          '[data-testid="dispatcher-deliveries-table"]',
        );
        if (!table) return false;
        const section = table.closest(".admin-section") ?? table.parentElement;
        const loading = Boolean(
          section &&
            [...section.querySelectorAll("span")].some(
              (s) => s.textContent === "Loading…",
            ),
        );
        const empty = document.body.innerText.includes("No deliveries");
        return (
          !loading &&
          (empty ||
            document.querySelector('[data-testid^="dispatcher-delivery-row-"]'))
        );
      },
      { timeout: 60_000 },
    );
    usableMs = Date.now() - t0;
  } catch {
    usableMs = Date.now() - t0;
  }
  return { dashboardUsableMs: usableMs };
});

// --- 5. Invoice review focus ---
report.phases.invoiceReviewFocus = await withCollector(page2, async (t0) => {
  await page2.goto(`${appBase}/#/invoice-review`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  const headingMs = await waitMs(
    page2,
    '[data-testid="needs-review-invoice-heading"]',
    30_000,
  );
  // Panel typically shows import rows or empty/loading copy
  await page2.waitForTimeout(2000);
  return {
    headingWaitMs: headingMs,
    fromStartMs: Date.now() - t0,
    bodyPreview: (await page2.locator("body").innerText().catch(() => "")).slice(
      0,
      400,
    ),
  };
});

// --- 6. Open first delivery drawer ---
report.phases.deliveryDrawer = await withCollector(page2, async (t0) => {
  await page2.goto(`${appBase}/#/dispatcher`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  try {
    await page2.waitForSelector('[data-testid^="dispatcher-delivery-row-"]', {
      timeout: 45_000,
    });
  } catch {
    return { skipped: true, reason: "no delivery rows" };
  }
  const listReadyMs = Date.now() - t0;
  const firstRow = page2.locator('[data-testid^="dispatcher-delivery-row-"]').first();
  await firstRow.click();
  let drawerMs = null;
  try {
    await page2
      .locator("text=Delivery Details")
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    drawerMs = Date.now() - t0 - listReadyMs;
  } catch {
    drawerMs = null;
  }
  // Wait for loading to finish if present
  try {
    await page2.waitForFunction(
      () => !document.body.innerText.includes("Unable to load delivery details"),
      { timeout: 5_000 },
    );
  } catch {
    /* ignore */
  }
  await page2.waitForTimeout(1500);
  const drawerText = (
    await page2.locator("body").innerText().catch(() => "")
  ).slice(0, 400);
  return {
    listReadyMs,
    drawerOpenMs: drawerMs,
    fromClickToNowMs: Date.now() - t0 - listReadyMs,
    drawerPreview: drawerText,
  };
});

await browser2.close();

const outPath = resolve(outDir, "mobile-load-diagnosis.json");
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nWrote ${outPath}`);

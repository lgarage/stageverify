/**
 * Playwright: authenticated internal portal shell at phone + desktop widths.
 *
 * Usage:
 *   npm run verify:internal-mobile-shell
 *   npm run verify:internal-mobile-shell:prod
 */

import { chromium } from "playwright";
import { resolveAppBase } from "./resolveAppBase.mjs";
import {
  assertReadableTextContrast,
  DISPATCHER_TOPBAR_CONTRAST_SPEC,
  INTERNAL_MOBILE_NAV_CONTRAST_SPEC,
} from "./lib/ui-text-contrast-lib.mjs";
import {
  ensureAuthenticated,
  loadEnvLocal,
} from "./dispatcherVerifyHelpers.mjs";

loadEnvLocal();

const baseUrl =
  process.argv.includes("--base-url")
    ? process.argv[process.argv.indexOf("--base-url") + 1]
    : process.argv.find((arg) => arg.startsWith("--base-url="))?.split("=")[1] ??
      process.env.STAGEVERIFY_BASE_URL ??
      "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);

const ROUTES = {
  dispatcher: {
    hash: "#/dispatcher",
    title: "Dispatcher Dashboard",
    heading: "Delivery Overview",
  },
  zones: {
    hash: "#/zones",
    title: "Staging Map",
    heading: "Staging Map",
  },
  vendors: {
    hash: "#/vendors",
    title: "Vendors",
    heading: "Vendors",
  },
  settings: {
    hash: "#/settings",
    title: "Settings",
    heading: "Settings",
  },
};

const MOBILE_NAV_TEST_IDS = [
  "portal-mobile-nav-dispatcher",
  "portal-mobile-nav-zones",
  "portal-mobile-nav-vendors",
  "portal-mobile-nav-settings",
];

async function waitForRoute(page, route) {
  await page.waitForURL((url) => url.hash.startsWith(route.hash), {
    timeout: 30_000,
  });
  await page
    .getByRole("heading", { name: route.heading, exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
  await page
    .getByTestId("dispatcher-portal-topbar")
    .waitFor({ state: "visible", timeout: 15_000 });
}

async function assertNoMobileShellOverflow(page, label) {
  const result = await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const topbar = document.querySelector(
      '[data-testid="dispatcher-portal-topbar"]',
    );
    const visibleControls = [
      "portal-mobile-nav-toggle",
      "dispatcher-topbar-breadcrumb",
      "vendor-communications-entry",
      "catch-all-delivery-btn",
      "dispatcher-new-delivery",
      "dispatcher-refresh-now",
    ]
      .map((testId) =>
        document.querySelector(`[data-testid="${testId}"]`),
      )
      .filter((element) => {
        if (!element) return false;
        const style = getComputedStyle(element);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          element.getBoundingClientRect().width > 0
        );
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          testId: element.getAttribute("data-testid"),
          left: rect.left,
          right: rect.right,
        };
      });
    const escaped = visibleControls.filter(
      ({ left, right }) => left < -1 || right > viewportWidth + 1,
    );
    const topbarRect = topbar?.getBoundingClientRect();

    const intentionalWide = (el) => {
      if (!el || !(el instanceof Element)) return false;
      if (
        el.closest(
          '[data-testid="shop-map-viewport"], [data-testid="shop-map-canvas"], [data-testid="shop-map-zoom-spacer"]',
        )
      ) {
        return true;
      }
      const scroller = el.closest("div");
      if (!scroller) return false;
      // Wide tables/maps are OK only inside an overflow-x scroller.
      let node = el.parentElement;
      while (node && node !== document.body) {
        const ox = getComputedStyle(node).overflowX;
        if (ox === "auto" || ox === "scroll") return true;
        node = node.parentElement;
      }
      return false;
    };

    const contentOffenders = [];
    for (const el of document.querySelectorAll(
      ".portal-scroll h1, .portal-scroll p, .portal-scroll .admin-card, .portal-scroll .admin-section, .portal-scroll [data-invoice-fields], .portal-scroll [data-testid='invoice-review-pending-fields'], .portal-scroll [data-testid='needs-review-email-toggle'], .portal-scroll [data-testid='dispatcher-page-heading']",
    )) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1) continue;
      if (intentionalWide(el)) continue;
      if (rect.right > viewportWidth + 1 || rect.left < -1) {
        contentOffenders.push({
          testId: el.getAttribute("data-testid"),
          tag: el.tagName,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          text: (el.textContent || "").trim().slice(0, 48),
        });
      }
    }

    return {
      viewportWidth,
      documentWidth: document.documentElement.scrollWidth,
      topbarLeft: topbarRect?.left ?? null,
      topbarRight: topbarRect?.right ?? null,
      escaped,
      contentOffenders: contentOffenders.slice(0, 8),
      actionsGridColumns: getComputedStyle(
        document.querySelector('[data-testid="dispatcher-topbar-actions"]') ||
          document.body,
      ).gridTemplateColumns,
    };
  });

  if (result.documentWidth > result.viewportWidth + 1) {
    throw new Error(
      `${label}: document overflow (${result.documentWidth}px > ${result.viewportWidth}px)`,
    );
  }
  if (
    result.topbarLeft == null ||
    result.topbarRight == null ||
    result.topbarLeft < -1 ||
    result.topbarRight > result.viewportWidth + 1
  ) {
    throw new Error(`${label}: top bar extends outside the viewport`);
  }
  if (result.escaped.length > 0) {
    throw new Error(
      `${label}: top bar controls escaped viewport: ${JSON.stringify(result.escaped)}`,
    );
  }
  if (result.contentOffenders.length > 0) {
    throw new Error(
      `${label}: content overflow: ${JSON.stringify(result.contentOffenders)}`,
    );
  }
  const trackCount = (result.actionsGridColumns || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  if (result.viewportWidth <= 767 && trackCount > 1) {
    throw new Error(
      `${label}: top bar actions should be single-column on phone (got ${result.actionsGridColumns})`,
    );
  }
}

async function openAndAssertMobileDrawer(page, route) {
  const toggle = page.getByTestId("portal-mobile-nav-toggle");
  if (!(await toggle.isVisible())) {
    throw new Error(`${route.title}: mobile navigation toggle is not visible`);
  }

  const desktopSidebar = page.locator(".portal-shell > .portal-sidebar").first();
  if (await desktopSidebar.isVisible().catch(() => false)) {
    throw new Error(`${route.title}: desktop sidebar must be hidden at 390px`);
  }

  const title = page
    .getByTestId("dispatcher-topbar-breadcrumb")
    .locator("span")
    .first();
  await title.waitFor({ state: "visible", timeout: 10_000 });
  if (!((await title.innerText()).trim().includes(route.title))) {
    throw new Error(
      `${route.title}: top bar title is not understandable (${await title.innerText()})`,
    );
  }

  await assertNoMobileShellOverflow(page, route.title);
  await assertReadableTextContrast(page, DISPATCHER_TOPBAR_CONTRAST_SPEC);

  await toggle.click();
  const drawer = page.getByTestId("portal-mobile-nav-drawer");
  await drawer.waitFor({ state: "visible", timeout: 10_000 });
  for (const testId of MOBILE_NAV_TEST_IDS) {
    if (!(await page.getByTestId(testId).isVisible())) {
      throw new Error(`${route.title}: drawer destination ${testId} missing`);
    }
  }
  if (!(await page.getByTestId("portal-mobile-sign-out").isVisible())) {
    throw new Error(`${route.title}: Sign Out is not reachable in mobile drawer`);
  }
  if (!(await page.getByTestId("portal-mobile-appearance").isVisible())) {
    throw new Error(`${route.title}: appearance toggle missing from mobile drawer`);
  }
  await assertReadableTextContrast(page, INTERNAL_MOBILE_NAV_CONTRAST_SPEC);
}

async function navigateFromDrawer(page, testId, route) {
  await page.getByTestId(testId).click();
  await waitForRoute(page, route);
  await page
    .getByTestId("portal-mobile-nav-drawer")
    .waitFor({ state: "detached", timeout: 10_000 });
}

async function assertContentScrolls(page) {
  const scroll = page.locator(".portal-scroll").first();
  const result = await scroll.evaluate((element) => {
    const before = element.scrollTop;
    element.scrollTop = Math.min(160, element.scrollHeight);
    return {
      overflowY: getComputedStyle(element).overflowY,
      before,
      after: element.scrollTop,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    };
  });
  if (!["auto", "scroll"].includes(result.overflowY)) {
    throw new Error(`Portal content overflow-y must be scrollable, got ${result.overflowY}`);
  }
  if (result.scrollHeight <= result.clientHeight || result.after <= result.before) {
    throw new Error(
      `Settings portal content did not scroll (${result.scrollHeight}/${result.clientHeight})`,
    );
  }
}

async function assertCollapsedMobileLists(page, width) {
  const list = page.getByTestId("dispatcher-deliveries-mobile-list");
  await list.waitFor({ state: "visible", timeout: 30_000 });

  if (await page.getByTestId("dispatcher-deliveries-table").isVisible().catch(() => false)) {
    throw new Error(`${width}: desktop deliveries table must not show on phone`);
  }

  const cards = page.locator('[data-testid^="dispatcher-delivery-mobile-card-"]');
  const cardCount = await cards.count();
  if (cardCount === 0) {
    console.log(`${width}: no delivery cards (empty filters) — skip expand/collapse`);
  } else {
    for (let i = 0; i < Math.min(cardCount, 3); i += 1) {
      const card = cards.nth(i);
      const expanded = await card.getAttribute("data-expanded");
      if (expanded !== "false") {
        throw new Error(`${width}: delivery card ${i} should default collapsed`);
      }
    }
    const firstToggle = page.locator('[data-testid^="dispatcher-delivery-mobile-toggle-"]').first();
    await firstToggle.click();
    const firstCard = cards.first();
    if ((await firstCard.getAttribute("data-expanded")) !== "true") {
      throw new Error(`${width}: delivery card did not expand`);
    }
    const details = page.locator('[data-testid^="dispatcher-delivery-mobile-details-"]').first();
    await details.waitFor({ state: "visible", timeout: 5_000 });
    await firstToggle.click();
    if ((await firstCard.getAttribute("data-expanded")) !== "false") {
      throw new Error(`${width}: delivery card did not collapse again`);
    }
  }

  await page.getByTestId("invoice-review-panel").waitFor({ state: "visible", timeout: 30_000 });
  await page
    .locator(
      '[data-testid="invoice-review-queue"], [data-testid="invoice-review-empty"], [data-testid="invoice-review-approved-empty"]',
    )
    .first()
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => {});
  const invoiceRows = page.locator('[data-testid^="invoice-review-queue-row-"]');
  const invoiceCount = await invoiceRows.count();
  if (invoiceCount === 0) {
    console.log(`${width}: no invoice review rows — skip invoice collapse`);
  } else {
    for (let i = 0; i < Math.min(invoiceCount, 3); i += 1) {
      const row = invoiceRows.nth(i);
      const expanded = await row.getAttribute("data-expanded");
      if (expanded !== "false") {
        throw new Error(`${width}: invoice row ${i} should default collapsed`);
      }
      if (
        await row
          .locator('[data-testid^="invoice-review-mobile-details-"]')
          .isVisible()
          .catch(() => false)
      ) {
        throw new Error(`${width}: invoice details visible while collapsed`);
      }
    }
    const invToggle = page.locator('[data-testid^="invoice-review-mobile-toggle-"]').first();
    await invToggle.scrollIntoViewIfNeeded();
    await invToggle.click();
    const firstInv = invoiceRows.first();
    if ((await firstInv.getAttribute("data-expanded")) !== "true") {
      throw new Error(`${width}: invoice row did not expand`);
    }
    await firstInv
      .locator('[data-testid^="invoice-review-mobile-details-"]')
      .waitFor({ state: "visible", timeout: 5_000 });
    await invToggle.click();
    if ((await firstInv.getAttribute("data-expanded")) !== "false") {
      throw new Error(`${width}: invoice row did not collapse again`);
    }
  }

  // Character-by-character wrap heuristic: no element with width < 28 and text length > 8
  // in the mobile delivery list (narrow columns force per-char wrap).
  const wrapOffenders = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="dispatcher-deliveries-mobile-list"]');
    if (!root) return [{ reason: "missing-mobile-list" }];
    const bad = [];
    for (const el of root.querySelectorAll("span, div, button, td, th")) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length < 10) continue;
      if (rect.width < 36 && text.length > 12) {
        bad.push({
          w: Math.round(rect.width),
          text: text.slice(0, 40),
        });
      }
    }
    return bad.slice(0, 5);
  });
  if (wrapOffenders.length > 0) {
    throw new Error(
      `${width}: suspected ultra-narrow wrap: ${JSON.stringify(wrapOffenders)}`,
    );
  }
}

async function verifyMobileAtWidth(browser, width) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
  });
  const page = await context.newPage();
  const authOutcome = await ensureAuthenticated(page, appBase);
  console.log(`Mobile ${width} auth: ${authOutcome}`);

  await waitForRoute(page, ROUTES.dispatcher);
  await assertCollapsedMobileLists(page, width);
  await assertNoMobileShellOverflow(page, "Dispatcher collapsed lists");
  await openAndAssertMobileDrawer(page, ROUTES.dispatcher);
  await navigateFromDrawer(page, "portal-mobile-nav-zones", ROUTES.zones);

  await openAndAssertMobileDrawer(page, ROUTES.zones);
  await navigateFromDrawer(page, "portal-mobile-nav-vendors", ROUTES.vendors);

  await openAndAssertMobileDrawer(page, ROUTES.vendors);
  await navigateFromDrawer(page, "portal-mobile-nav-settings", ROUTES.settings);

  await openAndAssertMobileDrawer(page, ROUTES.settings);
  await page.getByTestId("portal-mobile-nav-close").click();
  await page
    .getByTestId("portal-mobile-nav-drawer")
    .waitFor({ state: "detached", timeout: 10_000 });
  await assertContentScrolls(page);

  await page.getByTestId("portal-mobile-nav-toggle").click();
  await navigateFromDrawer(
    page,
    "portal-mobile-nav-dispatcher",
    ROUTES.dispatcher,
  );

  if (width === 390) {
    await page.evaluate(() => localStorage.setItem("stageverify-theme", "dark"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForRoute(page, ROUTES.dispatcher);
    await openAndAssertMobileDrawer(page, ROUTES.dispatcher);
    await page
      .getByTestId("portal-mobile-nav-backdrop")
      .click({ position: { x: Math.min(370, width - 20), y: 400 } });
    await page
      .getByTestId("portal-mobile-nav-drawer")
      .waitFor({ state: "detached", timeout: 10_000 });
  }

  console.log(
    `PASS: mobile ${width}x844 — routes, drawer, actions, no content overflow.`,
  );
  await context.close();
}

async function verifyMobile(browser) {
  for (const width of [360, 375, 390]) {
    await verifyMobileAtWidth(browser, width);
  }
}

async function verifyDesktop(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const authOutcome = await ensureAuthenticated(page, appBase);
  console.log(`Desktop auth: ${authOutcome}`);
  await waitForRoute(page, ROUTES.dispatcher);

  if (await page.getByTestId("portal-mobile-nav-toggle").isVisible()) {
    throw new Error("Desktop: mobile navigation toggle must be hidden");
  }
  const sidebar = page.locator(".portal-shell > .portal-sidebar").first();
  const display = await sidebar.evaluate((element) => getComputedStyle(element).display);
  if (display !== "flex") {
    throw new Error(`Desktop: sidebar display expected flex, got ${display}`);
  }

  // Desktop: table visible, mobile accordion hidden
  if (await page.getByTestId("dispatcher-deliveries-mobile-list").isVisible().catch(() => false)) {
    throw new Error("Desktop: mobile deliveries list must be hidden");
  }
  if (!(await page.getByTestId("dispatcher-deliveries-table").isVisible())) {
    throw new Error("Desktop: deliveries table must remain visible");
  }

  for (const [label, route] of [
    ["Staging Map", ROUTES.zones],
    ["Vendors", ROUTES.vendors],
    ["Settings", ROUTES.settings],
    ["Dispatcher Dashboard", ROUTES.dispatcher],
  ]) {
    await sidebar.getByRole("link", { name: label, exact: true }).click();
    await waitForRoute(page, route);
  }
  console.log("PASS: desktop 1280 — sidebar visible, hamburger hidden, table preserved, all links work.");
  await context.close();
}

const browser = await chromium.launch({ headless: true });
try {
  await verifyMobile(browser);
  await verifyDesktop(browser);
  console.log("verify:internal-mobile-shell PASS");
} finally {
  await browser.close();
}

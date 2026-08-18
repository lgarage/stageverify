/**
 * Vendor post-PIN job-selection list polish (390 iPhone viewport).
 * Presentation + D-42 contrast + order-tap behavior. Job PIN 1234 @ G1.
 *
 * Usage:
 *   npm run dev
 *   node scripts/verify-vendor-job-list.mjs
 *   STAGEVERIFY_BASE_URL=https://lgarage.github.io/stageverify node scripts/verify-vendor-job-list.mjs
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { assertReadableTextContrast } from "./lib/ui-text-contrast-lib.mjs";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  }
}

const baseUrl = process.env.STAGEVERIFY_BASE_URL ?? "http://localhost:5173";
const appBase = resolveAppBase(baseUrl);
const jobPin = process.env.STAGEVERIFY_JOB1_PIN ?? "1234";
const loc = process.env.STAGEVERIFY_SIGN_LOC ?? "G1";
const withPoOrder = process.env.STAGEVERIFY_VENDOR_ORDER ?? "ORD-005";
const outDir = resolve(process.cwd(), "screenshots", "vendor-job-list");
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
  const verifyBtn = page.getByTestId("location-scan-pin-verify");
  if (await verifyBtn.isVisible().catch(() => false)) {
    await verifyBtn.click();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  try {
    await page.goto(`${appBase}/#/s?loc=${encodeURIComponent(loc)}&_t=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.getByTestId("location-scan-pin-keypad").waitFor({ timeout: 20_000 });
    await enterPin(page, jobPin.split(""));
    await page.getByTestId("vendor-job-deliveries").waitFor({ timeout: 45_000 });
    record("job list lands after PIN", true);

    const heading = await page
      .getByRole("heading", { name: /DELIVERIES$/i })
      .isVisible();
    record("primary heading visible", heading);
    const headingText = (
      (await page.getByRole("heading", { name: /DELIVERIES$/i }).textContent()) ??
      ""
    ).trim();
    record(
      "heading uses vendor name + DELIVERIES",
      /^.+\sDELIVERIES$/.test(headingText) &&
        !/this job/i.test(headingText) &&
        headingText.length > "DELIVERIES".length,
      headingText,
    );
    const headingOverflow = await page.evaluate(() => {
      const h1 = document.querySelector(
        '[data-testid="vendor-job-deliveries"] h1',
      );
      if (!h1) return true;
      return h1.scrollWidth > h1.clientWidth + 1;
    });
    record("heading wraps without overflow", !headingOverflow);

    const helper = await page
      .getByText("Select an order to confirm delivery")
      .isVisible();
    record("helper copy visible", helper);

    const cards = page.locator('[data-testid^="vendor-job-delivery-"]');
    const cardCount = await cards.count();
    record("multiple available orders", cardCount >= 2, `count=${cardCount}`);

    const metrics = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="vendor-job-deliveries"]');
      const header = root?.querySelector("header");
      const main = root?.querySelector("main");
      const footer = root?.querySelector("footer");
      const cardEls = [...(root?.querySelectorAll('[data-testid^="vendor-job-delivery-"]') ?? [])];
      const back = [...(footer?.querySelectorAll("button") ?? [])].find((b) =>
        b.textContent?.includes("← Back"),
      );
      const cs = (el) => (el ? getComputedStyle(el) : null);
      const cardRects = cardEls.map((el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const order = el.querySelector(".vendor-job-delivery-order");
        const po = el.querySelector(".vendor-job-delivery-po");
        const chips = [...el.querySelectorAll(".vendor-job-delivery-staging-values > span")].map(
          (s) => (s.textContent ?? "").trim(),
        );
        return {
          top: r.top,
          bottom: r.bottom,
          height: r.height,
          width: r.width,
          overflowX: el.scrollWidth > el.clientWidth + 1,
          pad: parseFloat(style.paddingTop ?? "0"),
          bg: style.backgroundColor,
          orderText: (order?.textContent ?? "").trim(),
          orderOverflow: order ? order.scrollWidth > order.clientWidth + 1 : false,
          poText: (po?.textContent ?? "").trim(),
          chips,
        };
      });
      const gap =
        cardRects.length >= 2 ? cardRects[1].top - cardRects[0].bottom : null;
      const backRect = back?.getBoundingClientRect();
      return {
        headerPl: parseFloat(cs(header)?.paddingLeft ?? "0"),
        headerPt: parseFloat(cs(header)?.paddingTop ?? "0"),
        mainPl: parseFloat(cs(main)?.paddingLeft ?? "0"),
        footerPb: parseFloat(cs(footer)?.paddingBottom ?? "0"),
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
        rootOverflowX: (root?.scrollWidth ?? 0) > (root?.clientWidth ?? 0) + 1,
        cardCount: cardEls.length,
        cardRects,
        gap,
        sameBackground: new Set(cardRects.map((c) => c.bg)).size === 1,
        backBottom: backRect?.bottom ?? -1,
        backHeight: backRect?.height ?? -1,
        backVisible: Boolean(back && backRect && backRect.bottom <= window.innerHeight + 1),
      };
    });

    const spacingOk =
      metrics.headerPl >= 15 &&
      metrics.headerPt >= 12 &&
      metrics.mainPl >= 15 &&
      metrics.cardRects.every((c) => c.pad >= 15 && c.height >= 44) &&
      (metrics.gap ?? 16) >= 12 &&
      metrics.footerPb >= 12 &&
      metrics.backVisible &&
      metrics.backHeight >= 40;
    record(
      "mobile spacing + footer Back in viewport",
      spacingOk,
      JSON.stringify({
        headerPl: metrics.headerPl,
        headerPt: metrics.headerPt,
        mainPl: metrics.mainPl,
        footerPb: metrics.footerPb,
        gap: metrics.gap,
        backBottom: metrics.backBottom,
        backHeight: metrics.backHeight,
        viewportH: metrics.viewportH,
      }),
    );
    record("narrow iPhone viewport", metrics.viewportW === 390, `w=${metrics.viewportW}`);
    record("no horizontal overflow", !metrics.rootOverflowX && metrics.cardRects.every((c) => !c.overflowX && !c.orderOverflow));
    record("distinct cards (gap + independent buttons)", (metrics.gap ?? 0) >= 12 && metrics.cardCount >= 2);

    const withPo = metrics.cardRects.find((c) => c.orderText === withPoOrder);
    const withoutPo = metrics.cardRects.find((c) => c.orderText && c.orderText !== withPoOrder && !c.poText);
    const withSpots = metrics.cardRects.find((c) => c.chips.some((chip) => chip && chip !== "Not assigned yet"));
    const withoutSpots = metrics.cardRects.find((c) => c.chips.includes("Not assigned yet"));
    const longId = metrics.cardRects.find((c) => c.orderText.length >= 16);

    record(`order with PO (${withPoOrder})`, Boolean(withPo?.poText) && !/^PO PO/i.test(withPo?.poText ?? ""), withPo?.poText ?? "missing");
    record("order without PO", Boolean(withoutPo), withoutPo?.orderText ?? "missing");
    record("order with staging locations", Boolean(withSpots), withSpots?.chips.join(",") ?? "missing");
    record("order without staging (calm, not error)", Boolean(withoutSpots), withoutSpots?.chips.join(",") ?? "missing");
    record("long order identifier wraps", Boolean(longId) && !longId?.orderOverflow, longId?.orderText ?? "missing");

    const singleCard = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-testid^="vendor-job-delivery-"]')];
      cards.slice(1).forEach((el) => {
        el.dataset.prevDisplay = el.style.display;
        el.style.display = "none";
      });
      const visible = cards.find((el) => el.style.display !== "none");
      const r = visible?.getBoundingClientRect();
      const style = visible ? getComputedStyle(visible) : null;
      return {
        visibleCount: cards.filter((el) => el.style.display !== "none").length,
        pad: parseFloat(style?.paddingTop ?? "0"),
        height: r?.height ?? 0,
        radius: style?.borderRadius ?? "",
      };
    });
    record(
      "single available order still a distinct card",
      singleCard.visibleCount === 1 && singleCard.pad >= 15 && singleCard.height >= 44,
      JSON.stringify(singleCard),
    );
    await page.screenshot({
      path: resolve(outDir, "single-order.png"),
      fullPage: false,
    });
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('[data-testid^="vendor-job-delivery-"]')) {
        el.style.display = el.dataset.prevDisplay ?? "";
        delete el.dataset.prevDisplay;
      }
    });

    await assertReadableTextContrast(page, {
      rootSelector: '[data-testid="vendor-job-deliveries"]',
      elements: [
        { name: "title", selector: "h1", large: true },
        { name: "helper", selector: ".vendor-job-deliveries-helper" },
        { name: "order", selector: ".vendor-job-delivery-order", large: true },
        { name: "back", selector: "footer button" },
      ],
    });
    record("D-42 contrast", true);

    await page.screenshot({
      path: resolve(outDir, "verify-loaded.png"),
      fullPage: false,
    });

    await page.getByRole("button", { name: new RegExp(withPoOrder) }).click();
    await page.getByTestId("vendor-mark-delivered").waitFor({ timeout: 25_000 });
    record("order selection opens hub (unchanged behavior)", true);

    await page.getByRole("button", { name: "← Back" }).click();
    await page.getByTestId("vendor-job-deliveries").waitFor({ timeout: 15_000 });
    record("Back from hub returns to job list", true);
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

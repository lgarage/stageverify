/**
 * Visual inspection script - measures CSS properties on both applications
 * and takes screenshots for comparison.
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "screenshots");
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const HVAC_URL = "https://lgarage.github.io/HVAC_REPAIR_QUOTING_TOOL/";
const SV_URL = "https://lgarage.github.io/stageverify/#/dispatcher";

async function measure(page, label) {
  const data = await page.evaluate(() => {
    function cs(el) {
      return window.getComputedStyle(el);
    }

    // Helper: pick the first matching selector
    function first(sel) {
      return document.querySelector(sel);
    }

    // body
    const body = document.body;
    const bodyStyle = cs(body);

    // Sidebar
    const sidebar = first(
      "aside, nav.sidebar, [class*=sidebar], [class*=Sidebar], #sidebar, .sidenav, .side-nav",
    );

    // Main container / content area
    const main = first(
      "main, [class*=main-content], [class*=mainContent], .content, #content",
    );

    // Page heading h1 or equivalent
    const h1 = first("h1");

    // Card / panel
    const card = first(".card, [class*=card], [class*=Card], .panel");

    // Table
    const table = first("table");
    const thead = first("thead th, th");
    const tbody_row = first("tbody tr, tr:not(thead tr)");
    const tbody_td = first("tbody td, td");

    // Input
    const input = first(
      "input[type=text], input[type=search], input:not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button])",
    );

    // Button (first visible non-nav button)
    const btn = first("button:not([class*=nav]):not([class*=Nav])");

    // Status badge / chip
    const badge = first(
      "[class*=badge], [class*=Badge], [class*=chip], [class*=Chip], [class*=pill], [class*=status]",
    );

    function measureEl(el) {
      if (!el) return null;
      const s = cs(el);
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        className: el.className,
        width: r.width,
        height: r.height,
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        lineHeight: s.lineHeight,
        color: s.color,
        backgroundColor: s.backgroundColor,
        padding: s.padding,
        paddingTop: s.paddingTop,
        paddingRight: s.paddingRight,
        paddingBottom: s.paddingBottom,
        paddingLeft: s.paddingLeft,
        margin: s.margin,
        marginTop: s.marginTop,
        borderRadius: s.borderRadius,
        border: s.border,
        borderColor: s.borderColor,
        boxShadow: s.boxShadow,
        letterSpacing: s.letterSpacing,
        textTransform: s.textTransform,
      };
    }

    // Page background
    const pageBg =
      cs(document.documentElement).backgroundColor || cs(body).backgroundColor;

    // Top bar / header
    const topbar = first(
      "header, [class*=header], [class*=Header], [class*=topbar], [class*=TopBar], .navbar, .top-bar",
    );

    // Section title labels (uppercase tracking)
    const sectionLabel = first(
      "[class*=section-title], [class*=sectionTitle], .label, h2, h3",
    );

    return {
      page: {
        background: pageBg,
        fontFamily: bodyStyle.fontFamily,
        fontSize: bodyStyle.fontSize,
      },
      sidebar: measureEl(sidebar),
      topbar: measureEl(topbar),
      main: measureEl(main),
      h1: measureEl(h1),
      sectionLabel: measureEl(sectionLabel),
      card: measureEl(card),
      table: measureEl(table),
      thead: measureEl(thead),
      tbody_row: measureEl(tbody_row),
      tbody_td: measureEl(tbody_td),
      input: measureEl(input),
      button: measureEl(btn),
      badge: measureEl(badge),
      url: window.location.href,
    };
  });
  console.log(`\n${"=".repeat(70)}`);
  console.log(`MEASUREMENTS: ${label}`);
  console.log("=".repeat(70));
  console.log(JSON.stringify(data, null, 2));
  return data;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  // ── HVAC Tool ────────────────────────────────────────────────────────────
  console.log("\nNavigating to HVAC Repair Quoting Tool…");
  const hvacPage = await context.newPage();
  await hvacPage.goto(HVAC_URL, { waitUntil: "networkidle", timeout: 30000 });
  await hvacPage.waitForTimeout(2000);
  await hvacPage.screenshot({
    path: path.join(OUT_DIR, "hvac-before.png"),
    fullPage: true,
  });
  console.log(`Screenshot: ${path.join(OUT_DIR, "hvac-before.png")}`);
  const hvacData = await measure(hvacPage, "HVAC Repair Quoting Tool");

  // ── StageVerify ─────────────────────────────────────────────────────────
  console.log("\nNavigating to StageVerify Dispatcher…");
  const svPage = await context.newPage();
  await svPage.goto(SV_URL, { waitUntil: "networkidle", timeout: 30000 });
  await svPage.waitForTimeout(2000);
  await svPage.screenshot({
    path: path.join(OUT_DIR, "stageverify-before.png"),
    fullPage: true,
  });
  console.log(`Screenshot: ${path.join(OUT_DIR, "stageverify-before.png")}`);
  const svData = await measure(svPage, "StageVerify Dispatcher");

  // ── Detailed HVAC measurements ─────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  console.log("DETAILED HVAC PROPERTY AUDIT");
  console.log("=".repeat(70));
  const hvacDetail = await hvacPage.evaluate(() => {
    function cs(el) {
      return el ? window.getComputedStyle(el) : {};
    }

    // All headings
    const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4"))
      .slice(0, 8)
      .map((h) => {
        const s = cs(h);
        return {
          tag: h.tagName,
          text: h.textContent?.trim().slice(0, 40),
          fontSize: s.fontSize,
          fontWeight: s.fontWeight,
          color: s.color,
          letterSpacing: s.letterSpacing,
          textTransform: s.textTransform,
        };
      });

    // All buttons (sample first 5)
    const buttons = Array.from(document.querySelectorAll("button"))
      .slice(0, 5)
      .map((b) => {
        const s = cs(b);
        const r = b.getBoundingClientRect();
        return {
          text: b.textContent?.trim().slice(0, 20),
          height: r.height,
          padding: s.padding,
          fontSize: s.fontSize,
          fontWeight: s.fontWeight,
          borderRadius: s.borderRadius,
          backgroundColor: s.backgroundColor,
          color: s.color,
          border: s.border,
        };
      });

    // Table headers
    const ths = Array.from(document.querySelectorAll("th"))
      .slice(0, 3)
      .map((th) => {
        const s = cs(th);
        const r = th.getBoundingClientRect();
        return {
          text: th.textContent?.trim().slice(0, 20),
          height: r.height,
          padding: s.padding,
          fontSize: s.fontSize,
          fontWeight: s.fontWeight,
          color: s.color,
          backgroundColor: s.backgroundColor,
          letterSpacing: s.letterSpacing,
          textTransform: s.textTransform,
        };
      });

    // Table cells
    const tds = Array.from(document.querySelectorAll("td"))
      .slice(0, 3)
      .map((td) => {
        const s = cs(td);
        const r = td.getBoundingClientRect();
        return {
          height: r.height,
          padding: s.padding,
          fontSize: s.fontSize,
          lineHeight: s.lineHeight,
          color: s.color,
          borderBottom: s.borderBottom,
        };
      });

    // Cards / panels
    const cards = Array.from(
      document.querySelectorAll(
        "[class*=card i], [class*=panel i], [class*=widget i], [class*=box i]",
      ),
    )
      .slice(0, 3)
      .map((c) => {
        const s = cs(c);
        const r = c.getBoundingClientRect();
        return {
          className: c.className.slice(0, 60),
          width: r.width,
          height: r.height,
          padding: s.padding,
          borderRadius: s.borderRadius,
          backgroundColor: s.backgroundColor,
          boxShadow: s.boxShadow,
          border: s.border,
        };
      });

    // Sidebar
    const sidebar = document.querySelector(
      "aside, nav, [class*=sidebar i], [class*=side-nav i]",
    );
    const sidebarStyle = cs(sidebar);

    // Content area
    const content = document.querySelector(
      "main, [class*=content i], [class*=main i]",
    );
    const contentStyle = cs(content);

    // Body / root
    const rootEl =
      document.querySelector("#root, #app, #__next") || document.body;
    const rootStyle = cs(rootEl);

    return {
      headings,
      buttons,
      tableHeaders: ths,
      tableCells: tds,
      cards,
      sidebar: sidebar
        ? {
            className: sidebar.className,
            width: sidebar.getBoundingClientRect().width,
            backgroundColor: sidebarStyle.backgroundColor,
            padding: sidebarStyle.padding,
            borderRight: sidebarStyle.borderRight,
            fontFamily: sidebarStyle.fontFamily,
          }
        : null,
      content: content
        ? {
            className: content.className,
            padding: contentStyle.padding,
            backgroundColor: contentStyle.backgroundColor,
            maxWidth: contentStyle.maxWidth,
          }
        : null,
      bodyColors: {
        bg: cs(document.body).backgroundColor,
        color: cs(document.body).color,
        fontFamily: cs(document.body).fontFamily,
      },
      rootPadding: rootStyle.padding,
    };
  });
  console.log(JSON.stringify(hvacDetail, null, 2));

  await browser.close();

  // Save summary
  const summary = { hvac: hvacData, sv: svData, hvacDetail };
  fs.writeFileSync(
    path.join(OUT_DIR, "measurements.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(
    `\nMeasurements saved: ${path.join(OUT_DIR, "measurements.json")}`,
  );
})();

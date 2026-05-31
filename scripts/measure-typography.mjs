/**
 * Focused typography measurement script.
 * Measures font family, size, weight, letter-spacing, line-height
 * on the HVAC Repair Quoting Tool and StageVerify Dispatcher.
 */
import { chromium } from "playwright";

const HVAC_URL = "https://lgarage.github.io/HVAC_REPAIR_QUOTING_TOOL/";
const SV_URL = "https://lgarage.github.io/stageverify/#/dispatcher";

async function measureTypography(page, label) {
  const data = await page.evaluate(() => {
    function cs(el) {
      return el ? window.getComputedStyle(el) : null;
    }
    function typo(el) {
      if (!el) return null;
      const s = cs(el);
      return {
        tag: el.tagName,
        text: el.textContent?.trim().slice(0, 50),
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        letterSpacing: s.letterSpacing,
        lineHeight: s.lineHeight,
        textTransform: s.textTransform,
        wordSpacing: s.wordSpacing,
      };
    }

    const sel = (s) => document.querySelector(s);
    const selAll = (s) => Array.from(document.querySelectorAll(s));

    // Body
    const body = typo(document.body);

    // Nav / sidebar links
    const navLinks = selAll(".sidebar-menu a, aside a, nav a")
      .slice(0, 3)
      .map(typo);

    // Top bar title
    const topbarTitle = typo(
      sel("header span, .topbar span, [class*=topbar] span"),
    );

    // Page heading h1
    const h1 = typo(sel("h1"));

    // Section labels (uppercase small text)
    const sectionLabels = selAll("label, th").slice(0, 5).map(typo);

    // Table headers
    const tableHeaders = selAll("th").slice(0, 5).map(typo);

    // Table cells
    const tableCells = selAll("td").slice(0, 5).map(typo);

    // Buttons
    const buttons = selAll(
      "button:not([style*='display:none']):not([style*='display: none'])",
    )
      .slice(0, 5)
      .map(typo);

    // Status badges
    const badges = selAll(
      "[class*=badge], [class*=Badge], [class*=chip], [class*=Chip]",
    )
      .slice(0, 3)
      .map(typo);

    // Input fields
    const inputs = selAll("input[type=text], input[type=search]")
      .slice(0, 3)
      .map(typo);

    // Form labels
    const formLabels = selAll("label").slice(0, 5).map(typo);

    return {
      body,
      navLinks,
      topbarTitle,
      h1,
      tableHeaders,
      tableCells,
      buttons,
      badges,
      inputs,
      formLabels,
    };
  });

  console.log(`\n${"=".repeat(70)}`);
  console.log(`TYPOGRAPHY MEASUREMENTS: ${label}`);
  console.log("=".repeat(70));

  console.log("\n--- BODY ---");
  console.log(JSON.stringify(data.body, null, 2));

  console.log("\n--- H1 ---");
  console.log(JSON.stringify(data.h1, null, 2));

  console.log("\n--- NAV LINKS (first 3) ---");
  data.navLinks.forEach((n, i) => console.log(`[${i}]`, JSON.stringify(n)));

  console.log("\n--- TABLE HEADERS (first 5) ---");
  data.tableHeaders.forEach((n, i) => console.log(`[${i}]`, JSON.stringify(n)));

  console.log("\n--- TABLE CELLS (first 5) ---");
  data.tableCells.forEach((n, i) => console.log(`[${i}]`, JSON.stringify(n)));

  console.log("\n--- BUTTONS (first 5) ---");
  data.buttons.forEach((n, i) => console.log(`[${i}]`, JSON.stringify(n)));

  console.log("\n--- BADGES (first 3) ---");
  data.badges.forEach((n, i) => console.log(`[${i}]`, JSON.stringify(n)));

  console.log("\n--- FORM LABELS (first 5) ---");
  data.formLabels.forEach((n, i) => console.log(`[${i}]`, JSON.stringify(n)));

  console.log("\n--- INPUTS (first 3) ---");
  data.inputs.forEach((n, i) => console.log(`[${i}]`, JSON.stringify(n)));

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
  const hvacData = await measureTypography(
    hvacPage,
    "HVAC Repair Quoting Tool",
  );

  // ── StageVerify ──────────────────────────────────────────────────────────
  console.log("\nNavigating to StageVerify Dispatcher…");
  const svPage = await context.newPage();
  await svPage.goto(SV_URL, { waitUntil: "networkidle", timeout: 30000 });
  await svPage.waitForTimeout(2000);
  const svData = await measureTypography(svPage, "StageVerify Dispatcher");

  // ── Side-by-side comparison ──────────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  console.log("SIDE-BY-SIDE COMPARISON");
  console.log("=".repeat(70));

  const fields = [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "letterSpacing",
    "lineHeight",
    "wordSpacing",
  ];

  function compare(name, hvac, sv) {
    if (!hvac || !sv) return;
    const diffs = fields.filter((f) => hvac[f] !== sv[f]);
    if (diffs.length) {
      console.log(`\n[${name}] DIFFERENCES:`);
      diffs.forEach((f) => {
        console.log(`  ${f}:`);
        console.log(`    HVAC: ${hvac[f]}`);
        console.log(`    SV:   ${sv[f]}`);
      });
    } else {
      console.log(`\n[${name}] ✓ MATCH`);
    }
  }

  compare("BODY", hvacData.body, svData.body);
  compare("H1", hvacData.h1, svData.h1);
  compare("TABLE HEADER [0]", hvacData.tableHeaders[0], svData.tableHeaders[0]);
  compare("TABLE CELL [0]", hvacData.tableCells[0], svData.tableCells[0]);
  compare("BUTTON [0]", hvacData.buttons[0], svData.buttons[0]);
  compare("FORM LABEL [0]", hvacData.formLabels[0], svData.formLabels[0]);
  compare("NAV LINK [0]", hvacData.navLinks[0], svData.navLinks[0]);

  await browser.close();
})();

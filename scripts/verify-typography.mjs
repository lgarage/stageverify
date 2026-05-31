/**
 * Verification script: starts vite preview, measures typography on local build,
 * compares against HVAC target values.
 */
import { chromium } from "playwright";
import { spawn } from "child_process";
import { setTimeout as sleep } from "timers/promises";

const HVAC_URL = "https://lgarage.github.io/HVAC_REPAIR_QUOTING_TOOL/";
const LOCAL_URL = "http://localhost:5174/#/dispatcher";
const PORT = 5174;

// ── HVAC TARGET VALUES (measured in previous run) ──────────────────────────
const HVAC_TARGETS = {
  bodyFontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  bodyLineHeight: "normal",
  navFontSize: "15px",
  navFontWeight: "700",
  tableHeaderFontSize: "14px",
  tableHeaderFontWeight: "700",
  tableCellFontSize: "14px",
  tableCellLetterSpacing: "normal",
  buttonFontWeight: "700",
  labelFontSize: "13px",
  labelLetterSpacing: "normal",
  badgeFontSize: "11px",
  badgeFontWeight: "700",
  badgeLetterSpacing: "normal",
};

async function measureLocal(page) {
  return page.evaluate(() => {
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

    return {
      body: typo(document.body),
      navLinks: selAll(".sidebar-menu a, aside a, nav a").slice(0, 3).map(typo),
      tableHeaders: selAll("th").slice(0, 3).map(typo),
      tableCells: selAll("td").slice(0, 3).map(typo),
      formLabels: selAll("label").slice(0, 5).map(typo),
      badges: selAll(
        "[class*=badge], [class*=Badge], span[style*='border-radius: 4px']",
      )
        .slice(0, 3)
        .map(typo),
    };
  });
}

(async () => {
  // ── Start vite preview ─────────────────────────────────────────────────
  console.log(`\nStarting vite preview on port ${PORT}…`);
  const server = spawn("npx", ["vite", "preview", "--port", String(PORT)], {
    cwd: process.cwd(),
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

  // Wait for server to be ready
  await sleep(3000);
  console.log("Server should be ready. Opening browser…");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  let passed = 0;
  let failed = 0;

  function check(name, actual, expected) {
    if (actual === expected) {
      console.log(`  ✓ ${name}: ${actual}`);
      passed++;
    } else {
      console.log(`  ✗ ${name}:`);
      console.log(`      expected: ${expected}`);
      console.log(`      actual:   ${actual}`);
      failed++;
    }
  }

  try {
    // ── Measure local build ──────────────────────────────────────────────
    console.log(`\nNavigating to ${LOCAL_URL}…`);
    const page = await context.newPage();
    await page.goto(LOCAL_URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);
    const data = await measureLocal(page);

    console.log("\n" + "=".repeat(70));
    console.log("TYPOGRAPHY VERIFICATION — LOCAL BUILD");
    console.log("=".repeat(70));

    // Body
    console.log("\n[BODY]");
    check("font-family", data.body?.fontFamily, HVAC_TARGETS.bodyFontFamily);
    check("line-height", data.body?.lineHeight, HVAC_TARGETS.bodyLineHeight);

    // Nav links
    if (data.navLinks[0]) {
      console.log("\n[NAV LINKS]");
      check("font-size", data.navLinks[0].fontSize, HVAC_TARGETS.navFontSize);
      check(
        "font-weight",
        data.navLinks[0].fontWeight,
        HVAC_TARGETS.navFontWeight,
      );
    }

    // Table headers
    if (data.tableHeaders[0]) {
      console.log("\n[TABLE HEADERS]");
      check(
        "font-size",
        data.tableHeaders[0].fontSize,
        HVAC_TARGETS.tableHeaderFontSize,
      );
      check(
        "font-weight",
        data.tableHeaders[0].fontWeight,
        HVAC_TARGETS.tableHeaderFontWeight,
      );
      check("letter-spacing", data.tableHeaders[0].letterSpacing, "normal");
    }

    // Table cells
    if (data.tableCells[0]) {
      console.log("\n[TABLE CELLS]");
      check(
        "font-size",
        data.tableCells[0].fontSize,
        HVAC_TARGETS.tableCellFontSize,
      );
      check(
        "letter-spacing",
        data.tableCells[0].letterSpacing,
        HVAC_TARGETS.tableCellLetterSpacing,
      );
    }

    // Form labels
    if (data.formLabels[0]) {
      console.log("\n[FORM LABELS]");
      check(
        "font-size",
        data.formLabels[0].fontSize,
        HVAC_TARGETS.labelFontSize,
      );
      check(
        "letter-spacing",
        data.formLabels[0].letterSpacing,
        HVAC_TARGETS.labelLetterSpacing,
      );
    }

    // Print full measurements for reference
    console.log("\n--- RAW MEASUREMENTS (for reference) ---");
    console.log("Body:", JSON.stringify(data.body));
    console.log("\nNav[0]:", JSON.stringify(data.navLinks[0]));
    console.log("Nav[1]:", JSON.stringify(data.navLinks[1]));
    console.log("\nTable header[0]:", JSON.stringify(data.tableHeaders[0]));
    console.log("Table cell[0]:", JSON.stringify(data.tableCells[0]));
    console.log("\nForm label[0]:", JSON.stringify(data.formLabels[0]));
    console.log("Form label[1]:", JSON.stringify(data.formLabels[1]));
    console.log("\nBadge[0]:", JSON.stringify(data.badges[0]));

    console.log("\n" + "=".repeat(70));
    console.log(`RESULT: ${passed} passed, ${failed} failed`);
    console.log("=".repeat(70));
  } finally {
    await browser.close();
    server.kill();
    console.log("\nServer stopped.");
    process.exit(failed > 0 ? 1 : 0);
  }
})();

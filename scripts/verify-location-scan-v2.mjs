/**
 * Phase 3 location-first vendor scan v2 E2E.
 *
 * Wrong-spot scan at G2 + job-1 PIN → job-1 deliveries only (D14 cross-job negative).
 *
 * Usage:
 *   npm run verify:location-scan
 *   npm run verify:location-scan:prod
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { resolveAppBase } from "./resolveAppBase.mjs";
import { assertReadableTextContrast } from "./lib/ui-text-contrast-lib.mjs";
import {
  readExplicitTestPin,
  skipWithoutExplicitTestPin,
} from "./lib/test-job-pin.mjs";

const PROD_APP_BASE = "https://lgarage.github.io/stageverify";

/** Mirrors receiveQrUrls.buildPermanentLocationUrl (forPrint). */
function buildPermanentLocationUrl(locationCode) {
  const base = PROD_APP_BASE.replace(/\/$/, "");
  const loc = encodeURIComponent(locationCode.trim());
  return `${base}/#/s?loc=${loc}`;
}

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  }
}

const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;

if (!process.env.STAGEVERIFY_RECEIVE_DELIVERY) {
  process.env.STAGEVERIFY_RECEIVE_DELIVERY = "delivery-demo-vendor-1";
}

const job1Pin = readExplicitTestPin("STAGEVERIFY_JOB1_PIN");
const job2Pin = readExplicitTestPin("STAGEVERIFY_JOB2_PIN");
const job1Order = process.env.STAGEVERIFY_VENDOR_ORDER ?? "ORD-005";
const otherJobOrder = process.env.STAGEVERIFY_OTHER_JOB_ORDER ?? "ORD-006";
/** Ferguson (vendor-3) order at G2 — must not appear for job-1 Johnstone PIN session. */
const crossVendorOrder =
  process.env.STAGEVERIFY_CROSS_VENDOR_ORDER ?? "ORD-007";
const signLocationCode = process.env.STAGEVERIFY_SIGN_LOC ?? "G2";

const firebaseApp = initializeApp({
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: "stageverify-db",
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
});

/** CF findJobByPin fails when multiple jobs share the same pinCode query match. */
async function ensureUniqueJobPinForLocationScan() {
  if (!email || !password) return;
  if (!job1Pin) {
    console.log(
      "SKIP job PIN write — set STAGEVERIFY_JOB1_PIN (never the retired seed PIN, never a production company PIN)",
    );
    return;
  }
  const auth = getAuth(firebaseApp);
  const db = getFirestore(firebaseApp);
  await signInWithEmailAndPassword(auth, email, password);
  const now = new Date().toISOString();
  await setDoc(
    doc(db, "jobs", "job-1"),
    { pinCode: job1Pin, updatedAt: now },
    { merge: true },
  );
  if (job2Pin) {
    await setDoc(
      doc(db, "jobs", "job-2"),
      { pinCode: job2Pin, updatedAt: now },
      { merge: true },
    );
  }
  const dupSnap = await getDocs(
    query(collection(db, "jobs"), where("pinCode", "==", job1Pin)),
  );
  for (const jobDoc of dupSnap.docs) {
    if (jobDoc.id === "job-1") continue;
    throw new Error(
      `Refusing to rewrite ${jobDoc.id} pinCode — duplicate of STAGEVERIFY_JOB1_PIN. Set a unique test fixture PIN.`,
    );
  }
}

const appBase = resolveAppBase(baseUrl);

const authState = resolve(process.cwd(), "playwright/.auth/state.json");

const outDir = resolve(process.cwd(), "screenshots", "location-scan");
mkdirSync(outDir, { recursive: true });

const results = [];

function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
}

async function shot(page, name) {
  const path = resolve(outDir, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(`  screenshot: ${path}`);
}

async function enterPin(page, digits) {
  for (const digit of digits) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page
    .waitForFunction(
      () => {
        const body = document.body?.innerText ?? "";
        if (/Invalid code/i.test(body)) return true;
        return (
          /Mark Delivered/i.test(body) ||
          /DELIVERIES/i.test(body) ||
          /This job/i.test(body) ||
          document.querySelector('[data-testid="vendor-run-session-active"]') !=
            null
        );
      },
      { timeout: 20_000 },
    )
    .catch(() => {});
}

async function ensureZonesAuthenticated(page) {
  await page.goto(`${appBase}/#/zones`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(1500);
  if (!page.url().includes("/login")) return;

  if (!email || !password) {
    throw new Error(
      "Zones page requires login — set STAGEVERIFY_TEST_EMAIL/PASSWORD in .env.local",
    );
  }

  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/#\/(zones|dispatcher|settings|hub)/, {
    timeout: 20_000,
  });
  if (!page.url().includes("/zones")) {
    await page.goto(`${appBase}/#/zones`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  }
}

function normalizeSpotKey(code) {
  return code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/** Mirror of compareStagingMapLayoutSlots — SSOT: src/dispatcher/stagingMapSync.ts (D-53). */
function layoutSlotSortRank(key) {
  const norm = normalizeSpotKey(key);
  if (norm === "CA") return { kind: -1, primary: 0, secondary: 0 };
  const ground = /^G(\d+)$/.exec(norm);
  if (ground) return { kind: 0, primary: Number(ground[1]), secondary: 0 };
  const shelf = /^S(\d+)([A-Z])$/.exec(norm);
  if (shelf) {
    return {
      kind: 1,
      primary: Number(shelf[1]),
      secondary: shelf[2].charCodeAt(0) - 65,
    };
  }
  return { kind: 2, primary: 0, secondary: 0 };
}

function compareStagingMapLayoutSlots(a, b) {
  const rankA = layoutSlotSortRank(a);
  const rankB = layoutSlotSortRank(b);
  if (rankA.kind !== rankB.kind) return rankA.kind - rankB.kind;
  if (rankA.primary !== rankB.primary) return rankA.primary - rankB.primary;
  if (rankA.secondary !== rankB.secondary) return rankA.secondary - rankB.secondary;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function assertPickerSortOrder(codesInDomOrder) {
  const sorted = [...codesInDomOrder].sort(compareStagingMapLayoutSlots);
  for (let i = 0; i < codesInDomOrder.length; i++) {
    if (
      normalizeSpotKey(codesInDomOrder[i]) !== normalizeSpotKey(sorted[i])
    ) {
      throw new Error(
        `Print-label picker order violates D-53 at row ${i + 1}: DOM=${codesInDomOrder[i]}, expected=${sorted[i]}`,
      );
    }
  }
}

async function collectMapStagingSpotKeys(page) {
  await page.goto(`${appBase}/#/zones`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForSelector('[data-testid="shop-floor-map"]', {
    timeout: 30_000,
  });
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        '[data-testid^="shop-spot-"]:not([data-testid="shop-spot-catch-all-label"])',
      ).length >= 12,
    { timeout: 45_000 },
  );
  await page.waitForTimeout(800);
  const layoutSlots = await page
    .locator(
      '[data-testid^="shop-spot-"]:not([data-testid="shop-spot-catch-all-label"])',
    )
    .evaluateAll((els) =>
      els.map(
        (el) =>
          el.getAttribute("data-testid")?.replace("shop-spot-", "") ?? "",
      ),
    );
  const keys = layoutSlots.map((s) => normalizeSpotKey(s)).filter(Boolean);
  const catchAll = await page.locator('[data-testid="shop-map-catch-all"]').count();
  if (catchAll > 0) {
    keys.push("CA");
  }
  keys.sort();
  return keys;
}

async function countVisibleInViewport(locator) {
  return locator.evaluateAll((nodes) =>
    nodes.filter((n) => {
      const style = window.getComputedStyle(n);
      if (style.visibility === "hidden" || style.display === "none") return false;
      const r = n.getBoundingClientRect();
      return (
        r.width > 2 &&
        r.height > 2 &&
        r.bottom > 0 &&
        r.right > 0 &&
        r.left < window.innerWidth &&
        r.top < window.innerHeight
      );
    }).length,
  );
}

async function assertBatchLocationSignPrint(browser) {
  const printContext = await browser.newContext({
    viewport: { width: 900, height: 1100 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const printPage = await printContext.newPage();
  try {
    await ensureZonesAuthenticated(printPage);
    const mapSpotKeys = await collectMapStagingSpotKeys(printPage);
    await printPage.goto(`${appBase}/#/zones/print-labels`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await printPage
      .getByTestId("location-sign-batch-picker")
      .waitFor({ timeout: 45_000 });
    const pickerRows = printPage.getByTestId("location-sign-batch-picker-row");
    await pickerRows.first().waitFor({ timeout: 60_000 });
    const rowCount = await pickerRows.count();
    record(
      "Batch label picker lists printable spots",
      rowCount >= 2,
      `rowCount=${rowCount}`,
    );

    const orderedCodes = await pickerRows.evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-location-code") ?? ""),
    );
    const pickerKeys = orderedCodes
      .map((c) => normalizeSpotKey(c))
      .filter(Boolean);
    const mapKeySet = new Set(mapSpotKeys);
    const pickerKeySet = new Set(pickerKeys);
    let parityPass = pickerKeys.length === mapSpotKeys.length;
    if (parityPass) {
      for (const key of mapKeySet) {
        if (!pickerKeySet.has(key)) parityPass = false;
      }
      for (const key of pickerKeySet) {
        if (!mapKeySet.has(key)) parityPass = false;
      }
    }
    record(
      "Print-label picker matches Staging Map chips (D-52)",
      parityPass,
      `picker=${pickerKeys.length} map=${mapSpotKeys.length}`,
    );
    try {
      assertPickerSortOrder(orderedCodes.filter(Boolean));
      record("Print-label picker sort order (D-53 CA → G* → S*)", true);
    } catch (err) {
      record("Print-label picker sort order (D-53 CA → G* → S*)", false, err.message);
    }
    const catchAllRowCount = await printPage
      .locator(
        '[data-testid="location-sign-batch-picker-row"][data-catch-all="true"]',
      )
      .count();
    record(
      "At most one Catch-all row in print picker",
      catchAllRowCount <= 1,
      `catchAllRows=${catchAllRowCount}`,
    );
    const catchAllIdx = await pickerRows.evaluateAll((nodes) =>
      nodes.findIndex((n) => n.getAttribute("data-catch-all") === "true"),
    );
    const g1Idx = orderedCodes.findIndex((c) => c === "G1");
    if (catchAllIdx >= 0 && g1Idx >= 0) {
      record(
        "Catch-all row sorts before G1 in picker",
        catchAllIdx < g1Idx,
        `catchAllIdx=${catchAllIdx} g1Idx=${g1Idx}`,
      );
    } else {
      record(
        "Catch-all row sorts before G1 in picker",
        true,
        "skipped (catch-all or G1 not in list)",
      );
    }

    const batchBtn = printPage.getByTestId("location-sign-batch-print-button");
    const sheets = printPage.getByTestId("location-sign-print-sheet");
    const fullSizeBtn = printPage.getByTestId("location-sign-size-full");
    const label2x4Btn = printPage.getByTestId("location-sign-size-2x4");
    const summaryEl = printPage.getByTestId("location-sign-batch-summary");

    record(
      "Batch print disabled on open (none selected)",
      !(await batchBtn.isEnabled()),
      "disabled on load",
    );
    record(
      "Batch print stage empty on open",
      (await sheets.count()) === 0,
      `sheetCount=${await sheets.count()}`,
    );
    record(
      "Full page size toggle default active",
      (await fullSizeBtn.getAttribute("aria-pressed")) === "true",
    );
    record(
      "2x4 size toggle inactive on open",
      (await label2x4Btn.getAttribute("aria-pressed")) === "false",
    );

    await assertReadableTextContrast(printPage, {
      rootSelector: '[data-testid="location-sign-batch-picker"]',
      elements: [
        {
          name: "size toggle full page",
          selector: '[data-testid="location-sign-size-full"]',
          large: false,
        },
        {
          name: "size toggle 2x4",
          selector: '[data-testid="location-sign-size-2x4"]',
          large: false,
        },
      ],
    });
    record("Batch label size toggle contrast (D-42)", true);

    const clearBtn = printPage.getByTestId("location-sign-batch-clear-all");
    const selectAllBtn = printPage.getByTestId("location-sign-batch-select-all");
    await selectAllBtn.click();
    await printPage
      .locator('[data-testid="location-sign-print-sheet"]')
      .first()
      .waitFor({ state: "attached", timeout: 60_000 });
    const fullSheetCount = await sheets.count();
    record(
      "Batch full-page print DOM has multiple sheets",
      fullSheetCount >= 2,
      `sheetCount=${fullSheetCount}`,
    );
    record(
      "Select all full mode sheet count matches rows",
      fullSheetCount === rowCount,
      `sheets=${fullSheetCount} rows=${rowCount}`,
    );
    const visibleFullSheets = await countVisibleInViewport(sheets);
    record(
      "No visible on-screen full-page preview sheets",
      visibleFullSheets === 0 && fullSheetCount > 0,
      `visible=${visibleFullSheets} dom=${fullSheetCount}`,
    );
    record(
      "Batch print enabled when selection non-empty",
      await batchBtn.isEnabled(),
      "enabled after select all",
    );

    await label2x4Btn.click();
    record(
      "2x4 size toggle active after click",
      (await label2x4Btn.getAttribute("aria-pressed")) === "true",
    );
    record(
      "Full page toggle inactive when 2x4 selected",
      (await fullSizeBtn.getAttribute("aria-pressed")) === "false",
    );
    const summary2x4 = (await summaryEl.innerText()).trim();
    record(
      "2x4 mode summary mentions 8 labels per page",
      summary2x4.includes("8 labels per US Letter page"),
      summary2x4,
    );
    const pages2x4 = printPage.getByTestId("location-sign-2x4-page");
    const pageCount2x4 = await pages2x4.count();
    const expectedPages = Math.ceil(rowCount / 8);
    record(
      "2x4 select-all page count is ceil(n/8)",
      pageCount2x4 === expectedPages,
      `pages=${pageCount2x4} expected=${expectedPages} rows=${rowCount}`,
    );
    const labels2x4 = printPage.locator(
      '[data-testid="location-sign-2x4-label"]:not([data-blank="true"])',
    );
    record(
      "2x4 DOM label count matches selection",
      (await labels2x4.count()) === rowCount,
      `labels=${await labels2x4.count()} rows=${rowCount}`,
    );
    const visible2x4Pages = await countVisibleInViewport(pages2x4);
    record(
      "No visible on-screen 2x4 preview pages",
      visible2x4Pages === 0 && pageCount2x4 > 0,
      `visiblePages=${visible2x4Pages}`,
    );

    await fullSizeBtn.click();
    await printPage
      .locator('[data-testid="location-sign-print-sheet"]')
      .first()
      .waitFor({ state: "attached", timeout: 60_000 });
    record(
      "Switch back to full restores one sheet per row",
      (await sheets.count()) === rowCount,
      `sheets=${await sheets.count()}`,
    );

    await clearBtn.click();
    const g2Row = printPage.locator(
      '[data-testid="location-sign-batch-picker-row"][data-location-code="G2"]',
    );
    await g2Row.getByTestId("location-sign-batch-picker-checkbox").check();
    const g2Sheet = printPage.locator(
      '[data-testid="location-sign-print-sheet"][data-location-code="G2"]',
    );
    record(
      "Batch full labels include expected spot (G2) when selected",
      (await g2Sheet.count()) === 1,
      `g2Sheets=${await g2Sheet.count()}`,
    );
    record(
      "Batch print enabled for single selection",
      await batchBtn.isEnabled(),
      "enabled",
    );

    await clearBtn.click();
    const catchAllRow = printPage.locator(
      '[data-testid="location-sign-batch-picker-row"][data-catch-all="true"]',
    );
    if ((await catchAllRow.count()) > 0) {
      await catchAllRow
        .first()
        .getByTestId("location-sign-batch-picker-checkbox")
        .check();
      const catchAllHeadline = (
        await printPage
          .locator('[data-testid="location-sign-print-sheet"]')
          .first()
          .getAttribute("data-sign-headline")
      )?.trim();
      record(
        "Catch-all full sheet headline is Catch-All",
        catchAllHeadline === "Catch-All",
        catchAllHeadline,
      );

      await label2x4Btn.click();
      const catchAll2x4Headline = await printPage
        .locator(
          '[data-testid="location-sign-2x4-label"][data-sign-headline="Catch-All"]',
        )
        .first()
        .getAttribute("data-sign-headline");
      record(
        "Catch-all 2x4 label headline is Catch-All",
        catchAll2x4Headline === "Catch-All",
        catchAll2x4Headline ?? "missing",
      );
    } else {
      record(
        "Catch-all full sheet headline is Catch-All",
        true,
        "skipped (no catch-all row)",
      );
      record(
        "Catch-all 2x4 label headline is Catch-All",
        true,
        "skipped (no catch-all row)",
      );
    }

    await batchBtn.waitFor({ timeout: 10_000 });
  } catch (err) {
    record(
      "Batch full-page print DOM has multiple sheets",
      false,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    await printPage.close();
    await printContext.close();
  }
}

async function assertStagingMapBatchLabelButton(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const page = await ctx.newPage();
  try {
    await ensureZonesAuthenticated(page);
    await page.goto(`${appBase}/#/zones`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page
      .getByText("Loading zones…")
      .waitFor({ state: "hidden", timeout: 60_000 })
      .catch(() => {});
    const batchToolbarBtn = page.getByTestId(
      "staging-map-print-all-location-labels",
    );
    await batchToolbarBtn.waitFor({ timeout: 20_000 });
    const printMapBtn = page.getByRole("button", {
      name: "Print map",
      exact: true,
    });
    await printMapBtn.waitFor({ timeout: 10_000 });
    const focusSpot = page.getByTestId("shop-spot-G4");
    await focusSpot.waitFor({ timeout: 20_000 });
    await focusSpot.click();
    await page.waitForTimeout(400);
    const singleSpotPrint = page.getByTestId("staging-map-print-location-label");
    record(
      "Staging map has no single-spot Print label toolbar button",
      (await singleSpotPrint.count()) === 0,
      `count=${await singleSpotPrint.count()}`,
    );
    const batchBox = await batchToolbarBtn.boundingBox();
    const mapBox = await printMapBtn.boundingBox();
    record(
      "Print location labels left of Print map",
      Boolean(batchBox && mapBox && batchBox.x < mapBox.x),
      batchBox && mapBox
        ? `batchX=${batchBox.x} mapX=${mapBox.x}`
        : "missing bbox",
    );
    await assertReadableTextContrast(page, {
      rootSelector: "body",
      elements: [
        {
          name: "Print location labels toolbar",
          selector: '[data-testid="staging-map-print-all-location-labels"]',
          large: false,
        },
      ],
    });
    record("Staging map batch label button contrast (D-42)", true);
    await batchToolbarBtn.click();
    await page.waitForURL(/print-labels/, { timeout: 30_000 });
    record("Batch label toolbar opens print-labels route", true);
  } catch (err) {
    record(
      "Staging map batch label button contrast (D-42)",
      false,
      err instanceof Error ? err.message : String(err),
    );
    record(
      "Print location labels left of Print map",
      false,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    await page.close();
    await ctx.close();
  }
}

async function assertLetterLocationSignPrint(browser) {
  const expectedUrl = buildPermanentLocationUrl(signLocationCode);
  const printContext = await browser.newContext({
    viewport: { width: 900, height: 1100 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const printPage = await printContext.newPage();
  try {
    await ensureZonesAuthenticated(printPage);
    await printPage.goto(
      `${appBase}/#/zones/print-label?loc=${encodeURIComponent(signLocationCode)}`,
      { waitUntil: "domcontentloaded", timeout: 45_000 },
    );
    await printPage.evaluate(() => window.scrollTo(0, 0));
    const toolbar = printPage.getByTestId("location-sign-print-toolbar");
    await toolbar.waitFor({ timeout: 10_000 });
    const printBtn = printPage.getByTestId("location-sign-print-button");
    const locInput = printPage.getByTestId("location-sign-loc-input");
    const toolbarBox = await toolbar.boundingBox();
    const btnBox = await printBtn.boundingBox();
    const inputBox = await locInput.boundingBox();
    const vp = printPage.viewportSize();
    record(
      "Label print toolbar not clipped at top",
      Boolean(
        toolbarBox &&
          btnBox &&
          inputBox &&
          toolbarBox.y >= 0 &&
          btnBox.y >= toolbarBox.y - 2 &&
          inputBox.y >= toolbarBox.y - 2 &&
          (vp ? toolbarBox.y + toolbarBox.height <= vp.height + 2 : true),
      ),
      toolbarBox && btnBox
        ? `toolbarY=${toolbarBox.y} h=${toolbarBox.height}`
        : "missing bbox",
    );
    const sheet = printPage.getByTestId("location-sign-print-sheet");
    await sheet.waitFor({ timeout: 30_000 });
    const codeEl = printPage.getByTestId("location-sign-code");
    await codeEl.waitFor({ timeout: 10_000 });
    const codeText = (await codeEl.innerText()).trim();
    const permanentUrl = await sheet.getAttribute("data-permanent-url");
    record(
      "Letter sign sheet shows spot code",
      codeText === signLocationCode,
      codeText,
    );
    record(
      "Letter sign QR uses permanent loc URL",
      permanentUrl === expectedUrl,
      permanentUrl ?? "missing data-permanent-url",
    );
    const caption = printPage.getByTestId("location-sign-scan-caption");
    await caption.waitFor({ timeout: 10_000 });
    const captionText = (await caption.innerText()).trim().toUpperCase();
    record(
      "Letter sign shows SCAN FOR STATUS caption",
      captionText === "SCAN FOR STATUS",
      captionText,
    );
    const arrowSvg = printPage.getByTestId("location-sign-arrow-svg");
    await arrowSvg.waitFor({ timeout: 10_000 });
    const arrowBox = await arrowSvg.boundingBox();
    const arrowFill = await arrowSvg
      .locator("path")
      .first()
      .getAttribute("fill");
    const arrowPathD = await arrowSvg.locator("path").first().getAttribute("d");
    record(
      "Letter sign solid down arrow (SVG)",
      Boolean(
        arrowBox &&
          arrowBox.width >= 48 &&
          arrowBox.height >= 64 &&
          arrowFill === "#000" &&
          typeof arrowPathD === "string" &&
          /^M32 88/i.test(arrowPathD.trim()),
      ),
      arrowBox
        ? `w=${arrowBox.width} h=${arrowBox.height} fill=${arrowFill ?? "none"} d=${arrowPathD ?? "none"}`
        : "no bbox",
    );
    await assertReadableTextContrast(printPage, {
      rootSelector: '[data-testid="location-sign-print-sheet"]',
      elements: [
        {
          name: "location code",
          selector: '[data-testid="location-sign-code"]',
          large: true,
        },
        {
          name: "scan caption",
          selector: '[data-testid="location-sign-scan-caption"]',
          large: false,
        },
      ],
    });
    record("Letter sign readable contrast (D-42)", true);
    await printPage.emulateMedia({ media: "print" });
    const toolbarHidden = await toolbar.evaluate(
      (el) => window.getComputedStyle(el).display === "none",
    );
    const hintHidden = await printPage
      .getByTestId("location-sign-print-hint")
      .evaluate((el) => window.getComputedStyle(el).display === "none");
    const sidebarHidden = await printPage
      .locator(".portal-sidebar")
      .first()
      .evaluate((el) => window.getComputedStyle(el).display === "none")
      .catch(() => true);
    const sheetStillVisible = await sheet.isVisible();
    record(
      "Print media hides app chrome, shows sign sheet",
      toolbarHidden && hintHidden && sidebarHidden && sheetStillVisible,
      `toolbarHidden=${toolbarHidden} hintHidden=${hintHidden} sidebarHidden=${sidebarHidden} sheetVisible=${sheetStillVisible}`,
    );
    await printPage.emulateMedia({ media: "screen" });
    await shot(printPage, "05-letter-location-sign");
  } catch (err) {
    record(
      "Letter sign readable contrast (D-42)",
      false,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    await printPage.close();
    await printContext.close();
  }
}

async function assertPermanentSignUrl(browser) {
  const expectedUrl = buildPermanentLocationUrl(signLocationCode);
  const expectedLine = `Permanent URL: ${expectedUrl}`;

  const zonesContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...(existsSync(authState) ? { storageState: authState } : {}),
  });
  const zonesPage = await zonesContext.newPage();
  try {
    await ensureZonesAuthenticated(zonesPage);
    await zonesPage
      .getByText("Loading zones…")
      .waitFor({ state: "hidden", timeout: 60_000 })
      .catch(() => {});
    const zoneToolsBtn = zonesPage.getByRole("button", {
      name: "Zone tools",
      exact: true,
    });
    await zoneToolsBtn.waitFor({ timeout: 15_000 });
    if ((await zoneToolsBtn.getAttribute("aria-pressed")) !== "true") {
      await zoneToolsBtn.click();
    }
    await zonesPage
      .getByTestId("permanent-location-sign")
      .first()
      .waitFor({ state: "visible", timeout: 45_000 });
    const urlLine = zonesPage.getByText(expectedLine, { exact: true });
    const urlVisible = await urlLine.isVisible().catch(() => false);
    const signBlock = zonesPage
      .getByTestId("permanent-location-sign")
      .filter({ hasText: signLocationCode })
      .filter({ hasText: expectedLine })
      .first();
    const signVisible = await signBlock.isVisible().catch(() => false);
    record(
      "Permanent sign URL encodes exact permanent URL",
      urlVisible && signVisible,
      urlVisible ? expectedUrl : `expected ${expectedLine}`,
    );
    await shot(zonesPage, "04-zones-permanent-sign");
  } catch (err) {
    record(
      "Permanent sign URL encodes exact permanent URL",
      false,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    await zonesPage.close();
    await zonesContext.close();
  }
}

(async () => {
  if (skipWithoutExplicitTestPin(job1Pin, "verify:location-scan")) {
    process.exit(0);
  }
  await ensureUniqueJobPinForLocationScan();

  const browser = await chromium.launch({ headless: true });

  await assertPermanentSignUrl(browser);
  await assertLetterLocationSignPrint(browser);
  await assertStagingMapBatchLabelButton(browser);
  await assertBatchLocationSignPrint(browser);

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const page = await context.newPage();

  const url = `${appBase}/#/s?loc=${encodeURIComponent(signLocationCode)}`;
  console.log(`Opening ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });

  await page
    .getByText("Staging location", { exact: true })
    .waitFor({ timeout: 30_000 });
  await page.getByText(signLocationCode, { exact: true }).first().waitFor({
    timeout: 15_000,
  });
  record("Location header shows scanned code", true);
  await shot(page, "01-location-header");

  const pinHeading = page.getByRole("heading", {
    name: "Enter PIN",
    exact: true,
  });
  await pinHeading.waitFor({ state: "visible", timeout: 30_000 });
  // Neutral keypad — no Vendor/Technician/Office role selector.
  if (await page.getByTestId("pin-role-selector").count()) {
    throw new Error("pin-role-selector must not appear on location-scan PIN step");
  }
  await enterPin(page, job1Pin);
  const bodyAfterPin = await page.locator("body").innerText();
  if (/Invalid code/i.test(bodyAfterPin)) {
    throw new Error(
      "Job PIN rejected (Invalid code) — set STAGEVERIFY_JOB1_PIN to a unique test fixture PIN (never the retired seed PIN)",
    );
  }
  await page.waitForTimeout(1500);
  await shot(page, "01b-after-pin");

  const listHeading = page.getByRole("heading", { name: /DELIVERIES|This job/i });
  if (await listHeading.isVisible().catch(() => false)) {
    record("Job-scoped delivery list shown (multi-delivery)", true);
    const bodyBeforeSelect = await page.locator("body").innerText();
    record(
      "Same-vendor other-job order absent on list (D14)",
      !bodyBeforeSelect.includes(otherJobOrder),
    );
    record(
      "Cross-vendor order absent on list (D14)",
      !bodyBeforeSelect.includes(crossVendorOrder),
    );
    await page.getByRole("button", { name: new RegExp(job1Order) }).click();
  }

  try {
    await page.waitForSelector("text=Mark Delivered", { timeout: 45_000 });
  } catch (err) {
    const debugBody = await page.locator("body").innerText();
    console.error("Body after PIN (truncated):", debugBody.slice(0, 1200));
    await shot(page, "error-no-delivered");
    throw err;
  }
  record("PIN unlocks vendor hub (single delivery deep-link)", true);
  await shot(page, "02-hub-after-pin");

  const body = await page.locator("body").innerText();
  record("Job delivery order visible", body.includes(job1Order));
  record(
    "Same-vendor other-job order absent (D14)",
    !body.includes(otherJobOrder),
  );
  record(
    "Cross-vendor order absent (D14)",
    !body.includes(crossVendorOrder),
  );
  record("Wrong-spot shows job spot context", /G1|S1|Spot|location/i.test(body));

  await page.getByRole("button", { name: "Mark Delivered", exact: true }).click();
  await page.waitForFunction(() => {
    const btn = document.querySelector('[data-testid="vendor-mark-delivered"]');
    return btn && /Delivered/i.test(btn.textContent ?? "");
  }, { timeout: 30_000 });
  record("Confirm delivered updates status", true);
  await shot(page, "03-confirmed");

  await browser.close();

  console.log("\n--- Location scan v2 summary ---");
  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`  [${r.pass ? "ok" : "X"}] ${r.name}`);
  }
  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} checks passed.`);
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

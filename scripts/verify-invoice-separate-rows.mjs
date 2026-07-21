/**
 * Verify approved invoice imports each have their own shell delivery on prod/local.
 * After repair-invoice-separate-shells, asserts Deliveries table shows INV-* job rows.
 *
 * Usage:
 *   node scripts/verify-invoice-separate-rows.mjs
 *   node scripts/verify-invoice-separate-rows.mjs --base-url=https://lgarage.github.io/stageverify
 *   node scripts/verify-invoice-separate-rows.mjs --invoice=3869488-00,15046467-00
 */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { chromium } from "playwright";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { ensureAuthenticated, loadEnvLocal as loadEnvFromHelpers } from "./dispatcherVerifyHelpers.mjs";
import { resolveAppBase } from "./resolveAppBase.mjs";

const PROJECT_ID = "stageverify-db";
const SHELL_PREFIX = "delivery-vii-";
const firebaseConfig = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: PROJECT_ID,
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
};

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

function parseArgs(argv) {
  let baseUrl =
    process.env.STAGEVERIFY_BASE_URL?.trim() || "http://localhost:5173/stageverify";
  /** @type {string[]|null} */
  let invoices = null;
  for (const arg of argv) {
    if (arg.startsWith("--base-url=")) baseUrl = arg.slice("--base-url=".length);
    if (arg.startsWith("--invoice=")) {
      invoices = arg
        .slice("--invoice=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return { baseUrl: baseUrl.replace(/\/$/, ""), invoices };
}

loadEnvLocal();
loadEnvFromHelpers();
const { baseUrl, invoices: invoiceFilter } = parseArgs(process.argv.slice(2));
const appBase = resolveAppBase(baseUrl);
const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;
if (!email || !password) {
  console.error("Set STAGEVERIFY_TEST_EMAIL/PASSWORD in .env.local");
  process.exit(1);
}

const app = initializeApp(firebaseConfig, "verify-invoice-separate-rows");
const auth = getAuth(app);
const functions = getFunctions(app, "us-central1");
await signInWithEmailAndPassword(auth, email, password);
const listImports = httpsCallable(functions, "listVendorInvoiceImports");
const { data: listData } = await listImports({ limit: 100 });
const items = listData?.items ?? [];

const targets = items.filter((row) => {
  if (row.reviewStatus !== "approved") return false;
  const inv = String(row.parsedHeader?.vendorInvoiceNumber ?? "").trim();
  if (!inv) return false;
  if (invoiceFilter && !invoiceFilter.includes(inv)) return false;
  if (!invoiceFilter) {
    // Default: First Supply pair from Dan's report, else all approved with shells.
    if (inv !== "3869488-00" && inv !== "15046467-00") return false;
  }
  return true;
});

if (targets.length === 0) {
  console.error("No matching approved imports to verify.");
  process.exit(1);
}

console.log(`\n=== API check: ${targets.length} invoice(s) ===\n`);
let apiFail = 0;
/** Search hints: order # is usually the invoice # on shells; job may be shared. */
const expectedSearchHints = [];
const shellIds = new Set();
for (const row of targets) {
  const inv = String(row.parsedHeader?.vendorInvoiceNumber ?? "").trim();
  const shellId = `${SHELL_PREFIX}${row.id}`;
  const linked = row.linkedDeliveryOrderId?.trim() ?? "";
  if (linked !== shellId) {
    apiFail += 1;
    console.error(`FAIL API ${inv}: linked=${linked || "—"} expected=${shellId}`);
  } else {
    console.log(`PASS API ${inv} → ${shellId}`);
  }
  expectedSearchHints.push(inv);
  shellIds.add(shellId);
}

if (apiFail > 0) {
  console.error("\nAPI check failed — run: node scripts/repair-invoice-separate-shells.mjs");
  process.exit(1);
}
if (shellIds.size !== targets.length) {
  console.error("FAIL API: shell ids are not unique per invoice");
  process.exit(1);
}
console.log(`PASS API: ${shellIds.size} distinct shell delivery ids`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
try {
  await page.goto(`${appBase}/#/dispatcher`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await ensureAuthenticated(page, appBase);
  await page.goto(`${appBase}/#/dispatcher`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForSelector("table tbody tr", { timeout: 30_000 }).catch(() => null);
  await page.waitForTimeout(2500);

  console.log("\n=== UI Deliveries table ===\n");
  let uiFail = 0;
  const seenRowKeys = new Set();
  for (const hint of expectedSearchHints) {
    const search = page.getByPlaceholder(/Job #|PO|order|vendor/i).first();
    if (await search.isVisible().catch(() => false)) {
      await search.fill("");
      await search.fill(hint);
      await page.waitForTimeout(1000);
    }
    const rows = page.locator("table tbody tr", { hasText: hint });
    const count = await rows.count();
    if (count < 1) {
      uiFail += 1;
      console.error(`FAIL UI: no Deliveries row matching invoice/order ${hint}`);
      continue;
    }
    const text = ((await rows.first().innerText()) || "").replace(/\s+/g, " ").trim();
    seenRowKeys.add(text);
    console.log(`PASS UI Deliveries row for ${hint}: ${text.slice(0, 120)}`);
  }
  if (seenRowKeys.size < expectedSearchHints.length) {
    uiFail += 1;
    console.error(
      `FAIL UI: expected ${expectedSearchHints.length} distinct rows, got ${seenRowKeys.size}`,
    );
  } else {
    console.log(`PASS UI: ${seenRowKeys.size} distinct Deliveries rows`);
  }

  if (uiFail > 0) {
    console.error(`\nUI check failed (${uiFail})`);
    process.exit(1);
  }
  console.log("\nverify-invoice-separate-rows: PASS");
} finally {
  await browser.close();
}
process.exit(0);

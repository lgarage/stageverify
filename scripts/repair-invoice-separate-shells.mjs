/**
 * Live repair: approved imports linked to a non-shell delivery → relink_to_shell
 * so each invoice gets its own Deliveries row (D-39).
 *
 * Usage:
 *   node scripts/repair-invoice-separate-shells.mjs
 *   node scripts/repair-invoice-separate-shells.mjs --invoice=3869488-00,15046467-00
 *   node scripts/repair-invoice-separate-shells.mjs --dry-run
 */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";

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

function shellDeliveryIdForImport(importId) {
  return `${SHELL_PREFIX}${importId}`;
}

function parseArgs(argv) {
  let dryRun = false;
  /** @type {Set<string>|null} */
  let invoiceFilter = null;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    if (arg.startsWith("--invoice=")) {
      invoiceFilter = new Set(
        arg
          .slice("--invoice=".length)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    }
  }
  return { dryRun, invoiceFilter };
}

loadEnvLocal();
const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;
if (!email || !password) {
  console.error("Set STAGEVERIFY_TEST_EMAIL/PASSWORD in .env.local");
  process.exit(1);
}

const { dryRun, invoiceFilter } = parseArgs(process.argv.slice(2));

const app = initializeApp(firebaseConfig, "repair-invoice-separate-shells");
const auth = getAuth(app);
const functions = getFunctions(app, "us-central1");
await signInWithEmailAndPassword(auth, email, password);

const listImports = httpsCallable(functions, "listVendorInvoiceImports");
const approveImport = httpsCallable(functions, "approveVendorInvoiceImport");

const { data: listData } = await listImports({ limit: 100 });
const items = listData?.items ?? [];

const candidates = items.filter((row) => {
  if (row.reviewStatus !== "approved") return false;
  if (row.importStatus === "issue") return false;
  const linked = typeof row.linkedDeliveryOrderId === "string"
    ? row.linkedDeliveryOrderId.trim()
    : "";
  if (!linked) return false;
  const shellId = shellDeliveryIdForImport(row.id);
  if (linked === shellId) return false;
  if (invoiceFilter) {
    const inv = String(row.parsedHeader?.vendorInvoiceNumber ?? "").trim();
    if (!invoiceFilter.has(inv)) return false;
  }
  return true;
});

console.log(
  `\n=== repair-invoice-separate-shells: ${items.length} imports scanned, ${candidates.length} need relink ===\n`,
);

if (candidates.length === 0) {
  console.log("Nothing to repair (all approved linked imports already on their shells).");
  if (invoiceFilter) {
    console.log("Filter:", [...invoiceFilter].join(", "));
    for (const row of items) {
      const inv = String(row.parsedHeader?.vendorInvoiceNumber ?? "").trim();
      if (!invoiceFilter.has(inv)) continue;
      console.log(
        `  ${inv} id=${row.id} status=${row.reviewStatus} linked=${row.linkedDeliveryOrderId ?? "—"} shell=${shellDeliveryIdForImport(row.id)}`,
      );
    }
  }
  process.exit(0);
}

let failed = 0;
for (const row of candidates) {
  const inv = String(row.parsedHeader?.vendorInvoiceNumber ?? "—").trim() || "—";
  const shellId = shellDeliveryIdForImport(row.id);
  console.log(
    `→ ${inv} import=${row.id}\n   from ${row.linkedDeliveryOrderId}\n   to   ${shellId}`,
  );
  if (dryRun) {
    console.log("  (dry-run — skipped)\n");
    continue;
  }
  try {
    const { data } = await approveImport({
      vendorInvoiceImportId: row.id,
      action: "relink_to_shell",
    });
    console.log(
      `  OK deliveryOrderId=${data?.deliveryOrderId ?? "—"} shellCreated=${data?.shellCreated} relinked=${data?.relinked}\n`,
    );
  } catch (err) {
    failed += 1;
    console.error(`  FAIL: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

if (dryRun) {
  console.log("Dry-run complete — re-run without --dry-run to apply.");
  process.exit(0);
}

const { data: afterData } = await listImports({ limit: 100 });
const afterItems = afterData?.items ?? [];
let stillShared = 0;
for (const row of candidates) {
  const fresh = afterItems.find((i) => i.id === row.id);
  const linked = fresh?.linkedDeliveryOrderId?.trim() ?? "";
  const shellId = shellDeliveryIdForImport(row.id);
  const inv = String(row.parsedHeader?.vendorInvoiceNumber ?? "—").trim() || "—";
  if (linked === shellId) {
    console.log(`VERIFY OK ${inv} → ${linked}`);
  } else {
    stillShared += 1;
    console.error(`VERIFY FAIL ${inv} linked=${linked || "—"} expected=${shellId}`);
  }
}

if (failed > 0 || stillShared > 0) {
  console.error(`\nRepair incomplete: failed=${failed} stillShared=${stillShared}`);
  process.exit(1);
}

console.log(`\nRepair complete: ${candidates.length} invoice(s) each on their own shell.`);
process.exit(0);

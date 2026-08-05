/**
 * Inspect + repair will-call pickups reset before v0.0.214 shell-patch preserve.
 * Uses client SDK + STAGEVERIFY_TEST_* creds (no admin ADC required).
 *
 * Usage:
 *   node scripts/repair-will-call-pickups.mjs
 *   node scripts/repair-will-call-pickups.mjs --inspect-only
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, getDoc, updateDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

const INVOICES = new Set(["6168732", "6167990"]);
const inspectOnly = process.argv.includes("--inspect-only");

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

loadEnvLocal();

const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;
if (!email || !password) {
  console.error("Missing STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD in .env.local");
  process.exit(1);
}

const app = initializeApp(
  {
    apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
    authDomain: "stageverify-db.firebaseapp.com",
    projectId: "stageverify-db",
    storageBucket: "stageverify-db.firebasestorage.app",
    messagingSenderId: "784751243681",
    appId: "1:784751243681:web:31fa71762b94f878fd1be0",
  },
  "repair-will-call",
);

await signInWithEmailAndPassword(getAuth(app), email, password);
const db = getFirestore(app);
const listImports = httpsCallable(getFunctions(app, "us-central1"), "listVendorInvoiceImports");
const recalculate = httpsCallable(getFunctions(app, "us-central1"), "recalculateDeliveryReadiness");

/** Resolve shell delivery ids from invoice imports list. */
async function resolveShellDeliveries() {
  const { data } = await listImports({ limit: 200 });
  const rows = [];
  for (const row of data.items ?? []) {
    const inv = String(row.parsedHeader?.vendorInvoiceNumber ?? "").trim();
    if (!INVOICES.has(inv)) continue;
    const shellId = row.linkedDeliveryOrderId ?? `delivery-vii-${row.id}`;
    const deliverySnap = await getDoc(doc(db, "deliveries", shellId));
    const delivery = deliverySnap.exists() ? deliverySnap.data() : null;
    rows.push({
      inv,
      importId: row.id,
      shellId,
      exists: deliverySnap.exists(),
      orderNumber: delivery?.orderNumber,
      vendorInvoiceNumber: delivery?.vendorInvoiceNumber,
      status: delivery?.status,
      invoiceImportStatus: delivery?.invoiceImportStatus,
      readinessStatus: delivery?.readinessStatus,
      invoiceFulfillmentMethod: delivery?.invoiceFulfillmentMethod,
      jobId: delivery?.jobId,
    });
  }
  return rows;
}

const deliveries = await resolveShellDeliveries();
console.log(`Found ${deliveries.length} shell(s) for invoices ${[...INVOICES].join(", ")}:`);
for (const d of deliveries) {
  console.log(JSON.stringify(d, null, 2));
}

if (inspectOnly) {
  process.exit(deliveries.length >= INVOICES.size ? 0 : 1);
}

if (deliveries.length === 0) {
  console.error("No matching deliveries found — cannot repair.");
  process.exit(1);
}

const now = new Date().toISOString();
for (const d of deliveries) {
  if (!d.exists) {
    console.error(`Missing delivery doc ${d.shellId} for inv ${d.inv}`);
    continue;
  }
  const needsTerminal =
    d.status !== "picked_up" || d.invoiceImportStatus !== "closed_picked_up";
  if (needsTerminal) {
    console.log(`Patching ${d.shellId} (inv ${d.inv}) → picked_up / closed_picked_up`);
    await updateDoc(doc(db, "deliveries", d.shellId), {
      status: "picked_up",
      invoiceImportStatus: "closed_picked_up",
      readinessStatus: "picked_up",
      updatedAt: now,
    });
  } else {
    console.log(`Skip patch ${d.shellId} — already terminal pickup`);
  }
}

for (const d of deliveries) {
  if (!d.exists) continue;
  console.log(`Calling recalculateDeliveryReadiness for ${d.shellId}…`);
  const { data: result } = await recalculate({ deliveryOrderId: d.shellId });
  const afterSnap = await getDoc(doc(db, "deliveries", d.shellId));
  const after = afterSnap.data();
  console.log(
    JSON.stringify(
      {
        inv: d.inv,
        shellId: d.shellId,
        recalc: result,
        after: {
          status: after?.status,
          invoiceImportStatus: after?.invoiceImportStatus,
          readinessStatus: after?.readinessStatus,
        },
      },
      null,
      2,
    ),
  );
}

console.log("Repair complete.");

/**
 * One-time backfill: vendorBusinessInvoiceKeys + deliveryOrderId index from imports.
 * Default dry-run — pass --apply to write (never run --apply against prod without Dan).
 *
 * Usage:
 *   node scripts/backfill-vendor-business-invoice-delivery-index.mjs
 *   node scripts/backfill-vendor-business-invoice-delivery-index.mjs --apply
 */
import { createRequire } from "node:module";

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
import {
  buildBackfillKeyDocument,
  planBusinessInvoiceDeliveryIndexBackfill,
} from "../functions/lib/invoice/backfillBusinessInvoiceDeliveryIndexPlan.js";

const apply = process.argv.includes("--apply");

function initAdmin() {
  if (getApps().length === 0) {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || "stageverify-db" });
  }
  return getFirestore();
}

async function loadImports(db) {
  const snap = await db.collection("vendorInvoiceImports").limit(5000).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadDeliveries(db, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const rows = [];
  for (const id of unique) {
    const snap = await db.collection("deliveries").doc(id).get();
    if (snap.exists) rows.push({ id: snap.id, ...snap.data() });
  }
  return rows;
}

const db = initAdmin();
const imports = await loadImports(db);
const deliveryIds = imports
  .map((r) => String(r.linkedDeliveryOrderId ?? "").trim())
  .filter(Boolean);
const deliveries = await loadDeliveries(db, deliveryIds);

const plan = planBusinessInvoiceDeliveryIndexBackfill({ imports, deliveries });

console.log(
  JSON.stringify(
    {
      mode: apply ? "apply" : "dry-run",
      entryCount: plan.entries.length,
      duplicates: plan.duplicates,
      ambiguous: plan.ambiguous,
      skippedNoDeliveryCount: plan.skippedNoDelivery.length,
    },
    null,
    2,
  ),
);

if (!apply) {
  console.log("Dry-run complete — no writes. Pass --apply to write index docs.");
  process.exit(0);
}

const now = new Date().toISOString();
let written = 0;
for (const entry of plan.entries) {
  const importRow = imports.find((r) => r.id === entry.canonicalImportId);
  if (!importRow) continue;
  const ref = db.collection("vendorBusinessInvoiceKeys").doc(entry.indexKeyDocId);
  const existing = await ref.get();
  if (existing.exists && existing.data()?.deliveryOrderId) {
    continue;
  }
  const doc = buildBackfillKeyDocument(entry, importRow, now);
  if (existing.exists) {
    await ref.set({ deliveryOrderId: entry.deliveryOrderId, updatedAt: now }, { merge: true });
  } else {
    await ref.set(doc);
  }
  written += 1;
}
console.log(`Apply complete — wrote/merged ${written} key docs (duplicates not merged).`);

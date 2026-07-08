/**
 * Patches Firestore demo deliveries ORD-002..ORD-006 (keeps ORD-001 unchanged).
 * Mirrors src/dispatcher/seedFirestore.ts — Johnstone email-ingest scenarios.
 *
 * Usage: node scripts/patch-dispatcher-demo-deliveries.mjs
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, writeBatch, deleteField } from "firebase/firestore";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim().replace(/^["']|["']$/g, "");
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

const app = initializeApp({
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: "stageverify-db",
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
});

const purchaseOrders = {
  "po-4": {
    poNumber: "PO-88392",
    jobId: "job-2",
    vendorId: "vendor-1",
    orderDate: "2026-05-28",
    expectedDeliveryDate: "2026-06-01",
    status: "partially_received",
  },
  "po-5": {
    poNumber: "PO-88393",
    jobId: "job-3",
    vendorId: "vendor-1",
    orderDate: "2026-05-30",
    expectedDeliveryDate: "2026-06-02",
    status: "partially_received",
  },
  "po-6": {
    poNumber: "PO-88394",
    jobId: "job-2",
    vendorId: "vendor-1",
    orderDate: "2026-06-02",
    expectedDeliveryDate: "2026-06-03",
    status: "open",
  },
};

const deliveries = {
  "delivery-2": {
    orderNumber: "ORD-002",
    jobId: "job-2",
    vendorId: "vendor-1",
    vendorName: "Johnstone Supply",
    purchaseOrderId: "po-4",
    deliveryDate: "2026-06-01",
    stagingLocationId: deleteField(),
    status: "partial",
    issueSummary: "1 item backordered",
    notes:
      "Email ingest (svbotmail@gmail.com): Johnstone Reply-All SO#6163986 — Customer P/O La Crosse PF. Partial ship + line 2 backorder. Dispatcher: confirm split vs ship-complete hold.",
    updatedAt: "2026-06-01T11:20:00Z",
  },
  "delivery-3": {
    orderNumber: "ORD-004",
    jobId: "job-3",
    vendorId: "vendor-1",
    vendorName: "Johnstone Supply",
    purchaseOrderId: "po-5",
    deliveryDate: "2026-06-02",
    stagingLocationId: "staging-4",
    status: "partial",
    readinessStatus: "not_ready",
    currentLocationNote: "West dock bay 3 — lift gate unload",
    availabilityStatus: "received",
    issueSummary: "Received qty below vendor ship qty",
    notes:
      "Email ingest (svbotmail@gmail.com): Johnstone Reply-All SO#6164304 claimed 3× thermostat shipped; shop receipt shows 2. Dispatcher: reconcile lines before readiness.",
    updatedAt: "2026-06-02T07:45:00Z",
  },
  "delivery-demo-vendor-1": {
    orderNumber: "ORD-005",
    jobId: "job-1",
    vendorId: "vendor-1",
    vendorName: "Johnstone Supply",
    purchaseOrderId: "po-demo-vendor-1",
    deliveryDate: "2026-06-02",
    stagingLocationId: deleteField(),
    status: "pending",
    issueSummary: "",
    notes:
      "Email ingest (svbotmail@gmail.com): Johnstone will-call SO#6164159 — Customer P/O PLANET FITNESS PICKUP. Vendor demo QR unchanged. Assign staging when material arrives (orange row).",
    updatedAt: "2026-06-02T12:00:00Z",
  },
  "delivery-demo-vendor-2": {
    orderNumber: "ORD-006",
    jobId: "job-2",
    vendorId: "vendor-1",
    vendorName: "Johnstone Supply",
    purchaseOrderId: "po-6",
    deliveryDate: "2026-06-03",
    stagingLocationId: deleteField(),
    status: "shipped",
    issueSummary: "",
    notes:
      "Email ingest (svbotmail@gmail.com): Johnstone Reply-All SO#6164100 — Customer P/O TRUCK STOCK PICKUP shipped on truck. Driver ETA 2–4 pm. Assign staging before check-in.",
    updatedAt: "2026-06-03T06:30:00Z",
  },
};

const items = {
  "item-3": {
    deliveryOrderId: "delivery-2",
    sku: "NS10762605",
    description: "GREENHECK FAN 105105",
    qtyOrdered: 1,
    qtyReceived: 1,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "received",
  },
  "item-4": {
    deliveryOrderId: "delivery-2",
    sku: "NS99999999",
    description: "BACKORDERED PART — 2 DAY LEAD",
    qtyOrdered: 1,
    qtyReceived: 0,
    qtyMissing: 1,
    qtyDamaged: 0,
    qtyBackordered: 1,
    status: "backordered",
  },
  "item-6": {
    deliveryOrderId: "delivery-3",
    sku: "L46-668",
    description: "TH8320R1003/U THERMOSTAT PROGRAMMABLE REDLINK",
    qtyOrdered: 3,
    qtyReceived: 2,
    qtyMissing: 1,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "partial",
    materialSource: "vendor_delivery",
    availabilityStatus: "received",
  },
  "item-7": {
    deliveryOrderId: "delivery-3",
    sku: "B86-380",
    description: "4050-08 SEALANT REFRIGERATIO EASYSEAL",
    qtyOrdered: 1,
    qtyReceived: 1,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "received",
  },
  "item-demo-v1-1": {
    deliveryOrderId: "delivery-demo-vendor-1",
    sku: "L46-668",
    description: "TH8320R1003/U THERMOSTAT PROGRAMMABLE REDLINK",
    qtyOrdered: 1,
    qtyReceived: 0,
    qtyMissing: 1,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "pending",
  },
  "item-demo-v1-2": {
    deliveryOrderId: "delivery-demo-vendor-1",
    sku: "B86-380",
    description: "4050-08 SEALANT REFRIGERATIO EASYSEAL",
    qtyOrdered: 6,
    qtyReceived: 0,
    qtyMissing: 6,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "pending",
  },
  "item-demo-v1-3": {
    deliveryOrderId: "delivery-demo-vendor-1",
    sku: "L46-100",
    description: "TEST-001 FILTER DRIER",
    qtyOrdered: 2,
    qtyReceived: 0,
    qtyMissing: 2,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "pending",
  },
  "item-demo-v2-1": {
    deliveryOrderId: "delivery-demo-vendor-2",
    sku: "L46-100",
    description: "TEST-001 FILTER DRIER",
    qtyOrdered: 1,
    qtyReceived: 0,
    qtyMissing: 1,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "pending",
  },
};

const auth = getAuth(app);
const db = getFirestore(app);

await signInWithEmailAndPassword(auth, email, password);

const batch = writeBatch(db);
for (const [id, data] of Object.entries(purchaseOrders)) {
  batch.set(doc(db, "purchaseOrders", id), data, { merge: true });
}
for (const [id, data] of Object.entries(deliveries)) {
  batch.set(doc(db, "deliveries", id), data, { merge: true });
}
for (const [id, data] of Object.entries(items)) {
  batch.set(doc(db, "items", id), data, { merge: true });
}
await batch.commit();

console.log("Patched dispatcher demo deliveries ORD-002..ORD-006 (ORD-001 unchanged).");
process.exit(0);

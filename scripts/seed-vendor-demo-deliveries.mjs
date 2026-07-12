/**
 * Idempotent seed: two vendor-portal demo deliveries (Ordered + Shipped).
 *
 * Usage:
 *   node scripts/seed-vendor-demo-deliveries.mjs
 *
 * Requires STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD in .env.local
 * (dispatcher auth — deliveries create is auth-only in firestore.rules).
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, getDoc, writeBatch } from "firebase/firestore";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();

const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;
if (!email || !password) {
  console.error(
    "Missing STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD in .env.local",
  );
  process.exit(1);
}

const firebaseConfig = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: "stageverify-db",
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
};

const now = new Date().toISOString();
const today = now.slice(0, 10);

/** Demo deliveries — fixed IDs so re-run is safe. */
const DEMO_DELIVERIES = [
  {
    delivery: {
      id: "delivery-demo-vendor-1",
      orderNumber: "ORD-005",
      jobId: "job-1",
      vendorId: "vendor-1",
      purchaseOrderId: "po-demo-vendor-1",
      deliveryDate: today,
      status: "pending",
      issueSummary: "",
      notes: "Email ingest (svbotmail@gmail.com): Johnstone will-call SO#6164159 — Customer P/O PLANET FITNESS PICKUP. Vendor demo QR unchanged.",
      createdAt: now,
      updatedAt: now,
    },
    purchaseOrder: {
      id: "po-demo-vendor-1",
      poNumber: "PO-88390",
      jobId: "job-1",
      vendorId: "vendor-1",
      orderDate: today,
      expectedDeliveryDate: today,
      status: "open",
    },
    items: [
      {
        id: "item-demo-v1-1",
        sku: "L46-668",
        description: "TH8320R1003/U THERMOSTAT PROGRAMMABLE REDLINK",
        qtyOrdered: 1,
      },
      {
        id: "item-demo-v1-2",
        sku: "B86-380",
        description: "4050-08 SEALANT REFRIGERATIO EASYSEAL",
        qtyOrdered: 6,
      },
      {
        id: "item-demo-v1-3",
        sku: "L46-100",
        description: "TEST-001 FILTER DRIER",
        qtyOrdered: 2,
      },
    ],
    history: {
      id: "event-demo-vendor-1",
      toStatus: "pending",
    },
  },
  {
    delivery: {
      id: "delivery-demo-vendor-2",
      orderNumber: "ORD-006",
      jobId: "job-2",
      vendorId: "vendor-1",
      purchaseOrderId: "po-6",
      deliveryDate: today,
      status: "shipped",
      issueSummary: "",
      notes:
        "Email ingest (svbotmail@gmail.com): Johnstone Reply-All SO#6164100 — TRUCK STOCK PICKUP shipped. Assign staging before check-in.",
      createdAt: now,
      updatedAt: now,
    },
    purchaseOrder: null,
    items: [
      {
        id: "item-demo-v2-1",
        sku: "L46-100",
        description: "TEST-001 FILTER DRIER",
        qtyOrdered: 1,
      },
    ],
    history: {
      id: "event-demo-vendor-2-pending",
      toStatus: "pending",
      createdAt: "2026-06-01T10:00:00.000Z",
    },
    historyShipped: {
      id: "event-demo-vendor-2-shipped",
      fromStatus: "pending",
      toStatus: "shipped",
      createdAt: "2026-06-02T08:00:00.000Z",
    },
  },
];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function itemDoc(deliveryId, row) {
  return {
    id: row.id,
    deliveryOrderId: deliveryId,
    sku: row.sku,
    description: row.description,
    qtyOrdered: row.qtyOrdered,
    qtyReceived: 0,
    qtyMissing: row.qtyOrdered,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "pending",
  };
}

function historyDoc(entityId, spec) {
  return {
    id: spec.id,
    entityType: "delivery_order",
    entityId,
    ...(spec.fromStatus ? { fromStatus: spec.fromStatus } : {}),
    toStatus: spec.toStatus,
    actorType: "dispatcher",
    actorName: "StageVerify Demo Seed",
    createdAt: spec.createdAt ?? now,
  };
}

(async () => {
  console.log("Signing in…");
  await signInWithEmailAndPassword(auth, email, password);

  let created = 0;
  let skipped = 0;

  for (const demo of DEMO_DELIVERIES) {
    const deliveryId = demo.delivery.id;
    const existing = await getDoc(doc(db, "deliveries", deliveryId));
    if (existing.exists()) {
      console.log(`Skip ${deliveryId} (${demo.delivery.orderNumber}) — already exists`);
      skipped += 1;
      continue;
    }

    const batch = writeBatch(db);
    if (demo.purchaseOrder) {
      batch.set(doc(db, "purchaseOrders", demo.purchaseOrder.id), demo.purchaseOrder);
    }
    batch.set(doc(db, "deliveries", deliveryId), demo.delivery);
    for (const row of demo.items) {
      batch.set(doc(db, "items", row.id), itemDoc(deliveryId, row));
    }
    batch.set(
      doc(db, "statusHistory", demo.history.id),
      historyDoc(deliveryId, demo.history),
    );
    if (demo.historyShipped) {
      batch.set(
        doc(db, "statusHistory", demo.historyShipped.id),
        historyDoc(deliveryId, demo.historyShipped),
      );
    }
    await batch.commit();
    console.log(
      `Created ${deliveryId} — ${demo.delivery.orderNumber} (${demo.delivery.status})`,
    );
    created += 1;
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped.`);
  if (created > 0) {
    console.log("\nVendor Portal links:");
    console.log(
      "  ORD-005 (Ordered):  https://lgarage.github.io/stageverify/#/receive?id=delivery-demo-vendor-1",
    );
    console.log(
      "  ORD-006 (Shipped):  https://lgarage.github.io/stageverify/#/receive?id=delivery-demo-vendor-2",
    );
  }
  process.exit(0);
})().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});

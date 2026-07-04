/**
 * Removes seed/demo Firestore records from stageverify-db (production-safe allowlist).
 * IDs mirror src/dispatcher/seedFirestore.ts — only explicitly listed docs are deleted.
 *
 * Usage:
 *   node scripts/cleanup-demo-firestore.mjs                    # dry-run (admin SDK)
 *   node scripts/cleanup-demo-firestore.mjs --confirm          # delete via admin SDK
 *   node scripts/cleanup-demo-firestore.mjs --client           # dry-run via dispatcher auth
 *   node scripts/cleanup-demo-firestore.mjs --client --confirm # delete deliveries/items/staging
 *
 * Admin mode requires Application Default Credentials (gcloud auth application-default login).
 * Client mode requires STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD in .env.local
 * and deletes only collections rules allow authenticated delete on.
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { createRequire } from "module";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  writeBatch,
} from "firebase/firestore";

const require = createRequire(import.meta.url);
const admin = require("../functions/node_modules/firebase-admin");

const PROJECT_ID = "stageverify-db";

/** Must stay in sync with src/dispatcher/seedFirestore.ts */
const DEMO_DELIVERY_IDS = [
  "delivery-1",
  "delivery-2",
  "delivery-3",
  "delivery-demo-vendor-1",
  "delivery-demo-vendor-2",
];

const DEMO_ORDER_NUMBERS = ["ORD-001", "ORD-002", "ORD-004", "ORD-005", "ORD-006"];

const STATIC_IDS = {
  deliveries: DEMO_DELIVERY_IDS,
  items: [
    "item-1",
    "item-2",
    "item-3",
    "item-4",
    "item-6",
    "item-7",
    "item-demo-v1-1",
    "item-demo-v1-2",
    "item-demo-v1-3",
    "item-demo-v2-1",
  ],
  jobs: ["job-1", "job-2", "job-3"],
  vendors: ["vendor-1", "vendor-2", "vendor-3"],
  stagingLocations: ["staging-1", "staging-2", "staging-3", "staging-4", "staging-5"],
  purchaseOrders: [
    "po-1",
    "po-2",
    "po-3",
    "po-demo-vendor-1",
    "po-4",
    "po-5",
    "po-6",
  ],
  statusHistory: [
    "event-1",
    "event-2",
    "event-3",
    "event-4",
    "event-demo-vendor-1",
    "event-demo-vendor-2-pending",
    "event-demo-vendor-2-shipped",
  ],
  pickupEvents: ["pickup-1"],
};

/** Client SDK can delete these per firestore.rules */
const CLIENT_DELETABLE = new Set(["deliveries", "items", "stagingLocations"]);

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

function parseFlags(argv) {
  return {
    confirm: argv.includes("--confirm"),
    client: argv.includes("--client"),
  };
}

function summarizeEntry(collection, id, data, extra = "") {
  const label =
    collection === "deliveries" && data?.orderNumber
      ? `${id} (${data.orderNumber})`
      : id;
  return extra ? `${collection}/${label} — ${extra}` : `${collection}/${label}`;
}

async function adminDocExists(db, collectionName, id) {
  const snap = await db.collection(collectionName).doc(id).get();
  return snap.exists ? snap.data() : null;
}

async function collectLinkedAdmin(db, collectionName, field, values, staticIds) {
  const found = [];
  for (const value of values) {
    const snap = await db.collection(collectionName).where(field, "==", value).get();
    for (const docSnap of snap.docs) {
      if (!staticIds.includes(docSnap.id)) {
        found.push({
          collection: collectionName,
          id: docSnap.id,
          reason: `${field}=${value}`,
        });
      }
    }
  }
  return found;
}

async function collectExtraDemoDeliveriesAdmin(db) {
  const found = [];
  const snap = await db.collection("deliveries").get();
  for (const docSnap of snap.docs) {
    if (STATIC_IDS.deliveries.includes(docSnap.id)) continue;
    const data = docSnap.data();
    const orderNumber = typeof data.orderNumber === "string" ? data.orderNumber : "";
    const id = docSnap.id;
    if (id.startsWith("delivery-demo-") || DEMO_ORDER_NUMBERS.includes(orderNumber)) {
      found.push({
        collection: "deliveries",
        id,
        reason: `orderNumber=${orderNumber || "(none)"}`,
      });
    }
  }
  return found;
}

async function buildDeletePlanAdmin(db) {
  const toDelete = [];

  for (const [collectionName, ids] of Object.entries(STATIC_IDS)) {
    for (const id of ids) {
      const data = await adminDocExists(db, collectionName, id);
      if (data) {
        toDelete.push({ collection: collectionName, id, data, reason: "seed allowlist" });
      }
    }
  }

  const linked = [
    ...(await collectLinkedAdmin(db, "items", "deliveryOrderId", DEMO_DELIVERY_IDS, STATIC_IDS.items)),
    ...(await collectLinkedAdmin(
      db,
      "statusHistory",
      "entityId",
      DEMO_DELIVERY_IDS,
      STATIC_IDS.statusHistory,
    )),
    ...(await collectLinkedAdmin(
      db,
      "pickupEvents",
      "deliveryOrderId",
      DEMO_DELIVERY_IDS,
      STATIC_IDS.pickupEvents,
    )),
    ...(await collectExtraDemoDeliveriesAdmin(db)),
  ];

  for (const entry of linked) {
    const data = await adminDocExists(db, entry.collection, entry.id);
    if (data) {
      toDelete.push({ ...entry, data });
    }
  }

  return dedupePlan(toDelete);
}

async function clientDocExists(db, collectionName, id) {
  const snap = await getDoc(doc(db, collectionName, id));
  return snap.exists() ? snap.data() : null;
}

async function collectLinkedClient(db, collectionName, field, values, staticIds) {
  const found = [];
  for (const value of values) {
    const snap = await getDocs(
      query(collection(db, collectionName), where(field, "==", value)),
    );
    for (const docSnap of snap.docs) {
      if (!staticIds.includes(docSnap.id)) {
        found.push({
          collection: collectionName,
          id: docSnap.id,
          reason: `${field}=${value}`,
        });
      }
    }
  }
  return found;
}

async function collectExtraDemoDeliveriesClient(db) {
  const found = [];
  const snap = await getDocs(collection(db, "deliveries"));
  for (const docSnap of snap.docs) {
    if (STATIC_IDS.deliveries.includes(docSnap.id)) continue;
    const data = docSnap.data();
    const orderNumber = typeof data.orderNumber === "string" ? data.orderNumber : "";
    const id = docSnap.id;
    if (id.startsWith("delivery-demo-") || DEMO_ORDER_NUMBERS.includes(orderNumber)) {
      found.push({
        collection: "deliveries",
        id,
        reason: `orderNumber=${orderNumber || "(none)"}`,
      });
    }
  }
  return found;
}

async function buildDeletePlanClient(db) {
  const toDelete = [];

  for (const [collectionName, ids] of Object.entries(STATIC_IDS)) {
    if (!CLIENT_DELETABLE.has(collectionName)) continue;
    for (const id of ids) {
      const data = await clientDocExists(db, collectionName, id);
      if (data) {
        toDelete.push({ collection: collectionName, id, data, reason: "seed allowlist" });
      }
    }
  }

  const linked = [
    ...(await collectLinkedClient(
      db,
      "items",
      "deliveryOrderId",
      DEMO_DELIVERY_IDS,
      STATIC_IDS.items,
    )),
    ...(await collectExtraDemoDeliveriesClient(db)),
  ];

  for (const entry of linked) {
    if (!CLIENT_DELETABLE.has(entry.collection)) continue;
    const data = await clientDocExists(db, entry.collection, entry.id);
    if (data) {
      toDelete.push({ ...entry, data });
    }
  }

  return dedupePlan(toDelete);
}

function dedupePlan(rows) {
  const unique = new Map();
  for (const row of rows) {
    unique.set(`${row.collection}/${row.id}`, row);
  }
  return [...unique.values()].sort(
    (a, b) => a.collection.localeCompare(b.collection) || a.id.localeCompare(b.id),
  );
}

async function executeAdminDelete(db, plan) {
  const batchSize = 400;
  let deleted = 0;
  for (let i = 0; i < plan.length; i += batchSize) {
    const batch = db.batch();
    const chunk = plan.slice(i, i + batchSize);
    for (const row of chunk) {
      batch.delete(db.collection(row.collection).doc(row.id));
    }
    await batch.commit();
    deleted += chunk.length;
  }
  return deleted;
}

async function executeClientDelete(db, plan) {
  const batchSize = 400;
  let deleted = 0;
  for (let i = 0; i < plan.length; i += batchSize) {
    const batch = writeBatch(db);
    const chunk = plan.slice(i, i + batchSize);
    for (const row of chunk) {
      batch.delete(doc(db, row.collection, row.id));
    }
    await batch.commit();
    deleted += chunk.length;
  }
  return deleted;
}

async function runAdmin(confirm) {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }
  const db = admin.firestore();
  const plan = await buildDeletePlanAdmin(db);
  return { plan, mode: "admin", execute: () => executeAdminDelete(db, plan) };
}

async function runClient(confirm) {
  loadEnvLocal();
  const email = process.env.STAGEVERIFY_TEST_EMAIL;
  const password = process.env.STAGEVERIFY_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Missing STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD in .env.local for --client mode",
    );
  }
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  await signInWithEmailAndPassword(auth, email, password);
  const db = getFirestore(app);
  const plan = await buildDeletePlanClient(db);
  return { plan, mode: "client", execute: () => executeClientDelete(db, plan) };
}

async function main() {
  const { confirm, client } = parseFlags(process.argv.slice(2));

  let result;
  if (client) {
    result = await runClient(confirm);
  } else {
    try {
      result = await runAdmin(confirm);
    } catch (err) {
      const msg = err?.message ?? String(err);
      if (msg.includes("default credentials") || msg.includes("Could not load")) {
        console.error(
          "Admin SDK credentials unavailable. Re-run with --client (dispatcher auth) or run:\n  gcloud auth application-default login",
        );
        process.exit(1);
      }
      throw err;
    }
  }

  const { plan, mode, execute } = result;

  if (plan.length === 0) {
    console.log("No demo seed documents found in Firestore — dashboard should already be clean.");
    return;
  }

  const modeLabel = mode === "client" ? "client (deliveries/items/staging only)" : "admin (all seed collections)";
  console.log(
    confirm
      ? `Deleting ${plan.length} demo document(s) via ${modeLabel} from ${PROJECT_ID}:`
      : `DRY RUN [${modeLabel}] — would delete ${plan.length} demo document(s) from ${PROJECT_ID}:`,
  );
  if (!confirm) {
    console.log("(Re-run with --confirm to delete)\n");
  } else {
    console.log("");
  }

  for (const row of plan) {
    console.log(`  ${summarizeEntry(row.collection, row.id, row.data, row.reason)}`);
  }

  if (!confirm) {
    console.log("\nDry run complete. Pass --confirm to delete.");
    if (mode === "client") {
      console.log(
        "Note: --client mode cannot delete jobs, vendors, purchaseOrders, statusHistory, or pickupEvents (rules). Use admin mode for full cleanup.",
      );
    }
    return;
  }

  const deleted = await execute();
  console.log(`\nDeleted ${deleted} document(s).`);
  console.log("Demo order numbers targeted:", DEMO_ORDER_NUMBERS.join(", "));
  if (mode === "client") {
    console.log(
      "Orphan seed docs may remain in jobs/vendors/purchaseOrders/statusHistory — run admin mode to remove.",
    );
  }
}

main().catch((err) => {
  console.error("cleanup-demo-firestore failed:", err.message ?? err);
  process.exit(1);
});

/**
 * Production cleanup: Grok-approved SAFE verifier fixtures only (hardcoded allowlist).
 * Restores job-1 metadata polluted by verify-management-catch-all.mjs.
 *
 * Usage:
 *   node scripts/cleanup-mgmt-verify-fixtures.mjs           # dry-run
 *   node scripts/cleanup-mgmt-verify-fixtures.mjs --confirm # delete + restore job-1
 *
 * Requires STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD (.env.local or env).
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";

const PROJECT_ID = "stageverify-db";

/** Grok deletion review PASS — exact IDs only (2026-08-08). */
const ALLOWLIST_DELIVERY_IDS = [
  "delivery-mgmt-catchall-mrwwide8",
  "delivery-mgmt-catchall-mrwwj9nc",
  "delivery-mgmt-catchall-mrwwjpnj",
  "delivery-mgmt-catchall-mrwwkuns",
  "delivery-mgmt-catchall-mrwwniij",
  "delivery-mgmt-catchall-mrwx8o9h",
  "delivery-mgmt-catchall-mrwxejug",
  "delivery-mgmt-catchall-mrwxk5v1",
  "delivery-mgmt-catchall-mrwxt7vv",
  "delivery-mgmt-catchall-mrwxucar",
  "delivery-mgmt-catchall-mrwxxt5v",
  "delivery-mgmt-catchall-mrwy5e2g",
  "delivery-mgmt-catchall-mrzr2f3d",
  "delivery-unid-06adba20-5d8",
  "delivery-unid-2b8cc458-3d6",
  "delivery-unid-38be608b-b49",
  "delivery-unid-6e4bcece-5a9",
  "delivery-unid-ad1f4190-6f7",
  "delivery-unid-b44ef0e6-04c",
  "delivery-unid-e90b3b42-15b",
  "delivery-unid-ec9b5395-f20",
];

const JOB1_RESTORE = {
  jobNumber: "JOB-2026-0421",
  jobName: "Riverside Medical Center",
};

/** Sample preserved orders — assert still exist after cleanup. */
const PRESERVED_ORDER_NUMBERS = ["ORD-005", "6166261", "15046467-00", "3869488-00"];

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

function isAllowlistedDeliverySafe(id, data) {
  if (id.startsWith("delivery-mgmt-catchall-")) {
    const orderNumber = typeof data.orderNumber === "string" ? data.orderNumber : "";
    const vendorId = typeof data.vendorId === "string" ? data.vendorId : "";
    return orderNumber.startsWith("MGMT-VERIFY-") && vendorId === "vendor-verify";
  }
  if (id.startsWith("delivery-unid-")) {
    const vendorName = typeof data.vendorName === "string" ? data.vendorName : "";
    const notes = typeof data.notes === "string" ? data.notes : "";
    return vendorName === "Speedy Freight" && notes === "Unknown PO on slip";
  }
  return false;
}

async function collectItemsForDeliveries(db, deliveryIds) {
  const items = new Map();
  for (const deliveryId of deliveryIds) {
    const itemId = `${deliveryId}-item`;
    const directSnap = await getDoc(doc(db, "items", itemId));
    if (directSnap.exists()) {
      items.set(itemId, { id: itemId, deliveryOrderId: deliveryId, reason: "id pattern" });
    }
    const linkedSnap = await getDocs(
      query(collection(db, "items"), where("deliveryOrderId", "==", deliveryId)),
    );
    for (const itemDoc of linkedSnap.docs) {
      items.set(itemDoc.id, {
        id: itemDoc.id,
        deliveryOrderId: deliveryId,
        reason: "deliveryOrderId query",
      });
    }
  }
  return [...items.values()];
}

async function buildPlan(db) {
  const deliveries = [];
  const skipped = [];

  for (const id of ALLOWLIST_DELIVERY_IDS) {
    const snap = await getDoc(doc(db, "deliveries", id));
    if (!snap.exists()) {
      skipped.push({ collection: "deliveries", id, reason: "not found" });
      continue;
    }
    const data = snap.data();
    if (!isAllowlistedDeliverySafe(id, data)) {
      skipped.push({
        collection: "deliveries",
        id,
        reason: `safety mismatch orderNumber=${data.orderNumber ?? ""} vendorId=${data.vendorId ?? ""} vendorName=${data.vendorName ?? ""} notes=${data.notes ?? ""}`,
      });
      continue;
    }
    deliveries.push({ collection: "deliveries", id, data });
  }

  const deliveryIdsToDelete = deliveries.map((d) => d.id);
  const items = await collectItemsForDeliveries(db, deliveryIdsToDelete);

  return { deliveries, items, skipped };
}

async function executeDeletes(db, plan) {
  const deleted = [];
  const rows = [
    ...plan.items.map((row) => ({ collection: "items", id: row.id })),
    ...plan.deliveries.map((row) => ({ collection: "deliveries", id: row.id })),
  ];

  const batchSize = 400;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = writeBatch(db);
    const chunk = rows.slice(i, i + batchSize);
    for (const row of chunk) {
      batch.delete(doc(db, row.collection, row.id));
    }
    await batch.commit();
    for (const row of chunk) {
      deleted.push(`${row.collection}/${row.id}`);
      console.log(`  DELETED ${row.collection}/${row.id}`);
    }
  }
  return deleted;
}

async function restoreJob1(db, confirm) {
  const jobRef = doc(db, "jobs", "job-1");
  const beforeSnap = await getDoc(jobRef);
  const before = beforeSnap.exists()
    ? {
        jobNumber: beforeSnap.data().jobNumber ?? null,
        jobName: beforeSnap.data().jobName ?? null,
      }
    : { jobNumber: null, jobName: null };

  if (!confirm) {
    console.log("\njob-1 restore (dry-run merge):");
    console.log(`  before: jobNumber=${before.jobNumber} jobName=${before.jobName}`);
    console.log(`  after:  jobNumber=${JOB1_RESTORE.jobNumber} jobName=${JOB1_RESTORE.jobName}`);
    return { before, after: JOB1_RESTORE, restored: false };
  }

  const now = new Date().toISOString();
  await setDoc(
    jobRef,
    {
      ...JOB1_RESTORE,
      updatedAt: now,
    },
    { merge: true },
  );

  const afterSnap = await getDoc(jobRef);
  const after = {
    jobNumber: afterSnap.data()?.jobNumber ?? null,
    jobName: afterSnap.data()?.jobName ?? null,
  };
  console.log("\njob-1 restored:");
  console.log(`  before: jobNumber=${before.jobNumber} jobName=${before.jobName}`);
  console.log(`  after:  jobNumber=${after.jobNumber} jobName=${after.jobName}`);
  return { before, after, restored: true };
}

async function postDeleteAssertions(db) {
  const deliverySnap = await getDocs(collection(db, "deliveries"));
  let mgmtVerifyRemaining = 0;
  const allowlistedRemaining = [];

  for (const docSnap of deliverySnap.docs) {
    const data = docSnap.data();
    const orderNumber = typeof data.orderNumber === "string" ? data.orderNumber : "";
    if (orderNumber.startsWith("MGMT-VERIFY-")) mgmtVerifyRemaining += 1;
    if (ALLOWLIST_DELIVERY_IDS.includes(docSnap.id)) {
      allowlistedRemaining.push(docSnap.id);
    }
  }

  const preserved = {};
  for (const orderNumber of PRESERVED_ORDER_NUMBERS) {
    const snap = await getDocs(
      query(collection(db, "deliveries"), where("orderNumber", "==", orderNumber)),
    );
    preserved[orderNumber] = snap.size > 0;
  }

  console.log("\nPost-delete scan:");
  console.log(`  MGMT-VERIFY-* deliveries remaining: ${mgmtVerifyRemaining}`);
  console.log(`  allowlisted ids remaining: ${allowlistedRemaining.length}`);
  if (allowlistedRemaining.length) {
    console.log(`    ${allowlistedRemaining.join(", ")}`);
  }
  console.log("  preserved sample orders:");
  for (const [orderNumber, present] of Object.entries(preserved)) {
    console.log(`    ${orderNumber}: ${present ? "PRESENT" : "MISSING"}`);
  }

  const ok =
    mgmtVerifyRemaining === 0 &&
    allowlistedRemaining.length === 0 &&
    Object.values(preserved).every(Boolean);

  if (!ok) {
    throw new Error("Post-delete assertions failed — see scan output above.");
  }
  return { mgmtVerifyRemaining, allowlistedRemaining, preserved };
}

async function main() {
  loadEnvLocal();
  const confirm = process.argv.includes("--confirm");
  const email = process.env.STAGEVERIFY_TEST_EMAIL;
  const password = process.env.STAGEVERIFY_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error("STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD required");
  }

  const app = initializeApp(firebaseConfig, "cleanup-mgmt-verify-fixtures");
  const auth = getAuth(app);
  await signInWithEmailAndPassword(auth, email, password);
  const db = getFirestore(app);

  const plan = await buildPlan(db);

  console.log(
    confirm
      ? `CONFIRM — deleting verifier fixtures from ${PROJECT_ID}:`
      : `DRY RUN — would delete from ${PROJECT_ID}:`,
  );
  console.log(`  deliveries: ${plan.deliveries.length}`);
  console.log(`  items: ${plan.items.length}`);
  if (plan.skipped.length) {
    console.log(`  skipped: ${plan.skipped.length}`);
  }
  if (!confirm) console.log("(Re-run with --confirm to delete)\n");

  for (const row of plan.deliveries) {
    console.log(`  delivery/${row.id} (${row.data.orderNumber ?? ""})`);
  }
  for (const row of plan.items) {
    console.log(`  item/${row.id} (deliveryOrderId=${row.deliveryOrderId}, ${row.reason})`);
  }
  for (const row of plan.skipped) {
    console.log(`  SKIP ${row.collection}/${row.id} — ${row.reason}`);
  }

  let deleted = [];
  if (confirm) {
    deleted = await executeDeletes(db, plan);
  }

  await restoreJob1(db, confirm);

  if (confirm) {
    await postDeleteAssertions(db);
    console.log(`\nCleanup complete. Deleted ${deleted.length} document(s).`);
  } else {
    console.log("\nDry run complete.");
  }
}

main().catch((err) => {
  console.error("cleanup-mgmt-verify-fixtures failed:", err.message ?? err);
  process.exit(1);
});

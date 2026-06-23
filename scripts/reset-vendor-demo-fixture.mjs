/**
 * Resets delivery-demo-vendor-1 to pending / zero-received for repeatable E2E.
 *
 * Usage: node scripts/reset-vendor-demo-fixture.mjs
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
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
  console.error("Missing STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD");
  process.exit(1);
}

const deliveryId =
  process.env.STAGEVERIFY_RECEIVE_DELIVERY ?? "delivery-demo-vendor-1";

const app = initializeApp({
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: "stageverify-db",
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
});

const auth = getAuth(app);
const db = getFirestore(app);
const now = new Date().toISOString();

await signInWithEmailAndPassword(auth, email, password);

const deliverySnap = await getDoc(doc(db, "deliveries", deliveryId));
if (!deliverySnap.exists()) {
  console.error(`Delivery ${deliveryId} not found — run seed:vendor-demo first.`);
  process.exit(1);
}

const itemsSnap = await getDocs(
  query(collection(db, "items"), where("deliveryOrderId", "==", deliveryId)),
);

const batch = writeBatch(db);
batch.update(doc(db, "deliveries", deliveryId), {
  status: "pending",
  stagingLocationId: null,
  additionalStagingLocationIds: [],
  submittedAt: null,
  vendorPhysicalDropoffConfirmed: false,
  vendorPhysicalDropoffConfirmedAt: null,
  vendorOrderComplete: false,
  vendorOrderCompleteAt: null,
  vendorOrderCompleteSource: null,
  physicalDropoffComplete: false,
  physicalDropoffCompleteAt: null,
  readinessStatus: null,
  readinessBlockReasons: [],
  openIssueCount: 0,
  openBlockingIssueCount: 0,
  issueSummary: "",
  deliveredAt: null,
  updatedAt: now,
});

for (const itemDoc of itemsSnap.docs) {
  const data = itemDoc.data();
  const qtyOrdered = data.qtyOrdered ?? 0;
  batch.update(itemDoc.ref, {
    qtyReceived: 0,
    qtyMissing: qtyOrdered,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "pending",
  });
}

await batch.commit();
console.log(`Reset ${deliveryId} → pending (${itemsSnap.size} items zeroed).`);
process.exit(0);

/**
 * Read-only probe: vendor email events + delivery 4046362 status (no mutations).
 * Usage: node scripts/audit-needs-review-firestore.mjs
 */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  collection,
  getDocs,
  getFirestore,
  query,
  where,
  limit,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: "stageverify-db",
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

loadEnvLocal();
const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;
if (!email || !password) {
  console.error("Set STAGEVERIFY_TEST_EMAIL/PASSWORD in .env.local");
  process.exit(1);
}

const app = initializeApp(firebaseConfig, "audit-needs-review-firestore");
const auth = getAuth(app);
const db = getFirestore(app);

await signInWithEmailAndPassword(auth, email, password);

const pendingSnap = await getDocs(
  query(
    collection(db, "vendorEmailEvents"),
    where("reviewStatus", "==", "pending_review"),
    limit(20),
  ),
);
const pending = pendingSnap.docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .filter((e) => e.direction === "inbound" || !e.direction)
  .sort((a, b) => (b.receivedAt ?? "").localeCompare(a.receivedAt ?? ""));

console.log("\n=== Pending inbound vendorEmailEvents ===");
console.log(`count: ${pending.length}`);
for (const e of pending) {
  console.log(
    JSON.stringify(
      {
        id: e.id,
        subject: e.subject,
        senderEmail: e.senderEmail,
        matchedBy: e.matchedBy,
        humanReviewRequired: e.humanReviewRequired,
        deliveryOrderId: e.deliveryOrderId,
        threadId: e.threadId,
        sourceMessageId: e.sourceMessageId,
        emailClassification: e.emailClassification,
        confidenceReason: e.confidenceReason,
        reviewStatus: e.reviewStatus,
        receivedAt: e.receivedAt,
      },
      null,
      2,
    ),
  );
  console.log("---");
}

const deliverySnap = await getDocs(
  query(collection(db, "deliveryOrders"), where("orderNumber", "==", "4046362"), limit(5)),
);
console.log("\n=== deliveryOrders orderNumber=4046362 ===");
for (const d of deliverySnap.docs) {
  const data = d.data();
  console.log(
    JSON.stringify(
      {
        id: d.id,
        orderNumber: data.orderNumber,
        customerPoOrReference: data.customerPoOrReference,
        status: data.status,
        deliveryStatus: data.deliveryStatus,
        itemsReceived: data.itemsReceived,
        itemsExpected: data.itemsExpected,
        invoiceDeliverToSiteConfirmed: data.invoiceDeliverToSiteConfirmed,
        complete: data.complete,
      },
      null,
      2,
    ),
  );
}

if (deliverySnap.empty) {
  const altSnap = await getDocs(
    query(collection(db, "deliveryOrders"), limit(50)),
  );
  const hits = altSnap.docs.filter((d) => {
    const data = d.data();
    return (
      data.orderNumber === "4046362" ||
      String(data.customerPoOrReference ?? "").includes("P411190") ||
      String(data.customerPoOrReference ?? "").includes("4046362")
    );
  });
  console.log(`Fallback scan: ${hits.length} delivery rows mention 4046362/P411190`);
  for (const d of hits) {
    const data = d.data();
    console.log(
      JSON.stringify(
        {
          id: d.id,
          orderNumber: data.orderNumber,
          customerPoOrReference: data.customerPoOrReference,
          status: data.status,
          deliveryStatus: data.deliveryStatus,
        },
        null,
        2,
      ),
    );
  }
}

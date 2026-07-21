/**
 * Inspect shell deliveries + jobs for specific invoice numbers (prod).
 */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

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
const app = initializeApp(
  {
    apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
    authDomain: "stageverify-db.firebaseapp.com",
    projectId: "stageverify-db",
    storageBucket: "stageverify-db.firebasestorage.app",
    messagingSenderId: "784751243681",
    appId: "1:784751243681:web:31fa71762b94f878fd1be0",
  },
  "inspect-shells",
);
await signInWithEmailAndPassword(
  getAuth(app),
  process.env.STAGEVERIFY_TEST_EMAIL,
  process.env.STAGEVERIFY_TEST_PASSWORD,
);
const db = getFirestore(app);
const listImports = httpsCallable(getFunctions(app, "us-central1"), "listVendorInvoiceImports");
const { data } = await listImports({ limit: 100 });
const want = new Set(["3869488-00", "15046467-00"]);
for (const row of data.items ?? []) {
  const inv = String(row.parsedHeader?.vendorInvoiceNumber ?? "").trim();
  if (!want.has(inv)) continue;
  const shellId = `delivery-vii-${row.id}`;
  const deliverySnap = await getDoc(doc(db, "deliveries", shellId));
  const delivery = deliverySnap.exists() ? deliverySnap.data() : null;
  const jobId = delivery?.jobId;
  const vendorId = delivery?.vendorId;
  const jobSnap = jobId ? await getDoc(doc(db, "jobs", jobId)) : null;
  const vendorSnap = vendorId ? await getDoc(doc(db, "vendors", vendorId)) : null;
  console.log(
    JSON.stringify(
      {
        inv,
        importId: row.id,
        linked: row.linkedDeliveryOrderId,
        shellExists: deliverySnap.exists(),
        orderNumber: delivery?.orderNumber,
        vendorInvoiceImportId: delivery?.vendorInvoiceImportId,
        createdFromInvoiceImport: delivery?.createdFromInvoiceImport,
        jobId,
        jobNumber: jobSnap?.exists() ? jobSnap.data()?.jobNumber : null,
        jobName: jobSnap?.exists() ? jobSnap.data()?.jobName : null,
        vendorId,
        vendorName: vendorSnap?.exists()
          ? vendorSnap.data()?.name
          : delivery?.vendorName ?? null,
        vendorDocExists: vendorSnap?.exists() ?? false,
      },
      null,
      2,
    ),
  );
}

/**
 * Phase 1 probe: read production vendorInvoiceImports for page-0 / S/O 4046362.
 * Uses dispatcher auth + Cloud Functions callables (no admin ADC required).
 *
 * Usage: node scripts/inspect-import-4046362.mjs
 */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

const PROJECT_ID = "stageverify-db";
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

loadEnvLocal();
const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;
if (!email || !password) {
  console.error("Set STAGEVERIFY_TEST_EMAIL/PASSWORD in .env.local");
  process.exit(1);
}

const app = initializeApp(firebaseConfig, "inspect-import-4046362");
const auth = getAuth(app);
const functions = getFunctions(app, "us-central1");

await signInWithEmailAndPassword(auth, email, password);

const listImports = httpsCallable(functions, "listVendorInvoiceImports");
const getInbound = httpsCallable(functions, "getInboundEmailProcessing");

const { data: listData } = await listImports({ limit: 50 });
const items = listData?.items ?? [];

const hits = items.filter((row) => {
  const h = row.parsedHeader ?? {};
  const headerStr = JSON.stringify(h);
  return (
    row.pageId === "page-0" ||
    h.vendorOrderNumber === "4046362" ||
    headerStr.includes("4046362")
  );
});

console.log(`\n=== Firestore probe: ${items.length} imports scanned, ${hits.length} match page-0 / 4046362 ===\n`);

if (hits.length === 0) {
  console.log("No production match. Recent imports:");
  for (const row of items.slice(0, 10)) {
    const h = row.parsedHeader ?? {};
    console.log(
      `  ${row.id} pageId=${row.pageId} SO=${h.vendorOrderNumber ?? "—"} inv=${h.vendorInvoiceNumber ?? "—"} status=${row.importStatus}`,
    );
  }
  process.exit(0);
}

for (const row of hits) {
  console.log(JSON.stringify(row, null, 2));
  console.log("---");

  if (row.inboundEmailProcessingId) {
    try {
      const { data: inbound } = await getInbound({ id: row.inboundEmailProcessingId });
      const att = inbound?.pdfAttachments?.[0];
      console.log(
        "inbound extracted text preview:",
        JSON.stringify(
          {
            subject: inbound?.subject,
            status: inbound?.status,
            pdfFilenames: inbound?.pdfAttachments?.map((a) => a.filename),
            extractedTextPreview: att?.extractedText?.slice(0, 1200),
            combinedExtractedTextPreview:
              inbound?.combinedExtractedTextPreview ??
              inbound?.combinedExtractedText?.slice(0, 1200),
          },
          null,
          2,
        ),
      );
    } catch (err) {
      console.log("inbound fetch error:", err.message);
    }
  }
}

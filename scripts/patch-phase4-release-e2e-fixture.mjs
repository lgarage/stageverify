/**
 * Phase 4 release-prompt E2E fixture — planned G1, vendor NMS picks G2+GL.
 * Usage: node scripts/patch-phase4-release-e2e-fixture.mjs
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, writeBatch } from "firebase/firestore";

const FIREBASE_TIMEOUT_MS = 60_000;

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

function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(`${label} timed out after ${FIREBASE_TIMEOUT_MS / 1000}s`)),
        FIREBASE_TIMEOUT_MS,
      );
    }),
  ]);
}

loadEnvLocal();

const email = process.env.STAGEVERIFY_TEST_EMAIL;
const password = process.env.STAGEVERIFY_TEST_PASSWORD;
if (!email || !password) {
  console.error("Missing STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD");
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

const auth = getAuth(app);
const db = getFirestore(app);

console.log("[patch-phase4-release] signing in…");
await withTimeout(
  signInWithEmailAndPassword(auth, email, password),
  "Firebase signInWithEmailAndPassword",
);
console.log("[patch-phase4-release] sign-in OK");

const now = new Date().toISOString();
const batch = writeBatch(db);

batch.set(
  doc(db, "stagingLocations", "staging-2"),
  {
    adjacentGroupId: "pipe-a",
    sizeClass: "ground",
    updatedAt: now,
  },
  { merge: true },
);
batch.set(
  doc(db, "stagingLocations", "staging-5"),
  {
    adjacentGroupId: "pipe-a",
    sizeClass: "large",
    updatedAt: now,
  },
  { merge: true },
);

batch.set(
  doc(db, "deliveries", "delivery-demo-vendor-1"),
  {
    orderNumber: "ORD-005",
    stagingLocationId: "staging-1",
    plannedStagingLocationIds: ["staging-1", "staging-2"],
    additionalStagingLocationIds: [],
    plannedLocationReleases: [],
    status: "pending",
    updatedAt: now,
  },
  { merge: true },
);

console.log("[patch-phase4-release] committing batch…");
await withTimeout(batch.commit(), "Firestore batch.commit");
console.log(
  "Phase 4 release E2E fixture: planned G1 only on delivery-demo-vendor-1; pipe-a adjacency on G2+GL.",
);
process.exit(0);

/**
 * Production data fix: enable companyWideSessionEnabled for allowlisted vendors
 * so location-scan company PINs resolve (D-09 path). Dry-run default.
 *
 * Usage:
 *   node scripts/enable-vendor-companywide-pin.mjs
 *   node scripts/enable-vendor-companywide-pin.mjs --confirm
 *
 * Requires STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD.
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, getFirestore, setDoc } from "firebase/firestore";

const PROJECT_ID = "stageverify-db";
const ALLOWLIST = ["vendor-1", "vendor-2", "vendor-3"];
const PROTECTED_NAMES = {
  "vendor-1": /johnstone/i,
  "vendor-2": /first\s*supply/i,
  "vendor-3": /ferguson/i,
};

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

async function main() {
  loadEnvLocal();
  const confirm = process.argv.includes("--confirm");
  const email = process.env.STAGEVERIFY_TEST_EMAIL;
  const password = process.env.STAGEVERIFY_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error("STAGEVERIFY_TEST_EMAIL / STAGEVERIFY_TEST_PASSWORD required");
  }

  const app = initializeApp(firebaseConfig, "enable-vendor-companywide");
  const auth = getAuth(app);
  await signInWithEmailAndPassword(auth, email, password);
  const db = getFirestore(app);

  console.log(
    confirm
      ? `CONFIRM — enabling companyWideSessionEnabled on ${PROJECT_ID}:`
      : `DRY RUN — would enable companyWideSessionEnabled on ${PROJECT_ID}:`,
  );

  for (const id of ALLOWLIST) {
    const snap = await getDoc(doc(db, "vendors", id));
    if (!snap.exists()) {
      throw new Error(`Missing vendor ${id} — abort`);
    }
    const data = snap.data();
    const name = typeof data.name === "string" ? data.name : "";
    const nameOk = PROTECTED_NAMES[id];
    if (!nameOk.test(name)) {
      throw new Error(
        `Safety mismatch ${id}: name="${name}" does not match expected pattern — abort`,
      );
    }
    const before = data.companyWideSessionEnabled === true;
    console.log(
      `  ${id} (${name}): companyWide ${before} → true` +
        (before ? " (already true)" : ""),
    );

    if (confirm && !before) {
      await setDoc(
        doc(db, "vendors", id),
        {
          companyWideSessionEnabled: true,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
      const afterSnap = await getDoc(doc(db, "vendors", id));
      const after = afterSnap.data()?.companyWideSessionEnabled === true;
      if (!after) {
        throw new Error(`Read-back failed for ${id}`);
      }
      console.log(`    WRITE OK — read-back companyWide=true`);
    }
  }

  if (!confirm) {
    console.log("\n(Re-run with --confirm to write)");
  } else {
    console.log("\nDone.");
  }
}

main().catch((err) => {
  console.error("enable-vendor-companywide-pin failed:", err.message ?? err);
  process.exit(1);
});

/**
 * Ensure STAGEVERIFY_TEST_EMAIL has dispatcherRoles/{uid} in production Firestore.
 * Requires Application Default Credentials (gcloud auth application-default login).
 *
 * Usage: node scripts/ensure-dispatcher-role.mjs
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const admin = require("../functions/node_modules/firebase-admin");

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

const email = process.env.STAGEVERIFY_TEST_EMAIL;
if (!email) {
  console.error("Missing STAGEVERIFY_TEST_EMAIL in .env.local");
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({ projectId: "stageverify-db" });
}

const user = await admin.auth().getUserByEmail(email);
await admin.firestore().collection("dispatcherRoles").doc(user.uid).set(
  {
    active: true,
    email,
    updatedAt: new Date().toISOString(),
  },
  { merge: true },
);

console.log(`dispatcherRoles/${user.uid} ensured for ${email}`);

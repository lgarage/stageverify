/**
 * Bootstrap the first operator account (prepare-only script).
 * Requires --uid and --name. Never runs against production without --confirm-production.
 *
 * Usage (emulator):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/operator/bootstrap-first-operator.mjs --uid <uid> --name "Ops Name"
 */
import { createRequire } from "node:module";
import { parseArgs } from "node:util";

const require = createRequire(import.meta.url);
const admin = require("../../functions/node_modules/firebase-admin");

const { values } = parseArgs({
  options: {
    uid: { type: "string" },
    name: { type: "string" },
    "confirm-production": { type: "boolean", default: false },
  },
});

const uid = values.uid?.trim();
const name = values.name?.trim();
const confirmProduction = values["confirm-production"] === true;

if (!uid || !name) {
  console.error("Usage: --uid <firebase-auth-uid> --name <display-name>");
  process.exit(1);
}

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (!confirmProduction && !emulatorHost) {
  console.error(
    "Refusing to write: set FIRESTORE_EMULATOR_HOST or pass --confirm-production explicitly.",
  );
  process.exit(1);
}

const projectId =
  process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  "stageverify-db";

if (!admin.apps.length) {
  admin.initializeApp({ projectId });
}

const db = admin.firestore();
console.log(`projectId=${projectId} emulator=${emulatorHost ?? "none"}`);

const lockRef = db.collection("operatorConsoleLocks").doc("first-operator-bootstrap");
const operatorRef = db.collection("operatorAccounts").doc(uid);
const now = new Date().toISOString();

try {
  await db.runTransaction(async (tx) => {
    const lockSnap = await tx.get(lockRef);
    if (lockSnap.exists) {
      throw new Error("first-operator-bootstrap lock already claimed");
    }

    const activeQuery = db
      .collection("operatorAccounts")
      .where("active", "==", true)
      .limit(1);
    const activeSnap = await tx.get(activeQuery);
    if (!activeSnap.empty) {
      throw new Error("active operatorAccounts already exist");
    }

    tx.set(lockRef, { claimed: true, uid, claimedAt: now });
    tx.set(operatorRef, {
      active: true,
      displayName: name,
      createdAt: now,
      updatedAt: now,
    });
  });
} catch (err) {
  console.error(`Refusing bootstrap: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

console.log(`Bootstrapped first operator uid=${uid}`);

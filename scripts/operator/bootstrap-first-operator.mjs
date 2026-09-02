/**
 * Bootstrap the first operator account (prepare-only script).
 *
 * Run on Dan's trusted Windows PC: C:\Projects\stageverify
 * Credentials: `gcloud auth application-default login` OR gitignored
 * GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account JSON.
 * Confirm printed projectId before any production write.
 * UID from Firebase Console Auth or --lookup-email.
 *
 * Rollback: delete operatorAccounts/{uid} and
 * operatorConsoleLocks/first-operator-bootstrap in Firestore.
 *
 * Usage (emulator):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/operator/bootstrap-first-operator.mjs --uid <uid> --name "Ops Name"
 *
 * Usage (production — explicit):
 *   node scripts/operator/bootstrap-first-operator.mjs --uid <uid> --name "Ops Name" --confirm-production
 *
 * Dry-run (no writes):
 *   node scripts/operator/bootstrap-first-operator.mjs --uid <uid> --name "Ops Name" --dry-run
 *
 * Lookup UID by email (read-only):
 *   node scripts/operator/bootstrap-first-operator.mjs --lookup-email user@example.com
 */
import { accessSync, constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";

const require = createRequire(import.meta.url);
const admin = require("../../functions/node_modules/firebase-admin");

const { values } = parseArgs({
  options: {
    uid: { type: "string" },
    name: { type: "string" },
    email: { type: "string" },
    "lookup-email": { type: "string" },
    "dry-run": { type: "boolean", default: false },
    "confirm-production": { type: "boolean", default: false },
  },
});

const uid = values.uid?.trim();
const name = values.name?.trim();
const lookupEmail = values["lookup-email"]?.trim();
const dryRun = values["dry-run"] === true;
const confirmProduction = values["confirm-production"] === true;

const REQUIRED_PROJECT_ID = "stageverify-db";

function gcloudAdcPath() {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) return join(appData, "gcloud", "application_default_credentials.json");
    return null;
  }
  return join(homedir(), ".config", "gcloud", "application_default_credentials.json");
}

function isReadableFile(path) {
  if (!path) return false;
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveCredentialSource() {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (emulatorHost) {
    return { source: "emulator", adcPresent: true };
  }

  const gacPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (gacPath && isReadableFile(gacPath)) {
    return { source: "GOOGLE_APPLICATION_CREDENTIALS", adcPresent: true };
  }

  const adcPath = gcloudAdcPath();
  if (adcPath && isReadableFile(adcPath)) {
    return { source: "gcloud ADC file", adcPresent: true };
  }

  return { source: "none", adcPresent: false };
}

function resolveProjectId() {
  return (
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    REQUIRED_PROJECT_ID
  );
}

function refuseProjectId(projectId) {
  if (projectId !== REQUIRED_PROJECT_ID) {
    console.error(
      `Refusing: projectId must be "${REQUIRED_PROJECT_ID}" (got "${projectId}").`,
    );
    process.exit(1);
  }
}

function refuseMissingAdc(credentialSource) {
  console.error(
    `Refusing: Application Default Credentials required for production path (credential source: ${credentialSource}).`,
  );
  console.error(
    "Next step: run `gcloud auth application-default login` on Dan's trusted Windows PC, or set GOOGLE_APPLICATION_CREDENTIALS to a readable service-account JSON.",
  );
  process.exit(1);
}

function hasAuthEmulator() {
  return Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim());
}

function refuseUnsafeLookupEmail(credentialSource, adcPresent) {
  if (hasAuthEmulator()) {
    return;
  }

  if (emulatorHost) {
    console.error(
      "Refusing: --lookup-email with FIRESTORE_EMULATOR_HOST alone can hit live production Auth.",
    );
    console.error(
      "Set FIREBASE_AUTH_EMULATOR_HOST for emulator Auth lookup, or unset FIRESTORE_EMULATOR_HOST and use ADC for production lookup.",
    );
    process.exit(1);
  }

  if (!adcPresent) {
    refuseMissingAdc(credentialSource);
  }
}

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = resolveProjectId();
const { source: credentialSource, adcPresent } = resolveCredentialSource();

refuseProjectId(projectId);

if (lookupEmail) {
  refuseUnsafeLookupEmail(credentialSource, adcPresent);
  if (!admin.apps.length) {
    admin.initializeApp({ projectId });
  }
  try {
    const user = await admin.auth().getUserByEmail(lookupEmail);
    console.log(`lookup-email=${lookupEmail} uid=${user.uid}`);
    process.exit(0);
  } catch (err) {
    console.error(
      `Lookup failed: ${err instanceof Error ? err.message : err}`,
    );
    process.exit(1);
  }
}

if (!uid || !name) {
  console.error(
    "Usage: --uid <firebase-auth-uid> --name <display-name> [--dry-run] [--confirm-production] [--lookup-email <email>]",
  );
  process.exit(1);
}

const wouldWrite = {
  lock: {
    collection: "operatorConsoleLocks",
    doc: "first-operator-bootstrap",
    data: { claimed: true, uid, claimedAt: "<ISO timestamp>" },
  },
  operator: {
    collection: "operatorAccounts",
    doc: uid,
    data: {
      active: true,
      displayName: name,
      createdAt: "<ISO timestamp>",
      updatedAt: "<ISO timestamp>",
    },
  },
};

console.log(`projectId=${projectId}`);
console.log(`credentialSource=${credentialSource}`);
console.log(`emulator=${emulatorHost ?? "none"}`);

if (dryRun) {
  console.log("dry-run: would write:");
  console.log(JSON.stringify(wouldWrite, null, 2));
  process.exit(0);
}

if (confirmProduction && emulatorHost) {
  console.error(
    "Refusing: --confirm-production cannot be used when FIRESTORE_EMULATOR_HOST is set.",
  );
  process.exit(1);
}

if (!confirmProduction && !emulatorHost) {
  console.error(
    "Refusing to write: set FIRESTORE_EMULATOR_HOST or pass --confirm-production explicitly.",
  );
  process.exit(1);
}

if (!emulatorHost && !adcPresent) {
  refuseMissingAdc(credentialSource);
}

if (confirmProduction && !adcPresent) {
  refuseMissingAdc(credentialSource);
}

if (!admin.apps.length) {
  admin.initializeApp({ projectId });
}

const db = admin.firestore();
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

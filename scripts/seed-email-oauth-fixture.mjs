/**
 * Seeds emailProviderConnections/gmail for verify scripts (Admin SDK).
 * Requires Application Default Credentials (gcloud auth application-default login).
 *
 * Usage:
 *   node scripts/seed-email-oauth-fixture.mjs --status=connected
 *   node scripts/seed-email-oauth-fixture.mjs --status=disconnected
 */

import { createRequire } from "module";

const require = createRequire(import.meta.url);
const admin = require("../functions/node_modules/firebase-admin");

const PROJECT_ID = "stageverify-db";
const PROVIDER_ID = "gmail";

function parseStatus(argv) {
  const flag = argv.find((a) => a.startsWith("--status="));
  const value = flag?.split("=")[1] ?? "disconnected";
  if (value !== "connected" && value !== "disconnected" && value !== "token_expired") {
    console.error("Usage: --status=connected|disconnected|token_expired");
    process.exit(1);
  }
  return value;
}

async function main() {
  const status = parseStatus(process.argv.slice(2));

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }
  const db = admin.firestore();
  const now = new Date().toISOString();

  if (status === "connected") {
    await db.collection("emailProviderConnections").doc(PROVIDER_ID).set({
      provider: PROVIDER_ID,
      status: "connected",
      connectedAccountEmail: "verify-oauth@stageverify.test",
      connectedAt: now,
      connectedByUid: "verify-fixture",
      updatedAt: now,
    });
    await db.collection("emailProviderSecrets").doc(PROVIDER_ID).set({
      refreshToken: "verify-fixture-refresh-token-not-real",
      updatedAt: now,
    });
    console.log("Seeded Gmail provider: connected");
    return;
  }

  await db.collection("emailProviderSecrets").doc(PROVIDER_ID).delete().catch(() => {});
  await db.collection("emailProviderConnections").doc(PROVIDER_ID).set({
    provider: PROVIDER_ID,
    status,
    updatedAt: now,
  });
  console.log(`Seeded Gmail provider: ${status}`);
}

main().catch((err) => {
  console.error("seed-email-oauth-fixture failed:", err.message ?? err);
  process.exit(1);
});

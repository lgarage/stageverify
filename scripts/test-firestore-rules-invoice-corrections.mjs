/**
 * Lane C C2 — Firestore rules for vendorInvoiceFieldCorrections.
 * Usage: npm run test:firestore-rules-invoice-corrections
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

const PROJECT_ID = "stageverify-db";
const RULES_PATH = resolve(process.cwd(), "firestore.rules");

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules: readFileSync(RULES_PATH, "utf8"),
  },
});

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "dispatcherRoles", "firestore-rules-invoice-corrections_disp-1"), {
    active: true,
    manager: false,
  });
  await setDoc(doc(db, "vendorInvoiceFieldCorrections", "firestore-rules-invoice-corrections_c1"), {
    id: "firestore-rules-invoice-corrections_c1",
    vendorInvoiceImportId: "firestore-rules-invoice-corrections_imp-1",
    field: "customerPoOrReference",
    previousValue: "",
    newValue: "2205 EARLY",
    appliedByUid: "firestore-rules-invoice-corrections_disp-1",
  });
});

const unauth = testEnv.unauthenticatedContext().firestore();
await assertFails(getDoc(doc(unauth, "vendorInvoiceFieldCorrections", "firestore-rules-invoice-corrections_c1")));
await assertFails(
  setDoc(doc(unauth, "vendorInvoiceFieldCorrections", "firestore-rules-invoice-corrections_hack"), { x: 1 }),
);

const randomUser = testEnv.authenticatedContext("user-x").firestore();
await assertFails(getDoc(doc(randomUser, "vendorInvoiceFieldCorrections", "firestore-rules-invoice-corrections_c1")));
await assertFails(
  setDoc(doc(randomUser, "vendorInvoiceFieldCorrections", "firestore-rules-invoice-corrections_hack2"), { x: 1 }),
);

const dispatcher = testEnv.authenticatedContext("firestore-rules-invoice-corrections_disp-1").firestore();
await assertSucceeds(getDoc(doc(dispatcher, "vendorInvoiceFieldCorrections", "firestore-rules-invoice-corrections_c1")));
await assertFails(
  setDoc(doc(dispatcher, "vendorInvoiceFieldCorrections", "firestore-rules-invoice-corrections_hack3"), {
    field: "customerPoOrReference",
    newValue: "EVIL",
  }),
);
await assertFails(
  setDoc(doc(dispatcher, "vendorInvoiceImports", "firestore-rules-invoice-corrections_imp-1"), {
    parsedHeader: { customerPoOrReference: "EVIL" },
  }),
);

await testEnv.cleanup();
console.log("PASS: test-firestore-rules-invoice-corrections");

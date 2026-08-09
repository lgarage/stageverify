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
  await setDoc(doc(db, "dispatcherRoles", "disp-1"), {
    active: true,
    manager: false,
  });
  await setDoc(doc(db, "vendorInvoiceFieldCorrections", "c1"), {
    id: "c1",
    vendorInvoiceImportId: "imp-1",
    field: "customerPoOrReference",
    previousValue: "",
    newValue: "2205 EARLY",
    appliedByUid: "disp-1",
  });
});

const unauth = testEnv.unauthenticatedContext().firestore();
await assertFails(getDoc(doc(unauth, "vendorInvoiceFieldCorrections", "c1")));
await assertFails(
  setDoc(doc(unauth, "vendorInvoiceFieldCorrections", "hack"), { x: 1 }),
);

const randomUser = testEnv.authenticatedContext("user-x").firestore();
await assertFails(getDoc(doc(randomUser, "vendorInvoiceFieldCorrections", "c1")));
await assertFails(
  setDoc(doc(randomUser, "vendorInvoiceFieldCorrections", "hack2"), { x: 1 }),
);

const dispatcher = testEnv.authenticatedContext("disp-1").firestore();
await assertSucceeds(getDoc(doc(dispatcher, "vendorInvoiceFieldCorrections", "c1")));
await assertFails(
  setDoc(doc(dispatcher, "vendorInvoiceFieldCorrections", "hack3"), {
    field: "customerPoOrReference",
    newValue: "EVIL",
  }),
);
await assertFails(
  setDoc(doc(dispatcher, "vendorInvoiceImports", "imp-1"), {
    parsedHeader: { customerPoOrReference: "EVIL" },
  }),
);

await testEnv.cleanup();
console.log("PASS: test-firestore-rules-invoice-corrections");

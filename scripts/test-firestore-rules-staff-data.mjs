/**
 * Firestore rules — operational collections require active staff (not sign-in only).
 * Usage: npm run test:firestore-rules-staff-data
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

const PROJECT_ID = "stageverify-db";
const RULES_PATH = resolve(process.cwd(), "firestore.rules");

const STAFF_UID = "firestore-rules-staff-data_staff-1";
const REMOVED_UID = "firestore-rules-staff-data_staff-removed";
const INACTIVE_UID = "firestore-rules-staff-data_staff-inactive";
const NOROLE_UID = "firestore-rules-staff-data_norole";

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
  await setDoc(doc(db, "dispatcherRoles", STAFF_UID), {
    active: true,
    role: "dispatcher",
  });
  await setDoc(doc(db, "dispatcherRoles", REMOVED_UID), {
    active: true,
    removed: true,
    role: "dispatcher",
  });
  await setDoc(doc(db, "dispatcherRoles", INACTIVE_UID), {
    active: false,
    role: "dispatcher",
  });
  await setDoc(doc(db, "deliveries", "firestore-rules-staff-data_del-1"), {
    id: "firestore-rules-staff-data_del-1",
    orderNumber: "ORD-1",
    status: "pending",
    vendorId: "v1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
});

const deliveryRef = (db, id = "firestore-rules-staff-data_del-1") =>
  doc(db, "deliveries", id);

const unauth = testEnv.unauthenticatedContext().firestore();
await assertFails(getDoc(deliveryRef(unauth)));

const norole = testEnv.authenticatedContext(NOROLE_UID).firestore();
await assertFails(getDoc(deliveryRef(norole)));
await assertFails(
  setDoc(deliveryRef(norole, "firestore-rules-staff-data_del-new"), {
    id: "firestore-rules-staff-data_del-new",
    status: "pending",
    vendorId: "v1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  }),
);

const removed = testEnv.authenticatedContext(REMOVED_UID).firestore();
await assertFails(getDoc(deliveryRef(removed)));

const inactive = testEnv.authenticatedContext(INACTIVE_UID).firestore();
await assertFails(getDoc(deliveryRef(inactive)));

const staff = testEnv.authenticatedContext(STAFF_UID).firestore();
await assertSucceeds(getDoc(deliveryRef(staff)));
await assertSucceeds(
  updateDoc(deliveryRef(staff), { updatedAt: "2026-01-02T00:00:00Z" }),
);

const legacyClaim = testEnv
  .authenticatedContext("firestore-rules-staff-data_claim", {
    dispatcher: true,
  })
  .firestore();
await assertSucceeds(getDoc(deliveryRef(legacyClaim)));

console.log("test-firestore-rules-staff-data: PASS");
await testEnv.cleanup();
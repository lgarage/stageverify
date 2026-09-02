/**
 * Concurrent deactivate — last two active operators cannot both deactivate.
 * Usage: npm run test:operator-deactivate-concurrent
 */
import {
  admin,
  callable,
  createAuthUser,
  createTestClient,
  initAdmin,
  seedOperator,
  signIn,
} from "./lib/operator-test-lib.mjs";

initAdmin();
const stamp = Date.now();
let passed = 0;
let failed = 0;
const pass = (msg) => {
  passed += 1;
  console.log(`  ✓ ${msg}`);
};
const fail = (msg, err) => {
  failed += 1;
  console.error(`  ✗ ${msg}`);
  if (err) console.error(`    ${err?.message ?? err}`);
};

console.log("\n=== operator deactivate concurrent ===\n");

const clientA = createTestClient("deact-a");
const clientB = createTestClient("deact-b");

const emailA = `op-deact-a-${stamp}@test.local`;
const emailB = `op-deact-b-${stamp}@test.local`;
const uidA = await createAuthUser(clientA.auth, emailA);
const uidB = await createAuthUser(clientB.auth, emailB);
await seedOperator(uidA, "Operator A");
await seedOperator(uidB, "Operator B");

const deactivateA = async (targetUid) => {
  await signIn(clientA.auth, emailA);
  return callable(clientA.functions, "deactivateOperatorAccount")({ targetUid });
};

const deactivateB = async (targetUid) => {
  await signIn(clientB.auth, emailB);
  return callable(clientB.functions, "deactivateOperatorAccount")({ targetUid });
};

const results = await Promise.allSettled([
  deactivateA(uidB),
  deactivateB(uidA),
]);

const successes = results.filter((r) => r.status === "fulfilled");
const failures = results.filter((r) => r.status === "rejected");

if (successes.length === 1 && failures.length === 1) {
  pass("exactly one concurrent deactivate succeeds when two actives remain");
} else {
  fail(
    "exactly one concurrent deactivate succeeds when two actives remain",
    new Error(`successes=${successes.length} failures=${failures.length}`),
  );
}

const rejected = failures[0]?.reason;
const rejectCode = rejected?.code ?? "";
if (
  String(rejectCode).includes("failed-precondition") ||
  String(rejectCode).includes("aborted")
) {
  pass("losing concurrent deactivate fails closed");
} else {
  fail(
    "losing concurrent deactivate fails closed",
    new Error(`code=${rejectCode} msg=${rejected?.message}`),
  );
}

const activeSnap = await admin
  .firestore()
  .collection("operatorAccounts")
  .where("active", "==", true)
  .get();

if (activeSnap.size === 1) {
  pass("exactly one active operator remains after concurrent deactivations");
} else {
  fail(
    "exactly one active operator remains after concurrent deactivations",
    new Error(`active count=${activeSnap.size}`),
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

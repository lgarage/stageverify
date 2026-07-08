/**
 * Phase 2 privacy negative tests — unauth clients must not enumerate or read
 * cross-vendor delivery data via public Firestore REST.
 *
 * Usage:
 *   npm run verify:privacy
 *   STAGEVERIFY_BASE_URL=https://lgarage.github.io/stageverify npm run verify:privacy:prod
 */

const PROJECT_ID = "stageverify-db";
const API_KEY = "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE";
const REST_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)`;

const args = process.argv.slice(2);
const baseUrlFlag = args.find((a) => a.startsWith("--base-url="));
const _baseUrl =
  (baseUrlFlag ? baseUrlFlag.split("=")[1] : null) ??
  process.env.STAGEVERIFY_BASE_URL ??
  "http://localhost:5173";

const results = [];

function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
}

async function restGet(path) {
  const response = await fetch(`${REST_ROOT}/${path}?key=${API_KEY}`);
  return { status: response.status, ok: response.ok };
}

async function restRunQuery(collectionId) {
  const response = await fetch(`${REST_ROOT}/documents:runQuery?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        limit: 1,
      },
    }),
  });
  return { status: response.status, ok: response.ok };
}

async function main() {
  console.log("\n=== Phase 2 privacy negative (unauth Firestore REST) ===\n");

  const deliveryRead = await restGet("documents/deliveries/delivery-demo-vendor-1");
  record(
    "unauth cannot read delivery doc by id",
    deliveryRead.status === 403 || deliveryRead.status === 401,
    `status=${deliveryRead.status}`,
  );

  const deliveriesList = await restRunQuery("deliveries");
  record(
    "unauth cannot list deliveries collection",
    deliveriesList.status === 403 || deliveriesList.status === 401,
    `status=${deliveriesList.status}`,
  );

  const itemsList = await restRunQuery("items");
  record(
    "unauth cannot list items collection",
    itemsList.status === 403 || itemsList.status === 401,
    `status=${itemsList.status}`,
  );

  const jobsList = await restRunQuery("jobs");
  record(
    "unauth cannot list jobs collection",
    jobsList.status === 403 || jobsList.status === 401,
    `status=${jobsList.status}`,
  );

  const poList = await restRunQuery("purchaseOrders");
  record(
    "unauth cannot list purchaseOrders collection",
    poList.status === 403 || poList.status === 401,
    `status=${poList.status}`,
  );

  const stagingRead = await restGet("documents/stagingLocations/staging-1");
  record(
    "stagingLocations remain publicly readable (pre-PIN branding)",
    stagingRead.status === 200 || stagingRead.status === 404,
    `status=${stagingRead.status}`,
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Production cleanup: StageVerify "Unplanned Verify Vendor" fixtures only.
 * Dry-run default. Uses FIREBASE_TOKEN admin REST (client rules deny vendor/
 * accessPinSecrets deletes).
 *
 * Usage:
 *   node scripts/cleanup-vendor-unplanned-verify-fixtures.mjs
 *   node scripts/cleanup-vendor-unplanned-verify-fixtures.mjs --confirm
 */

import {
  getFirebaseAccessToken,
  restDeleteDoc,
  restDocId,
  restFields,
  restListCollection,
} from "./lib/firestore-admin-rest.mjs";

const PROJECT_ID = "stageverify-db";
const EXCLUDED_VENDOR_IDS = new Set(["vendor-1", "vendor-2", "vendor-3"]);
const SHARED_JOB_ID = "job-unplanned-verify-anchor";
const SHARED_LOC_ID = "loc-unplanned-verify";

function isUnplannedVendorId(id) {
  return typeof id === "string" && /^vendor-unpl-/.test(id);
}

function isSafeUnplannedVendor(id, data) {
  if (!isUnplannedVendorId(id)) return false;
  if (EXCLUDED_VENDOR_IDS.has(id)) return false;
  const name = typeof data.name === "string" ? data.name : "";
  return name === "Unplanned Verify Vendor";
}

async function buildPlan(accessToken) {
  const vendors = await restListCollection(accessToken, PROJECT_ID, "vendors");
  const deliveries = await restListCollection(
    accessToken,
    PROJECT_ID,
    "deliveries",
  );
  const secrets = await restListCollection(
    accessToken,
    PROJECT_ID,
    "accessPinSecrets",
  );
  const uniqueness = await restListCollection(
    accessToken,
    PROJECT_ID,
    "accessPinUniqueness",
  );
  const jobs = await restListCollection(accessToken, PROJECT_ID, "jobs");
  const locs = await restListCollection(
    accessToken,
    PROJECT_ID,
    "stagingLocations",
  );

  const vendorRows = [];
  const skipped = [];
  for (const doc of vendors) {
    const id = restDocId(doc.name);
    const data = restFields(doc);
    if (!isUnplannedVendorId(id) && !/Unplanned Verify/i.test(data.name || "")) {
      continue;
    }
    if (!isSafeUnplannedVendor(id, data)) {
      skipped.push({
        path: `vendors/${id}`,
        reason: `safety mismatch name=${data.name ?? ""}`,
      });
      continue;
    }
    vendorRows.push({ path: `vendors/${id}`, id });
  }

  const vendorIds = new Set(vendorRows.map((v) => v.id));

  const deliveryRows = [];
  for (const doc of deliveries) {
    const id = restDocId(doc.name);
    const data = restFields(doc);
    const vendorId = data.vendorId || "";
    const anchor =
      id.endsWith("-anchor") && isUnplannedVendorId(vendorId);
    const nameMatch = data.vendorName === "Unplanned Verify Vendor";
    if ((anchor || nameMatch) && vendorIds.has(vendorId)) {
      deliveryRows.push({ path: `deliveries/${id}`, id, vendorId });
    } else if (anchor || nameMatch || isUnplannedVendorId(vendorId)) {
      if (vendorIds.has(vendorId) || isUnplannedVendorId(vendorId)) {
        if (
          nameMatch ||
          (anchor && isUnplannedVendorId(vendorId))
        ) {
          deliveryRows.push({ path: `deliveries/${id}`, id, vendorId });
          vendorIds.add(vendorId);
        }
      }
    }
  }

  // Include orphan unpl vendors from deliveries even if vendor doc missing
  for (const d of deliveryRows) {
    if (isUnplannedVendorId(d.vendorId) && !vendorIds.has(d.vendorId)) {
      vendorIds.add(d.vendorId);
      vendorRows.push({
        path: `vendors/${d.vendorId}`,
        id: d.vendorId,
        maybeMissing: true,
      });
    }
  }

  const secretRows = [];
  for (const doc of secrets) {
    const id = restDocId(doc.name);
    const data = restFields(doc);
    const targetId = data.targetId || "";
    if (
      data.targetType === "vendor" &&
      isUnplannedVendorId(targetId) &&
      !EXCLUDED_VENDOR_IDS.has(targetId)
    ) {
      secretRows.push({ path: `accessPinSecrets/${id}`, targetId });
      vendorIds.add(targetId);
    }
  }

  const uniquenessRows = [];
  for (const doc of uniqueness) {
    const id = restDocId(doc.name);
    const data = restFields(doc);
    const targetId = data.targetId || "";
    if (
      data.targetType === "vendor" &&
      isUnplannedVendorId(targetId) &&
      !EXCLUDED_VENDOR_IDS.has(targetId)
    ) {
      uniquenessRows.push({ path: `accessPinUniqueness/${id}`, targetId });
    }
  }

  let sharedJob = null;
  for (const doc of jobs) {
    const id = restDocId(doc.name);
    const data = restFields(doc);
    if (id === SHARED_JOB_ID || data.jobName === "Unplanned Verify Anchor") {
      sharedJob = { path: `jobs/${id}`, id, jobName: data.jobName };
    }
  }

  let sharedLoc = null;
  for (const doc of locs) {
    const id = restDocId(doc.name);
    const data = restFields(doc);
    if (id === SHARED_LOC_ID || data.label === "Unplanned Verify Bay") {
      sharedLoc = { path: `stagingLocations/${id}`, id, label: data.label };
    }
  }

  // Hard stop if any excluded id appears in delete plan
  for (const row of [...vendorRows, ...secretRows, ...uniquenessRows]) {
    const id = row.id || row.targetId;
    if (EXCLUDED_VENDOR_IDS.has(id)) {
      throw new Error(`Abort: plan includes protected vendor ${id}`);
    }
  }

  return {
    vendors: vendorRows,
    deliveries: deliveryRows,
    secrets: secretRows,
    uniqueness: uniquenessRows,
    sharedJob,
    sharedLoc,
    skipped,
  };
}

async function main() {
  const confirm = process.argv.includes("--confirm");
  const accessToken = await getFirebaseAccessToken();
  const plan = await buildPlan(accessToken);

  const deletePaths = [
    ...plan.deliveries.map((r) => r.path),
    ...plan.secrets.map((r) => r.path),
    ...plan.uniqueness.map((r) => r.path),
    ...plan.vendors.map((r) => r.path),
  ];
  if (plan.sharedJob) deletePaths.push(plan.sharedJob.path);
  if (plan.sharedLoc) deletePaths.push(plan.sharedLoc.path);

  console.log(
    confirm
      ? `CONFIRM — deleting Unplanned Verify fixtures from ${PROJECT_ID}:`
      : `DRY RUN — would delete from ${PROJECT_ID}:`,
  );
  console.log(`  vendors: ${plan.vendors.length}`);
  console.log(`  deliveries: ${plan.deliveries.length}`);
  console.log(`  accessPinSecrets: ${plan.secrets.length}`);
  console.log(`  accessPinUniqueness: ${plan.uniqueness.length}`);
  console.log(`  shared job: ${plan.sharedJob ? plan.sharedJob.path : "(none)"}`);
  console.log(
    `  shared location: ${plan.sharedLoc ? plan.sharedLoc.path : "(none)"}`,
  );
  if (plan.skipped.length) {
    console.log(`  skipped: ${plan.skipped.length}`);
    for (const s of plan.skipped) {
      console.log(`    SKIP ${s.path} — ${s.reason}`);
    }
  }
  for (const p of deletePaths) console.log(`  ${p}`);

  if (!confirm) {
    console.log("\n(Re-run with --confirm to delete)");
    return;
  }

  let deleted = 0;
  for (const path of deletePaths) {
    const result = await restDeleteDoc(accessToken, PROJECT_ID, path);
    if (result.deleted) {
      deleted += 1;
      console.log(`  DELETED ${path}`);
    } else {
      console.log(`  MISSING ${path}`);
    }
  }

  // Post-delete: no Unplanned Verify Vendor names remain
  const vendorsAfter = await restListCollection(
    accessToken,
    PROJECT_ID,
    "vendors",
  );
  const leftover = vendorsAfter
    .map((d) => ({ id: restDocId(d.name), ...restFields(d) }))
    .filter(
      (v) =>
        isUnplannedVendorId(v.id) ||
        v.name === "Unplanned Verify Vendor",
    );
  if (leftover.length) {
    throw new Error(
      `Post-delete leftovers: ${leftover.map((v) => v.id).join(", ")}`,
    );
  }

  // Protected vendors still present
  for (const id of EXCLUDED_VENDOR_IDS) {
    const still = vendorsAfter.some((d) => restDocId(d.name) === id);
    if (!still) {
      throw new Error(`Protected vendor ${id} missing after cleanup — STOP`);
    }
  }

  console.log(`\nCleanup complete. Deleted ${deleted} document(s).`);
}

main().catch((err) => {
  console.error(
    "cleanup-vendor-unplanned-verify-fixtures failed:",
    err.message ?? err,
  );
  process.exit(1);
});

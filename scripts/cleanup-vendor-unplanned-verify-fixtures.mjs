/**
 * Production cleanup: StageVerify unplanned verify/drawer fixtures only.
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

const FIXTURE_VENDORS = [
  {
    id: "vendor-unpl-verify",
    name: "Unplanned Verify Vendor",
    jobId: "job-unplanned-verify-anchor",
    jobName: "Unplanned Verify Anchor",
    locId: "loc-unplanned-verify",
    locLabel: "Unplanned Verify Bay",
  },
  {
    id: "vendor-unpl-drawer-verify",
    name: "Unplanned Drawer Vendor",
    jobId: "job-unpl-drawer-verify",
    jobName: "Unplanned Drawer Match Job",
    locId: "loc-unpl-drawer-verify",
    locLabel: "Unplanned Drawer Verify",
  },
];

const FIXTURE_VENDOR_NAMES = new Set(FIXTURE_VENDORS.map((v) => v.name));
const FIXTURE_VENDOR_IDS = new Set(FIXTURE_VENDORS.map((v) => v.id));
const FIXTURE_JOB_IDS = new Set(FIXTURE_VENDORS.map((v) => v.jobId));
const FIXTURE_LOC_IDS = new Set(FIXTURE_VENDORS.map((v) => v.locId));

function isUnplannedVendorId(id) {
  return typeof id === "string" && /^vendor-unpl-/.test(id);
}

function isFixtureVendor(id, data) {
  if (EXCLUDED_VENDOR_IDS.has(id)) return false;
  if (FIXTURE_VENDOR_IDS.has(id)) {
    const name = typeof data.name === "string" ? data.name : "";
    return FIXTURE_VENDOR_NAMES.has(name);
  }
  return false;
}

function isFixtureDelivery(data) {
  const vendorId = data.vendorId || "";
  const vendorName = data.vendorName || "";
  if (FIXTURE_VENDOR_IDS.has(vendorId)) return true;
  return FIXTURE_VENDOR_NAMES.has(vendorName);
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
    if (!isUnplannedVendorId(id) && !FIXTURE_VENDOR_NAMES.has(data.name || "")) {
      continue;
    }
    if (!isFixtureVendor(id, data)) {
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
    if (isFixtureDelivery(data)) {
      deliveryRows.push({ path: `deliveries/${id}`, id, vendorId: data.vendorId });
      if (isUnplannedVendorId(data.vendorId)) {
        vendorIds.add(data.vendorId);
      }
    }
  }

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

  const sharedJobs = [];
  for (const doc of jobs) {
    const id = restDocId(doc.name);
    const data = restFields(doc);
    if (FIXTURE_JOB_IDS.has(id)) {
      sharedJobs.push({ path: `jobs/${id}`, id, jobName: data.jobName });
      continue;
    }
    for (const fixture of FIXTURE_VENDORS) {
      if (data.jobName === fixture.jobName) {
        sharedJobs.push({ path: `jobs/${id}`, id, jobName: data.jobName });
      }
    }
  }

  const sharedLocs = [];
  for (const doc of locs) {
    const id = restDocId(doc.name);
    const data = restFields(doc);
    if (FIXTURE_LOC_IDS.has(id)) {
      sharedLocs.push({ path: `stagingLocations/${id}`, id, label: data.label });
      continue;
    }
    for (const fixture of FIXTURE_VENDORS) {
      if (data.label === fixture.locLabel) {
        sharedLocs.push({ path: `stagingLocations/${id}`, id, label: data.label });
      }
    }
  }

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
    sharedJobs,
    sharedLocs,
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
    ...plan.sharedJobs.map((r) => r.path),
    ...plan.sharedLocs.map((r) => r.path),
  ];

  console.log(
    confirm
      ? `CONFIRM — deleting unplanned verify/drawer fixtures from ${PROJECT_ID}:`
      : `DRY RUN — would delete from ${PROJECT_ID}:`,
  );
  console.log(`  vendors: ${plan.vendors.length}`);
  console.log(`  deliveries: ${plan.deliveries.length}`);
  console.log(`  accessPinSecrets: ${plan.secrets.length}`);
  console.log(`  accessPinUniqueness: ${plan.uniqueness.length}`);
  console.log(`  shared jobs: ${plan.sharedJobs.length}`);
  console.log(`  shared locations: ${plan.sharedLocs.length}`);
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
        FIXTURE_VENDOR_NAMES.has(v.name || ""),
    );
  if (leftover.length) {
    throw new Error(
      `Post-delete leftovers: ${leftover.map((v) => `${v.id} (${v.name})`).join(", ")}`,
    );
  }

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

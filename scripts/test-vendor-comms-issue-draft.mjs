/**
 * Unit tests for vendor comms issue draft helpers.
 *   npx tsx scripts/test-vendor-comms-issue-draft.mjs
 */
import assert from "node:assert/strict";
import {
  buildVendorCommsIssueBody,
  buildVendorCommsIssueSubject,
  resolveVendorCommsIssueHeadline,
} from "../src/dispatcher/drawer/vendorCommsIssueDraft.ts";

const EM_DASH = "\u2014";

const baseVendor = {
  id: "vendor-1",
  name: "Johnstone Supply",
  contactName: "Alex",
  email: "dispatch@johnstone.com",
  createdAt: "2026-01-01T00:00:00Z",
};

const baseJob = {
  id: "job-1",
  jobNumber: "JOB-2026-0389",
  jobName: "Oakwood Office Park",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function boDeliveryDetails(orderNumber = "6168008") {
  return {
    delivery: {
      id: "delivery-bo-test",
      orderNumber,
      jobId: "job-1",
      vendorId: "vendor-1",
      vendorName: "Johnstone Supply",
      deliveryDate: "2026-07-24",
      status: "partial",
      issueSummary: "1 item backordered",
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-24T00:00:00Z",
      vendorOrderComplete: true,
      vendorPhysicalDropoffConfirmed: true,
    },
    job: baseJob,
    vendor: baseVendor,
    items: [
      {
        id: "item-bo",
        deliveryOrderId: "delivery-bo-test",
        sku: "NS99999999",
        description: "BACKORDERED PART — 2 DAY LEAD",
        qtyOrdered: 1,
        qtyReceived: 0,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered: 1,
        status: "backordered",
      },
    ],
    statusHistory: [],
    pickupEvents: [],
    materialIssues: [],
  };
}

const boDetails = boDeliveryDetails();

assert.equal(
  resolveVendorCommsIssueHeadline(boDetails),
  "1 item backordered",
  "BO-only uses banner attention headline",
);

assert.equal(
  buildVendorCommsIssueSubject(boDetails),
  `6168008 ${EM_DASH} 1 item backordered`,
  "subject uses Unicode em dash U+2014",
);

assert(
  buildVendorCommsIssueSubject(boDetails).includes(EM_DASH),
  "subject contains em dash not hyphen",
);
assert(
  !buildVendorCommsIssueSubject(boDetails).includes(" - "),
  "subject does not use ASCII hyphen separator",
);

const body = buildVendorCommsIssueBody(boDetails);
assert.match(body, /Hi Alex,/);
assert.match(body, /6168008/);
assert.match(body, /Oakwood Office Park/);
assert.match(body, /BACKORDERED PART/);
assert.match(body, /ETA or updated status/i);

const willCallDetails = {
  ...boDetails,
  delivery: {
    ...boDetails.delivery,
    orderNumber: "ORD-005",
    invoiceImportStatus: "pickup_at_vendor",
    issueSummary: "",
  },
  items: [],
};

assert.equal(
  resolveVendorCommsIssueHeadline(willCallDetails),
  "delivery follow up",
  "calm will-call issue summary falls back to generic follow-up",
);
assert.equal(
  buildVendorCommsIssueSubject(willCallDetails),
  `ORD-005 ${EM_DASH} delivery follow up`,
);

const noJobDetails = {
  ...boDetails,
  job: undefined,
};
assert.doesNotThrow(() => buildVendorCommsIssueBody(noJobDetails));
assert.match(buildVendorCommsIssueBody(noJobDetails), /6168008/);

const ord002Details = boDeliveryDetails("ORD-002");
assert.equal(
  buildVendorCommsIssueSubject(ord002Details),
  `ORD-002 ${EM_DASH} 1 item backordered`,
);

console.log("test-vendor-comms-issue-draft PASS");

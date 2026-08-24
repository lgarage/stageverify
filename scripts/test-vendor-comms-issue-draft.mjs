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

function boDeliveryDetails(orderNumber = "6168008", overrides = {}) {
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
      ...overrides.delivery,
    },
    job: baseJob,
    vendor: baseVendor,
    items: overrides.items ?? [
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
    materialIssues: overrides.materialIssues ?? [],
  };
}

const boDetails = boDeliveryDetails();

assert.equal(
  resolveVendorCommsIssueHeadline(boDetails),
  "1 item backordered",
  "BO-only uses fulfillment exception headline",
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

// 1. Partial + valid stagingLocationId + received + backordered → backorder wins
{
  const details = boDeliveryDetails("6168008", {
    delivery: {
      stagingLocationId: "zone-a-1",
      status: "partial",
    },
    items: [
      {
        id: "item-received",
        deliveryOrderId: "delivery-bo-test",
        sku: "RCV-001",
        description: "RECEIVED FILTER",
        qtyOrdered: 1,
        qtyReceived: 1,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered: 0,
        status: "received",
      },
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
  });
  const headline = resolveVendorCommsIssueHeadline(details);
  assert.equal(headline, "1 item backordered", "received+BO with staging → backorder headline");
  const draftBody = buildVendorCommsIssueBody(details);
  assert.match(draftBody, /backordered/i);
  assert.doesNotMatch(
    draftBody,
    /Staging location missing/i,
    "must not mention staging missing when BO exists",
  );
}

// 2. Partial + staging + multiple outstanding categories
{
  const details = boDeliveryDetails("ORD-MULTI", {
    delivery: {
      stagingLocationId: "zone-b-2",
      status: "partial",
    },
    items: [
      {
        id: "item-partial",
        deliveryOrderId: "delivery-bo-test",
        sku: "PART-001",
        description: "PARTIAL LINE",
        qtyOrdered: 4,
        qtyReceived: 2,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered: 0,
        status: "partial",
      },
      {
        id: "item-bo",
        deliveryOrderId: "delivery-bo-test",
        sku: "BO-001",
        description: "BACKORDERED WIDGET",
        qtyOrdered: 2,
        qtyReceived: 0,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered: 2,
        status: "backordered",
      },
    ],
  });
  assert.equal(
    resolveVendorCommsIssueHeadline(details),
    "Items still need attention",
    "multiple exception categories → combined headline",
  );
  const multiBody = buildVendorCommsIssueBody(details);
  assert.doesNotMatch(multiBody, /Staging location missing/i);
  assert.match(multiBody, /PARTIAL LINE/);
  assert.match(multiBody, /BACKORDERED WIDGET/);
}

// 3. True missing staging — received items, no BO/outstanding
{
  const details = boDeliveryDetails("ORD-STAGING", {
    delivery: {
      status: "received",
      issueSummary: "",
    },
    items: [
      {
        id: "item-full",
        deliveryOrderId: "delivery-bo-test",
        sku: "FULL-001",
        description: "FULLY RECEIVED PART",
        qtyOrdered: 2,
        qtyReceived: 2,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered: 0,
        status: "received",
      },
    ],
  });
  assert.equal(
    resolveVendorCommsIssueHeadline(details),
    "Staging location missing",
    "received-only with no staging → staging-missing headline",
  );
}

// 4. Ready for pickup — no false backorder/staging complaint
{
  const details = boDeliveryDetails("ORD-RFP", {
    delivery: {
      stagingLocationId: "zone-ready",
      status: "ready_for_pickup",
      issueSummary: "",
      vendorOrderComplete: true,
      vendorPhysicalDropoffConfirmed: true,
    },
    items: [
      {
        id: "item-done",
        deliveryOrderId: "delivery-bo-test",
        sku: "DONE-001",
        description: "COMPLETE ITEM",
        qtyOrdered: 1,
        qtyReceived: 1,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered: 0,
        status: "received",
      },
    ],
  });
  const rfpHeadline = resolveVendorCommsIssueHeadline(details);
  assert.notEqual(rfpHeadline, "Staging location missing");
  assert.ok(!/backordered/i.test(rfpHeadline));
  assert.equal(rfpHeadline, "delivery follow up", "ready state → generic follow-up");
}

// 5. Fully delivered/complete — no false partial/backorder draft
{
  const details = boDeliveryDetails("ORD-COMPLETE", {
    delivery: {
      stagingLocationId: "zone-done",
      status: "delivered",
      issueSummary: "",
      vendorOrderComplete: true,
      vendorPhysicalDropoffConfirmed: true,
    },
    items: [
      {
        id: "item-complete",
        deliveryOrderId: "delivery-bo-test",
        sku: "CMP-001",
        description: "DELIVERED ITEM",
        qtyOrdered: 3,
        qtyReceived: 3,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered: 0,
        status: "received",
      },
    ],
  });
  const completeHeadline = resolveVendorCommsIssueHeadline(details);
  assert.ok(!/partial|backordered/i.test(completeHeadline));
  assert.equal(completeHeadline, "delivery follow up");
}

// 6. Open blocking material issue wins over staging + backorder
{
  const details = boDeliveryDetails("ORD-ISSUE", {
    delivery: {
      stagingLocationId: "zone-x",
    },
    materialIssues: [
      {
        id: "issue-1",
        deliveryOrderId: "delivery-bo-test",
        jobId: "job-1",
        type: "wrong_item",
        status: "open",
        reportedBy: "tech-1",
        blocking: true,
        clientRequestId: "req-1",
        description: "Wrong compressor model shipped",
      },
    ],
  });
  assert.equal(
    resolveVendorCommsIssueHeadline(details),
    "Wrong Item: Wrong compressor model shipped",
    "blocking material issue headline wins",
  );
}

// 7. Calm will-call already covered above (willCallDetails)

// 8. Staging via plannedStagingLocationIds + received + BO
{
  const details = boDeliveryDetails("ORD-PLANNED", {
    delivery: {
      plannedStagingLocationIds: ["planned-zone-1"],
      status: "partial",
    },
    items: [
      {
        id: "item-received",
        deliveryOrderId: "delivery-bo-test",
        sku: "RCV-002",
        description: "RECEIVED COIL",
        qtyOrdered: 1,
        qtyReceived: 1,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered: 0,
        status: "received",
      },
      {
        id: "item-bo",
        deliveryOrderId: "delivery-bo-test",
        sku: "BO-002",
        description: "BACKORDERED VALVE",
        qtyOrdered: 1,
        qtyReceived: 0,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered: 1,
        status: "backordered",
      },
    ],
  });
  assert.equal(
    resolveVendorCommsIssueHeadline(details),
    "1 item backordered",
    "planned staging recognized → backorder headline",
  );
  assert.doesNotMatch(
    buildVendorCommsIssueBody(details),
    /Staging location missing/i,
  );
}

// 9. Staging via additionalStagingLocationIds + received + BO
{
  const details = boDeliveryDetails("ORD-ADDITIONAL", {
    delivery: {
      additionalStagingLocationIds: ["add-zone-1"],
      status: "partial",
    },
    items: [
      {
        id: "item-received",
        deliveryOrderId: "delivery-bo-test",
        sku: "RCV-003",
        description: "RECEIVED MOTOR",
        qtyOrdered: 1,
        qtyReceived: 1,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered: 0,
        status: "received",
      },
      {
        id: "item-bo",
        deliveryOrderId: "delivery-bo-test",
        sku: "BO-003",
        description: "BACKORDERED MOTOR MOUNT",
        qtyOrdered: 1,
        qtyReceived: 0,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered: 1,
        status: "backordered",
      },
    ],
  });
  assert.equal(
    resolveVendorCommsIssueHeadline(details),
    "1 item backordered",
    "additional staging recognized → backorder headline",
  );
}

// 10. stagingLocationId + received + BO (same as case 1, explicit name)
{
  const details = boDeliveryDetails("ORD-PRIMARY-STAGING", {
    delivery: { stagingLocationId: "primary-zone" },
    items: [
      {
        id: "item-received",
        deliveryOrderId: "delivery-bo-test",
        description: "RECEIVED PART A",
        qtyOrdered: 1,
        qtyReceived: 1,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered: 0,
        status: "received",
      },
      {
        id: "item-bo",
        deliveryOrderId: "delivery-bo-test",
        description: "BACKORDERED PART B",
        qtyOrdered: 1,
        qtyReceived: 0,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered: 1,
        status: "backordered",
      },
    ],
  });
  assert.equal(resolveVendorCommsIssueHeadline(details), "1 item backordered");
  assert.doesNotMatch(
    buildVendorCommsIssueBody(details),
    /Staging location missing/i,
  );
}

// 11. Core/return line NOT outstanding — must not appear in bullets
{
  const details = boDeliveryDetails("ORD-CORE", {
    delivery: { stagingLocationId: "zone-core" },
    items: [
      {
        id: "item-required",
        deliveryOrderId: "delivery-bo-test",
        description: "REQUIRED RECEIVED PART",
        qtyOrdered: 1,
        qtyReceived: 1,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered: 0,
        status: "received",
      },
      {
        id: "item-core",
        deliveryOrderId: "delivery-bo-test",
        description: "CORE CHARGE RETURN",
        qtyOrdered: 0,
        qtyReceived: 0,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered: 0,
        status: "received",
      },
      {
        id: "item-bo",
        deliveryOrderId: "delivery-bo-test",
        description: "BACKORDERED PART C",
        qtyOrdered: 1,
        qtyReceived: 0,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered: 1,
        status: "backordered",
      },
    ],
  });
  const coreBody = buildVendorCommsIssueBody(details);
  assert.match(coreBody, /BACKORDERED PART C/);
  assert.doesNotMatch(coreBody, /CORE CHARGE RETURN/);
}

// 12. Cross-job isolation — two DeliveryDetails use only their own items/order
{
  const jobA = boDeliveryDetails("ORDER-A", {
    delivery: { id: "delivery-a", orderNumber: "ORDER-A" },
    items: [
      {
        id: "item-a",
        deliveryOrderId: "delivery-a",
        description: "PART FOR ORDER A",
        qtyOrdered: 1,
        qtyReceived: 0,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered: 1,
        status: "backordered",
      },
    ],
  });
  const jobB = boDeliveryDetails("ORDER-B", {
    delivery: { id: "delivery-b", orderNumber: "ORDER-B" },
    items: [
      {
        id: "item-b",
        deliveryOrderId: "delivery-b",
        description: "PART FOR ORDER B",
        qtyOrdered: 1,
        qtyReceived: 0,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered: 1,
        status: "backordered",
      },
    ],
  });
  const bodyA = buildVendorCommsIssueBody(jobA);
  const bodyB = buildVendorCommsIssueBody(jobB);
  assert.match(bodyA, /ORDER-A/);
  assert.match(bodyA, /PART FOR ORDER A/);
  assert.doesNotMatch(bodyA, /ORDER-B/);
  assert.doesNotMatch(bodyA, /PART FOR ORDER B/);
  assert.match(bodyB, /ORDER-B/);
  assert.match(bodyB, /PART FOR ORDER B/);
  assert.doesNotMatch(bodyB, /ORDER-A/);
}

// Proven fixture: received + BO + no staging → backorder (not staging collision)
{
  const collisionDetails = boDeliveryDetails("6168008", {
    delivery: {
      status: "partial",
      issueSummary: "",
    },
    items: [
      {
        id: "item-received",
        deliveryOrderId: "delivery-bo-test",
        description: "RECEIVED UNIT",
        qtyOrdered: 1,
        qtyReceived: 1,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered: 0,
        status: "received",
      },
      {
        id: "item-bo",
        deliveryOrderId: "delivery-bo-test",
        description: "BACKORDERED PART — 2 DAY LEAD",
        qtyOrdered: 1,
        qtyReceived: 0,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered: 1,
        status: "backordered",
      },
    ],
  });
  assert.equal(
    resolveVendorCommsIssueHeadline(collisionDetails),
    "1 item backordered",
    "6168008-shaped fixture: BO wins over staging-missing collision",
  );
}

console.log("test-vendor-comms-issue-draft PASS");

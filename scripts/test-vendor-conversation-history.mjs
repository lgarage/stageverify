/**
 * Unit tests for vendor conversation history merge helper.
 *   npx tsx scripts/test-vendor-conversation-history.mjs
 */
import assert from "node:assert/strict";
import {
  mergeVendorConversationHistory,
} from "../src/dispatcher/email/vendorConversationHistory.ts";

function inbound(overrides = {}) {
  return {
    id: "inbound-1",
    gmailMessageId: "gmail-msg-1",
    senderEmail: "vendor@example.com",
    subject: "Invoice attached",
    receivedAt: "2026-03-01T10:00:00.000Z",
    attachmentFilenames: ["invoice.pdf"],
    processingStatus: "parsed",
    reviewStatus: "pending_review",
    createdAt: "2026-03-01T10:00:00.000Z",
    updatedAt: "2026-03-01T10:00:00.000Z",
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    id: "event-1",
    sourceMessageId: "gmail-msg-other",
    senderEmail: "vendor@example.com",
    subject: "Follow up",
    receivedAt: "2026-03-02T10:00:00.000Z",
    reviewStatus: "pending_review",
    createdAt: "2026-03-02T10:00:00.000Z",
    updatedAt: "2026-03-02T10:00:00.000Z",
    ...overrides,
  };
}

// 1. one linked inbound invoice-source email, no vendorEmailEvents → history shows that email
{
  const history = mergeVendorConversationHistory({
    events: [],
    invoiceSourceEmail: inbound(),
  });
  assert.equal(history.length, 1);
  assert.equal(history[0].id, "invoice-source:inbound-1");
  assert.equal(history[0].direction, "inbound");
  assert.equal(history[0].senderEmail, "vendor@example.com");
  assert.match(history[0].preview, /Invoice PDF email|invoice\.pdf/);
}

// 2. multiple linked messages → chronological oldest-first
{
  const history = mergeVendorConversationHistory({
    events: [
      event({
        id: "event-newer",
        receivedAt: "2026-03-03T10:00:00.000Z",
        subject: "Newer outbound",
        direction: "outbound",
        recipientEmails: ["vendor@example.com"],
      }),
      event({
        id: "event-middle",
        receivedAt: "2026-03-02T10:00:00.000Z",
        subject: "Middle inbound",
      }),
    ],
    invoiceSourceEmail: inbound({
      receivedAt: "2026-03-01T08:00:00.000Z",
      subject: "Oldest invoice",
    }),
  });
  assert.equal(history.length, 3);
  assert.equal(history[0].subject, "Oldest invoice");
  assert.equal(history[1].subject, "Middle inbound");
  assert.equal(history[2].subject, "Newer outbound");
}

// 3. outbound vendorEmailEvent → direction outbound
{
  const history = mergeVendorConversationHistory({
    events: [
      event({
        direction: "outbound",
        sentAt: "2026-03-04T12:00:00.000Z",
        recipientEmails: ["sales@vendor.com", "dispatch@vendor.com"],
        bodyExcerpt: "Please confirm ship date.",
      }),
    ],
    invoiceSourceEmail: null,
  });
  assert.equal(history.length, 1);
  assert.equal(history[0].direction, "outbound");
  assert.equal(history[0].recipientEmails, "sales@vendor.com, dispatch@vendor.com");
  assert.equal(history[0].preview, "Please confirm ship date.");
}

// 4. no events + no invoice source → empty
{
  const history = mergeVendorConversationHistory({
    events: [],
    invoiceSourceEmail: null,
  });
  assert.deepEqual(history, []);
}

// 5. caller isolation — helper only merges what it is given (delivery B event not passed in)
{
  const deliveryAEvents = [
    event({ id: "event-a", deliveryOrderId: "delivery-a", subject: "Delivery A only" }),
  ];
  const history = mergeVendorConversationHistory({
    events: deliveryAEvents,
    invoiceSourceEmail: inbound({ subject: "Delivery A invoice" }),
  });
  assert.equal(history.length, 2);
  assert.ok(history.every((row) => row.subject.includes("Delivery A")));
}

// 6. same vendor / two jobs: helper given only delivery A sources does not include B
{
  const deliveryBEvent = event({
    id: "event-b",
    deliveryOrderId: "delivery-b",
    subject: "Delivery B message",
  });
  const historyForA = mergeVendorConversationHistory({
    events: [event({ id: "event-a", deliveryOrderId: "delivery-a", subject: "Delivery A" })],
    invoiceSourceEmail: inbound({ id: "inbound-a", subject: "Delivery A invoice" }),
  });
  assert.ok(!historyForA.some((row) => row.subject.includes("Delivery B")));
  const historyIfBPassedByMistake = mergeVendorConversationHistory({
    events: [deliveryBEvent],
    invoiceSourceEmail: null,
  });
  assert.equal(historyIfBPassedByMistake.length, 1);
  assert.equal(historyIfBPassedByMistake[0].subject, "Delivery B message");
}

// 7. same gmailMessageId on event + invoice source → one row (no duplicate)
{
  const history = mergeVendorConversationHistory({
    events: [
      event({
        id: "event-linked",
        sourceMessageId: "gmail-msg-1",
        subject: "Already tracked inbound",
      }),
    ],
    invoiceSourceEmail: inbound({ gmailMessageId: "gmail-msg-1" }),
  });
  assert.equal(history.length, 1);
  assert.equal(history[0].id, "event-linked");
}

// 8. vendorEmailEventId match also dedupes
{
  const history = mergeVendorConversationHistory({
    events: [
      event({
        id: "event-from-ingest",
        sourceMessageId: "different-gmail-id",
        subject: "Tracked via vendorEmailEvents",
      }),
    ],
    invoiceSourceEmail: inbound({
      gmailMessageId: "gmail-msg-unique",
      vendorEmailEventId: "event-from-ingest",
    }),
  });
  assert.equal(history.length, 1);
  assert.equal(history[0].id, "event-from-ingest");
}

console.log("test-vendor-conversation-history PASS");

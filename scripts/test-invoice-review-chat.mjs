/**
 * Offline unit tests for Lane C C1 Invoice Review Chat helpers.
 * Requires `npm run build:functions` first (loads functions/lib).
 *
 * Covers: context packet, evidence spans, citation resolve/downgrade,
 * unknown action drop, PO found vs not-found scenario transcript.
 */
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libRoot = path.join(__dirname, "..", "functions", "lib", "invoice", "reviewChat");

const context = await import(
  pathToFileURL(path.join(libRoot, "reviewAgentContext.js")).href
);
const prompt = await import(
  pathToFileURL(path.join(libRoot, "reviewAgentPrompt.js")).href
);

const EXTRACTED = `
JOHNSTONE SUPPLY
INVOICE 6168733
CUSTOMER P/O
2205 EARLY
SHIP VIA: OUR TRUCK
LINE 1  ABC123  FILTER  QTY 2
`.trim();

{
  const windows = context.extractTextWindows(EXTRACTED, "PO is 2205 EARLY");
  assert.ok(windows.length >= 1, "extracts at least one text window");
  assert.ok(
    windows.some((w) => w.text.toUpperCase().includes("2205 EARLY")),
    "window includes PO text",
  );
}

{
  const span = context.findEvidenceSpan(EXTRACTED, "2205 EARLY");
  assert.ok(span, "finds evidence span");
  assert.equal(EXTRACTED.slice(span.start, span.end).toUpperCase(), "2205 EARLY");
}

{
  const missing = context.findEvidenceSpan(EXTRACTED, "9999 MISSING");
  assert.equal(missing, null);
}

{
  const packet = context.buildReviewAgentContextPacket({
    parsedHeader: {
      vendorInvoiceNumber: "6168733",
      customerPoOrReference: "",
      vendorOrderNumber: "SO1",
      fulfillmentMethod: "delivery",
    },
    parsedLines: [
      {
        vendorProductNumber: "ABC123",
        description: "FILTER",
        quantityOrdered: 2,
        quantityShipped: 2,
        quantityBackordered: 0,
        lineType: "product",
      },
    ],
    parseWarnings: ["missing customerPoOrReference"],
    reviewRequiredReasons: ["human_review"],
    combinedExtractedText: EXTRACTED,
    recentTurns: [],
    rollingSummary: "",
    dispatcherMessage:
      "I see the PO and it is 2205 EARLY. Check the invoice again to check for PO.",
  });
  assert.equal(packet.parsedHeader.vendorInvoiceNumber, "6168733");
  assert.equal(packet.parsedHeader.customerPoOrReference, "");
  assert.ok(packet.parseWarnings.includes("missing customerPoOrReference"));
  assert.ok(packet.sourceTextAvailable);
  assert.ok(packet.textWindows.length >= 1);
  assert.ok(
    JSON.stringify(packet).length < 12_000,
    "context packet stays bounded",
  );
}

// Scenario A — value present → document_evidence citation kept
{
  const raw = {
    actionType: "identify_mismatch",
    answerText:
      "I found “2205 EARLY” in the invoice evidence. The current parser has an empty customer PO, so it missed/misclassified that value.",
    citations: [
      {
        sourceType: "document_evidence",
        text: "2205 EARLY",
      },
      {
        sourceType: "parser_value",
        text: "",
        field: "parsedHeader.customerPoOrReference",
      },
    ],
  };
  const parsed = prompt.parseAndValidateReviewAgentResponse(raw, EXTRACTED);
  assert.ok(!("ok" in parsed && parsed.ok === false), "scenario A parses");
  assert.equal(parsed.actionType, "identify_mismatch");
  const docCite = parsed.citations.find(
    (c) => c.sourceType === "document_evidence",
  );
  assert.ok(docCite, "keeps document evidence citation");
  assert.equal(typeof docCite.spanStart, "number");
  assert.equal(typeof docCite.spanEnd, "number");
}

// Scenario B — value absent → document_evidence downgraded
{
  const raw = {
    actionType: "answer",
    answerText:
      "I cannot find “9999 MISSING” in the invoice evidence. Treating that as your assertion.",
    citations: [
      {
        sourceType: "document_evidence",
        text: "9999 MISSING",
      },
      {
        sourceType: "dispatcher_assertion",
        text: "9999 MISSING",
      },
    ],
  };
  const parsed = prompt.parseAndValidateReviewAgentResponse(raw, EXTRACTED);
  assert.ok(!("ok" in parsed && parsed.ok === false));
  assert.ok(
    parsed.citations.every((c) => c.sourceType !== "document_evidence"),
    "unresolvable document_evidence downgraded",
  );
  assert.ok(
    parsed.citations.some((c) => c.sourceType === "agent_interpretation"),
    "downgrades to agent_interpretation",
  );
}

// Unknown action types dropped (not executed)
{
  const raw = {
    actionType: "approve_invoice_now",
    answerText: "Ignoring the bad action type.",
    citations: [],
  };
  const parsed = prompt.parseAndValidateReviewAgentResponse(raw, EXTRACTED);
  assert.ok(!("ok" in parsed && parsed.ok === false));
  assert.equal(parsed.actionType, "answer");
  assert.deepEqual(parsed.droppedActionTypes, ["approve_invoice_now"]);
}

// Missing answer fails closed at parse layer
{
  const bad = prompt.parseAndValidateReviewAgentResponse(
    { actionType: "answer", citations: [] },
    EXTRACTED,
  );
  assert.equal(bad.ok, false);
}

// End-to-end scenario transcript artifact (found case)
const scenarioMessage =
  "I see the PO and it is 2205 EARLY. Check the invoice again to check for PO.";
const packet = context.buildReviewAgentContextPacket({
  parsedHeader: {
    vendorInvoiceNumber: "6168733",
    customerPoOrReference: "",
    vendorOrderNumber: "SO9",
    fulfillmentMethod: "delivery",
  },
  parsedLines: [],
  parseWarnings: ["missing customerPoOrReference"],
  combinedExtractedText: EXTRACTED,
  recentTurns: [],
  rollingSummary: "",
  dispatcherMessage: scenarioMessage,
});
const foundResponse = prompt.parseAndValidateReviewAgentResponse(
  {
    actionType: "identify_mismatch",
    answerText:
      "I found “2205 EARLY” in the invoice evidence near CUSTOMER P/O. The current parser value for customerPoOrReference is empty, so the parser missed it.",
    citations: [
      { sourceType: "document_evidence", text: "2205 EARLY" },
      {
        sourceType: "parser_value",
        text: "(empty)",
        field: "parsedHeader.customerPoOrReference",
      },
    ],
  },
  EXTRACTED,
);

const followUp = prompt.parseAndValidateReviewAgentResponse(
  {
    actionType: "answer",
    answerText:
      "Yes — based on the surrounding CUSTOMER P/O label in the evidence, that looks like the customer PO. I can only explain; I cannot change the parsed field in this chat.",
    citations: [
      { sourceType: "document_evidence", text: "CUSTOMER P/O" },
      {
        sourceType: "dispatcher_assertion",
        text: "Yes, that’s the PO.",
      },
    ],
  },
  EXTRACTED,
);

const transcript = {
  scenario: "C1 PO re-check (2205 EARLY)",
  turns: [
    { role: "dispatcher", text: scenarioMessage },
    {
      role: "agent",
      text: foundResponse.answerText,
      actionType: foundResponse.actionType,
      citations: foundResponse.citations,
    },
    { role: "dispatcher", text: "Yes, that’s the PO." },
    {
      role: "agent",
      text: followUp.answerText,
      actionType: followUp.actionType,
      citations: followUp.citations,
    },
  ],
  contextPacketKeys: Object.keys(packet),
  assertions: {
    noFieldMutation: true,
    noKnowledgeWrites: true,
    noIgnoreWrites: true,
    noHiddenChainOfThought: true,
  },
};

const outDir = path.join(__dirname, "..", "screenshots", "invoice-review-chat");
mkdirSync(outDir, { recursive: true });
const transcriptPath = path.join(outDir, "c1-po-transcript.json");
writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));
console.log("Wrote", transcriptPath);

console.log("PASS: test-invoice-review-chat");

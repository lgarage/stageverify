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
const assertionSupport = await import(
  pathToFileURL(path.join(libRoot, "assertionSupport.js")).href
);
const core = await import(
  pathToFileURL(path.join(libRoot, "runReviewAgentTurn.js")).href
);

const EXTRACTED = `
JOHNSTONE SUPPLY
INVOICE 6168733
CUSTOMER P/O
2205 EARLY
SHIP VIA: OUR TRUCK
LINE 1  ABC123  FILTER  QTY 2
`.trim();

const EXTRACTED_PROD = `
JOHNSTONE SUPPLY
INVOICE 6168733
Customer P/O # 2205 EARLY PICKUP SAD
SHIP VIA: OUR TRUCK
LINE 1  ABC123  FILTER  QTY 2
`.trim();

const DISPATCHER_PO_MSG =
  "I see the PO and it is 2205 EARLY. Check the invoice again to check for PO.";

const parseOpts = (dispatcherMessage, parserCustomerPo = "") => ({
  dispatcherMessage,
  parserCustomerPo,
});

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

// Optional citation.field omitted when absent (Firestore rejects undefined)
{
  const raw = {
    actionType: "cite_evidence",
    answerText: "Found CUSTOMER P/O near the header.",
    citations: [
      {
        sourceType: "document_evidence",
        text: "CUSTOMER P/O",
        // field intentionally omitted
      },
    ],
  };
  const parsed = prompt.parseAndValidateReviewAgentResponse(raw, EXTRACTED);
  assert.ok(!("ok" in parsed && parsed.ok === false));
  const cite = parsed.citations.find((c) => c.sourceType === "document_evidence");
  assert.ok(cite, "document_evidence citation present");
  assert.equal(
    Object.prototype.hasOwnProperty.call(cite, "field"),
    false,
    "field key must be omitted when undefined (Firestore write)",
  );
  const sanitized = core.citationsForFirestoreWrite(parsed.citations);
  for (const row of sanitized) {
    assert.equal(
      Object.values(row).some((v) => v === undefined),
      false,
      "sanitized citations must not contain undefined values",
    );
  }
}

// Missing answer fails closed at parse layer
{
  const bad = prompt.parseAndValidateReviewAgentResponse(
    { actionType: "answer", citations: [] },
    EXTRACTED,
  );
  assert.equal(bad.ok, false);
}

// --- Assertion / evidence consistency (C1 reconcile) ---

// 1. Prod-style: 2205 EARLY in Customer P/O line → supported
{
  const support = assertionSupport.classifyAssertionSupport(
    "2205 EARLY",
    EXTRACTED_PROD,
  );
  assert.notEqual(support.support, "unsupported", "2205 EARLY supported in prod text");
  assert.ok(support.matchedEvidenceText, "has matched evidence");
}

// 2. Exact full value → supported
{
  const support = assertionSupport.classifyAssertionSupport(
    "2205 EARLY PICKUP SAD",
    EXTRACTED_PROD,
  );
  assert.notEqual(support.support, "unsupported");
}

// 3. Case/spacing normalization → supported
{
  const support = assertionSupport.classifyAssertionSupport(
    "2205 early",
    EXTRACTED_PROD,
  );
  assert.notEqual(support.support, "unsupported");
}

// 4. Parser mismatch: model wrongly says unsupported → reconcile fixes
{
  const raw = {
    actionType: "answer",
    answerText:
      'I cannot find "2205 EARLY" in the invoice evidence. Treating that as your assertion.',
    citations: [
      {
        sourceType: "document_evidence",
        text: "Customer P/O # 2205 EARLY PICKUP SAD",
      },
    ],
  };
  const parsed = prompt.parseAndValidateReviewAgentResponse(
    raw,
    EXTRACTED_PROD,
    parseOpts(DISPATCHER_PO_MSG, "truck stock"),
  );
  assert.ok(!("ok" in parsed && parsed.ok === false));
  assert.equal(parsed.consistencyCorrected, true);
  assert.equal(parsed.actionType, "identify_mismatch");
  assert.ok(
    !assertionSupport.answerClaimsUnsupported(parsed.answerText),
    "corrected answer must not claim unsupported",
  );
  assert.ok(
    parsed.answerText.includes("parser"),
    "mentions parser mismatch",
  );
  assert.ok(
    !/\bcannot change\b|\bcan't change\b|\bcannot apply\b/i.test(
      parsed.answerText,
    ),
    "C2 reconcile copy must not claim inability to change/apply",
  );
  assert.ok(
    /Apply correction|Yes, apply it/i.test(parsed.answerText),
    "C2 reconcile copy offers confirm-to-apply path",
  );
  assert.ok(
    parsed.citations.some((c) => c.sourceType === "document_evidence"),
    "keeps document_evidence after reconcile",
  );
}

// 5. Invented PO → unsupported; model claiming found gets rewritten
{
  const fake = "ZZZX-PO-DOES-NOT-EXIST-99999";
  const support = assertionSupport.classifyAssertionSupport(fake, EXTRACTED_PROD);
  assert.equal(support.support, "unsupported");

  const raw = {
    actionType: "cite_evidence",
    answerText: `I found "${fake}" in the invoice evidence near the header.`,
    citations: [
      { sourceType: "document_evidence", text: fake },
      { sourceType: "dispatcher_assertion", text: fake },
    ],
  };
  const msg = `I see the PO and it is ${fake}. Check the invoice again.`;
  const parsed = prompt.parseAndValidateReviewAgentResponse(
    raw,
    EXTRACTED_PROD,
    parseOpts(msg, ""),
  );
  assert.equal(parsed.consistencyCorrected, true);
  assert.ok(assertionSupport.answerClaimsUnsupported(parsed.answerText));
  assert.ok(
    parsed.citations.every(
      (c) =>
        c.sourceType !== "document_evidence" ||
        !c.text.includes("ZZZX"),
    ),
    "no document_evidence for fake value",
  );
}

// 6. Weak unrelated substring → unsupported
{
  const viaSupport = assertionSupport.classifyAssertionSupport("VIA", EXTRACTED_PROD);
  assert.equal(viaSupport.support, "unsupported", "VIA alone is weak");

  const sadSupport = assertionSupport.classifyAssertionSupport("SAD", EXTRACTED_PROD);
  assert.equal(sadSupport.support, "unsupported", "SAD alone is weak");
}

// 7. Citations agree with final support classification after reconcile
{
  const raw = {
    actionType: "answer",
    answerText: 'I cannot find "2205 EARLY" in the document.',
    citations: [
      {
        sourceType: "document_evidence",
        text: "2205 EARLY",
      },
    ],
  };
  const parsed = prompt.parseAndValidateReviewAgentResponse(
    raw,
    EXTRACTED,
    parseOpts(DISPATCHER_PO_MSG, ""),
  );
  assert.equal(parsed.consistencyCorrected, true);
  const docCite = parsed.citations.find((c) => c.sourceType === "document_evidence");
  assert.ok(docCite, "document_evidence present when supported");
  assert.ok(
    assertionSupport.normalizeEvidenceText(docCite.text).includes("2205 EARLY"),
    "citation contains assertion",
  );
}

// 8. Impossible state: unsupported answer + supporting document_evidence → fixed
{
  const beforeAnswer =
    'I cannot find "2205 EARLY" in the invoice evidence. It is unsupported.';
  const raw = {
    actionType: "answer",
    answerText: beforeAnswer,
    citations: [
      {
        sourceType: "document_evidence",
        text: "Customer P/O # 2205 EARLY PICKUP SAD",
      },
    ],
  };
  const parsed = prompt.parseAndValidateReviewAgentResponse(
    raw,
    EXTRACTED_PROD,
    parseOpts(DISPATCHER_PO_MSG, ""),
  );
  assert.equal(parsed.consistencyCorrected, true);
  assert.ok(
    !assertionSupport.answerClaimsUnsupported(parsed.answerText),
    "after validate answer must NOT claim unsupported",
  );

  const beforeAfterArtifact = {
    scenario: "C1 assertion-evidence contradiction (prod defect)",
    before: {
      answerText: beforeAnswer,
      claimsUnsupported: true,
      citations: raw.citations,
    },
    after: {
      answerText: parsed.answerText,
      actionType: parsed.actionType,
      consistencyCorrected: parsed.consistencyCorrected,
      claimsUnsupported: assertionSupport.answerClaimsUnsupported(parsed.answerText),
      citations: parsed.citations,
    },
  };
  const outDir = path.join(__dirname, "..", "screenshots", "invoice-review-chat");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, "c1-assertion-consistency-before-after.json"),
    JSON.stringify(beforeAfterArtifact, null, 2),
  );
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

// C2 — proposedCorrection accepted for allowlisted fields; dropped for bad fields
{
  const withPc = prompt.parseAndValidateReviewAgentResponse(
    {
      actionType: "suggest_correction_may_be_needed",
      answerText: "I can update Customer PO to 2205 EARLY after you confirm.",
      citations: [{ sourceType: "document_evidence", text: "2205 EARLY" }],
      proposedCorrection: {
        field: "customerPoOrReference",
        currentValue: "",
        proposedValue: "2205 EARLY",
      },
    },
    EXTRACTED,
  );
  assert.ok(!("ok" in withPc && withPc.ok === false));
  assert.equal(withPc.proposedCorrection?.field, "customerPoOrReference");
  assert.equal(withPc.proposedCorrection?.proposedValue, "2205 EARLY");

  const badPc = prompt.parseAndValidateReviewAgentResponse(
    {
      actionType: "suggest_correction_may_be_needed",
      answerText: "Cannot correct fulfillment via chat.",
      citations: [],
      proposedCorrection: {
        field: "fulfillmentMethod",
        currentValue: "delivery",
        proposedValue: "will_call_pickup",
      },
    },
    EXTRACTED,
  );
  assert.ok(!("ok" in badPc && badPc.ok === false));
  assert.equal(badPc.proposedCorrection, undefined);
}

// C1∩C2 inheritance — supported 2205 keeps proposal; fake ZZZX cannot verify
{
  const msg2205 =
    "I see the PO and it is 2205 EARLY. Check the invoice again.";
  const reconciledWithProposal = prompt.parseAndValidateReviewAgentResponse(
    {
      actionType: "answer",
      answerText:
        'I cannot find "2205 EARLY" in the invoice evidence. Treating that as your assertion.',
      citations: [
        {
          sourceType: "document_evidence",
          text: "Customer P/O # 2205 EARLY PICKUP SAD",
        },
      ],
      proposedCorrection: {
        field: "customerPoOrReference",
        currentValue: "truck stock",
        proposedValue: "2205 EARLY",
      },
    },
    EXTRACTED_PROD,
    { dispatcherMessage: msg2205, parserCustomerPo: "truck stock" },
  );
  assert.ok(!("ok" in reconciledWithProposal && reconciledWithProposal.ok === false));
  assert.equal(reconciledWithProposal.consistencyCorrected, true);
  assert.equal(
    assertionSupport.answerClaimsUnsupported(reconciledWithProposal.answerText),
    false,
  );
  assert.ok(
    /truck stock/i.test(reconciledWithProposal.answerText),
    "parser mismatch still explained after reconcile",
  );
  assert.equal(
    reconciledWithProposal.proposedCorrection?.proposedValue,
    "2205 EARLY",
    "supported evidence can still carry a C2 proposal through parse",
  );

  const fake = "ZZZX-PO-DOES-NOT-EXIST-99999";
  const fakeMsg = `I see the PO and it is ${fake}. Check the invoice again.`;
  const fakeParsed = prompt.parseAndValidateReviewAgentResponse(
    {
      actionType: "suggest_correction_may_be_needed",
      answerText: `I found "${fake}" in the invoice evidence.`,
      citations: [{ sourceType: "document_evidence", text: fake }],
      proposedCorrection: {
        field: "customerPoOrReference",
        proposedValue: fake,
      },
    },
    EXTRACTED_PROD,
    { dispatcherMessage: fakeMsg, parserCustomerPo: "truck stock" },
  );
  assert.ok(!("ok" in fakeParsed && fakeParsed.ok === false));
  assert.equal(fakeParsed.consistencyCorrected, true);
  assert.ok(assertionSupport.answerClaimsUnsupported(fakeParsed.answerText));
  assert.equal(
    (fakeParsed.citations ?? []).some(
      (c) =>
        c.sourceType === "document_evidence" &&
        String(c.text ?? "").includes("ZZZX"),
    ),
    false,
    "no fabricated document_evidence for fake PO",
  );
  // Raw parse may still echo model proposedCorrection; apply/propose persistence
  // must refuse via classifyCorrectionEvidence (covered in field-correction tests).
  const fakeEvidence = (
    await import(
      pathToFileURL(path.join(libRoot, "classifyCorrectionEvidence.js")).href
    )
  ).classifyCorrectionEvidence({
    proposedValue: fake,
    combinedExtractedText: EXTRACTED_PROD,
    recentDispatcherTexts: [fakeMsg],
  });
  assert.equal(
    fakeEvidence.sourceType,
    null,
    "ZZZX cannot independently verify — no valid C2 correction",
  );
}

// C2 — context packet exposes correctableFields
{
  assert.ok(Array.isArray(packet.correctableFields));
  assert.ok(packet.correctableFields.includes("customerPoOrReference"));
  assert.equal(packet.correctableFields.includes("fulfillmentMethod"), false);
}

console.log("PASS: test-invoice-review-chat");

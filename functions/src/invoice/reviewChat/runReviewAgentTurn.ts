/**
 * Lane C C1/C2 — core reviewAgentTurn logic (injectable Vertex for tests).
 * C2: may persist proposedCorrection; never mutates parsedHeader (apply is separate).
 */
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import {
  MAX_REVIEW_CHAT_MESSAGE_CHARS,
  MODEL_FLASH,
  MODEL_FLASH_LITE,
  REVIEW_CHAT_RECENT_TURNS,
  REVIEW_CHAT_SUMMARY_EVERY_N_TURNS,
} from "../aiShadow/constants";
import { vertexGenerateJson } from "../aiShadow/vertexGenerate";
import { classifyCorrectionEvidence } from "./classifyCorrectionEvidence";
import { classifyCorrectionIntent } from "./correctionIntentClassifier";
import {
  headerFieldAsString,
  isCorrectableFieldKey,
  type ReviewProposedCorrection,
} from "./correctionAllowlist";
import { buildReviewAgentContextPacket } from "./reviewAgentContext";
import {
  FAIL_CLOSED_AGENT_TEXT,
  REVIEW_AGENT_SYSTEM_INSTRUCTION,
  formatReviewAgentUserText,
  parseAndValidateReviewAgentResponse,
} from "./reviewAgentPrompt";
import {
  REVIEW_CHAT_COLLECTION,
  REVIEW_CHAT_MESSAGES_SUB,
  type ReviewAgentActionType,
  type ReviewAgentTurnResult,
  type ReviewChatCitation,
  type ReviewChatMessageRole,
} from "./reviewAgentTypes";

export type ReviewGenerateJson = (input: {
  modelId: string;
  thinkingLevel: "minimal" | "low" | "medium" | "high";
  systemInstruction: string;
  userText: string;
}) => Promise<unknown>;

export class ReviewAgentTurnInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewAgentTurnInputError";
  }
}

function isoNow(): string {
  return new Date().toISOString();
}

/** Firestore rejects `undefined` values — omit optional citation keys. */
export function citationsForFirestoreWrite(
  citations: ReviewChatCitation[],
): Array<Record<string, string | number>> {
  return citations.map((c) => {
    const out: Record<string, string | number> = {
      sourceType: c.sourceType,
      text: c.text,
    };
    if (typeof c.spanStart === "number") out.spanStart = c.spanStart;
    if (typeof c.spanEnd === "number") out.spanEnd = c.spanEnd;
    if (typeof c.field === "string" && c.field.trim()) out.field = c.field;
    return out;
  });
}

async function loadRecentTurns(
  db: Firestore,
  importId: string,
): Promise<Array<{ role: ReviewChatMessageRole; text: string; id?: string }>> {
  const snap = await db
    .collection(REVIEW_CHAT_COLLECTION)
    .doc(importId)
    .collection(REVIEW_CHAT_MESSAGES_SUB)
    .orderBy("createdAt", "desc")
    .limit(REVIEW_CHAT_RECENT_TURNS)
    .get();

  const turns: Array<{
    role: ReviewChatMessageRole;
    text: string;
    id?: string;
  }> = [];
  for (const doc of snap.docs.reverse()) {
    const data = doc.data() as { role?: string; text?: string };
    if (
      (data.role === "dispatcher" || data.role === "agent") &&
      typeof data.text === "string"
    ) {
      turns.push({ role: data.role, text: data.text, id: doc.id });
    }
  }
  return turns;
}

async function findPendingProposalMessageId(
  db: Firestore,
  importId: string,
  fieldFilter?: string,
  excludeMessageId?: string,
): Promise<string | null> {
  const snap = await db
    .collection(REVIEW_CHAT_COLLECTION)
    .doc(importId)
    .collection(REVIEW_CHAT_MESSAGES_SUB)
    .orderBy("createdAt", "desc")
    .limit(40)
    .get();

  const matches: string[] = [];
  for (const doc of snap.docs) {
    if (excludeMessageId && doc.id === excludeMessageId) continue;
    const data = doc.data() as Record<string, unknown>;
    if (data.role !== "agent") continue;
    if (data.correctionStatus !== "proposed") continue;
    const pc = data.proposedCorrection;
    if (!pc || typeof pc !== "object" || Array.isArray(pc)) continue;
    const field = (pc as Record<string, unknown>).field;
    if (!isCorrectableFieldKey(field)) continue;
    if (fieldFilter && field !== fieldFilter) continue;
    matches.push(doc.id);
  }
  // Exactly one pending proposal — never guess when ambiguous.
  if (matches.length === 1) return matches[0]!;
  return null;
}

function updateRollingSummary(
  previous: string,
  dispatcherText: string,
  agentText: string,
  turnCount: number,
): string | null {
  if (turnCount % REVIEW_CHAT_SUMMARY_EVERY_N_TURNS !== 0) return null;
  return [
    previous.trim(),
    `Dispatcher: ${dispatcherText.slice(0, 180)}`,
    `Agent: ${agentText.slice(0, 220)}`,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(-1_400);
}

async function callModelWithEscalation(
  generateJson: ReviewGenerateJson,
  userText: string,
): Promise<{ raw: unknown; modelUsed: string }> {
  try {
    const liteRaw = await generateJson({
      modelId: MODEL_FLASH_LITE,
      thinkingLevel: "minimal",
      systemInstruction: REVIEW_AGENT_SYSTEM_INSTRUCTION,
      userText,
    });
    const liteParsed = parseAndValidateReviewAgentResponse(liteRaw, " ");
    if (!("ok" in liteParsed && liteParsed.ok === false)) {
      return { raw: liteRaw, modelUsed: MODEL_FLASH_LITE };
    }
  } catch {
    // escalate to Flash
  }

  const flashRaw = await generateJson({
    modelId: MODEL_FLASH,
    thinkingLevel: "minimal",
    systemInstruction: REVIEW_AGENT_SYSTEM_INSTRUCTION,
    userText,
  });
  return { raw: flashRaw, modelUsed: MODEL_FLASH };
}

function buildPersistedProposal(input: {
  raw: { field: string; currentValue?: string; proposedValue: string };
  parsedHeader: unknown;
  combinedExtractedText: string;
  recentDispatcherTexts: string[];
}): ReviewProposedCorrection | null {
  if (!isCorrectableFieldKey(input.raw.field)) return null;
  const proposedValue = input.raw.proposedValue.trim();
  if (!proposedValue) return null;
  const currentValue =
    typeof input.raw.currentValue === "string"
      ? input.raw.currentValue.trim()
      : headerFieldAsString(input.parsedHeader, input.raw.field);
  const evidence = classifyCorrectionEvidence({
    proposedValue,
    combinedExtractedText: input.combinedExtractedText,
    recentDispatcherTexts: input.recentDispatcherTexts,
  });
  // Inherit C1 hallucination resistance: no document/dispatcher evidence ⇒ no
  // persisted proposal (Apply also refuses not_independently_verifiable).
  if (!evidence.sourceType) return null;
  return {
    field: input.raw.field,
    currentValue,
    proposedValue,
    sourceType: evidence.sourceType,
  };
}

export async function runReviewAgentTurnCore(input: {
  db: Firestore;
  uid: string;
  vendorInvoiceImportId: string;
  message: string;
  generateJson?: ReviewGenerateJson;
}): Promise<ReviewAgentTurnResult> {
  const generateJson = input.generateJson ?? vertexGenerateJson;
  const importId = input.vendorInvoiceImportId.trim();
  const message = input.message.trim();

  if (!importId || importId.length > 200) {
    throw new ReviewAgentTurnInputError("Invalid vendorInvoiceImportId.");
  }
  if (!message) {
    throw new ReviewAgentTurnInputError("Message is required.");
  }
  if (message.length > MAX_REVIEW_CHAT_MESSAGE_CHARS) {
    throw new ReviewAgentTurnInputError(
      `Message exceeds ${MAX_REVIEW_CHAT_MESSAGE_CHARS} characters.`,
    );
  }

  const importRef = input.db.collection("vendorInvoiceImports").doc(importId);
  const importSnap = await importRef.get();
  if (!importSnap.exists) {
    throw new ReviewAgentTurnInputError("Invoice import not found.");
  }
  const importDoc = importSnap.data() as Record<string, unknown>;

  let combinedExtractedText = "";
  const inboundId =
    typeof importDoc.inboundEmailProcessingId === "string"
      ? importDoc.inboundEmailProcessingId.trim()
      : "";
  if (inboundId) {
    const inboundSnap = await input.db
      .collection("inboundEmailProcessing")
      .doc(inboundId)
      .get();
    if (inboundSnap.exists) {
      const inbound = inboundSnap.data() as Record<string, unknown>;
      if (typeof inbound.combinedExtractedText === "string") {
        combinedExtractedText = inbound.combinedExtractedText;
      }
    }
  }

  const chatRef = input.db.collection(REVIEW_CHAT_COLLECTION).doc(importId);
  const chatSnap = await chatRef.get();
  const chatData = chatSnap.exists
    ? (chatSnap.data() as Record<string, unknown>)
    : {};
  const priorSummary =
    typeof chatData.rollingSummary === "string" ? chatData.rollingSummary : "";
  const priorTurnCount =
    typeof chatData.turnCount === "number" ? chatData.turnCount : 0;

  const recentTurns = await loadRecentTurns(input.db, importId);
  const recentDispatcherTexts = recentTurns
    .filter((t) => t.role === "dispatcher")
    .map((t) => t.text);
  // Include the message about to be persisted for evidence classification.
  recentDispatcherTexts.push(message);

  const dispatcherMsgRef = chatRef.collection(REVIEW_CHAT_MESSAGES_SUB).doc();
  await dispatcherMsgRef.set({
    role: "dispatcher",
    text: message,
    createdAt: FieldValue.serverTimestamp(),
    createdByUid: input.uid,
  });

  const turnCountAfterUser = priorTurnCount + 1;
  await chatRef.set(
    {
      vendorInvoiceImportId: importId,
      createdAt: chatSnap.exists
        ? (chatData.createdAt ?? FieldValue.serverTimestamp())
        : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      turnCount: turnCountAfterUser,
      rollingSummary: priorSummary,
      rollingSummaryUpdatedAt: chatData.rollingSummaryUpdatedAt ?? null,
    },
    { merge: true },
  );

  const packet = buildReviewAgentContextPacket({
    parsedHeader: importDoc.parsedHeader,
    parsedLines: importDoc.parsedLines,
    parseWarnings: importDoc.parseWarnings,
    reviewRequiredReasons: importDoc.reviewRequiredReasons,
    error: importDoc.error,
    combinedExtractedText,
    recentTurns: recentTurns.map(({ role, text }) => ({ role, text })),
    rollingSummary: priorSummary,
    dispatcherMessage: message,
  });

  let agentText = FAIL_CLOSED_AGENT_TEXT;
  let citations: ReviewChatCitation[] | undefined;
  let actionType: ReviewAgentActionType | undefined = "answer";
  let modelUsed: string | undefined;
  let droppedActionTypes: string[] | undefined;
  let error: string | undefined = "model_unavailable";
  let proposedCorrection: ReviewProposedCorrection | undefined;

  try {
    const userText = formatReviewAgentUserText(packet, message);
    const modelResult = await callModelWithEscalation(generateJson, userText);
    const parsedHeader = importDoc.parsedHeader as
      | Record<string, unknown>
      | undefined;
    const rawParserPo = parsedHeader?.customerPoOrReference;
    const parserCustomerPo =
      typeof rawParserPo === "string" ? rawParserPo : null;

    const parsed = parseAndValidateReviewAgentResponse(
      modelResult.raw,
      combinedExtractedText,
      {
        dispatcherMessage: message,
        parserCustomerPo,
      },
    );
    if ("ok" in parsed && parsed.ok === false) {
      throw new Error(parsed.reason);
    }
    const ok = parsed as {
      actionType: ReviewAgentActionType;
      answerText: string;
      citations: ReviewChatCitation[];
      droppedActionTypes: string[];
      proposedCorrection?: {
        field: string;
        currentValue?: string;
        proposedValue: string;
      };
    };
    agentText = ok.answerText;
    citations = ok.citations;
    actionType = ok.actionType;
    modelUsed = modelResult.modelUsed;
    droppedActionTypes = ok.droppedActionTypes.length
      ? ok.droppedActionTypes
      : undefined;
    error = undefined;
    if (ok.proposedCorrection) {
      proposedCorrection =
        buildPersistedProposal({
          raw: ok.proposedCorrection,
          parsedHeader: importDoc.parsedHeader,
          combinedExtractedText,
          recentDispatcherTexts,
        }) ?? undefined;
    }
  } catch (err) {
    console.error("reviewAgentTurn model/parse failed:", err);
  }

  const intent = classifyCorrectionIntent(message);

  // Confirmation turns apply an *existing* proposal — never persist a new one
  // from the model on this turn (prevents arbitrary/extra pending cards).
  if (intent.kind === "confirmation") {
    proposedCorrection = undefined;
  }

  // If dispatcher issued a direct command with a value but the model omitted
  // proposedCorrection, synthesize a proposal when evidence/classifier agree.
  if (
    !proposedCorrection &&
    intent.kind === "direct_command" &&
    intent.field &&
    intent.proposedValue
  ) {
    proposedCorrection =
      buildPersistedProposal({
        raw: {
          field: intent.field,
          proposedValue: intent.proposedValue,
        },
        parsedHeader: importDoc.parsedHeader,
        combinedExtractedText,
        recentDispatcherTexts,
      }) ?? undefined;
    if (proposedCorrection && !error) {
      actionType = "suggest_correction_may_be_needed";
      const display =
        intent.field === "customerPoOrReference"
          ? "Customer PO"
          : intent.field === "vendorOrderNumber"
            ? "Vendor order #"
            : "Invoice #";
      const cur = proposedCorrection.currentValue || "blank";
      agentText = `I can update ${display} from ${cur} to ${proposedCorrection.proposedValue}. Confirm with Apply correction or reply “Yes, apply it.”`;
    }
  }

  const agentMsgRef = chatRef.collection(REVIEW_CHAT_MESSAGES_SUB).doc();
  await agentMsgRef.set({
    role: "agent",
    text: agentText,
    createdAt: FieldValue.serverTimestamp(),
    createdByUid: "system",
    ...(citations ? { citations: citationsForFirestoreWrite(citations) } : {}),
    ...(actionType ? { actionType } : {}),
    ...(modelUsed ? { modelUsed } : {}),
    ...(droppedActionTypes ? { droppedActionTypes } : {}),
    ...(error ? { error } : {}),
    ...(proposedCorrection
      ? {
          proposedCorrection,
          correctionStatus: "proposed",
        }
      : {}),
  });

  let autoApplyEligible = false;
  let autoApplyMessageId: string | undefined;
  let autoApplyTriggerMode:
    | "chat_direct_command"
    | "chat_confirmation"
    | undefined;

  if (
    intent.kind === "direct_command" &&
    proposedCorrection &&
    intent.field === proposedCorrection.field
  ) {
    autoApplyEligible = true;
    autoApplyMessageId = agentMsgRef.id;
    autoApplyTriggerMode = "chat_direct_command";
  } else if (intent.kind === "confirmation") {
    // Confirmation must target the sole *existing* pending proposal — never a
    // newly synthesized proposal on this turn (avoids arbitrary mutation).
    const pendingId = await findPendingProposalMessageId(
      input.db,
      importId,
      intent.field,
      agentMsgRef.id,
    );
    if (pendingId) {
      autoApplyEligible = true;
      autoApplyMessageId = pendingId;
      autoApplyTriggerMode = "chat_confirmation";
    }
  }

  const turnCountAfterAgent = turnCountAfterUser + 1;
  const nextSummary = updateRollingSummary(
    priorSummary,
    message,
    agentText,
    turnCountAfterAgent,
  );

  await chatRef.set(
    {
      updatedAt: FieldValue.serverTimestamp(),
      turnCount: turnCountAfterAgent,
      ...(nextSummary !== null
        ? {
            rollingSummary: nextSummary,
            rollingSummaryUpdatedAt: FieldValue.serverTimestamp(),
          }
        : {}),
    },
    { merge: true },
  );

  return {
    messageId: agentMsgRef.id,
    agentMessage: {
      id: agentMsgRef.id,
      role: "agent",
      text: agentText,
      createdAt: isoNow(),
      createdByUid: "system",
      ...(citations ? { citations } : {}),
      ...(actionType ? { actionType } : {}),
      ...(modelUsed ? { modelUsed } : {}),
      ...(droppedActionTypes ? { droppedActionTypes } : {}),
      ...(error ? { error } : {}),
      ...(proposedCorrection
        ? {
            proposedCorrection,
            correctionStatus: "proposed" as const,
          }
        : {}),
    },
    ...(autoApplyEligible
      ? {
          autoApplyEligible: true,
          autoApplyMessageId,
          autoApplyTriggerMode,
        }
      : {}),
  };
}

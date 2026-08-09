"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewAgentTurnInputError = void 0;
exports.citationsForFirestoreWrite = citationsForFirestoreWrite;
exports.runReviewAgentTurnCore = runReviewAgentTurnCore;
const firestore_1 = require("firebase-admin/firestore");
const constants_1 = require("../aiShadow/constants");
const vertexGenerate_1 = require("../aiShadow/vertexGenerate");
const classifyCorrectionEvidence_1 = require("./classifyCorrectionEvidence");
const correctionIntentClassifier_1 = require("./correctionIntentClassifier");
const correctionAllowlist_1 = require("./correctionAllowlist");
const reviewAgentContext_1 = require("./reviewAgentContext");
const reviewAgentPrompt_1 = require("./reviewAgentPrompt");
const reviewAgentTypes_1 = require("./reviewAgentTypes");
const CANNOT_APPLY_COPY_RE = /\b(cannot change|can't change|cannot apply|can't apply|unable to (change|apply)|i cannot change or apply)\b/i;
function asFieldCorrectionLog(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const item of raw) {
        if (!item || typeof item !== "object" || Array.isArray(item))
            continue;
        const e = item;
        if (!(0, correctionAllowlist_1.isCorrectableFieldKey)(e.field))
            continue;
        const newValue = typeof e.newValue === "string" ? e.newValue.trim() : "";
        if (!newValue)
            continue;
        out.push({
            field: e.field,
            newValue,
            ...(typeof e.previousValue === "string"
                ? { previousValue: e.previousValue }
                : {}),
            ...(typeof e.at === "string" ? { at: e.at } : {}),
            ...(typeof e.by === "string" ? { by: e.by } : {}),
            ...(typeof e.correctionId === "string"
                ? { correctionId: e.correctionId }
                : {}),
        });
    }
    return out;
}
class ReviewAgentTurnInputError extends Error {
    constructor(message) {
        super(message);
        this.name = "ReviewAgentTurnInputError";
    }
}
exports.ReviewAgentTurnInputError = ReviewAgentTurnInputError;
function isoNow() {
    return new Date().toISOString();
}
/** Firestore rejects `undefined` values — omit optional citation keys. */
function citationsForFirestoreWrite(citations) {
    return citations.map((c) => {
        const out = {
            sourceType: c.sourceType,
            text: c.text,
        };
        if (typeof c.spanStart === "number")
            out.spanStart = c.spanStart;
        if (typeof c.spanEnd === "number")
            out.spanEnd = c.spanEnd;
        if (typeof c.field === "string" && c.field.trim())
            out.field = c.field;
        return out;
    });
}
async function loadRecentTurns(db, importId) {
    const snap = await db
        .collection(reviewAgentTypes_1.REVIEW_CHAT_COLLECTION)
        .doc(importId)
        .collection(reviewAgentTypes_1.REVIEW_CHAT_MESSAGES_SUB)
        .orderBy("createdAt", "desc")
        .limit(constants_1.REVIEW_CHAT_RECENT_TURNS)
        .get();
    const turns = [];
    for (const doc of snap.docs.reverse()) {
        const data = doc.data();
        if ((data.role === "dispatcher" || data.role === "agent") &&
            typeof data.text === "string") {
            turns.push({ role: data.role, text: data.text, id: doc.id });
        }
    }
    return turns;
}
async function findPendingProposalMessageId(db, importId, fieldFilter, excludeMessageId) {
    const snap = await db
        .collection(reviewAgentTypes_1.REVIEW_CHAT_COLLECTION)
        .doc(importId)
        .collection(reviewAgentTypes_1.REVIEW_CHAT_MESSAGES_SUB)
        .orderBy("createdAt", "desc")
        .limit(40)
        .get();
    const matches = [];
    for (const doc of snap.docs) {
        if (excludeMessageId && doc.id === excludeMessageId)
            continue;
        const data = doc.data();
        if (data.role !== "agent")
            continue;
        if (data.correctionStatus !== "proposed")
            continue;
        const pc = data.proposedCorrection;
        if (!pc || typeof pc !== "object" || Array.isArray(pc))
            continue;
        const field = pc.field;
        if (!(0, correctionAllowlist_1.isCorrectableFieldKey)(field))
            continue;
        if (fieldFilter && field !== fieldFilter)
            continue;
        matches.push(doc.id);
    }
    // Exactly one pending proposal — never guess when ambiguous.
    if (matches.length === 1)
        return matches[0];
    return null;
}
function updateRollingSummary(previous, dispatcherText, agentText, turnCount) {
    if (turnCount % constants_1.REVIEW_CHAT_SUMMARY_EVERY_N_TURNS !== 0)
        return null;
    return [
        previous.trim(),
        `Dispatcher: ${dispatcherText.slice(0, 180)}`,
        `Agent: ${agentText.slice(0, 220)}`,
    ]
        .filter(Boolean)
        .join("\n")
        .slice(-1_400);
}
async function callModelWithEscalation(generateJson, userText) {
    try {
        const liteRaw = await generateJson({
            modelId: constants_1.MODEL_FLASH_LITE,
            thinkingLevel: "minimal",
            systemInstruction: reviewAgentPrompt_1.REVIEW_AGENT_SYSTEM_INSTRUCTION,
            userText,
        });
        const liteParsed = (0, reviewAgentPrompt_1.parseAndValidateReviewAgentResponse)(liteRaw, " ");
        if (!("ok" in liteParsed && liteParsed.ok === false)) {
            return { raw: liteRaw, modelUsed: constants_1.MODEL_FLASH_LITE };
        }
    }
    catch {
        // escalate to Flash
    }
    const flashRaw = await generateJson({
        modelId: constants_1.MODEL_FLASH,
        thinkingLevel: "minimal",
        systemInstruction: reviewAgentPrompt_1.REVIEW_AGENT_SYSTEM_INSTRUCTION,
        userText,
    });
    return { raw: flashRaw, modelUsed: constants_1.MODEL_FLASH };
}
function buildPersistedProposal(input) {
    if (!(0, correctionAllowlist_1.isCorrectableFieldKey)(input.raw.field))
        return null;
    const proposedValue = input.raw.proposedValue.trim();
    if (!proposedValue)
        return null;
    const currentValue = typeof input.raw.currentValue === "string"
        ? input.raw.currentValue.trim()
        : (0, correctionAllowlist_1.headerFieldAsString)(input.parsedHeader, input.raw.field);
    const evidence = (0, classifyCorrectionEvidence_1.classifyCorrectionEvidence)({
        proposedValue,
        combinedExtractedText: input.combinedExtractedText,
        recentDispatcherTexts: input.recentDispatcherTexts,
    });
    // Inherit C1 hallucination resistance: no document/dispatcher evidence ⇒ no
    // persisted proposal (Apply also refuses not_independently_verifiable).
    if (!evidence.sourceType)
        return null;
    return {
        field: input.raw.field,
        currentValue,
        proposedValue,
        sourceType: evidence.sourceType,
    };
}
async function runReviewAgentTurnCore(input) {
    const generateJson = input.generateJson ?? vertexGenerate_1.vertexGenerateJson;
    const importId = input.vendorInvoiceImportId.trim();
    const message = input.message.trim();
    if (!importId || importId.length > 200) {
        throw new ReviewAgentTurnInputError("Invalid vendorInvoiceImportId.");
    }
    if (!message) {
        throw new ReviewAgentTurnInputError("Message is required.");
    }
    if (message.length > constants_1.MAX_REVIEW_CHAT_MESSAGE_CHARS) {
        throw new ReviewAgentTurnInputError(`Message exceeds ${constants_1.MAX_REVIEW_CHAT_MESSAGE_CHARS} characters.`);
    }
    const importRef = input.db.collection("vendorInvoiceImports").doc(importId);
    const importSnap = await importRef.get();
    if (!importSnap.exists) {
        throw new ReviewAgentTurnInputError("Invoice import not found.");
    }
    const importDoc = importSnap.data();
    let combinedExtractedText = "";
    const inboundId = typeof importDoc.inboundEmailProcessingId === "string"
        ? importDoc.inboundEmailProcessingId.trim()
        : "";
    if (inboundId) {
        const inboundSnap = await input.db
            .collection("inboundEmailProcessing")
            .doc(inboundId)
            .get();
        if (inboundSnap.exists) {
            const inbound = inboundSnap.data();
            if (typeof inbound.combinedExtractedText === "string") {
                combinedExtractedText = inbound.combinedExtractedText;
            }
        }
    }
    const chatRef = input.db.collection(reviewAgentTypes_1.REVIEW_CHAT_COLLECTION).doc(importId);
    const chatSnap = await chatRef.get();
    const chatData = chatSnap.exists
        ? chatSnap.data()
        : {};
    const priorSummary = typeof chatData.rollingSummary === "string" ? chatData.rollingSummary : "";
    const priorTurnCount = typeof chatData.turnCount === "number" ? chatData.turnCount : 0;
    const recentTurns = await loadRecentTurns(input.db, importId);
    const recentDispatcherTexts = recentTurns
        .filter((t) => t.role === "dispatcher")
        .map((t) => t.text);
    // Include the message about to be persisted for evidence classification.
    recentDispatcherTexts.push(message);
    const dispatcherMsgRef = chatRef.collection(reviewAgentTypes_1.REVIEW_CHAT_MESSAGES_SUB).doc();
    await dispatcherMsgRef.set({
        role: "dispatcher",
        text: message,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
        createdByUid: input.uid,
    });
    const turnCountAfterUser = priorTurnCount + 1;
    await chatRef.set({
        vendorInvoiceImportId: importId,
        createdAt: chatSnap.exists
            ? (chatData.createdAt ?? firestore_1.FieldValue.serverTimestamp())
            : firestore_1.FieldValue.serverTimestamp(),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
        turnCount: turnCountAfterUser,
        rollingSummary: priorSummary,
        rollingSummaryUpdatedAt: chatData.rollingSummaryUpdatedAt ?? null,
    }, { merge: true });
    const fieldCorrectionLog = asFieldCorrectionLog(importDoc.fieldCorrectionLog);
    const packet = (0, reviewAgentContext_1.buildReviewAgentContextPacket)({
        parsedHeader: importDoc.parsedHeader,
        parsedLines: importDoc.parsedLines,
        parseWarnings: importDoc.parseWarnings,
        reviewRequiredReasons: importDoc.reviewRequiredReasons,
        error: importDoc.error,
        combinedExtractedText,
        recentTurns: recentTurns.map(({ role, text }) => ({ role, text })),
        rollingSummary: priorSummary,
        dispatcherMessage: message,
        originalParsedHeader: importDoc.originalParsedHeader,
        fieldCorrectionLog,
        originalParseWarnings: importDoc.originalParseWarnings,
    });
    let agentText = reviewAgentPrompt_1.FAIL_CLOSED_AGENT_TEXT;
    let citations;
    let actionType = "answer";
    let modelUsed;
    let droppedActionTypes;
    let error = "model_unavailable";
    let proposedCorrection;
    try {
        const userText = (0, reviewAgentPrompt_1.formatReviewAgentUserText)(packet, message);
        const modelResult = await callModelWithEscalation(generateJson, userText);
        const parsedHeader = importDoc.parsedHeader;
        const rawParserPo = parsedHeader?.customerPoOrReference;
        const parserCustomerPo = typeof rawParserPo === "string" ? rawParserPo : null;
        const parsed = (0, reviewAgentPrompt_1.parseAndValidateReviewAgentResponse)(modelResult.raw, combinedExtractedText, {
            dispatcherMessage: message,
            parserCustomerPo,
            parsedHeader: importDoc.parsedHeader,
            fieldCorrectionLog,
        });
        if ("ok" in parsed && parsed.ok === false) {
            throw new Error(parsed.reason);
        }
        const ok = parsed;
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
    }
    catch (err) {
        console.error("reviewAgentTurn model/parse failed:", err);
    }
    const intent = (0, correctionIntentClassifier_1.classifyCorrectionIntent)(message);
    // Confirmation turns apply an *existing* proposal — never persist a new one
    // from the model on this turn (prevents arbitrary/extra pending cards).
    let confirmationPendingId = null;
    let confirmationPendingPc;
    if (intent.kind === "confirmation") {
        proposedCorrection = undefined;
        confirmationPendingId = await findPendingProposalMessageId(input.db, importId, intent.field);
        if (confirmationPendingId) {
            const pendingSnap = await chatRef
                .collection(reviewAgentTypes_1.REVIEW_CHAT_MESSAGES_SUB)
                .doc(confirmationPendingId)
                .get();
            const rawPc = pendingSnap.exists
                ? pendingSnap.data().proposedCorrection
                : undefined;
            if (rawPc && typeof rawPc === "object" && !Array.isArray(rawPc)) {
                const pc = rawPc;
                if ((0, correctionAllowlist_1.isCorrectableFieldKey)(pc.field) &&
                    typeof pc.proposedValue === "string" &&
                    pc.proposedValue.trim()) {
                    confirmationPendingPc = {
                        field: pc.field,
                        currentValue: typeof pc.currentValue === "string" ? pc.currentValue : "",
                        proposedValue: pc.proposedValue.trim(),
                        sourceType: pc.sourceType === "document_evidence" ||
                            pc.sourceType === "dispatcher_assertion" ||
                            pc.sourceType === "agent_interpretation"
                            ? pc.sourceType
                            : "agent_interpretation",
                    };
                    const display = confirmationPendingPc.field === "customerPoOrReference"
                        ? "Customer PO"
                        : confirmationPendingPc.field === "vendorOrderNumber"
                            ? "Vendor order #"
                            : "Invoice #";
                    // C2 can apply after explicit confirmation — never claim inability.
                    agentText = `Confirmed. Applying ${display} → ${confirmationPendingPc.proposedValue}.`;
                    error = undefined;
                }
            }
            // Pending proposal message exists but stored correction is invalid —
            // never auto-apply while leaving model "cannot apply" copy in place.
            if (!confirmationPendingPc) {
                confirmationPendingId = null;
                agentText =
                    "I found a pending correction proposal, but it is incomplete or invalid, so I cannot apply it. Ask me to propose the field update again.";
                error = undefined;
            }
        }
    }
    // If dispatcher issued a direct command with a value but the model omitted
    // proposedCorrection, synthesize a proposal when evidence/classifier agree.
    if (!proposedCorrection &&
        intent.kind === "direct_command" &&
        intent.field &&
        intent.proposedValue) {
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
            const display = intent.field === "customerPoOrReference"
                ? "Customer PO"
                : intent.field === "vendorOrderNumber"
                    ? "Vendor order #"
                    : "Invoice #";
            const cur = proposedCorrection.currentValue || "blank";
            agentText = `I can update ${display} from ${cur} to ${proposedCorrection.proposedValue}. Confirm with Apply correction or reply “Yes, apply it.”`;
        }
    }
    // Strip leftover "cannot change/apply" model copy when we have a real C2 path.
    if ((proposedCorrection || confirmationPendingPc) &&
        CANNOT_APPLY_COPY_RE.test(agentText)) {
        if (confirmationPendingPc) {
            const display = confirmationPendingPc.field === "customerPoOrReference"
                ? "Customer PO"
                : confirmationPendingPc.field === "vendorOrderNumber"
                    ? "Vendor order #"
                    : "Invoice #";
            agentText = `Confirmed. Applying ${display} → ${confirmationPendingPc.proposedValue}.`;
        }
        else if (proposedCorrection) {
            const display = proposedCorrection.field === "customerPoOrReference"
                ? "Customer PO"
                : proposedCorrection.field === "vendorOrderNumber"
                    ? "Vendor order #"
                    : "Invoice #";
            const cur = proposedCorrection.currentValue || "blank";
            agentText = `I can update ${display} from ${cur} to ${proposedCorrection.proposedValue}. Confirm with Apply correction or reply “Yes, apply it.”`;
        }
    }
    const agentMsgRef = chatRef.collection(reviewAgentTypes_1.REVIEW_CHAT_MESSAGES_SUB).doc();
    await agentMsgRef.set({
        role: "agent",
        text: agentText,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
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
    let autoApplyMessageId;
    let autoApplyTriggerMode;
    if (intent.kind === "direct_command" &&
        proposedCorrection &&
        intent.field === proposedCorrection.field) {
        autoApplyEligible = true;
        autoApplyMessageId = agentMsgRef.id;
        autoApplyTriggerMode = "chat_direct_command";
    }
    else if (intent.kind === "confirmation" &&
        confirmationPendingId &&
        confirmationPendingPc) {
        // Gate on validated pending correction — never auto-apply on id alone.
        autoApplyEligible = true;
        autoApplyMessageId = confirmationPendingId;
        autoApplyTriggerMode = "chat_confirmation";
    }
    const turnCountAfterAgent = turnCountAfterUser + 1;
    const nextSummary = updateRollingSummary(priorSummary, message, agentText, turnCountAfterAgent);
    await chatRef.set({
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
        turnCount: turnCountAfterAgent,
        ...(nextSummary !== null
            ? {
                rollingSummary: nextSummary,
                rollingSummaryUpdatedAt: firestore_1.FieldValue.serverTimestamp(),
            }
            : {}),
    }, { merge: true });
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
                    correctionStatus: "proposed",
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
//# sourceMappingURL=runReviewAgentTurn.js.map
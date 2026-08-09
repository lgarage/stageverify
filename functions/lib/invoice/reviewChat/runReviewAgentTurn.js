"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewAgentTurnInputError = void 0;
exports.citationsForFirestoreWrite = citationsForFirestoreWrite;
exports.runReviewAgentTurnCore = runReviewAgentTurnCore;
const firestore_1 = require("firebase-admin/firestore");
const constants_1 = require("../aiShadow/constants");
const vertexGenerate_1 = require("../aiShadow/vertexGenerate");
const reviewAgentContext_1 = require("./reviewAgentContext");
const reviewAgentPrompt_1 = require("./reviewAgentPrompt");
const reviewAgentTypes_1 = require("./reviewAgentTypes");
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
            turns.push({ role: data.role, text: data.text });
        }
    }
    return turns;
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
        // Validate structure without citation resolution first (empty text ok for gate).
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
    const packet = (0, reviewAgentContext_1.buildReviewAgentContextPacket)({
        parsedHeader: importDoc.parsedHeader,
        parsedLines: importDoc.parsedLines,
        parseWarnings: importDoc.parseWarnings,
        reviewRequiredReasons: importDoc.reviewRequiredReasons,
        error: importDoc.error,
        combinedExtractedText,
        recentTurns,
        rollingSummary: priorSummary,
        dispatcherMessage: message,
    });
    let agentText = reviewAgentPrompt_1.FAIL_CLOSED_AGENT_TEXT;
    let citations;
    let actionType = "answer";
    let modelUsed;
    let droppedActionTypes;
    let error = "model_unavailable";
    try {
        const userText = (0, reviewAgentPrompt_1.formatReviewAgentUserText)(packet, message);
        const modelResult = await callModelWithEscalation(generateJson, userText);
        const parsedHeader = importDoc.parsedHeader;
        const rawParserPo = parsedHeader?.customerPoOrReference;
        const parserCustomerPo = typeof rawParserPo === "string" ? rawParserPo : null;
        const parsed = (0, reviewAgentPrompt_1.parseAndValidateReviewAgentResponse)(modelResult.raw, combinedExtractedText, {
            dispatcherMessage: message,
            parserCustomerPo,
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
    }
    catch (err) {
        console.error("reviewAgentTurn model/parse failed:", err);
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
    });
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
        },
    };
}
//# sourceMappingURL=runReviewAgentTurn.js.map
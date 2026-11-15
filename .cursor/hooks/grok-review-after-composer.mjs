#!/usr/bin/env node
// Composer does the work, then grok-4.7-high reviews it. Code edits and
// research about updating the program use the same loop: FAIL goes back to
// Composer, Composer revises, Grok reviews again until PASS.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_ROUNDS = 6;
const MARK = "GROK_REVIEW_LOOP";

/**
 * @param {"" | "code" | "research" | "both"} subject
 */
function reviewFollowup(subject) {
  const target =
    subject === "both"
      ? "the research answer and the git diff"
      : subject === "research"
        ? "the research answer in this conversation (there may be no file diff)"
        : "the git diff of the latest Composer edits";
  return `${MARK}\nLaunch the composer-diff-review subagent now (model grok-4.7-high: Grok 4.7, effort High, Fast off, context 256k). Give it ${target}. It is read-only. Wait for its full reply. Do not edit or revise during the review. If the reply starts with VERDICT: PASS, stop. If it starts with VERDICT: FAIL, stop without changing anything so the fix list can be sent back to you.`;
}

/**
 * @param {"" | "code" | "research" | "both"} subject
 * @param {string} feedback
 */
function fixFollowup(subject, feedback) {
  const action =
    subject === "research"
      ? "Revise the research answer to fix every item below."
      : subject === "both"
        ? "Revise the research and update the code to fix every item below."
        : "Update the code to fix every item below.";
  return `${MARK}\nGrok 4.7 (grok-4.7-high, Fast off) is not satisfied. ${action} Then stop so Grok can review the update. Do not launch another review until that update is done.\n\n${feedback}`;
}

const CAP_FOLLOWUP = `${MARK}\nGrok 4.7 (grok-4.7-high, Fast off) reviewed this 6 times without a pass. Stop the loop and report the remaining defects. Do not launch another review.`;

/**
 * Research about how to change the program. The hook's own follow-ups are marked and ignored.
 * @param {string} text
 */
export function isResearchPrompt(text) {
  const raw = String(text || "");
  if (raw.includes(MARK)) return false;
  const s = raw.toLowerCase();
  if (!s.trim()) return false;
  if (/\bresearch\b/.test(s)) return true;
  if (/\b(investigate|recommendation)\b/.test(s)) return true;
  if (/\brecommend\b/.test(s) && /\b(updat|chang|improv|fix|approach)/.test(s)) return true;
  if (/\bhow\b/.test(s) && /\b(updat|chang|improv|fix)/.test(s)) return true;
  if (/\b(what should|what can) we\b/.test(s) && /\b(updat|chang|improv|build|fix)/.test(s)) return true;
  return false;
}

/**
 * @param {string} text
 * @returns {"PASS" | "FAIL" | ""}
 */
export function extractVerdict(text) {
  const matches = [...String(text || "").matchAll(/VERDICT:\s*(PASS|FAIL)/gi)];
  if (matches.length === 0) return "";
  return matches[matches.length - 1][1].toUpperCase() === "PASS" ? "PASS" : "FAIL";
}

/**
 * @param {string} text
 */
export function clipFeedback(text) {
  const trimmed = String(text || "").trim();
  if (trimmed.length <= 1500) return trimmed;
  return trimmed.slice(0, 1500);
}

/**
 * @returns {{
 *   needsReview: boolean,
 *   subject: "" | "code" | "research" | "both",
 *   awaitingRevision: boolean,
 *   revisionReady: boolean,
 *   verdict: "" | "PASS" | "FAIL",
 *   feedback: string,
 *   rounds: number,
 *   capped: boolean
 * }}
 */
export function emptyState() {
  return {
    needsReview: false,
    subject: "",
    awaitingRevision: false,
    revisionReady: false,
    verdict: "",
    feedback: "",
    rounds: 0,
    capped: false,
  };
}

/**
 * @param {"code" | "research"} kind
 * @param {"" | "code" | "research" | "both"} current
 * @returns {"" | "code" | "research" | "both"}
 */
function addSubject(kind, current) {
  if (!current || current === kind) return kind;
  return "both";
}

/**
 * @param {Record<string, unknown>} input
 * @param {ReturnType<typeof emptyState>} state
 */
export function decide(input, state) {
  const event = String(input.hook_event_name || "");
  if (event === "beforeSubmitPrompt") {
    return isResearchPrompt(String(input.prompt || "")) ? { action: "mark-research" } : { action: "noop" };
  }
  if (event === "afterFileEdit") {
    return isComposer(input) ? { action: "mark-code" } : { action: "noop" };
  }
  if (event === "afterAgentResponse") {
    return state.awaitingRevision && isComposer(input) ? { action: "mark-revision" } : { action: "noop" };
  }
  if (event === "subagentStop") {
    if (!isGrokHighFastOff(input)) return { action: "noop" };
    const text = `${input.summary || ""}\n${input.reviewFeedback || ""}`;
    const parsed = String(input.reviewVerdict || extractVerdict(text) || "FAIL").toUpperCase();
    const verdict = parsed === "PASS" ? "PASS" : "FAIL";
    return {
      action: "record-review",
      verdict,
      feedback: clipFeedback(String(input.reviewFeedback || input.summary || "")),
    };
  }
  if (event === "stop") {
    const status = String(input.status || "");
    if (status !== "completed" || !isComposer(input) || state.capped) return { action: "noop" };
    if (state.verdict === "PASS" && !state.needsReview && !state.revisionReady) return { action: "noop" };
    if (state.rounds >= MAX_ROUNDS && state.verdict !== "PASS" && (state.needsReview || state.revisionReady)) {
      return { action: "cap", followup_message: CAP_FOLLOWUP };
    }
    if (state.needsReview || state.revisionReady) {
      return { action: "followup", kind: "review", followup_message: reviewFollowup(state.subject) };
    }
    if (state.verdict === "FAIL") {
      return { action: "followup", kind: "fix", followup_message: fixFollowup(state.subject, state.feedback) };
    }
  }
  return { action: "noop" };
}

/**
 * @param {ReturnType<typeof emptyState>} state
 * @param {ReturnType<typeof decide>} decision
 */
export function apply(state, decision) {
  if (decision.action === "mark-research") {
    return {
      ...state,
      needsReview: true,
      subject: addSubject("research", state.subject),
      verdict: state.verdict === "PASS" ? "" : state.verdict,
      capped: false,
      awaitingRevision: false,
      revisionReady: false,
    };
  }
  if (decision.action === "mark-code") {
    return {
      ...state,
      needsReview: true,
      subject: addSubject("code", state.subject),
      verdict: state.verdict === "PASS" ? "" : state.verdict,
      capped: false,
      awaitingRevision: false,
      revisionReady: false,
    };
  }
  if (decision.action === "mark-revision") {
    return { ...state, revisionReady: true };
  }
  if (decision.action === "record-review") {
    return {
      ...state,
      needsReview: false,
      revisionReady: false,
      awaitingRevision: false,
      verdict: decision.verdict,
      feedback: decision.feedback,
      rounds: state.rounds + 1,
    };
  }
  if (decision.action === "followup" && decision.kind === "fix") {
    return { ...state, awaitingRevision: true, needsReview: false, revisionReady: false };
  }
  if (decision.action === "followup" && decision.kind === "review") {
    return { ...state, needsReview: true, revisionReady: false, awaitingRevision: false };
  }
  if (decision.action === "cap") return { ...state, capped: true };
  return state;
}

/**
 * @param {Record<string, unknown>} input
 */
export function isComposer(input) {
  return modelText(input).includes("composer");
}

/**
 * grok-4.7-high is effort High and Fast off. The -fast slug does not count.
 * @param {Record<string, unknown>} input
 */
export function isGrokHighFastOff(input) {
  const text = modelText(input);
  if (text.includes("-fast") || fastParam(input) === "true") return false;
  if (text.includes("grok-4.7-high")) return true;
  return text.includes("grok-4.7") && effortParam(input) === "high" && fastParam(input) !== "true";
}

/**
 * @param {Record<string, unknown>} input
 */
function modelText(input) {
  return [input.model, input.model_id, input.subagent_model].filter(Boolean).join(" ").toLowerCase();
}

/**
 * @param {Record<string, unknown>} input
 * @param {string} id
 */
function param(input, id) {
  const params = input.model_params;
  if (!Array.isArray(params)) return "";
  const found = params.find((item) => item && typeof item === "object" && item.id === id);
  return found ? String(found.value).toLowerCase() : "";
}

/** @param {Record<string, unknown>} input */
function fastParam(input) {
  return param(input, "fast");
}

/** @param {Record<string, unknown>} input */
function effortParam(input) {
  return param(input, "effort");
}

/**
 * @param {string} conversationId
 */
export function statePath(conversationId) {
  const safe = String(conversationId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(tmpdir(), "stageverify-grok-review", safe + ".json");
}

/**
 * @param {string} file
 */
function readState(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const base = emptyState();
    if (parsed.needsReview !== undefined || parsed.subject !== undefined || parsed.rounds !== undefined) {
      const verdict = parsed.verdict === "PASS" || parsed.verdict === "FAIL" ? parsed.verdict : "";
      const subject = parsed.subject === "code" || parsed.subject === "research" || parsed.subject === "both" ? parsed.subject : "";
      return {
        ...base,
        needsReview: parsed.needsReview === true || parsed.dirty === true,
        subject: subject || (parsed.dirty === true ? "code" : ""),
        awaitingRevision: parsed.awaitingRevision === true,
        revisionReady: parsed.revisionReady === true,
        verdict,
        feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
        rounds: Number(parsed.rounds) || 0,
        capped: parsed.capped === true,
      };
    }
    if (parsed.dirty !== undefined || parsed.verdict !== undefined) {
      const verdict = parsed.verdict === "PASS" || parsed.verdict === "FAIL" ? parsed.verdict : "";
      return {
        ...base,
        needsReview: parsed.dirty === true,
        subject: parsed.dirty === true ? "code" : "",
        verdict,
        feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
        rounds: Number(parsed.rounds) || 0,
        capped: parsed.capped === true,
      };
    }
    return {
      ...base,
      needsReview: parsed.edited === true && parsed.reviewed !== true,
      subject: parsed.edited === true ? "code" : "",
      verdict: parsed.reviewed === true ? "PASS" : "",
      rounds: parsed.reviewed === true ? 1 : 0,
    };
  } catch {
    return emptyState();
  }
}

/**
 * @param {string} file
 * @param {ReturnType<typeof emptyState>} state
 */
/**
 * @param {string} file
 * @param {ReturnType<typeof emptyState>} state
 */
function writeStateFile(file, state) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(state));
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

/**
 * @param {Record<string, unknown>} input
 */
function withReviewText(input) {
  if (String(input.hook_event_name || "") !== "subagentStop") return input;
  let transcript = "";
  if (typeof input.agent_transcript_path === "string" && input.agent_transcript_path) {
    try {
      transcript = readFileSync(input.agent_transcript_path, "utf8").slice(-20000);
    } catch {
      transcript = "";
    }
  }
  const reviewFeedback = `${input.summary || ""}\n${transcript}`.trim();
  return { ...input, reviewFeedback, reviewVerdict: extractVerdict(reviewFeedback) };
}

async function main() {
  let input = {};
  try {
    input = await readStdin();
  } catch {
    process.stdout.write("{}\n");
    return;
  }
  const file = statePath(String(input.conversation_id || ""));
  const state = readState(file);
  const decision = decide(withReviewText(input), state);
  if (decision.action !== "noop") writeStateFile(file, apply(state, decision));
  if (decision.action === "followup" || decision.action === "cap") {
    process.stdout.write(JSON.stringify({ followup_message: decision.followup_message }) + "\n");
    return;
  }
  if (String(input.hook_event_name || "") === "beforeSubmitPrompt") {
    process.stdout.write(JSON.stringify({ continue: true }) + "\n");
    return;
  }
  process.stdout.write("{}\n");
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main();
}

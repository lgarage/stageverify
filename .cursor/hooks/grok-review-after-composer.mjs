#!/usr/bin/env node
// Composer edits, then grok-4.7-high reviews. A FAIL verdict is handed back
// to Composer. Composer updates the code. Grok reviews again until PASS.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_ROUNDS = 6;

const REVIEW_FOLLOWUP =
  "Launch the composer-diff-review subagent now (model grok-4.7-high: Grok 4.7, effort High, Fast off, context 256k). Give it the git diff of the latest Composer edits. It is read-only. Wait for its full reply. Do not edit during the review. If the reply starts with VERDICT: PASS, stop. If it starts with VERDICT: FAIL, stop without editing so the fix list can be sent back to you.";

/**
 * @param {string} feedback
 */
function fixFollowup(feedback) {
  return (
    "Grok 4.7 (grok-4.7-high, Fast off) is not satisfied. Update the code to fix every item below. Then stop so Grok can review the update. Do not launch another review until those edits are saved.\n\n" +
    feedback
  );
}

const CAP_FOLLOWUP =
  "Grok 4.7 (grok-4.7-high, Fast off) reviewed this 6 times without a pass. Stop the loop and report the remaining defects. Do not launch another review.";

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
 * @returns {{ dirty: boolean, verdict: "" | "PASS" | "FAIL", feedback: string, rounds: number, capped: boolean }}
 */
export function emptyState() {
  return { dirty: false, verdict: "", feedback: "", rounds: 0, capped: false };
}

/**
 * @param {Record<string, unknown>} input
 * @param {ReturnType<typeof emptyState>} state
 */
export function decide(input, state) {
  const event = String(input.hook_event_name || "");
  if (event === "afterFileEdit") {
    return isComposer(input) ? { action: "mark-dirty" } : { action: "noop" };
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
    if (state.verdict === "PASS" && !state.dirty) return { action: "noop" };
    if (state.rounds >= MAX_ROUNDS && state.verdict !== "PASS") {
      return { action: "cap", followup_message: CAP_FOLLOWUP };
    }
    if (state.dirty) return { action: "followup", followup_message: REVIEW_FOLLOWUP };
    if (state.verdict === "FAIL") return { action: "followup", followup_message: fixFollowup(state.feedback) };
  }
  return { action: "noop" };
}

/**
 * @param {ReturnType<typeof emptyState>} state
 * @param {ReturnType<typeof decide>} decision
 */
export function apply(state, decision) {
  if (decision.action === "mark-dirty") {
    return { ...state, dirty: true, verdict: state.verdict === "PASS" ? "" : state.verdict, capped: false };
  }
  if (decision.action === "record-review") {
    return {
      ...state,
      dirty: false,
      verdict: decision.verdict,
      feedback: decision.feedback,
      rounds: state.rounds + 1,
    };
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
    if (parsed.verdict !== undefined || parsed.dirty !== undefined || parsed.rounds !== undefined) {
      const verdict = parsed.verdict === "PASS" || parsed.verdict === "FAIL" ? parsed.verdict : "";
      return {
        dirty: parsed.dirty === true,
        verdict,
        feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
        rounds: Number(parsed.rounds) || 0,
        capped: parsed.capped === true,
      };
    }
    return {
      dirty: parsed.edited === true && parsed.reviewed !== true,
      verdict: parsed.reviewed === true ? "PASS" : "",
      feedback: "",
      rounds: parsed.reviewed === true ? 1 : 0,
      capped: false,
    };
  } catch {
    return emptyState();
  }
}

/**
 * @param {string} file
 * @param {ReturnType<typeof emptyState>} state
 */
function writeState(file, state) {
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
      const raw = readFileSync(input.agent_transcript_path, "utf8");
      transcript = raw.slice(-20000);
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
  if (decision.action === "mark-dirty" || decision.action === "record-review" || decision.action === "cap") {
    writeState(file, apply(state, decision));
  }
  if (decision.action === "followup" || decision.action === "cap") {
    process.stdout.write(JSON.stringify({ followup_message: decision.followup_message }) + "\n");
    return;
  }
  process.stdout.write("{}\n");
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main();
}

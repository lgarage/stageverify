#!/usr/bin/env node
// After Composer edits files, the stop hook submits one follow-up that
// launches the composer-diff-review subagent (grok-4.7-high: effort High, Fast off).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const FOLLOWUP =
  "Composer edited files and grok-4.7-high has not reviewed them. Launch the composer-diff-review subagent now (model grok-4.7-high: Grok 4.7, effort High, Fast off, context 256k). Give it the git diff of this task. It is read-only. Wait for its verdict, put the verdict in your reply, then stop.";

/**
 * @param {Record<string, unknown>} input
 * @param {{ edited: boolean, reviewed: boolean }} state
 */
export function decide(input, state) {
  const event = String(input.hook_event_name || "");
  if (event === "afterFileEdit") {
    return isComposer(input) ? { action: "mark-edited" } : { action: "noop" };
  }
  if (event === "subagentStop") {
    return isGrokHighFastOff(input) ? { action: "mark-reviewed" } : { action: "noop" };
  }
  if (event === "stop") {
    const status = String(input.status || "");
    const loopCount = Number(input.loop_count || 0);
    if (status === "completed" && isComposer(input) && state.edited && !state.reviewed && loopCount === 0) {
      return { action: "followup", followup_message: FOLLOWUP };
    }
  }
  return { action: "noop" };
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
    return { edited: parsed.edited === true, reviewed: parsed.reviewed === true };
  } catch {
    return { edited: false, reviewed: false };
  }
}

/**
 * @param {string} file
 * @param {{ edited: boolean, reviewed: boolean }} state
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
  const decision = decide(input, state);
  if (decision.action === "mark-edited") writeState(file, { ...state, edited: true });
  if (decision.action === "mark-reviewed") writeState(file, { ...state, reviewed: true });
  if (decision.action === "followup") {
    process.stdout.write(JSON.stringify({ followup_message: decision.followup_message }) + "\n");
    return;
  }
  process.stdout.write("{}\n");
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main();
}

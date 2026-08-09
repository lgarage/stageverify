#!/usr/bin/env node
/**
 * StageVerify Timekeeper — Cursor hook entrypoint (advise-only).
 *
 * Reads JSON from stdin, updates per-conversation state on disk, writes JSON to stdout.
 * Fail-open: on any error, emit {} so the agent loop continues.
 *
 * Cloud note: sessionStart is unavailable — lazy-init on first hook using conversation_id.
 */

import { loadState, saveState } from "./lib/state.mjs";
import { evaluate, buildHookResponse } from "./lib/decisions.mjs";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text);
}

function resolveHookName(input) {
  return (
    input.hook_event_name ||
    input.hook ||
    process.env.CURSOR_HOOK_EVENT_NAME ||
    ""
  );
}

async function main() {
  let input = {};
  try {
    input = await readStdin();
  } catch {
    process.stdout.write("{}\n");
    return;
  }

  try {
    const hook = resolveHookName(input);
    input.hook_event_name = hook;
    const conversationId =
      input.conversation_id ||
      input.session_id ||
      input.parent_conversation_id ||
      "unknown";
    const workspaceRoots = Array.isArray(input.workspace_roots)
      ? input.workspace_roots
      : [process.cwd()];
    const now = Date.now();

    const state = loadState(conversationId, workspaceRoots, now);
    // Lazy session start (cloud has no sessionStart hook)
    if (!state._initialized) {
      state._initialized = true;
      if (!state.startedAt) state.startedAt = now;
    }

    const { interventions } = evaluate(state, input, now);
    const response = buildHookResponse(hook, interventions, state, input);
    saveState(state, workspaceRoots);
    process.stdout.write(JSON.stringify(response) + "\n");
  } catch (err) {
    // Fail-open — never block the agent on timekeeper bugs
    try {
      process.stderr.write(`[timekeeper] ${err?.stack || err}\n`);
    } catch {
      /* ignore */
    }
    process.stdout.write("{}\n");
  }
}

main();

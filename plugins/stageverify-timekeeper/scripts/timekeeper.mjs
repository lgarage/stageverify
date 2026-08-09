#!/usr/bin/env node
/**
 * StageVerify Timekeeper — Cursor hook entrypoint (advise-only).
 *
 * Reads JSON from stdin, updates per-conversation state on disk, writes JSON to stdout.
 * Fail-open: on any error, emit {} so the agent loop continues.
 *
 * Cloud note: sessionStart is unavailable — lazy-init on first hook using conversation_id.
 *
 * Delivery: elapsed/event interventions are queued as pending and marked delivered only
 * after a reliable agent-visible hook builds a response with advice fields
 * (additional_context / agent_message / followup_message). Platform does not ack receipt.
 */

import { loadState, saveState, appendTrace, elapsedMs, isReliableDeliveryHook } from "./lib/state.mjs";
import {
  evaluate,
  buildHookResponse,
  responseCarriesAdvice,
} from "./lib/decisions.mjs";

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

    const beforeDelivery = { ...(state.delivery || {}) };
    const { interventions, pendingOnly } = evaluate(state, input, now);
    const response = buildHookResponse(hook, interventions, state, input);

    // Safety: if somehow marked delivered without a carry field, do not persist false delivery.
    // (evaluate only marks on reliable hooks that always attach a field when interventions≠[].)
    if (interventions.length && !responseCarriesAdvice(response) && isReliableDeliveryHook(hook)) {
      for (const i of interventions) {
        const prev = beforeDelivery[i.kind];
        if (prev) state.delivery[i.kind] = prev;
        else if (state.delivery?.[i.kind]) {
          state.delivery[i.kind] = {
            ...state.delivery[i.kind],
            status: "pending",
            deliveredAt: null,
          };
        }
      }
    }

    appendTrace(workspaceRoots, {
      ts: now,
      conversation_id: conversationId,
      hook,
      reliable: isReliableDeliveryHook(hook),
      elapsed_ms: elapsedMs(state.startedAt, now),
      progress_age_ms: now - state.lastProgressAt,
      pending_only: Boolean(pendingOnly),
      delivered_kinds: interventions.map((i) => i.kind),
      delivery_snapshot: Object.fromEntries(
        Object.entries(state.delivery || {}).map(([k, v]) => [k, v?.status])
      ),
    });

    saveState(state, workspaceRoots);
    process.stdout.write(JSON.stringify(response) + "\n");
  } catch (err) {
    // Fail-open — never block the agent on timekeeper bugs; do not save partial marks
    try {
      process.stderr.write(`[timekeeper] ${err?.stack || err}\n`);
    } catch {
      /* ignore */
    }
    process.stdout.write("{}\n");
  }
}

main();

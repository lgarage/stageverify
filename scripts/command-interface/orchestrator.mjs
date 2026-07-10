/**
 * Transport-agnostic command interface orchestrator.
 */
import { routeIntent } from "./intentRouter.mjs";
import { executeIntent, formatProgressEvent } from "./harnessBridge.mjs";
import { recordTurn, getRecentTurns } from "./conversation.mjs";

/** @typedef {import('./types.mjs').Transport} Transport */
/** @typedef {import('./types.mjs').IncomingMessage} IncomingMessage */

/**
 * @param {string | undefined} userId
 * @param {Record<string, string | undefined>} [env]
 */
export function isAllowedSlackUser(userId, env = process.env) {
  if (!userId) return false;
  const raw =
    env.STAGEVERIFY_SLACK_ALLOWED_USER_IDS ?? "U0B47NC4A9L";
  const allowed = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(userId);
}

/**
 * @param {Transport} transport
 * @param {IncomingMessage} message
 * @param {Record<string, string | undefined>} [env]
 */
export async function handleIncoming(transport, message, env = process.env) {
  if (!isAllowedSlackUser(message.userId, env)) {
    console.log(`[command] ignored message from ${message.userId ?? "unknown"}`);
    return null;
  }
  recordTurn("user", message.text);
  const routed = routeIntent(message.text, getRecentTurns());
  const response = await executeIntent(routed);
  recordTurn("assistant", response.text, response.intent);

  await transport.send({
    text: response.text,
    threadId: message.id,
  });

  return { routed, response };
}

/**
 * @param {Transport} transport
 * @param {'task_started' | 'review_running' | 'repair_required' | 'repair_complete' | 'waiting_approval' | 'completed' | 'listening'} event
 * @param {string} [detail]
 */
export async function sendProgress(transport, event, detail) {
  const text = formatProgressEvent(event, detail);
  await transport.send({ text });
}

/**
 * @param {Transport} transport
 * @param {number} pollIntervalMs
 */
export async function runLoop(transport, pollIntervalMs = 8000) {
  await transport.connect();
  await sendProgress(transport, "listening");

  const seen = new Set();

  const tick = async () => {
    try {
      const messages = await transport.poll();
      for (const msg of messages) {
        if (seen.has(msg.id)) continue;
        seen.add(msg.id);
        if (seen.size > 200) {
          const arr = [...seen];
          seen.clear();
          arr.slice(-100).forEach((id) => seen.add(id));
        }
        console.log(`[command] ← ${msg.text.slice(0, 80)}`);
        const result = await handleIncoming(transport, msg);
        console.log(`[command] → ${result.routed.type} (${result.routed.confidence})`);
      }
    } catch (err) {
      console.error("[command] poll error:", err instanceof Error ? err.message : err);
    }
  };

  await tick();
  const timer = setInterval(tick, pollIntervalMs);
  return () => clearInterval(timer);
}

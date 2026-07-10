/**
 * Slack transport — uses Slack Web API (same bot token as Cursor user-slack MCP).
 * No Slack-specific logic outside this file.
 */
import { getLastSlackTs, rememberLastSlackTs } from "./harnessBridge.mjs";

/** @typedef {import('./types.mjs').Transport} Transport */
/** @typedef {import('./types.mjs').IncomingMessage} IncomingMessage */
/** @typedef {import('./types.mjs').OutgoingMessage} OutgoingMessage */

const API = "https://slack.com/api";

/**
 * @param {string} token
 * @param {string} method
 * @param {Record<string, string>} [params]
 */
async function slackApi(token, method, params = {}) {
  const body = new URLSearchParams(params);
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Slack ${method}: ${data.error ?? "unknown_error"}`);
  }
  return data;
}

/**
 * @param {object} config
 * @param {string} config.token
 * @param {string} config.channelId
 * @param {string} [config.botUserId]
 * @returns {Transport}
 */
export function createSlackTransport({ token, channelId, botUserId }) {
  /** @type {string | undefined} */
  let cursorTs;

  return {
    name: "slack",

    async connect() {
      const data = await slackApi(token, "auth.test");
      if (botUserId && data.user_id !== botUserId) {
        console.warn(
          `Slack bot user ${data.user_id} differs from STAGEVERIFY_SLACK_BOT_USER_ID`,
        );
      }
      cursorTs = getLastSlackTs();
    },

    async poll() {
      const params = {
        channel: channelId,
        limit: "20",
        inclusive: "false",
      };
      if (cursorTs) params.oldest = cursorTs;

      const data = await slackApi(token, "conversations.history", params);
      const messages = /** @type {Array<{ ts: string; text?: string; user?: string; bot_id?: string }>} */ (
        data.messages ?? []
      );

      const incoming = [];
      for (const msg of messages.reverse()) {
        if (!msg.text?.trim()) continue;
        if (msg.bot_id) continue;
        if (botUserId && msg.user === botUserId) continue;
        incoming.push({
          id: msg.ts,
          text: msg.text.trim(),
          userId: msg.user,
          timestamp: Number.parseFloat(msg.ts),
        });
        cursorTs = msg.ts;
      }

      if (cursorTs) rememberLastSlackTs(cursorTs);
      return incoming;
    },

    async send(message) {
      const params = {
        channel: channelId,
        text: message.text,
      };
      if (message.threadId) params.thread_ts = message.threadId;

      await slackApi(token, "chat.postMessage", params);
    },
  };
}

/**
 * Load Slack config from environment (.env.local supported by runner).
 * @param {Record<string, string | undefined>} env
 */
export function loadSlackConfig(env = process.env) {
  const token =
    env.STAGEVERIFY_SLACK_BOT_TOKEN ?? env.SLACK_BOT_TOKEN ?? "";
  const channelId =
    env.STAGEVERIFY_SLACK_CHANNEL_ID ?? env.SLACK_CHANNEL_ID ?? "";
  const botUserId = env.STAGEVERIFY_SLACK_BOT_USER_ID ?? "";

  if (!token) {
    throw new Error(
      "Missing STAGEVERIFY_SLACK_BOT_TOKEN (same token as user-slack MCP bot).",
    );
  }
  if (!channelId) {
    throw new Error(
      "Missing STAGEVERIFY_SLACK_CHANNEL_ID (e.g. C0B43DJPMS7 for #general).",
    );
  }

  return { token, channelId, botUserId };
}

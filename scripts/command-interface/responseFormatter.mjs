/**
 * DONE / NOW / DECIDE / NEXT response formatter.
 */

/** @typedef {import('./types.mjs').FormattedResponse} FormattedResponse */

/**
 * @param {Record<string, string>} sections
 * @param {import('./types.mjs').IntentType} intent
 * @returns {FormattedResponse}
 */
export function formatDigest(sections, intent) {
  const lines = [];
  for (const key of ["DONE", "NOW", "DECIDE", "NEXT"]) {
    const value = sections[key];
    if (value?.trim()) lines.push(`${key}: ${value.trim()}`);
  }
  return { text: lines.join("\n"), intent };
}

/**
 * @param {string} body
 * @param {import('./types.mjs').IntentType} intent
 * @returns {FormattedResponse}
 */
export function formatPlain(body, intent) {
  return { text: body.trim(), intent };
}

/**
 * @param {string[]} options
 * @returns {FormattedResponse}
 */
export function formatClarification(options) {
  const list = options.map((o) => `• ${o}`).join("\n");
  return {
    text: `I didn't catch that clearly. Did you mean:\n${list}\n\nReply in plain language — no slash commands needed.`,
    intent: "clarify",
  };
}

/**
 * In-process conversation memory (transient — not authoritative).
 */

/** @typedef {import('./types.mjs').ConversationTurn} ConversationTurn */

const MAX_TURNS = 12;

/** @type {ConversationTurn[]} */
let turns = [];

/**
 * @param {'user' | 'assistant'} role
 * @param {string} text
 * @param {string} [intent]
 */
export function recordTurn(role, text, intent) {
  turns.push({ role, text, intent, at: Date.now() });
  if (turns.length > MAX_TURNS) {
    turns = turns.slice(-MAX_TURNS);
  }
}

/** @returns {ConversationTurn[]} */
export function getRecentTurns() {
  return [...turns];
}

export function clearTurns() {
  turns = [];
}

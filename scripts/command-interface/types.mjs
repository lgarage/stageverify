/**
 * Command Interface Layer — transport-agnostic types (Phase 0).
 * Slack is the first transport; do not import Slack-specific types here.
 */

/** @typedef {'incoming' | 'outgoing'} MessageDirection */

/**
 * @typedef {object} IncomingMessage
 * @property {string} id
 * @property {string} text
 * @property {string} [userId]
 * @property {string} [userName]
 * @property {number} [timestamp]
 */

/**
 * @typedef {object} OutgoingMessage
 * @property {string} text
 * @property {string} [threadId]
 */

/**
 * @typedef {object} Transport
 * @property {string} name
 * @property {() => Promise<void>} connect
 * @property {() => Promise<IncomingMessage[]>} poll
 * @property {(message: OutgoingMessage) => Promise<void>} send
 * @property {() => Promise<void>} [disconnect]
 */

/**
 * @typedef {object} ConversationTurn
 * @property {'user' | 'assistant'} role
 * @property {string} text
 * @property {string} [intent]
 * @property {number} at
 */

/**
 * @typedef {(
 *   | 'status'
 *   | 'blockers'
 *   | 'phase_summary'
 *   | 'review_failed'
 *   | 'what_changed'
 *   | 'next_decision'
 *   | 'explain_wait'
 *   | 'pause'
 *   | 'resume'
 *   | 'help'
 *   | 'clarify'
 *   | 'unsupported'
 * )} IntentType
 */

/**
 * @typedef {object} RoutedIntent
 * @property {IntentType} type
 * @property {number} confidence
 * @property {string} [detail]
 * @property {boolean} [pauseAfterCurrentTask]
 */

/**
 * @typedef {object} FormattedResponse
 * @property {string} text
 * @property {IntentType} intent
 */

/**
 * @typedef {object} CommandInterfaceControl
 * @property {boolean} paused
 * @property {boolean} pauseAfterCurrentTask
 * @property {string} [updatedAt]
 * @property {string} [lastSlackTs]
 */

export {};

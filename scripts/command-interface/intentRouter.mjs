/**
 * Natural-language intent router — maps utterances to existing harness behaviors.
 * Low confidence → clarify (never guess).
 */

/** @typedef {import('./types.mjs').RoutedIntent} RoutedIntent */
/** @typedef {import('./types.mjs').ConversationTurn} ConversationTurn */

/** @type {Array<{ patterns: RegExp[]; type: import('./types.mjs').IntentType; confidence: number; pauseAfterCurrentTask?: boolean }>} */
const RULES = [
  {
    patterns: [
      /\b(continue|resume|unpause|go ahead)\b/i,
      /^go$/i,
    ],
    type: "resume",
    confidence: 0.92,
  },
  {
    patterns: [
      /\b(pause after (this )?task|stop after (this )?task)\b/i,
    ],
    type: "pause",
    confidence: 0.94,
    pauseAfterCurrentTask: true,
  },
  {
    patterns: [/\b(pause|hold)\b/i],
    type: "pause",
    confidence: 0.88,
  },
  {
    patterns: [
      /\bwhat review failed\b/i,
      /\breview failed\b/i,
      /\bwhat does grok think\b/i,
      /\bsecurity gate\b/i,
      /\bship.?verifier\b/i,
    ],
    type: "review_failed",
    confidence: 0.9,
  },
  {
    patterns: [
      /\bwhat(?:'s| is) blocking\b/i,
      /\bblockers?\b/i,
      /\bwhat(?:'s| is) in the way\b/i,
      /\bstuck\b/i,
    ],
    type: "blockers",
    confidence: 0.9,
  },
  {
    patterns: [
      /\bwhat(?:'re| are) you (doing|working on)\b/i,
      /\bwhat are you working on\b/i,
      /\btoday(?:'s)? status\b/i,
      /\bshow me (the )?status\b/i,
      /\bcurrent status\b/i,
      /\bwhat(?:'s| is) happening\b/i,
    ],
    type: "status",
    confidence: 0.9,
  },
  {
    patterns: [
      /\bsummarize (the )?current phase\b/i,
      /\bcurrent phase\b/i,
      /\bwhat phase\b/i,
    ],
    type: "phase_summary",
    confidence: 0.88,
  },
  {
    patterns: [
      /\bwhat changed\b/i,
      /\bwhat(?:'s| is) new\b/i,
      /\brecent commits?\b/i,
    ],
    type: "what_changed",
    confidence: 0.86,
  },
  {
    patterns: [
      /\bnext decision\b/i,
      /\bwhat do i need to (decide|approve)\b/i,
      /\bwaiting for (my )?approval\b/i,
      /\bwhat(?:'s| is) the next decision\b/i,
    ],
    type: "next_decision",
    confidence: 0.88,
  },
  {
    patterns: [
      /\bwhy (?:are you |you're )?wait/i,
      /\bexplain why you(?:'re| are) waiting\b/i,
      /\bwhy waiting\b/i,
    ],
    type: "explain_wait",
    confidence: 0.9,
  },
  {
    patterns: [/\bhelp\b/i, /\bwhat can you do\b/i, /\bcommands?\b/i],
    type: "help",
    confidence: 0.85,
  },
  {
    patterns: [
      /\b(deploy|ship it|push to prod|implement|build|write code|approve cf)\b/i,
    ],
    type: "unsupported",
    confidence: 0.95,
  },
];

const CLARIFY_THRESHOLD = 0.72;

/**
 * @param {string} text
 * @param {ConversationTurn[]} [recentTurns]
 * @returns {RoutedIntent}
 */
export function routeIntent(text, recentTurns = []) {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return { type: "clarify", confidence: 0, detail: "empty_message" };
  }

  let best = /** @type {RoutedIntent} */ ({
    type: "clarify",
    confidence: 0,
    detail: "no_match",
  });

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(normalized)) {
        if (rule.confidence > best.confidence) {
          best = {
            type: rule.type,
            confidence: rule.confidence,
            pauseAfterCurrentTask: rule.pauseAfterCurrentTask,
          };
        }
      }
    }
  }

  if (best.confidence < CLARIFY_THRESHOLD) {
    const lastIntent = [...recentTurns]
      .reverse()
      .find((t) => t.role === "assistant" && t.intent)?.intent;
    if (lastIntent && /^(what about|and that|more on|elaborate)/i.test(normalized)) {
      return { type: lastIntent, confidence: 0.75, detail: "follow_up" };
    }
    return {
      type: "clarify",
      confidence: best.confidence,
      detail: `heard: "${normalized.slice(0, 120)}"`,
    };
  }

  return best;
}

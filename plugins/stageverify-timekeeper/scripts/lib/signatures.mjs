/**
 * Normalize shell/tool command text into a stable signature for thrash detection.
 * Strips drifting paths, timestamps, and whitespace noise.
 */

const PATH_RE = /(?:\/[\w.-]+){2,}/g;
const WIN_PATH_RE = /[A-Za-z]:\\(?:[\w.-]+\\)+[\w.-]+/g;
const ISO_TS_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g;
const HEX_LONG_RE = /\b[a-f0-9]{12,}\b/gi;
const WS_RE = /\s+/g;

/**
 * @param {string | undefined | null} command
 * @returns {string}
 */
export function normalizeCommandSignature(command) {
  if (!command || typeof command !== "string") return "";
  let s = command.trim();
  s = s.replace(WIN_PATH_RE, "<path>");
  s = s.replace(PATH_RE, "<path>");
  s = s.replace(ISO_TS_RE, "<ts>");
  s = s.replace(HEX_LONG_RE, "<hex>");
  s = s.replace(WS_RE, " ");
  // Collapse quoted args that are only paths already replaced
  s = s.replace(/["']<path>["']/g, "<path>");
  return s.slice(0, 240);
}

/**
 * Extract a stable npm script name when present.
 * @param {string} command
 * @returns {string | null}
 */
export function extractNpmScript(command) {
  if (!command) return null;
  const m = command.match(/\bnpm\s+run\s+([^\s]+)/);
  return m ? m[1] : null;
}

/**
 * Heuristic: did output look like success?
 * afterShellExecution does not expose exit code — use output heuristics.
 * @param {string | undefined | null} output
 * @returns {'pass' | 'fail' | 'unknown'}
 */
export function classifyOutputOutcome(output) {
  if (output == null || output === "") return "unknown";
  const text = String(output);
  const lower = text.toLowerCase();
  if (
    /\b(exit code[=:]?\s*[1-9]\d*|failed|fail\b|timed?\s*out|timeout|econnreset|enotfound)\b/i.test(
      text
    ) ||
    /\bFAIL\b/.test(text) ||
    /\berror\b/i.test(text) ||
    /Error:/.test(text)
  ) {
    // Prefer fail if both — but green verify scripts often print PASS after prior FAIL mentions
    if (/\bPASS\b/.test(text) && !/\bFAIL\b/.test(text) && !/timed?\s*out/i.test(text)) {
      return "pass";
    }
    return "fail";
  }
  if (
    /\bPASS\b/.test(text) ||
    /\ball tests passed\b/i.test(lower) ||
    /\bbuild succeeded\b/i.test(lower) ||
    /\b✓\b/.test(text)
  ) {
    return "pass";
  }
  return "unknown";
}

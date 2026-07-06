/**
 * Deterministic SV tracking tokens for outbound vendor email (Stage 1).
 * Tokens are random UUIDs — never derived from record ids.
 */
import { randomUUID } from "crypto";

export const TRACKING_SUBJECT_PREFIX = "SV-";

/** Generate a new tracking token (128-bit UUID). */
export function generateTrackingToken(): string {
  return randomUUID();
}

/** Subject tag: [SV-<uuid>] */
export function formatSubjectTag(token: string): string {
  return `[${TRACKING_SUBJECT_PREFIX}${token}]`;
}

/** Prepend subject tag when absent. */
export function subjectWithTrackingTag(subject: string, token: string): string {
  const tag = formatSubjectTag(token);
  if (subject.includes(tag)) return subject;
  return `${tag} ${subject}`.trim();
}

/** Plus-address Reply-To: local+t-<token>@domain (Gmail delivers to base inbox). */
export function buildPlusReplyTo(baseEmail: string, token: string): string {
  const at = baseEmail.lastIndexOf("@");
  if (at <= 0) return baseEmail;
  const local = baseEmail.slice(0, at);
  const domain = baseEmail.slice(at + 1);
  const compact = token.replace(/-/g, "");
  return `${local}+t-${compact}@${domain}`;
}

/** Human-visible body footer (secondary match signal — not load-bearing). */
export function formatBodyTrackingFooter(token: string): string {
  return `\n\n---\nRef: ${TRACKING_SUBJECT_PREFIX}${token}`;
}

const SUBJECT_TOKEN_RE = new RegExp(
  `\\[${TRACKING_SUBJECT_PREFIX}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\]`,
  "i",
);

const PLUS_TOKEN_RE = /\+t-([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@/i;

/** Extract token from subject tag [SV-uuid]. */
export function extractTokenFromSubject(subject: string): string | null {
  const m = subject.match(SUBJECT_TOKEN_RE);
  if (!m?.[1]) return null;
  return normalizeToken(m[1]);
}

/** Extract token from plus-address in To/Cc/Delivered-To. */
export function extractTokenFromAddress(address: string): string | null {
  const m = address.match(PLUS_TOKEN_RE);
  if (!m?.[1]) return null;
  const raw = m[1];
  if (raw.includes("-")) return normalizeToken(raw);
  // 32 hex chars without dashes → rehydrate UUID format for lookup
  if (raw.length === 32) {
    return normalizeToken(
      `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`,
    );
  }
  return null;
}

export function extractTokenFromAddresses(addresses: string[]): string | null {
  for (const addr of addresses) {
    const token = extractTokenFromAddress(addr);
    if (token) return token;
  }
  return null;
}

/** Extract token from body footer Ref: SV-uuid */
export function extractTokenFromBody(body: string): string | null {
  const footerRe = new RegExp(
    `Ref:\\s*${TRACKING_SUBJECT_PREFIX}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`,
    "i",
  );
  const m = body.match(footerRe);
  if (!m?.[1]) return null;
  return normalizeToken(m[1]);
}

function normalizeToken(token: string): string {
  return token.trim().toLowerCase();
}

export function tokensEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return normalizeToken(a) === normalizeToken(b);
}

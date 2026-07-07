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

/** Server footer delimiter — canonical Ref must appear after the last occurrence. */
export const CANONICAL_FOOTER_SEPARATOR = "\n\n---\n";

const TRACKING_UUID_CAPTURE =
  "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";

const FOOTER_REF_RE = new RegExp(
  `Ref:\\s*${TRACKING_SUBJECT_PREFIX}${TRACKING_UUID_CAPTURE}`,
  "gi",
);

/** Human-visible body footer (secondary match signal — not load-bearing). */
export function formatBodyTrackingFooter(token: string): string {
  return `${CANONICAL_FOOTER_SEPARATOR}Ref: ${TRACKING_SUBJECT_PREFIX}${token}`;
}

const DEFAULT_OUTBOUND_SIGNATURE = "Thanks,\nL. Garage Dispatch";

/** True when the user body already ends with a sign-off or tracking footer. */
export function bodyHasSignatureOrFooter(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return false;
  if (
    /Ref:\s*SV-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  if (/\n---(?:\s*\n|\s*$)/.test(trimmed)) return true;
  const tail = trimmed.split("\n").slice(-3).join("\n");
  if (/^(?:thanks|thank you|regards|best|sincerely),?\s*$/im.test(tail)) {
    return true;
  }
  if (/L\.\s*Garage\s+Dispatch/i.test(trimmed)) return true;
  return false;
}

/** User message + optional default signature + Ref footer (Ref always last). */
export function assembleOutboundEmailBody(body: string, token: string): string {
  const trimmed = body.trimEnd();
  const withSignature = bodyHasSignatureOrFooter(trimmed)
    ? trimmed
    : `${trimmed}\n\n${DEFAULT_OUTBOUND_SIGNATURE}`;
  return `${withSignature}${formatBodyTrackingFooter(token)}`;
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

/** Canonical footer zone — after the last `\n\n---\n` server delimiter. */
export function canonicalFooterZone(body: string): string | null {
  const lastIdx = body.lastIndexOf(CANONICAL_FOOTER_SEPARATOR);
  if (lastIdx < 0) return null;
  return body.slice(lastIdx);
}

/** Extract token from canonical server footer only (weak fallback signal). */
export function extractCanonicalFooterTokenFromBody(body: string): string | null {
  const zone = canonicalFooterZone(body);
  if (!zone) return null;
  const m = zone.match(
    new RegExp(`Ref:\\s*${TRACKING_SUBJECT_PREFIX}${TRACKING_UUID_CAPTURE}`, "i"),
  );
  if (!m?.[1]) return null;
  return normalizeToken(m[1]);
}

/** All Ref: SV-uuid tokens outside the canonical footer (quoted/copied/forged). */
export function extractNonCanonicalBodyRefTokens(body: string): string[] {
  const canonical = extractCanonicalFooterTokenFromBody(body);
  const found: string[] = [];
  for (const m of body.matchAll(FOOTER_REF_RE)) {
    const token = normalizeToken(m[1] ?? "");
    if (!token) continue;
    if (canonical && tokensEqual(canonical, token)) continue;
    if (!found.includes(token)) found.push(token);
  }
  return found;
}

/** Extract token from body footer Ref: SV-uuid (canonical zone only). */
export function extractTokenFromBody(body: string): string | null {
  return extractCanonicalFooterTokenFromBody(body);
}

function normalizeToken(token: string): string {
  return token.trim().toLowerCase();
}

export function tokensEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return normalizeToken(a) === normalizeToken(b);
}

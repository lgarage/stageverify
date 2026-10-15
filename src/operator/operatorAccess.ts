/**
 * PROTOTYPE-ONLY CLIENT GATE — NOT A SECURITY BOUNDARY.
 *
 * This module is for local/dev operator-console prototyping only. It does NOT
 * enforce security. Hiding a menu item or route in the UI is not security —
 * users can still attempt direct URL navigation. Direct URL manipulation must
 * NOT be assumed safe; production must enforce access server-side.
 *
 * Allowlist source: VITE_OPERATOR_ALLOWED_EMAILS (comma-separated; vite .env.local).
 * Empty or unset VITE_OPERATOR_ALLOWED_EMAILS fail-closed: deny everyone.
 *
 * Production must use server-side operator claims and callable auth — not this
 * client allowlist. The operator localStorage store (operatorStore) is not
 * production-secure persistence.
 */

export function normalizeOperatorAllowlist(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function readEnvAllowlist(): string[] {
  return normalizeOperatorAllowlist(
    import.meta.env.VITE_OPERATOR_ALLOWED_EMAILS as string | undefined,
  );
}

/** Parsed allowlist from VITE_OPERATOR_ALLOWED_EMAILS. Empty/unset → []. */
export function parseOperatorAllowlist(): string[] {
  return readEnvAllowlist();
}

/** Fail closed: no email, empty allowlist, or email not listed → false. */
export function isOperatorPrototypeAllowed(
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  const allowlist = readEnvAllowlist();
  if (allowlist.length === 0) return false;
  return allowlist.includes(email.trim().toLowerCase());
}

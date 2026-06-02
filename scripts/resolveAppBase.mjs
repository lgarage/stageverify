/** Resolve gh-pages app root whether base is host-only or already includes /stageverify. */
export function resolveAppBase(baseUrl) {
  const normalized = baseUrl.replace(/\/$/, "");
  if (normalized.endsWith("/stageverify")) return normalized;
  return `${normalized}/stageverify`;
}

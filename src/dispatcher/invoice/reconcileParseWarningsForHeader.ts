/**
 * Client mirror of functions reconcileParseWarningsForHeader.
 * Drops resolved `missing <allowlistedField>` warnings when the current header
 * already has a value — keeps unrelated warnings as current unresolved issues.
 */

const CORRECTABLE_MISSING_WARNINGS = [
  "missing customerPoOrReference",
  "missing vendorOrderNumber",
  "missing vendorInvoiceNumber",
] as const;

function headerFieldPresent(
  header: Record<string, unknown> | undefined,
  field: string,
): boolean {
  const raw = header?.[field];
  return typeof raw === "string" && Boolean(raw.trim());
}

export function reconcileParseWarningsForHeader(
  parseWarnings: string[] | undefined,
  parsedHeader: Record<string, unknown> | undefined,
): string[] {
  const warnings = (parseWarnings ?? []).filter(Boolean);
  return warnings.filter((warning) => {
    const normalized = warning.trim().toLowerCase();
    for (const token of CORRECTABLE_MISSING_WARNINGS) {
      if (normalized === token.toLowerCase()) {
        const field = token.replace(/^missing\s+/i, "");
        return !headerFieldPresent(parsedHeader, field);
      }
    }
    return true;
  });
}

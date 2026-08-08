/**
 * Shared vendor display-name helpers.
 * Vendor docs remain the location-level SoT (`vendors/{id}`);
 * company + location fields generate "Company — Location" for UI.
 */

export interface VendorDisplayParts {
  /** Persisted / legacy flat name (also written as generated display name). */
  name?: string | null;
  companyName?: string | null;
  locationName?: string | null;
}

const DISPLAY_SEP = " — ";

/** Soft-normalize company: explicit companyName, else legacy name. */
export function resolveVendorCompanyName(vendor: VendorDisplayParts): string {
  const company = vendor.companyName?.trim();
  if (company) return company;
  return vendor.name?.trim() ?? "";
}

/** Soft-normalize location/branch (empty when unset or legacy flat-only). */
export function resolveVendorLocationName(vendor: VendorDisplayParts): string {
  return vendor.locationName?.trim() ?? "";
}

/**
 * Generated display name: "Company — Location", or company/name alone.
 * Prefer explicit company+location; fall back to persisted `name` for legacy docs.
 */
export function formatVendorDisplayName(vendor: VendorDisplayParts): string {
  const company = vendor.companyName?.trim() ?? "";
  const location = vendor.locationName?.trim() ?? "";
  if (company && location) return `${company}${DISPLAY_SEP}${location}`;
  if (company) return company;
  if (location) return location;
  return vendor.name?.trim() ?? "";
}

/** Fields to persist when saving company/location (keeps `name` in sync for denorm consumers). */
export function buildVendorDisplayFields(input: {
  companyName: string;
  locationName?: string;
}): { companyName: string; locationName?: string; name: string } {
  const companyName = input.companyName.trim();
  const locationName = input.locationName?.trim() || undefined;
  return {
    companyName,
    locationName,
    name: formatVendorDisplayName({ companyName, locationName }),
  };
}

/** Search match across company, location, display name, email, address. */
export function vendorMatchesSearch(
  vendor: VendorDisplayParts & {
    email?: string | null;
    address?: string | null;
    contactName?: string | null;
  },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    formatVendorDisplayName(vendor),
    resolveVendorCompanyName(vendor),
    resolveVendorLocationName(vendor),
    vendor.name,
    vendor.email,
    vendor.address,
    vendor.contactName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

/** Unique company names for datalist / grouping (sorted). */
export function listVendorCompanyNames(
  vendors: VendorDisplayParts[],
): string[] {
  const set = new Set<string>();
  for (const v of vendors) {
    const company = resolveVendorCompanyName(v);
    if (company) set.add(company);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function groupVendorsByCompany<T extends VendorDisplayParts & { id: string }>(
  vendors: T[],
): Array<{ companyName: string; locations: T[] }> {
  const map = new Map<string, T[]>();
  for (const v of vendors) {
    const company = resolveVendorCompanyName(v) || "Unnamed vendor";
    const list = map.get(company);
    if (list) list.push(v);
    else map.set(company, [v]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([companyName, locations]) => ({
      companyName,
      locations: [...locations].sort((a, b) =>
        formatVendorDisplayName(a).localeCompare(formatVendorDisplayName(b)),
      ),
    }));
}

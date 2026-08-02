import type { Vendor } from "../models";

/** Merge delivery vendor into portal list; fill empty list email from delivery. */
export function mergeVendorIntoList(
  vendors: Vendor[],
  deliveryVendor: Vendor,
): Vendor[] {
  const list = [...vendors];
  const idx = list.findIndex((v) => v.id === deliveryVendor.id);
  if (idx >= 0) {
    const existing = list[idx];
    const deliveryEmail = deliveryVendor.email?.trim();
    list[idx] = {
      ...existing,
      email: existing.email?.trim() ? existing.email : deliveryEmail || existing.email,
    };
    return list;
  }
  return [...list, deliveryVendor];
}

export function resolveVendorForComms({
  vendors,
  initialVendorId,
  vendorNameHint,
}: {
  vendors: Vendor[];
  initialVendorId?: string;
  vendorNameHint?: string;
}): Vendor | null {
  if (initialVendorId) {
    const byId = vendors.find((v) => v.id === initialVendorId);
    if (byId) return byId;
  }

  const hint = vendorNameHint?.trim();
  if (!hint) return null;

  const normalizedHint = hint.toLowerCase();
  const nameMatches = vendors.filter(
    (v) => v.name.trim().toLowerCase() === normalizedHint,
  );
  if (nameMatches.length === 1) return nameMatches[0];
  return null;
}

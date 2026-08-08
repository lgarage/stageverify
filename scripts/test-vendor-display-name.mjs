/**
 * Pure-logic tests for vendor company/location display names.
 * Keep assertions aligned with src/dispatcher/vendorDisplayName.ts.
 * Run: npm run test:vendor-display-name
 */

import assert from "node:assert/strict";

function formatVendorDisplayName(vendor) {
  const company = vendor.companyName?.trim() ?? "";
  const location = vendor.locationName?.trim() ?? "";
  if (company && location) return `${company} — ${location}`;
  if (company) return company;
  if (location) return location;
  return vendor.name?.trim() ?? "";
}

function vendorMatchesSearch(vendor, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    formatVendorDisplayName(vendor),
    vendor.companyName,
    vendor.locationName,
    vendor.name,
    vendor.email,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function buildVendorDisplayFields({ companyName, locationName }) {
  const company = companyName.trim();
  const location = locationName?.trim() || undefined;
  return {
    companyName: company,
    locationName: location,
    name: formatVendorDisplayName({
      companyName: company,
      locationName: location,
    }),
  };
}

assert.equal(
  formatVendorDisplayName({
    companyName: "Johnstone Supply",
    locationName: "Appleton",
  }),
  "Johnstone Supply — Appleton",
);
assert.equal(
  formatVendorDisplayName({ name: "Johnstone Supply" }),
  "Johnstone Supply",
);
assert.equal(
  formatVendorDisplayName({ companyName: "First Supply" }),
  "First Supply",
);

const built = buildVendorDisplayFields({
  companyName: "Johnstone Supply",
  locationName: "De Pere",
});
assert.equal(built.name, "Johnstone Supply — De Pere");
assert.equal(built.companyName, "Johnstone Supply");
assert.equal(built.locationName, "De Pere");

const sample = {
  companyName: "Johnstone Supply",
  locationName: "Appleton",
  name: "Johnstone Supply — Appleton",
  email: "appleton@example.com",
};
assert.equal(vendorMatchesSearch(sample, "johnstone"), true);
assert.equal(vendorMatchesSearch(sample, "Appleton"), true);
assert.equal(vendorMatchesSearch(sample, "milwaukee"), false);

console.log("PASS: test-vendor-display-name");

import { HttpsError } from "firebase-functions/v2/https";
import {
  DEFAULT_SPOT_ALLOWANCE,
  FOUNDING_MONTHLY_USD,
  ONBOARDING_STATUSES,
  type AddressFields,
  type CustomerStatus,
  type OnboardingStatus,
  type OperatorUserRole,
} from "./customerModels";

const CLIENT_OPERATION_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function resolveClientOperationId(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    return "";
  }
  const trimmed = raw.trim();
  return CLIENT_OPERATION_ID_RE.test(trimmed) ? trimmed : "";
}

export function parseAddress(raw: unknown, label: string): AddressFields {
  if (!raw || typeof raw !== "object") {
    throw new HttpsError("invalid-argument", `${label} address is required.`);
  }
  const obj = raw as Record<string, unknown>;
  const line1 = typeof obj.line1 === "string" ? obj.line1.trim() : "";
  const city = typeof obj.city === "string" ? obj.city.trim() : "";
  const region = typeof obj.region === "string" ? obj.region.trim() : "";
  const postalCode =
    typeof obj.postalCode === "string" ? obj.postalCode.trim() : "";
  const country =
    typeof obj.country === "string" && obj.country.trim()
      ? obj.country.trim()
      : "US";
  if (!line1 || !city || !region || !postalCode) {
    throw new HttpsError(
      "invalid-argument",
      `${label} address must include line1, city, region, and postalCode.`,
    );
  }
  const line2 =
    typeof obj.line2 === "string" ? obj.line2.trim() : undefined;
  return { line1, line2, city, region, postalCode, country };
}

export function requireCompanyName(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new HttpsError("invalid-argument", "Company name is required.");
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new HttpsError("invalid-argument", "Company name is required.");
  }
  return trimmed;
}

export function parseCustomerStatus(raw: unknown): CustomerStatus {
  if (raw === "active" || raw === "inactive" || raw === "prospect") {
    return raw;
  }
  return "prospect";
}

export function parseOperatorUserRole(raw: unknown): OperatorUserRole {
  const allowed: OperatorUserRole[] = [
    "customer_admin",
    "manager",
    "dispatcher",
    "technician",
  ];
  if (typeof raw === "string" && (allowed as string[]).includes(raw)) {
    return raw as OperatorUserRole;
  }
  throw new HttpsError("invalid-argument", "Invalid user role.");
}

export function parseOnboardingStatus(raw: unknown): OnboardingStatus {
  if (
    typeof raw === "string" &&
    (ONBOARDING_STATUSES as readonly string[]).includes(raw)
  ) {
    return raw as OnboardingStatus;
  }
  throw new HttpsError("invalid-argument", "Invalid onboarding status.");
}

export type CreateCustomerLocationInput = {
  locationName: string;
  physicalAddress: AddressFields;
  billingAddress: AddressFields;
  billingSameAsPhysical: boolean;
  billingContactName: string;
  billingEmail: string;
  billingPhone: string;
  groundSpotCount: number;
  shelfSpotCount: number;
  spotAllowance: number;
};

export function parseCreateCustomerLocationInput(
  raw: unknown,
  index: number,
): CreateCustomerLocationInput {
  if (!raw || typeof raw !== "object") {
    throw new HttpsError(
      "invalid-argument",
      `Location ${index + 1} is required.`,
    );
  }
  const obj = raw as Record<string, unknown>;
  const locationName =
    typeof obj.locationName === "string" ? obj.locationName.trim() : "";
  const physicalAddress = parseAddress(obj.physicalAddress, `Location ${index + 1} physical`);
  const billingSameAsPhysical = obj.billingSameAsPhysical === true;
  const billingAddress = billingSameAsPhysical
    ? { ...physicalAddress }
    : parseAddress(
        obj.billingAddress ?? obj.physicalAddress,
        `Location ${index + 1} billing`,
      );
  const groundSpotCount =
    typeof obj.groundSpotCount === "number" && Number.isFinite(obj.groundSpotCount)
      ? Math.max(0, Math.floor(obj.groundSpotCount))
      : 0;
  const shelfSpotCount =
    typeof obj.shelfSpotCount === "number" && Number.isFinite(obj.shelfSpotCount)
      ? Math.max(0, Math.floor(obj.shelfSpotCount))
      : 0;
  if (groundSpotCount + shelfSpotCount <= 0) {
    throw new HttpsError(
      "invalid-argument",
      `Location ${index + 1} must include at least one spot.`,
    );
  }
  return {
    locationName: locationName || "Unnamed location",
    physicalAddress,
    billingAddress,
    billingSameAsPhysical,
    billingContactName:
      typeof obj.billingContactName === "string"
        ? obj.billingContactName.trim()
        : "",
    billingEmail:
      typeof obj.billingEmail === "string" ? obj.billingEmail.trim() : "",
    billingPhone:
      typeof obj.billingPhone === "string" ? obj.billingPhone.trim() : "",
    groundSpotCount,
    shelfSpotCount,
    spotAllowance: DEFAULT_SPOT_ALLOWANCE,
  };
}

export type CreateCustomerUserInput = {
  name: string;
  email: string;
  role: OperatorUserRole;
  locationIndexes?: number[];
  locationIds?: string[];
};

export function parseCreateCustomerUserInput(
  raw: unknown,
  index: number,
): CreateCustomerUserInput {
  if (!raw || typeof raw !== "object") {
    throw new HttpsError("invalid-argument", `User ${index + 1} is invalid.`);
  }
  const obj = raw as Record<string, unknown>;
  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  const email = typeof obj.email === "string" ? obj.email.trim() : "";
  if (!name || !email) {
    throw new HttpsError(
      "invalid-argument",
      `User ${index + 1} requires name and email.`,
    );
  }
  const role = parseOperatorUserRole(obj.role);
  const locationIndexes = Array.isArray(obj.locationIndexes)
    ? obj.locationIndexes
        .filter((v): v is number => typeof v === "number" && Number.isInteger(v))
        .map((v) => Math.max(0, v))
    : undefined;
  const locationIds = Array.isArray(obj.locationIds)
    ? obj.locationIds.filter((v): v is string => typeof v === "string")
    : undefined;
  return { name, email, role, locationIndexes, locationIds };
}

export { FOUNDING_MONTHLY_USD, DEFAULT_SPOT_ALLOWANCE };

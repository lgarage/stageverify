/** Operator foundation data model — Cloud Functions Admin SDK persistence. */

export const FOUNDING_MONTHLY_USD = 199;
export const STANDARD_MONTHLY_USD = 399;
export const DEFAULT_SPOT_ALLOWANCE = 30;

export const ONBOARDING_STATUSES = [
  "NEW",
  "CONFIGURING",
  "LAYOUT_DRAFT",
  "LAYOUT_APPROVED",
  "SIGNS_ORDERED",
  "READY_TO_INSTALL",
  "INSTALLING",
  "ACTIVE",
  "PAST_DUE",
  "SUSPENDED",
  "CANCELED",
] as const;

export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export type CustomerStatus = "prospect" | "active" | "inactive";

export type LocationStatus = "active" | "suspended" | "canceled";

export type OperatorUserRole =
  | "customer_admin"
  | "manager"
  | "dispatcher"
  | "technician";

export type AddressFields = {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
};

export type LocationSpotKind = "ground" | "shelf";

export type LocationSpot = {
  spotId: string;
  customerId: string;
  locationId: string;
  visibleLabel: string;
  kind: LocationSpotKind;
  qrToken: string | null;
  createdAt: string;
};

export type LocationLayoutExtras = {
  canvasWidth?: number;
  canvasHeight?: number;
  hiddenSlotIds?: string[];
};

export type LocationLayout = {
  customerId: string;
  locationId: string;
  spots: LocationSpot[];
  extras?: LocationLayoutExtras;
};

export type Customer = {
  customerId: string;
  companyName: string;
  primaryContactName: string;
  primaryContactEmail: string;
  primaryContactPhone: string;
  customerStatus: CustomerStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type PhysicalLocation = {
  locationId: string;
  customerId: string;
  locationName: string;
  physicalAddress: AddressFields;
  billingAddress: AddressFields;
  billingSameAsPhysical: boolean;
  billingContactName: string;
  billingEmail: string;
  billingPhone: string;
  onboardingStatus: OnboardingStatus;
  locationStatus: LocationStatus;
  spotAllowance: number;
  foundingPrice: boolean;
  monthlyPriceUsd: number;
  foundingPriceStartDate?: string;
  foundingPriceExpirationDate?: string;
  activationDate?: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  layout: LocationLayout;
  createdAt: string;
  updatedAt: string;
};

export type OperatorUser = {
  userId: string;
  customerId: string;
  name: string;
  email: string;
  role: OperatorUserRole;
  locationIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ActivityEvent = {
  eventId: string;
  customerId: string;
  locationId?: string;
  type: string;
  message: string;
  actorUid: string;
  createdAt: string;
};

export type CustomerSummary = {
  customerId: string;
  companyName: string;
  customerStatus: CustomerStatus;
  locationCount: number;
  onboardingRollup: OnboardingStatus;
};

export type CustomerBundle = {
  customer: Customer;
  locations: PhysicalLocation[];
  users: OperatorUser[];
  events: ActivityEvent[];
};

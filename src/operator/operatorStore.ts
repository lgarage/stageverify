import {
  DEFAULT_SPOT_ALLOWANCE,
  FOUNDING_MONTHLY_USD,
  type ActivityEvent,
  type AddressFields,
  type Customer,
  type CustomerBundle,
  type CustomerSummary,
  type OnboardingStatus,
  type OperatorStoreSnapshot,
  type OperatorUser,
  type OperatorUserRole,
  type PhysicalLocation,
} from "./customerModels";
import { buildLocationLayout, copyAddress } from "./locationLayout";
import {
  newCustomerId,
  newEventId,
  newLocationId,
  newUserId,
} from "./operatorIds";
import {
  rollupCustomerOnboarding,
  transitionOnboarding,
} from "./onboardingTransitions";

export const OPERATOR_STORE_KEY = "stageverify.operator.foundation.v1";

export type OperatorStorageAdapter = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
};

function emptySnapshot(): OperatorStoreSnapshot {
  return { customers: [], locations: [], users: [], events: [] };
}

const memoryBacking = new Map<string, string>();
const defaultMemoryAdapter: OperatorStorageAdapter = {
  getItem: (key) => memoryBacking.get(key) ?? null,
  setItem: (key, value) => {
    memoryBacking.set(key, value);
  },
  removeItem: (key) => {
    memoryBacking.delete(key);
  },
};

let injectedAdapter: OperatorStorageAdapter | null = null;

export function setOperatorStorageAdapter(
  adapter: OperatorStorageAdapter | null,
): void {
  injectedAdapter = adapter;
}

export function resetOperatorStoreForTests(): void {
  injectedAdapter = null;
  memoryBacking.clear();
}

function resolveStorage(): OperatorStorageAdapter {
  if (injectedAdapter) return injectedAdapter;
  if (
    typeof globalThis !== "undefined" &&
    "localStorage" in globalThis &&
    globalThis.localStorage
  ) {
    return globalThis.localStorage as OperatorStorageAdapter;
  }
  return defaultMemoryAdapter;
}

export function loadOperatorStore(): OperatorStoreSnapshot {
  const raw = resolveStorage().getItem(OPERATOR_STORE_KEY);
  if (!raw) return emptySnapshot();
  try {
    const parsed = JSON.parse(raw) as OperatorStoreSnapshot;
    return {
      customers: parsed.customers ?? [],
      locations: parsed.locations ?? [],
      users: parsed.users ?? [],
      events: parsed.events ?? [],
    };
  } catch {
    return emptySnapshot();
  }
}

export function saveOperatorStore(snapshot: OperatorStoreSnapshot): void {
  resolveStorage().setItem(OPERATOR_STORE_KEY, JSON.stringify(snapshot));
}

function appendEvent(
  snapshot: OperatorStoreSnapshot,
  event: Omit<ActivityEvent, "eventId" | "createdAt"> & { createdAt?: string },
  nowIso: string,
): ActivityEvent {
  const full: ActivityEvent = {
    eventId: newEventId(),
    createdAt: event.createdAt ?? nowIso,
    customerId: event.customerId,
    locationId: event.locationId,
    type: event.type,
    message: event.message,
  };
  snapshot.events.unshift(full);
  return full;
}

export type CreateCustomerLocationInput = {
  locationName: string;
  physicalAddress: AddressFields;
  billingAddress?: AddressFields;
  billingSameAsPhysical: boolean;
  billingContactName: string;
  billingEmail: string;
  billingPhone: string;
  groundSpotCount: number;
  shelfSpotCount: number;
  spotAllowance?: number;
  foundingPriceStartDate?: string;
  foundingPriceExpirationDate?: string;
};

export type CreateCustomerUserInput = {
  name: string;
  email: string;
  role: OperatorUserRole;
  /** Zero-based indexes into the locations array created in the same request. */
  locationIndexes?: number[];
  locationIds?: string[];
};

export type CreateCustomerWithOnboardingInput = {
  companyName: string;
  primaryContactName: string;
  primaryContactEmail: string;
  primaryContactPhone: string;
  notes?: string;
  customerStatus?: Customer["customerStatus"];
  locations: CreateCustomerLocationInput[];
  users?: CreateCustomerUserInput[];
};

function requireCompanyName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Company name is required");
  }
  return trimmed;
}

function buildPhysicalLocation(
  customerId: string,
  input: CreateCustomerLocationInput,
  nowIso: string,
): PhysicalLocation {
  const locationId = newLocationId();
  const physicalAddress = copyAddress(input.physicalAddress);
  const billingAddress = input.billingSameAsPhysical
    ? copyAddress(physicalAddress)
    : copyAddress(input.billingAddress ?? physicalAddress);

  const layout = buildLocationLayout({
    customerId,
    locationId,
    groundSpotCount: Math.max(0, input.groundSpotCount),
    shelfSpotCount: Math.max(0, input.shelfSpotCount),
    nowIso,
  });

  return {
    locationId,
    customerId,
    locationName: input.locationName.trim() || "Unnamed location",
    physicalAddress,
    billingAddress,
    billingSameAsPhysical: input.billingSameAsPhysical,
    billingContactName: input.billingContactName,
    billingEmail: input.billingEmail,
    billingPhone: input.billingPhone,
    onboardingStatus: "NEW",
    locationStatus: "active",
    spotAllowance: input.spotAllowance ?? DEFAULT_SPOT_ALLOWANCE,
    foundingPrice: true,
    monthlyPriceUsd: FOUNDING_MONTHLY_USD,
    foundingPriceStartDate: input.foundingPriceStartDate,
    foundingPriceExpirationDate: input.foundingPriceExpirationDate,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    layout,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function createCustomerWithOnboarding(
  input: CreateCustomerWithOnboardingInput,
  nowIso: string = new Date().toISOString(),
): CustomerBundle {
  const companyName = requireCompanyName(input.companyName);
  if (!input.locations.length) {
    throw new Error("At least one location is required");
  }

  const snapshot = loadOperatorStore();
  const customerId = newCustomerId();
  const customer: Customer = {
    customerId,
    companyName,
    primaryContactName: input.primaryContactName.trim(),
    primaryContactEmail: input.primaryContactEmail.trim(),
    primaryContactPhone: input.primaryContactPhone.trim(),
    customerStatus: input.customerStatus ?? "prospect",
    notes: input.notes?.trim() ?? "",
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const locations = input.locations.map((loc) =>
    buildPhysicalLocation(customerId, loc, nowIso),
  );

  const users: OperatorUser[] = (input.users ?? []).map((userInput) => {
    let locationIds: string[] = [];
    if (userInput.locationIds?.length) {
      locationIds = [...userInput.locationIds];
    } else if (userInput.locationIndexes?.length) {
      locationIds = userInput.locationIndexes
        .map((idx) => locations[idx]?.locationId)
        .filter((id): id is string => Boolean(id));
    }
    return {
      userId: newUserId(),
      customerId,
      name: userInput.name.trim(),
      email: userInput.email.trim(),
      role: userInput.role,
      locationIds,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  });

  snapshot.customers.push(customer);
  snapshot.locations.push(...locations);
  snapshot.users.push(...users);

  appendEvent(
    snapshot,
    {
      customerId,
      type: "customer.created",
      message: `Customer "${companyName}" created with ${locations.length} location(s) and ${users.length} user(s).`,
    },
    nowIso,
  );

  saveOperatorStore(snapshot);

  return getCustomerBundle(customerId)!;
}

export function listCustomersWithSummary(): CustomerSummary[] {
  const snapshot = loadOperatorStore();
  return snapshot.customers.map((customer) => {
    const customerLocations = snapshot.locations.filter(
      (loc) => loc.customerId === customer.customerId,
    );
    return {
      customerId: customer.customerId,
      companyName: customer.companyName,
      customerStatus: customer.customerStatus,
      locationCount: customerLocations.length,
      onboardingRollup: rollupCustomerOnboarding(customerLocations),
    };
  });
}

export function getCustomerBundle(
  customerId: string,
): CustomerBundle | undefined {
  const snapshot = loadOperatorStore();
  const customer = snapshot.customers.find((c) => c.customerId === customerId);
  if (!customer) return undefined;
  return {
    customer,
    locations: snapshot.locations.filter(
      (loc) => loc.customerId === customerId,
    ),
    users: snapshot.users.filter((u) => u.customerId === customerId),
    events: snapshot.events.filter((e) => e.customerId === customerId),
  };
}

export function addLocationToCustomer(
  customerId: string,
  input: CreateCustomerLocationInput,
  nowIso: string = new Date().toISOString(),
): PhysicalLocation {
  const snapshot = loadOperatorStore();
  const customer = snapshot.customers.find((c) => c.customerId === customerId);
  if (!customer) {
    throw new Error(`Customer not found: ${customerId}`);
  }

  const location = buildPhysicalLocation(customerId, input, nowIso);
  snapshot.locations.push(location);
  customer.updatedAt = nowIso;

  appendEvent(
    snapshot,
    {
      customerId,
      locationId: location.locationId,
      type: "location.added",
      message: `Location "${location.locationName}" added.`,
    },
    nowIso,
  );

  saveOperatorStore(snapshot);
  return location;
}

export function addUserToCustomer(
  customerId: string,
  input: Omit<CreateCustomerUserInput, "locationIndexes"> & {
    locationIds: string[];
  },
  nowIso: string = new Date().toISOString(),
): OperatorUser {
  const snapshot = loadOperatorStore();
  const customer = snapshot.customers.find((c) => c.customerId === customerId);
  if (!customer) {
    throw new Error(`Customer not found: ${customerId}`);
  }

  const user: OperatorUser = {
    userId: newUserId(),
    customerId,
    name: input.name.trim(),
    email: input.email.trim(),
    role: input.role,
    locationIds: [...input.locationIds],
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  snapshot.users.push(user);
  customer.updatedAt = nowIso;

  appendEvent(
    snapshot,
    {
      customerId,
      type: "user.added",
      message: `User "${user.name}" (${user.role}) added.`,
    },
    nowIso,
  );

  saveOperatorStore(snapshot);
  return user;
}

export function transitionLocationOnboarding(
  locationId: string,
  to: OnboardingStatus,
  nowIso: string = new Date().toISOString(),
): PhysicalLocation {
  const snapshot = loadOperatorStore();
  const index = snapshot.locations.findIndex(
    (loc) => loc.locationId === locationId,
  );
  if (index === -1) {
    throw new Error(`Location not found: ${locationId}`);
  }

  const current = snapshot.locations[index];
  const next = transitionOnboarding(current, to, nowIso);
  snapshot.locations[index] = next;

  const customer = snapshot.customers.find(
    (c) => c.customerId === current.customerId,
  );
  if (customer) {
    customer.updatedAt = nowIso;
  }

  appendEvent(
    snapshot,
    {
      customerId: current.customerId,
      locationId,
      type: "onboarding.transition",
      message: `Location "${current.locationName}" onboarding ${current.onboardingStatus} → ${to}.`,
    },
    nowIso,
  );

  saveOperatorStore(snapshot);
  return next;
}

/** Ensures globally unique spotId per visible label scope (customer + location). */
export function assertSpotIdentityIsolation(
  snapshot: OperatorStoreSnapshot,
  visibleLabel: string,
): void {
  const matches = snapshot.locations.flatMap((loc) =>
    loc.layout.spots
      .filter((spot) => spot.visibleLabel === visibleLabel)
      .map((spot) => ({
        spotId: spot.spotId,
        customerId: spot.customerId,
        locationId: spot.locationId,
      })),
  );

  const spotIds = new Set(matches.map((m) => m.spotId));
  if (spotIds.size !== matches.length) {
    throw new Error(
      `Spot identity collision for label ${visibleLabel}: duplicate spotId`,
    );
  }

  const scopes = new Set(
    matches.map((m) => `${m.customerId}:${m.locationId}:${visibleLabel}`),
  );
  if (scopes.size !== matches.length) {
    throw new Error(
      `Spot identity collision for label ${visibleLabel}: duplicate scope`,
    );
  }
}

export {
  rollupCustomerOnboarding,
  transitionOnboarding,
  canTransitionOnboarding,
  listAllowedOnboardingTransitions,
} from "./onboardingTransitions";

import {
  DEFAULT_SPOT_ALLOWANCE,
  FOUNDING_MONTHLY_USD,
  type ActivityEvent,
  type Customer,
  type CustomerBundle,
  type OperatorUser,
  type PhysicalLocation,
} from "./customerModels";
import { buildLocationLayout, copyAddress } from "./locationLayout";
import {
  newCustomerId,
  newEventId,
  newLocationId,
  newUserId,
} from "./operatorIds";
import type { CreateCustomerLocationInput, CreateCustomerUserInput } from "./operatorValidation";

export function buildPhysicalLocation(
  customerId: string,
  input: CreateCustomerLocationInput,
  nowIso: string,
): PhysicalLocation {
  const locationId = newLocationId();
  const physicalAddress = copyAddress(input.physicalAddress);
  const billingAddress = input.billingSameAsPhysical
    ? copyAddress(physicalAddress)
    : copyAddress(input.billingAddress);

  const layout = buildLocationLayout({
    customerId,
    locationId,
    groundSpotCount: input.groundSpotCount,
    shelfSpotCount: input.shelfSpotCount,
    nowIso,
  });

  return {
    locationId,
    customerId,
    locationName: input.locationName,
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
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    layout,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function buildActivityEvent(
  input: {
    customerId: string;
    locationId?: string;
    type: string;
    message: string;
    actorUid: string;
    createdAt?: string;
  },
  nowIso: string,
): ActivityEvent {
  const event: ActivityEvent = {
    eventId: newEventId(),
    createdAt: input.createdAt ?? nowIso,
    customerId: input.customerId,
    type: input.type,
    message: input.message,
    actorUid: input.actorUid,
  };
  if (input.locationId) {
    event.locationId = input.locationId;
  }
  return event;
}

export function buildUsersForCustomer(
  customerId: string,
  userInputs: CreateCustomerUserInput[],
  locations: PhysicalLocation[],
  nowIso: string,
): OperatorUser[] {
  return userInputs.map((userInput) => {
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
      name: userInput.name,
      email: userInput.email,
      role: userInput.role,
      locationIds,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  });
}

export function buildCustomerBundle(
  customer: Customer,
  locations: PhysicalLocation[],
  users: OperatorUser[],
  events: ActivityEvent[],
): CustomerBundle {
  return { customer, locations, users, events };
}

export function newCustomerRecord(
  input: {
    companyName: string;
    primaryContactName: string;
    primaryContactEmail: string;
    primaryContactPhone: string;
    notes?: string;
    customerStatus?: Customer["customerStatus"];
  },
  nowIso: string,
): Customer {
  return {
    customerId: newCustomerId(),
    companyName: input.companyName,
    primaryContactName: input.primaryContactName,
    primaryContactEmail: input.primaryContactEmail,
    primaryContactPhone: input.primaryContactPhone,
    customerStatus: input.customerStatus ?? "prospect",
    notes: input.notes?.trim() ?? "",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/** Ensures globally unique spotId per visible label scope (customer + location). */
export function assertSpotIdentityIsolation(
  locations: PhysicalLocation[],
  visibleLabel: string,
): void {
  const matches = locations.flatMap((loc) =>
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

export function assertLocationIdsBelongToCustomer(
  customerId: string,
  locationIds: string[],
  locations: PhysicalLocation[],
): void {
  const allowed = new Set(
    locations.filter((l) => l.customerId === customerId).map((l) => l.locationId),
  );
  for (const locationId of locationIds) {
    if (!allowed.has(locationId)) {
      throw new Error(
        `Location ${locationId} does not belong to customer ${customerId}`,
      );
    }
  }
}

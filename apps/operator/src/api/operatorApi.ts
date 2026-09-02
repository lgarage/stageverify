import { httpsCallable } from "firebase/functions";
import { assertSafeBackend } from "./assertSafeBackend";
import { functions } from "../firebase";
import { newClientOperationId } from "../domain/newClientOperationId";
import type {
  CustomerBundle,
  CustomerSummary,
  OnboardingStatus,
  OperatorUser,
  PhysicalLocation,
} from "../domain/customerModels";

type CreateLocationPayload = {
  locationName: string;
  physicalAddress: Record<string, string | undefined>;
  billingAddress?: Record<string, string | undefined>;
  billingSameAsPhysical: boolean;
  billingContactName: string;
  billingEmail: string;
  billingPhone: string;
  groundSpotCount: number;
  shelfSpotCount: number;
};

type CreateUserPayload = {
  name: string;
  email: string;
  role: OperatorUser["role"];
  locationIndexes?: number[];
  locationIds?: string[];
};

export type CreateCustomerWithOnboardingPayload = {
  companyName: string;
  primaryContactName: string;
  primaryContactEmail: string;
  primaryContactPhone: string;
  notes?: string;
  locations: CreateLocationPayload[];
  users?: CreateUserPayload[];
  clientOperationId?: string;
};

function mutatingCall<TRequest extends object, TResponse>(
  name: string,
  payload: TRequest,
): Promise<TResponse> {
  assertSafeBackend();
  const callable = httpsCallable<TRequest, TResponse>(functions, name);
  return callable(payload).then((result) => result.data);
}

export async function listCustomersWithSummary(): Promise<CustomerSummary[]> {
  assertSafeBackend();
  const callable = httpsCallable<Record<string, never>, CustomerSummary[]>(
    functions,
    "listCustomersWithSummary",
  );
  const result = await callable({});
  return result.data;
}

export async function getCustomerBundle(
  customerId: string,
): Promise<CustomerBundle> {
  assertSafeBackend();
  const callable = httpsCallable<{ customerId: string }, CustomerBundle>(
    functions,
    "getCustomerBundle",
  );
  const result = await callable({ customerId });
  return result.data;
}

export async function createCustomerWithOnboarding(
  payload: CreateCustomerWithOnboardingPayload,
): Promise<CustomerBundle> {
  return mutatingCall<
    CreateCustomerWithOnboardingPayload & { clientOperationId: string },
    CustomerBundle
  >("createCustomerWithOnboarding", {
    ...payload,
    clientOperationId: payload.clientOperationId ?? newClientOperationId(),
  });
}

export async function addLocationToCustomer(input: {
  customerId: string;
  location: CreateLocationPayload;
  clientOperationId?: string;
}): Promise<PhysicalLocation> {
  return mutatingCall("addLocationToCustomer", {
    customerId: input.customerId,
    location: input.location,
    clientOperationId: input.clientOperationId ?? newClientOperationId(),
  });
}

export async function addUserToCustomer(input: {
  customerId: string;
  user: CreateUserPayload & { locationIds: string[] };
  clientOperationId?: string;
}): Promise<OperatorUser> {
  return mutatingCall("addUserToCustomer", {
    customerId: input.customerId,
    user: input.user,
    clientOperationId: input.clientOperationId ?? newClientOperationId(),
  });
}

export async function transitionLocationOnboarding(input: {
  locationId: string;
  to: OnboardingStatus;
  clientOperationId?: string;
}): Promise<PhysicalLocation> {
  return mutatingCall("transitionLocationOnboarding", {
    locationId: input.locationId,
    to: input.to,
    clientOperationId: input.clientOperationId ?? newClientOperationId(),
  });
}

export { listAllowedOnboardingTransitions } from "../domain/onboardingTransitions";

import {
  getAllStagingLocationIds,
  type DeliveryOrder,
} from "./models";

/** Thrown when assigning a staging zone already held by another active delivery. */
export class StagingLocationOccupiedError extends Error {
  readonly code = "STAGING_LOCATION_OCCUPIED";
  readonly locationCode: string;
  readonly orderNumber: string;

  constructor(locationCode: string, orderNumber: string) {
    super(
      `Zone ${locationCode} is already assigned to order ${orderNumber}. Pick another spot.`,
    );
    this.name = "StagingLocationOccupiedError";
    this.locationCode = locationCode;
    this.orderNumber = orderNumber;
  }
}

export function deliveryUsesStagingLocation(
  delivery: DeliveryOrder,
  locationId: string,
): boolean {
  return getAllStagingLocationIds(delivery).includes(locationId);
}

export function isStagingLocationOccupiedError(
  err: unknown,
): err is StagingLocationOccupiedError {
  return err instanceof StagingLocationOccupiedError;
}

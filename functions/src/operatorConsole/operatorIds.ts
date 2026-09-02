import { randomUUID } from "node:crypto";

/** Server-minted permanent unique ID prefixes for operator foundation entities. */

export function newCustomerId(): string {
  return `cus_${randomUUID()}`;
}

export function newLocationId(): string {
  return `loc_${randomUUID()}`;
}

export function newUserId(): string {
  return `usr_${randomUUID()}`;
}

export function newSpotId(): string {
  return `spt_${randomUUID()}`;
}

export function newEventId(): string {
  return `evt_${randomUUID()}`;
}

export function newServerOperationId(): string {
  return `op_${randomUUID()}`.slice(0, 64);
}

/** Permanent unique ID prefixes for operator foundation entities. */

export function newCustomerId(): string {
  return `cus_${crypto.randomUUID()}`;
}

export function newLocationId(): string {
  return `loc_${crypto.randomUUID()}`;
}

export function newUserId(): string {
  return `usr_${crypto.randomUUID()}`;
}

export function newSpotId(): string {
  return `spt_${crypto.randomUUID()}`;
}

export function newEventId(): string {
  return `evt_${crypto.randomUUID()}`;
}

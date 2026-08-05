/** Cloud Function recordPickupEvent — max length + charset for idempotency key. */
export const PICKUP_CLIENT_OP_ID_MAX_LEN = 64;
export const PICKUP_CLIENT_OP_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/** New idempotency key — always within CF limits (op-{uuid} = 39 chars). */
export function newPickupClientOperationId(): string {
  return `op-${crypto.randomUUID()}`;
}

/** Use caller id when CF-valid; otherwise generate a fresh key (e.g. legacy pickup-{deliveryId}-{uuid}). */
export function resolvePickupClientOperationId(provided?: string): string {
  const trimmed = provided?.trim();
  if (
    trimmed &&
    trimmed.length <= PICKUP_CLIENT_OP_ID_MAX_LEN &&
    PICKUP_CLIENT_OP_ID_PATTERN.test(trimmed)
  ) {
    return trimmed;
  }
  return newPickupClientOperationId();
}

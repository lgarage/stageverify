export type VendorCompleteConfirmEvent = "tap-complete" | "cancel" | "confirm";

export interface VendorCompleteConfirmReduceResult {
  next: string | null;
  fire?: string;
}

export interface VendorCompleteConfirmOptions {
  locked?: boolean;
}

/**
 * Pure state machine for vendor-run Complete delivery confirmation.
 * tap-complete while idle → show confirm (no fire). confirm → fire once and reset.
 */
export function reduceVendorCompleteConfirm(
  current: string | null,
  event: VendorCompleteConfirmEvent,
  deliveryId?: string,
  options: VendorCompleteConfirmOptions = {},
): VendorCompleteConfirmReduceResult {
  if (options.locked) {
    return { next: current };
  }

  switch (event) {
    case "tap-complete":
      if (current !== null) {
        return { next: current };
      }
      if (!deliveryId) {
        return { next: current };
      }
      return { next: deliveryId };

    case "cancel":
      return { next: null };

    case "confirm":
      if (current !== null) {
        return { next: null, fire: current };
      }
      return { next: current };

    default:
      return { next: current };
  }
}

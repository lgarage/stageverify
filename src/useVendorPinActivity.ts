import { useEffect } from "react";
import {
  clearPinSession,
  hasPinSession,
  isPinSessionValid,
} from "./vendorPinSession";

/** Poll fixed TTL — re-prompt when server expiresAt passes (no activity extension). */
export function useVendorPinSessionExpiry(
  deliveryId: string | null,
  onSessionExpired: () => void,
): void {
  useEffect(() => {
    if (!deliveryId) return;

    const interval = window.setInterval(() => {
      if (!hasPinSession(deliveryId)) return;
      if (!isPinSessionValid(deliveryId)) {
        clearPinSession(deliveryId);
        onSessionExpired();
      }
    }, 30_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [deliveryId, onSessionExpired]);
}

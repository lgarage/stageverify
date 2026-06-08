import { useEffect } from "react";
import {
  clearPinSession,
  isPinSessionValid,
  touchPinSession,
} from "./vendorPinSession";

/** Re-prompt for PIN after 15 minutes of inactivity on an unlocked delivery. */
export function useVendorPinActivity(
  deliveryId: string | null,
  onSessionExpired: () => void,
): void {
  useEffect(() => {
    if (!deliveryId) return;

    const bump = () => {
      if (isPinSessionValid(deliveryId)) {
        touchPinSession(deliveryId);
      }
    };

    const interval = window.setInterval(() => {
      if (!isPinSessionValid(deliveryId)) {
        clearPinSession(deliveryId);
        onSessionExpired();
      }
    }, 30_000);

    window.addEventListener("pointerdown", bump);
    window.addEventListener("keydown", bump);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
    };
  }, [deliveryId, onSessionExpired]);
}

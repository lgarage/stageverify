import type { Html5QrcodeCameraScanConfiguration } from "./qrScannerTypes";

/** iPhone / iPad (incl. iPadOS desktop UA). */
export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** Larger scan region + rear camera resolution — helps ESL tags on monitors. */
export function buildMobileScanConfig(): Html5QrcodeCameraScanConfiguration {
  return {
    fps: 10,
    qrbox: (viewfinderWidth, viewfinderHeight) => {
      const edge = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.88);
      const capped = Math.min(edge, 420);
      return { width: capped, height: capped };
    },
    aspectRatio: 1.777778,
    disableFlip: false,
    videoConstraints: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      // Safari may honor via advanced / applyVideoConstraints
      focusMode: { ideal: "continuous" },
    } as MediaTrackConstraints,
  };
}


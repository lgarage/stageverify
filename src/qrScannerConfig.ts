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
  const videoConstraints: MediaTrackConstraints = {
    facingMode: { ideal: "environment" },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  };
  if (isIosDevice()) {
    Object.assign(videoConstraints, {
      focusMode: { ideal: "continuous" },
    });
  }

  return {
    fps: 12,
    qrbox: (viewfinderWidth, viewfinderHeight) => {
      const edge = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.92);
      const capped = Math.min(edge, 480);
      return { width: capped, height: capped };
    },
    aspectRatio: 1.777778,
    disableFlip: false,
    videoConstraints: videoConstraints as MediaTrackConstraints,
  };
}


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

type CameraTuningScanner = {
  getRunningTrackCapabilities: () => MediaTrackCapabilities;
  applyVideoConstraints: (videoConstraints: MediaTrackConstraints) => Promise<void>;
};

/** After camera starts: continuous focus + light zoom for screen-printed zone QRs. */
export async function tuneIosCamera(scanner: CameraTuningScanner): Promise<void> {
  if (!isIosDevice()) return;
  await new Promise((resolve) => setTimeout(resolve, 700));
  try {
    const caps = scanner.getRunningTrackCapabilities() as MediaTrackCapabilities & {
      zoom?: { min?: number; max?: number };
    };
    const iosConstraints = {
      focusMode: "continuous",
    } as MediaTrackConstraints;
    const zoomCap = caps.zoom;
    if (zoomCap && typeof zoomCap.max === "number") {
      const min = zoomCap.min ?? 1;
      const max = zoomCap.max;
      const zoom = Math.min(max, Math.max(min, min + (max - min) * 0.35));
      await scanner.applyVideoConstraints({
        focusMode: "continuous",
        advanced: [{ zoom }],
      } as unknown as MediaTrackConstraints);
      return;
    }
    await scanner.applyVideoConstraints(iosConstraints);
  } catch {
    // Unsupported constraint sets are common on iOS — scanning still works without tuning.
  }
}

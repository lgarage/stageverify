/** Minimal html5-qrcode surface used by QrScannerOverlay. */

export type QrScanBoxDimensions = { width: number; height: number };

export type QrScanBoxConfig =
  | QrScanBoxDimensions
  | ((
      viewfinderWidth: number,
      viewfinderHeight: number,
    ) => QrScanBoxDimensions);

export interface Html5QrcodeCameraScanConfiguration {
  fps: number;
  qrbox?: QrScanBoxConfig;
  aspectRatio?: number;
  disableFlip?: boolean;
  videoConstraints?: MediaTrackConstraints;
}

export interface Html5QrcodeFullConfiguration {
  formatsToSupport?: number[];
  useBarCodeDetectorIfSupported?: boolean;
  verbose?: boolean;
}

export interface Html5QrcodeInstance {
  start: (
    cameraIdOrConfig: { facingMode: string } | MediaTrackConstraints,
    configuration: Html5QrcodeCameraScanConfiguration,
    qrCodeSuccessCallback: (decodedText: string) => void,
    qrCodeErrorCallback: (errorMessage: string) => void,
  ) => Promise<void>;
  stop: () => Promise<void>;
  clear: () => void;
  getRunningTrackCapabilities: () => MediaTrackCapabilities;
  applyVideoConstraints: (videoConstraints: MediaTrackConstraints) => Promise<void>;
}

/** Minimal html5-qrcode surface used by receive and check-in scanners. */
export interface Html5QrcodeInstance {
  start: (
    cameraIdOrConfig: { facingMode: string },
    configuration: { fps: number; qrbox: { width: number; height: number } },
    qrCodeSuccessCallback: (decodedText: string) => void,
    qrCodeErrorCallback: (errorMessage: string) => void,
  ) => Promise<void>;
  stop: () => Promise<void>;
  clear: () => void;
}

/** Thrown when vendor receive write lacks a valid delivery-scoped session. */
export class VendorSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VendorSessionError";
  }
}

export function isVendorSessionError(err: unknown): err is VendorSessionError {
  return err instanceof VendorSessionError;
}

export function vendorSessionErrorMessage(err: unknown): string {
  if (isVendorSessionError(err)) return err.message;
  if (err instanceof Error && err.message.trim()) return err.message;
  return "Session expired. Enter your PIN again.";
}

/** User-facing message from Firestore/client errors on public pickup writes. */
export function formatPickupError(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as { code: string }).code);
    if (code === "permission-denied") {
      return "Pickup could not be saved (permission denied). Ask your dispatcher to confirm Firestore rules are deployed.";
    }
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return "Failed to record pickup. Please try again.";
}

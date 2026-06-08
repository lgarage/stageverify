/** User-facing message from Firestore/client errors on public pickup writes. */
export function formatPickupError(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as { code: string }).code);
    if (code === "permission-denied") {
      return "Pickup could not be saved (permission denied). Ask your dispatcher to confirm Firestore rules are deployed.";
    }
    if (code === "functions/failed-precondition" || code === "failed-precondition") {
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "";
      if (message) return message;
    }
    if (code.startsWith("functions/") && err && typeof err === "object" && "message" in err) {
      const message = String((err as { message: string }).message);
      if (message && message !== "INTERNAL") return message;
    }
  }
  if (err && typeof err === "object" && "message" in err) {
    const message = String((err as { message: string }).message);
    if (message.includes("Maximum of")) return message;
    if (message.includes("Too many issue")) return message;
    if (message.includes("wait a few seconds")) return message;
    if (message.includes("Cannot report an issue")) return message;
    if (message.includes("Delivery does not belong")) {
      return "Invalid delivery for this job.";
    }
    if (message) return message;
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return "Failed to record pickup. Please try again.";
}

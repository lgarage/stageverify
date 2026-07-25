import type { OfficeReceiver } from "../dispatcher/models";

/** Playwright/verify fixture rows — hide in Settings, keep in Firestore for CF tests. */
export function isVerifySeedOfficeReceiver(receiver: OfficeReceiver): boolean {
  const name = receiver.name?.trim() ?? "";
  const email = (receiver.email ?? "").trim().toLowerCase();
  if (name === "Verify Office Receiver") return true;
  if (/^catchall-verify\+.+@example\.com$/i.test(email)) return true;
  return false;
}

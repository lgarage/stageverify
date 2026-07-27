/**
 * Email the Settings alert address when a training lesson fails safety/redaction.
 */
import * as admin from "firebase-admin";
import {
  buildGmailRawMessage,
  refreshGmailAccessToken,
  sendGmailMessage,
} from "../../gmailApi";

const PROVIDER_ID = "gmail";

function getDb() {
  return admin.firestore();
}

export async function notifyTrainingLessonPendingAdmin(input: {
  alertEmail: string;
  vendorKey: string;
  reason: string;
  importId?: string;
  notePreview?: string;
}): Promise<{ emailed: boolean; error?: string }> {
  const to = input.alertEmail.trim().toLowerCase();
  if (!to || !to.includes("@")) {
    return { emailed: false, error: "invalid_alert_email" };
  }

  const secretSnap = await getDb()
    .collection("emailProviderSecrets")
    .doc(PROVIDER_ID)
    .get();
  const refreshToken = (secretSnap.data() as { refreshToken?: string } | undefined)
    ?.refreshToken;
  if (!refreshToken?.trim()) {
    return { emailed: false, error: "gmail_not_connected" };
  }

  const connSnap = await getDb()
    .collection("emailProviderConnections")
    .doc(PROVIDER_ID)
    .get();
  const fromEmail =
    (connSnap.data() as { connectedAccountEmail?: string } | undefined)
      ?.connectedAccountEmail ?? to;

  const subject = "StageVerify — invoice training lesson pending Admin review";
  const bodyText = [
    "A training note could not be written to the vendor playbook (safety/redaction).",
    "",
    `Vendor key: ${input.vendorKey}`,
    `Reason: ${input.reason}`,
    input.importId ? `Import id: ${input.importId}` : null,
    input.notePreview
      ? `Note preview (redacted): ${input.notePreview.slice(0, 200)}`
      : null,
    "",
    "Open Invoice Review → Admin to inspect the playbook MD, or fix the note and Save lesson again.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const accessToken = await refreshGmailAccessToken(refreshToken);
    const raw = buildGmailRawMessage(to, fromEmail, subject, bodyText, {
      fromDisplayName: "StageVerify Training",
    });
    await sendGmailMessage(accessToken, raw);
    return { emailed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("notifyTrainingLessonPendingAdmin failed:", message);
    return { emailed: false, error: message };
  }
}

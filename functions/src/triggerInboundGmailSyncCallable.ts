/**
 * Callable: manual inbound Gmail sync (same as scheduled syncInboundGmail).
 * Dispatcher auth required — used by dashboard Refresh Now.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { gmailClientId, gmailClientSecret } from "./gmailApi";
import { gmailOAuthSecretsConfigured } from "./gmailInbound";
import { requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";
import { runInboundGmailSync } from "./syncInboundGmail";

export const triggerInboundGmailSyncCallable = onCall(
  {
    region: "us-central1",
    secrets: [gmailClientId, gmailClientSecret],
    timeoutSeconds: 300,
  },
  async (request) => {
    await requireDispatcherAuth(request);

    if (!gmailOAuthSecretsConfigured()) {
      throw new HttpsError(
        "failed-precondition",
        "Gmail OAuth is not configured on the server.",
      );
    }

    const result = await runInboundGmailSync({ retryOnError: true });
    return {
      ok: true,
      processed: result.processed,
      skipped: result.skipped,
      errors: result.errors,
      invoicesQueued: result.invoicesQueued,
      skippedByStatus: result.skippedByStatus,
      skippedReviewCounts: result.skippedReviewCounts,
      errorDetails: result.errorDetails,
    };
  },
);

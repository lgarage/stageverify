/**
 * Read-only match preview for vendor unplanned-delivery fallback.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  asSessionToken,
  assertVendorUnplannedSessionValid,
} from "./vendorSessionValidation";
import { asUnplannedReference } from "./unplannedVendorDeliveryMatching";
import {
  checkUnplannedPreviewRateLimit,
  publicCandidate,
  runVendorScopedUnplannedMatch,
  writeUnplannedAudit,
} from "./unplannedVendorDeliveryShared";

interface MatchUnplannedRequest {
  sessionToken?: string;
  reference?: string;
}

export const matchUnplannedVendorDelivery = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as MatchUnplannedRequest;
    const sessionToken = asSessionToken(data.sessionToken);
    const reference = asUnplannedReference(data.reference);

    if (!sessionToken || !reference) {
      throw new HttpsError("invalid-argument", "Reference is required.");
    }

    const session = await assertVendorUnplannedSessionValid(sessionToken);
    await checkUnplannedPreviewRateLimit(sessionToken);

    const classification = await runVendorScopedUnplannedMatch(
      session.vendorId,
      reference,
    );

    await writeUnplannedAudit({
      action:
        classification.outcome === "strong_match"
          ? "VENDOR_UNPLANNED_MATCH_FOUND"
          : classification.outcome === "ambiguous"
            ? "VENDOR_UNPLANNED_MATCH_AMBIGUOUS"
            : "VENDOR_UNPLANNED_MATCH_NOT_FOUND",
      vendorId: session.vendorId,
      vendorName: session.vendorName,
      reference,
      details: {
        outcome: classification.outcome,
        candidateCount: classification.candidateSummaries.length,
      },
    });

    if (classification.outcome === "strong_match" && classification.candidate) {
      return {
        outcome: "strong_match" as const,
        candidate: publicCandidate(classification.candidate),
      };
    }

    if (classification.outcome === "ambiguous") {
      return {
        outcome: "ambiguous" as const,
        candidateSummaries: classification.candidateSummaries.map(publicCandidate),
      };
    }

    return { outcome: "no_match" as const };
  },
);

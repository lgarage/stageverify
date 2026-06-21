import { EMAIL_FIXTURES, MULTI_VENDOR_MATCH_CONTEXT } from "./emailFixtures";
import { contentFingerprint } from "./parseVendorEmail";
import { processInboundEmail } from "./processEmailMessage";
import type { EmailClassification, EmailProcessingResult } from "./types";

export interface ProposedEmailUpdate {
  messageId: string;
  subject: string;
  senderEmail: string;
  receivedAt: string;
  classification: EmailClassification;
  poNumber: string | null;
  vendorName: string | null;
  confidenceScore: number;
  reviewStatus: EmailProcessingResult["reviewStatus"];
  duplicate: boolean;
}

const vendorNameById = new Map(
  MULTI_VENDOR_MATCH_CONTEXT.vendors.map((v) => [v.id, v.name]),
);

/** Offline fixture-derived proposals for dispatcher review (read-only — no Firestore writes). */
export function getProposedEmailUpdates(): ProposedEmailUpdate[] {
  const existing = {
    byMessageId: new Map<string, string>(),
    byFingerprint: new Map<string, string>(),
  };
  const proposals: ProposedEmailUpdate[] = [];

  for (const fixture of EMAIL_FIXTURES) {
    const result = processInboundEmail(fixture, MULTI_VENDOR_MATCH_CONTEXT, existing);
    if (result.duplicate) continue;
    existing.byMessageId.set(fixture.sourceMessageId, fixture.sourceMessageId);
    existing.byFingerprint.set(contentFingerprint(fixture), fixture.sourceMessageId);

    if (result.reviewStatus === "rejected") continue;

    proposals.push({
      messageId: fixture.sourceMessageId,
      subject: fixture.subject,
      senderEmail: fixture.senderEmail,
      receivedAt: fixture.receivedAt,
      classification: result.parsed.classification,
      poNumber: result.parsed.poNumbers[0] ?? null,
      vendorName: result.match.vendorId
        ? (vendorNameById.get(result.match.vendorId) ?? result.match.vendorId)
        : null,
      confidenceScore: result.match.confidenceScore,
      reviewStatus: result.reviewStatus,
      duplicate: result.duplicate,
    });
  }

  return proposals.sort(
    (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
  );
}

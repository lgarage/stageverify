/**
 * Server-echo helpers for teach-chat ignore rule propose/confirm (D-59 P1).
 */
import { createHash } from "node:crypto";
import {
  documentTypeLabel,
  type InvoiceDocumentType,
  type InvoiceParserFormatId,
} from "./inferDocumentType";
import type { VendorIgnoreFingerprint } from "./aiShadow/vendorIgnoreRules";

export function extractSenderDomain(senderEmail: string): string | null {
  const trimmed = senderEmail.trim();
  const angle = trimmed.match(/<([^>]+)>/);
  const email = (angle?.[1] ?? trimmed).trim().toLowerCase();
  if (!email.includes("@")) return null;
  const domain = email.split("@")[1]?.trim();
  return domain && domain.length > 0 && domain.length <= 253 ? domain : null;
}

const HOSTNAME_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Bare hostname or From-style email → lowercase domain; rejects junk. Max 5 unique. */
export function normalizeSenderDomains(raw: unknown): string[] {
  const inputs: string[] = [];
  if (typeof raw === "string") {
    inputs.push(raw);
  } else if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry === "string") inputs.push(entry);
    }
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of inputs) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    let domain = extractSenderDomain(trimmed);
    if (domain && !HOSTNAME_RE.test(domain)) domain = null;
    if (!domain && !trimmed.includes("@")) {
      const host = trimmed.toLowerCase();
      if (
        host.length >= 3 &&
        host.length <= 253 &&
        !host.includes(" ") &&
        !host.includes("/") &&
        HOSTNAME_RE.test(host)
      ) {
        domain = host;
      }
    }
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
    if (out.length >= 5) break;
  }
  return out;
}

/** SHA-256 of importId|vendorKey|parserFormatId|documentType|senderDomainsJoined|importUpdatedAt */
export function computeEchoToken(input: {
  importId: string;
  vendorKey: string;
  parserFormatId: InvoiceParserFormatId;
  documentType: InvoiceDocumentType;
  senderDomains: string[];
  importUpdatedAt: string;
}): string {
  const payload = [
    input.importId,
    input.vendorKey,
    input.parserFormatId,
    input.documentType,
    input.senderDomains.join(","),
    input.importUpdatedAt,
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

export function buildProposeEchoText(input: {
  fingerprint: VendorIgnoreFingerprint;
  vendorLabel: string;
  senderDomains: string[];
}): string {
  const { fingerprint, vendorLabel, senderDomains } = input;
  const typeLabel = documentTypeLabel(fingerprint.documentType);
  const domainText =
    senderDomains.length === 1
      ? senderDomains[0]
      : senderDomains.join(", ");
  const lines = [
    `I understand: automatically skip future ${typeLabel} imports for ${vendorLabel} (format: ${fingerprint.parserFormatId}).`,
    `Sender domain: ${domainText}.`,
    "New matching documents will be auto-moved to Rejected (recoverable). Nothing is deleted.",
    "A manager must activate this rule before it takes effect.",
  ];
  if (fingerprint.documentType === "credit_memo") {
    lines.push(
      "Note: this is separate from structural credit-return auto-skip — taught rules match by vendor, format, and document type.",
    );
  }
  return lines.join(" ");
}

export function armableFingerprintError(
  fp: VendorIgnoreFingerprint,
): string | null {
  if (fp.vendorKey === "unknown-vendor" || !fp.vendorKey.trim()) {
    return "Vendor unknown — link a vendor first.";
  }
  if (fp.parserFormatId === "unknown") {
    return "Cannot ignore documents with an unknown parser format — resolve the format first.";
  }
  if (fp.documentType === "unknown") {
    return "Cannot ignore documents with an unknown type — the document must be classifiable first.";
  }
  if (fp.documentType === "invoice") {
    return "Cannot ignore documents that look like invoices.";
  }
  if (
    fp.documentType !== "sales_order_confirmation" &&
    fp.documentType !== "credit_memo"
  ) {
    return "This document type cannot be used for an ignore rule.";
  }
  return null;
}

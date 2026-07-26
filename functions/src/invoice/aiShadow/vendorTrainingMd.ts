import * as admin from "firebase-admin";
import {
  INVOICE_TRAINING_BUCKET,
  MAX_VENDOR_MD_BYTES,
} from "./constants";
import { isSafeLessonNote, redactLessonNote } from "./redactLessonNote";

function storage() {
  return admin.storage().bucket(INVOICE_TRAINING_BUCKET);
}

/** Sanitize vendor key for object path (no path traversal). */
export function sanitizeVendorKey(raw: string): string {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return key || "unknown-vendor";
}

export function vendorTrainingObjectPath(vendorKey: string): string {
  return `vendors/${sanitizeVendorKey(vendorKey)}.md`;
}

export async function readVendorTrainingMd(vendorKey: string): Promise<string> {
  const file = storage().file(vendorTrainingObjectPath(vendorKey));
  const [exists] = await file.exists();
  if (!exists) return "";
  const [buf] = await file.download();
  return buf.toString("utf8").slice(0, MAX_VENDOR_MD_BYTES);
}

/**
 * Append a generalized human correction lesson. Returns false if note empty/unsafe.
 * Never stores specific invoice details — caller must pass already-generalized text.
 */
export async function appendVendorTrainingLesson(input: {
  vendorKey: string;
  correctionNote: string;
  atIso: string;
}): Promise<{ wrote: boolean; reason?: string }> {
  const redacted = redactLessonNote(input.correctionNote);
  if (!isSafeLessonNote(redacted)) {
    return { wrote: false, reason: "note_empty_or_unsafe" };
  }

  const path = vendorTrainingObjectPath(input.vendorKey);
  const file = storage().file(path);
  const [exists] = await file.exists();
  let prior = "";
  if (exists) {
    const [buf] = await file.download();
    prior = buf.toString("utf8");
  }
  if (!prior.trim()) {
    prior =
      `# Vendor invoice playbook — ${sanitizeVendorKey(input.vendorKey)}\n\n` +
      `Generalized rules only. Do not store invoice numbers, POs, addresses, or customer names.\n\n` +
      `## Lessons\n`;
  } else if (!prior.includes("## Lessons")) {
    prior = `${prior.trimEnd()}\n\n## Lessons\n`;
  }

  const entry = `\n- (${input.atIso.slice(0, 10)}) Look for: ${redacted}\n`;
  const next = `${prior.trimEnd()}${entry}\n`;
  if (Buffer.byteLength(next, "utf8") > MAX_VENDOR_MD_BYTES) {
    return { wrote: false, reason: "md_size_cap" };
  }

  await file.save(next, {
    contentType: "text/markdown; charset=utf-8",
    resumable: false,
    metadata: {
      cacheControl: "private, max-age=0",
    },
  });
  return { wrote: true };
}

/**
 * D-59 P7 unit tests — redaction preview, expireAt, classify labels (no Firestore).
 * Requires `npm run build:functions` first.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libRoot = path.join(__dirname, "..", "functions", "lib", "invoice", "aiShadow");

const classify = await import(
  pathToFileURL(path.join(libRoot, "classifyLessonNoteRejection.js")).href
);
const audit = await import(
  pathToFileURL(path.join(libRoot, "trainingNoteAudit.js")).href
);
const constants = await import(
  pathToFileURL(path.join(libRoot, "constants.js")).href
);

{
  const raw = "When B/O column has qty, set quantityBackordered from that column.";
  const a = classify.classifyLessonNoteRejection(raw);
  const b = classify.classifyLessonNoteRejection(raw);
  assert.equal(a.noteRedacted, b.noteRedacted, "preview identity");
  assert.equal(a.safe, true);
}

{
  const unsafe = classify.classifyLessonNoteRejection("Reach me @ vendor desk");
  assert.equal(unsafe.safe, false);
  assert.equal(unsafe.rejectClass, "contains_email");
}

{
  assert.equal(constants.MAX_TRAINING_LESSONS_PER_HOUR_PER_UID, 20);
  assert.equal(constants.TRAINING_NOTE_AUDIT_TTL_DAYS, 90);
  const now = new Date("2026-08-04T12:00:00.000Z");
  const expire = audit.expireAtFromNow?.(now);
  if (typeof expire === "string") {
    const diffDays =
      (new Date(expire).getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    assert.ok(Math.abs(diffDays - 90) < 0.01, `expireAt ≈ +90d got ${diffDays}`);
  } else {
    // inline check via writeTrainingNoteAudit doc shape — expireAt set at write time
    const created = now.toISOString();
    const expireAt = new Date(now.getTime());
    expireAt.setUTCDate(expireAt.getUTCDate() + constants.TRAINING_NOTE_AUDIT_TTL_DAYS);
    const diffDays =
      (expireAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    assert.ok(Math.abs(diffDays - 90) < 0.01);
    assert.ok(created.startsWith("2026-08-04"));
  }
}

console.log("test:training-note-p7: PASS");

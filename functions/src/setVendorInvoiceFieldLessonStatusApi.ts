/**
 * Lane C C3-D.2 — Manager lifecycle callable (activate/reject/suspend/reactivate).
 * No parse effect. No auto-activate.
 */
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireManagerAuth } from "./inboundEmail/dispatcherAuth";
import {
  applyFieldLessonStatusTransition,
  type FieldLessonLifecycleRequest,
} from "./invoice/reviewChat/fieldLessonLifecycle";
import type { FieldLessonLifecycleAction } from "./invoice/reviewChat/vendorInvoiceFieldLessons";

function getDb() {
  return admin.firestore();
}

const ACTIONS: FieldLessonLifecycleAction[] = [
  "activate",
  "reject",
  "suspend",
  "reactivate",
];

function parseAction(raw: unknown): FieldLessonLifecycleAction | null {
  return typeof raw === "string" &&
    (ACTIONS as string[]).includes(raw.trim())
    ? (raw.trim() as FieldLessonLifecycleAction)
    : null;
}

export const setVendorInvoiceFieldLessonStatus = onCall(
  { region: "us-central1" },
  async (request) => {
    const uid = await requireManagerAuth(request);
    const data = (request.data ?? {}) as {
      lessonId?: unknown;
      action?: unknown;
      expectedVersion?: unknown;
      idempotencyKey?: unknown;
      note?: unknown;
    };

    const lessonId =
      typeof data.lessonId === "string" ? data.lessonId.trim() : "";
    const action = parseAction(data.action);
    const expectedVersion =
      typeof data.expectedVersion === "number" &&
      Number.isFinite(data.expectedVersion)
        ? Math.floor(data.expectedVersion)
        : null;
    const idempotencyKey =
      typeof data.idempotencyKey === "string"
        ? data.idempotencyKey.trim()
        : "";
    const note =
      typeof data.note === "string" ? data.note.trim().slice(0, 500) : undefined;

    if (!lessonId) {
      throw new HttpsError("invalid-argument", "lessonId is required.");
    }
    if (!action) {
      throw new HttpsError(
        "invalid-argument",
        "action must be activate|reject|suspend|reactivate.",
      );
    }
    if (expectedVersion == null || expectedVersion < 1) {
      throw new HttpsError(
        "invalid-argument",
        "expectedVersion must be a positive integer.",
      );
    }
    if (!idempotencyKey) {
      throw new HttpsError("invalid-argument", "idempotencyKey is required.");
    }

    const lifecycleRequest: FieldLessonLifecycleRequest = {
      lessonId,
      action,
      expectedVersion,
      idempotencyKey,
      note,
      actorUid: uid,
    };

    const outcome = await applyFieldLessonStatusTransition({
      db: getDb(),
      request: lifecycleRequest,
    });

    if (!outcome.ok) {
      switch (outcome.code) {
        case "not_found":
          throw new HttpsError("not-found", outcome.message);
        case "lesson_version_mismatch":
          throw new HttpsError("failed-precondition", "lesson_version_mismatch");
        case "invalid_transition":
          throw new HttpsError("failed-precondition", outcome.message);
        case "revalidation_failed":
          throw new HttpsError(
            "failed-precondition",
            outcome.message || "revalidation_failed",
          );
        default:
          throw new HttpsError("internal", "Lifecycle transition failed.");
      }
    }

    return outcome.result;
  },
);

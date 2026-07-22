import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { todayReleaseDateUtc } from "./technicianSessionValidation";
import { requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";

function getDb() {
  return admin.firestore();
}

interface ReleaseJobsToTechnicianRequest {
  technicianId?: string;
  jobIds?: unknown;
  releaseDate?: string;
}

function asTechnicianId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}

function asReleaseDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

function asJobIdArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > 50) return null;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    const trimmed = entry.trim();
    if (!trimmed || trimmed.length > 128) return null;
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

/** Dispatcher-only: release job(s) to a technician for a day (always-strict source). */
export const releaseJobsToTechnician = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const uid = await requireDispatcherAuth(request);

    const data = (request.data ?? {}) as ReleaseJobsToTechnicianRequest;
    const technicianId = asTechnicianId(data.technicianId);
    const jobIds = asJobIdArray(data.jobIds);
    const releaseDate =
      asReleaseDate(data.releaseDate) ?? todayReleaseDateUtc();

    if (!technicianId || !jobIds) {
      throw new HttpsError(
        "invalid-argument",
        "technicianId and jobIds are required.",
      );
    }

    const techSnap = await getDb()
      .collection("technicians")
      .doc(technicianId)
      .get();
    if (!techSnap.exists || techSnap.data()?.active === false) {
      throw new HttpsError("not-found", "Technician not found.");
    }

    for (const jobId of jobIds) {
      const jobSnap = await getDb().collection("jobs").doc(jobId).get();
      if (!jobSnap.exists) {
        throw new HttpsError("not-found", `Job not found: ${jobId}`);
      }
    }

    const docId = `${technicianId}_${releaseDate}`;
    const now = new Date().toISOString();
    const existing = await getDb()
      .collection("technicianDayReleases")
      .doc(docId)
      .get();

    await getDb()
      .collection("technicianDayReleases")
      .doc(docId)
      .set(
        {
          id: docId,
          technicianId,
          releaseDate,
          jobIds,
          updatedAt: now,
          updatedBy: uid,
          createdAt: existing.exists
            ? (existing.data()?.createdAt as string) ?? now
            : now,
        },
        { merge: true },
      );

    return {
      success: true,
      technicianId,
      releaseDate,
      jobIds,
    };
  },
);

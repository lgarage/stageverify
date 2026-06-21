import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { applyDeliveryReadinessTransaction } from "./applyDeliveryReadiness";
import {
  resolvePickupMaterialIssueReadback,
  type PickupMaterialIssueReadback,
} from "./pickupMaterialIssueReadback";

function getDb() {
  return admin.firestore();
}

const OPEN_ISSUE_STATUSES = ["open", "assigned"] as const;
const MAX_NOTE_LEN = 500;

const RESOLUTION_TYPES = [
  "found_in_shop",
  "pick_up_supply_house",
  "vendor_redeliver",
  "substitute",
  "transfer",
  "continue_without",
  "hold_job",
  "other",
] as const;

type ResolutionType = (typeof RESOLUTION_TYPES)[number];

interface ResolveMaterialIssueRequest {
  issueId?: string;
  resolutionType?: string;
  resolutionNote?: string;
}

function asNonEmptyString(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLen) return null;
  return trimmed;
}

function asResolutionType(value: unknown): ResolutionType | null {
  if (typeof value !== "string") return null;
  return RESOLUTION_TYPES.includes(value as ResolutionType)
    ? (value as ResolutionType)
    : null;
}

function isBlockingType(type: string): boolean {
  return type !== "other" && type !== "running_low";
}

/** Authenticated dispatcher resolves a material issue; recalculates readiness when eligible. */
export const resolveMaterialIssue = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError(
        "permission-denied",
        "Sign in as a dispatcher to resolve issues.",
      );
    }

    const data = (request.data ?? {}) as ResolveMaterialIssueRequest;
    const issueId = asNonEmptyString(data.issueId, 128);
    const resolutionType = asResolutionType(data.resolutionType);
    const resolutionNote = asNonEmptyString(
      data.resolutionNote ?? "Resolved",
      MAX_NOTE_LEN,
    );
    if (!issueId || !resolutionType || !resolutionNote) {
      throw new HttpsError(
        "invalid-argument",
        "issueId, resolutionType, and resolutionNote are required.",
      );
    }

    const issueRef = getDb().collection("materialIssues").doc(issueId);
    const issueSnap = await issueRef.get();
    if (!issueSnap.exists) {
      throw new HttpsError("not-found", "Issue not found.");
    }

    const issue = issueSnap.data()!;
    if (!OPEN_ISSUE_STATUSES.includes(issue.status as (typeof OPEN_ISSUE_STATUSES)[number])) {
      throw new HttpsError(
        "failed-precondition",
        "Issue is not open or assigned.",
      );
    }

    const deliveryOrderId = issue.deliveryOrderId as string;
    const deliveryRef = getDb().collection("deliveries").doc(deliveryOrderId);
    const now = new Date().toISOString();
    const resolvedBy =
      request.auth.token.email?.trim() ||
      request.auth.token.name?.trim() ||
      request.auth.uid;
    const blocking = issue.blocking === true;

    await getDb().runTransaction(async (tx) => {
      const liveIssue = await tx.get(issueRef);
      if (!liveIssue.exists) {
        throw new HttpsError("not-found", "Issue not found.");
      }
      const liveData = liveIssue.data()!;
      if (
        !OPEN_ISSUE_STATUSES.includes(
          liveData.status as (typeof OPEN_ISSUE_STATUSES)[number],
        )
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Issue is not open or assigned.",
        );
      }

      const liveDelivery = await tx.get(deliveryRef);
      if (!liveDelivery.exists) {
        throw new HttpsError("not-found", "Delivery not found.");
      }
      const delivery = liveDelivery.data()!;
      const prevOpen = delivery.openIssueCount ?? 0;
      const prevBlocking = delivery.openBlockingIssueCount ?? 0;

      tx.update(issueRef, {
        status: "resolved",
        resolutionType,
        resolutionNote,
        resolvedAt: now,
        resolvedBy,
        updatedAt: now,
      });
      const pickupMaterialIssues = resolvePickupMaterialIssueReadback(
        delivery.pickupMaterialIssues as PickupMaterialIssueReadback[] | undefined,
        issueId,
        { resolutionType, resolutionNote, resolvedAt: now },
      );
      tx.update(deliveryRef, {
        openIssueCount: Math.max(0, prevOpen - 1),
        openBlockingIssueCount: blocking
          ? Math.max(0, prevBlocking - 1)
          : prevBlocking,
        pickupMaterialIssues,
        updatedAt: now,
      });
    });

    let readinessRecalculated = false;
    const openSnap = await getDb()
      .collection("materialIssues")
      .where("deliveryOrderId", "==", deliveryOrderId)
      .where("status", "in", [...OPEN_ISSUE_STATUSES])
      .get();

    const hasBlockingOpen = openSnap.docs.some((docSnap) => {
      const row = docSnap.data();
      return row.blocking === true || isBlockingType(String(row.type ?? ""));
    });

    if (!hasBlockingOpen) {
      try {
        await applyDeliveryReadinessTransaction(getDb(), deliveryOrderId);
        readinessRecalculated = true;
      } catch {
        readinessRecalculated = false;
      }
    }

    return {
      issueId,
      status: "resolved" as const,
      resolutionType,
      readinessRecalculated,
    };
  },
);

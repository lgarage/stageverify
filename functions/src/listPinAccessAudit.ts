import { onCall } from "firebase-functions/v2/https";
import {
  getDb,
  PIN_ACCESS_AUDIT_COLLECTION,
  type PinAccessAuditDoc,
} from "./accessPinSecretsShared";
import { clampListLimit, requireManagerAuth } from "./inboundEmail/dispatcherAuth";

interface ListPinAccessAuditRequest {
  limit?: number;
  startAfterCreatedAt?: string;
}

export type PinAccessAuditListItem = PinAccessAuditDoc & { id: string };

/** Manager paginated PIN access audit — never includes PIN values. */
export const listPinAccessAudit = onCall(
  { region: "us-central1" },
  async (request) => {
    await requireManagerAuth(request);
    const data = (request.data ?? {}) as ListPinAccessAuditRequest;
    const limit = clampListLimit(data.limit, 25, 100);
    const startAfter =
      typeof data.startAfterCreatedAt === "string"
        ? data.startAfterCreatedAt.trim()
        : "";

    let query = getDb()
      .collection(PIN_ACCESS_AUDIT_COLLECTION)
      .orderBy("createdAt", "desc")
      .limit(limit);

    if (startAfter) {
      query = query.startAfter(startAfter);
    }

    const snap = await query.get();
    const entries: PinAccessAuditListItem[] = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as PinAccessAuditDoc),
    }));

    const lastCreatedAt =
      entries.length > 0 ? entries[entries.length - 1]!.createdAt : null;

    return {
      entries,
      nextStartAfterCreatedAt: lastCreatedAt,
      hasMore: entries.length === limit,
    };
  },
);

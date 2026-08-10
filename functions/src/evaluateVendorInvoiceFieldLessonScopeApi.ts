/**
 * Lane C C3-D.1 — Manager/Admin evaluate callable (no activate, no parse effect).
 */
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireManagerAuth } from "./inboundEmail/dispatcherAuth";
import {
  evaluateFieldLessonScope,
  listRecentExampleScopeKeys,
  parseScopeKey,
  type EvaluateFieldLessonResult,
} from "./invoice/reviewChat/evaluateFieldLessonCandidate";
import { isCorrectableFieldKey } from "./invoice/reviewChat/correctionAllowlist";

function getDb() {
  return admin.firestore();
}

export const evaluateVendorInvoiceFieldLessonCandidates = onCall(
  { region: "us-central1" },
  async (request) => {
    const uid = await requireManagerAuth(request);
    const data = (request.data ?? {}) as {
      scopeKey?: unknown;
      vendorKey?: unknown;
      parserFormatId?: unknown;
      senderDomain?: unknown;
      field?: unknown;
      evaluateRecent?: unknown;
      recentLimit?: unknown;
    };

    const results: EvaluateFieldLessonResult[] = [];

    if (data.evaluateRecent === true) {
      const limit =
        typeof data.recentLimit === "number" ? data.recentLimit : 30;
      const keys = await listRecentExampleScopeKeys(getDb(), limit);
      for (const sk of keys) {
        const parsed = parseScopeKey(sk);
        if (!parsed) continue;
        results.push(
          await evaluateFieldLessonScope({
            db: getDb(),
            scope: parsed,
            actorUid: uid,
          }),
        );
      }
      return { results, count: results.length };
    }

    let scope = null as null | {
      vendorKey: string;
      parserFormatId: string;
      senderDomain: string;
      field: string;
    };
    if (typeof data.scopeKey === "string" && data.scopeKey.trim()) {
      scope = parseScopeKey(data.scopeKey.trim());
      if (!scope) {
        throw new HttpsError("invalid-argument", "Invalid scopeKey.");
      }
    } else {
      const vendorKey =
        typeof data.vendorKey === "string" ? data.vendorKey.trim() : "";
      const parserFormatId =
        typeof data.parserFormatId === "string"
          ? data.parserFormatId.trim()
          : "";
      const senderDomain =
        typeof data.senderDomain === "string"
          ? data.senderDomain.trim().toLowerCase()
          : "";
      const field = typeof data.field === "string" ? data.field.trim() : "";
      if (!vendorKey || !parserFormatId || !senderDomain || !field) {
        throw new HttpsError(
          "invalid-argument",
          "Provide scopeKey or vendorKey+parserFormatId+senderDomain+field (or evaluateRecent:true).",
        );
      }
      if (!isCorrectableFieldKey(field)) {
        throw new HttpsError("invalid-argument", "Unsupported field.");
      }
      scope = { vendorKey, parserFormatId, senderDomain, field };
    }

    const result = await evaluateFieldLessonScope({
      db: getDb(),
      scope,
      actorUid: uid,
    });
    return { results: [result], count: 1 };
  },
);

/**
 * Invoice training Admin — configure alert email/password, Save lesson, MD editor.
 * Password hash in invoiceTrainingAdminSecrets (CF-only). Never in public appSettings.
 */
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";
import {
  asAdminPassword,
  asAlertEmail,
  isAdminFullyConfigured,
  AdminPasswordLockedError,
  storeAdminConfig,
  verifyAdminPassword,
  vendorKeyFromImportDoc,
} from "./invoice/aiShadow/adminConfig";
import {
  readVendorTrainingMd,
  sanitizeVendorKey,
  writeVendorTrainingMd,
} from "./invoice/aiShadow/vendorTrainingMd";
import { saveTrainingLessonCore } from "./invoice/aiShadow/saveTrainingLessonCore";
import type { VendorInvoiceImportDoc } from "./inboundEmail/types";
import {
  CREDIT_RETURN_SKIP_REASON,
  shouldApplyNowDismissCreditImport,
} from "./invoice/creditReturnSkip";

function getDb() {
  return admin.firestore();
}

async function requirePassword(data: unknown): Promise<void> {
  const password = asAdminPassword(
    (data as { password?: unknown } | null)?.password,
  );
  if (!password) {
    throw new HttpsError(
      "invalid-argument",
      `Admin password required (${8}–${128} characters).`,
    );
  }
  try {
    const ok = await verifyAdminPassword(password);
    if (!ok) {
      throw new HttpsError("permission-denied", "Incorrect Admin password.");
    }
  } catch (err) {
    if (err instanceof AdminPasswordLockedError) {
      throw new HttpsError("resource-exhausted", err.message);
    }
    throw err;
  }
}

export const getInvoiceTrainingAdminStatus = onCall(
  { region: "us-central1" },
  async (request) => {
    await requireDispatcherAuth(request);
    const status = await isAdminFullyConfigured();
    return {
      alertEmailConfigured: status.alertEmailConfigured,
      passwordConfigured: status.passwordConfigured,
      fullyConfigured:
        status.alertEmailConfigured && status.passwordConfigured,
      alertEmail: status.alertEmail,
    };
  },
);

export const configureInvoiceTrainingAdmin = onCall(
  { region: "us-central1" },
  async (request) => {
    await requireDispatcherAuth(request);
    const data = (request.data ?? {}) as {
      alertEmail?: unknown;
      password?: unknown;
    };
    const alertEmail = asAlertEmail(data.alertEmail);
    if (!alertEmail) {
      throw new HttpsError(
        "invalid-argument",
        "A valid alert email is required.",
      );
    }
    const password = asAdminPassword(data.password);
    if (!password) {
      throw new HttpsError(
        "invalid-argument",
        "Admin password must be 8–128 characters.",
      );
    }

    await storeAdminConfig({ alertEmail, password });

    return {
      success: true,
      alertEmailConfigured: true,
      passwordConfigured: true,
      fullyConfigured: true,
      alertEmail,
    };
  },
);

export const saveInvoiceTrainingLesson = onCall(
  { region: "us-central1" },
  async (request) => {
    const uid = await requireDispatcherAuth(request);
    const data = (request.data ?? {}) as {
      vendorInvoiceImportId?: unknown;
      correctionNote?: unknown;
    };
    const importId =
      typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    if (!importId || importId.length > 200) {
      throw new HttpsError(
        "invalid-argument",
        "vendorInvoiceImportId is required.",
      );
    }
    const correctionNote =
      typeof data.correctionNote === "string" ? data.correctionNote : "";
    if (!correctionNote.trim()) {
      throw new HttpsError(
        "invalid-argument",
        "Training note is required to save a lesson.",
      );
    }

    const importRef = getDb().collection("vendorInvoiceImports").doc(importId);
    const snap = await importRef.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Invoice import not found.");
    }
    const importDoc = snap.data() as VendorInvoiceImportDoc;
    const vendorKey = vendorKeyFromImportDoc(importDoc);
    const now = new Date().toISOString();
    const applyNowDismiss =
      importDoc.reviewStatus === "pending_review" &&
      shouldApplyNowDismissCreditImport(correctionNote, importDoc);
    const result = await saveTrainingLessonCore({
      vendorKey,
      correctionNoteRaw: correctionNote,
      importId,
      atIso: now,
    });

    let importDismissed = false;
    let reviewStatus = importDoc.reviewStatus ?? "pending_review";
    if (result.trainingLessonWrote && applyNowDismiss) {
      await getDb().runTransaction(async (tx) => {
        const freshSnap = await tx.get(importRef);
        if (!freshSnap.exists) {
          throw new HttpsError("not-found", "Invoice import not found.");
        }
        const fresh = freshSnap.data() as VendorInvoiceImportDoc;
        if (fresh.reviewStatus !== "pending_review") {
          return;
        }
        tx.update(importRef, {
          reviewStatus: "rejected",
          skipReason: CREDIT_RETURN_SKIP_REASON,
          rejectedAt: now,
          rejectedBy: uid,
          trainingLessonAppendedAt: now,
          updatedAt: now,
        });
        importDismissed = true;
      });
      if (importDismissed) {
        reviewStatus = "rejected";
      }
    } else if (result.trainingLessonWrote) {
      await importRef.update({
        trainingLessonAppendedAt: now,
        updatedAt: now,
      });
    }

    return {
      vendorInvoiceImportId: importId,
      vendorKey: sanitizeVendorKey(vendorKey),
      importDismissed,
      reviewStatus,
      ...result,
    };
  },
);

export const getVendorTrainingPlaybook = onCall(
  { region: "us-central1" },
  async (request) => {
    await requireDispatcherAuth(request);
    await requirePassword(request.data);
    const data = (request.data ?? {}) as {
      vendorKey?: unknown;
      vendorInvoiceImportId?: unknown;
    };

    let vendorKeyRaw = "";
    if (typeof data.vendorKey === "string" && data.vendorKey.trim()) {
      vendorKeyRaw = data.vendorKey.trim();
    } else if (
      typeof data.vendorInvoiceImportId === "string" &&
      data.vendorInvoiceImportId.trim()
    ) {
      const snap = await getDb()
        .collection("vendorInvoiceImports")
        .doc(data.vendorInvoiceImportId.trim())
        .get();
      if (!snap.exists) {
        throw new HttpsError("not-found", "Invoice import not found.");
      }
      vendorKeyRaw = vendorKeyFromImportDoc(
        snap.data() as {
          detectedVendorName?: string;
          parserFormatId?: string;
        },
      );
    } else {
      throw new HttpsError(
        "invalid-argument",
        "vendorKey or vendorInvoiceImportId is required.",
      );
    }

    const vendorKey = sanitizeVendorKey(vendorKeyRaw);
    const markdown = await readVendorTrainingMd(vendorKey);
    return { vendorKey, markdown };
  },
);

export const saveVendorTrainingPlaybook = onCall(
  { region: "us-central1" },
  async (request) => {
    await requireDispatcherAuth(request);
    await requirePassword(request.data);
    const data = (request.data ?? {}) as {
      vendorKey?: unknown;
      markdown?: unknown;
    };
    const vendorKeyRaw =
      typeof data.vendorKey === "string" ? data.vendorKey.trim() : "";
    if (!vendorKeyRaw) {
      throw new HttpsError("invalid-argument", "vendorKey is required.");
    }
    const markdown = typeof data.markdown === "string" ? data.markdown : "";
    const vendorKey = sanitizeVendorKey(vendorKeyRaw);
    const result = await writeVendorTrainingMd({ vendorKey, markdown });
    if (!result.wrote) {
      throw new HttpsError(
        "invalid-argument",
        result.reason === "md_size_cap"
          ? "Playbook exceeds size limit."
          : "Playbook markdown is empty.",
      );
    }
    return { vendorKey, wrote: true };
  },
);

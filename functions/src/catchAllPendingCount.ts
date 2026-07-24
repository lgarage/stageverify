import * as admin from "firebase-admin";

const APP_SETTINGS_DOC = "config";

/** Packages dropped at catch-all awaiting management check-in (CF-only field). */
export async function incrementCatchAllPendingCount(
  db: admin.firestore.Firestore,
): Promise<number> {
  const ref = db.collection("appSettings").doc(APP_SETTINGS_DOC);
  await ref.set(
    { catchAllPendingCheckInCount: admin.firestore.FieldValue.increment(1) },
    { merge: true },
  );
  const snap = await ref.get();
  return (snap.data()?.catchAllPendingCheckInCount as number) ?? 0;
}

export async function decrementCatchAllPendingCount(
  db: admin.firestore.Firestore,
): Promise<number> {
  const ref = db.collection("appSettings").doc(APP_SETTINGS_DOC);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = (snap.data()?.catchAllPendingCheckInCount as number) ?? 0;
    const next = Math.max(0, current - 1);
    tx.set(ref, { catchAllPendingCheckInCount: next }, { merge: true });
    return next;
  });
}

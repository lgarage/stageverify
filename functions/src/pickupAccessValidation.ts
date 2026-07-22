import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import {
  asPickupToken,
  verifyPickupTokenForJob,
} from "./pickupTokenValidation";
import {
  asTechnicianSessionToken,
  assertTechnicianSessionForJobPickup,
  type TechnicianSessionDoc,
} from "./technicianSessionValidation";

export type PickupAccessKind = "pickupToken" | "technicianSession";

export interface PickupAccessContext {
  kind: PickupAccessKind;
  technicianSession?: TechnicianSessionDoc;
}

/** Token door OR technician session (day-released job only). */
export async function assertPickupAccessForJob(
  db: admin.firestore.Firestore,
  jobId: string,
  input: { pickupToken?: unknown; technicianSessionToken?: unknown },
): Promise<PickupAccessContext> {
  const pickupToken = asPickupToken(input.pickupToken);
  if (pickupToken) {
    await verifyPickupTokenForJob(db, pickupToken, jobId);
    return { kind: "pickupToken" };
  }

  const technicianSessionToken = asTechnicianSessionToken(
    input.technicianSessionToken,
  );
  if (technicianSessionToken) {
    const session = await assertTechnicianSessionForJobPickup(
      technicianSessionToken,
      jobId,
    );
    return { kind: "technicianSession", technicianSession: session };
  }

  throw new HttpsError(
    "permission-denied",
    "Pickup token or technician session is required.",
  );
}

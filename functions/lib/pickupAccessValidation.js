"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertPickupAccessForJob = assertPickupAccessForJob;
const https_1 = require("firebase-functions/v2/https");
const pickupTokenValidation_1 = require("./pickupTokenValidation");
const technicianSessionValidation_1 = require("./technicianSessionValidation");
/** Token door OR technician session (day-released job only). */
async function assertPickupAccessForJob(db, jobId, input) {
    const pickupToken = (0, pickupTokenValidation_1.asPickupToken)(input.pickupToken);
    if (pickupToken) {
        await (0, pickupTokenValidation_1.verifyPickupTokenForJob)(db, pickupToken, jobId);
        return { kind: "pickupToken" };
    }
    const technicianSessionToken = (0, technicianSessionValidation_1.asTechnicianSessionToken)(input.technicianSessionToken);
    if (technicianSessionToken) {
        const session = await (0, technicianSessionValidation_1.assertTechnicianSessionForJobPickup)(technicianSessionToken, jobId);
        return { kind: "technicianSession", technicianSession: session };
    }
    throw new https_1.HttpsError("permission-denied", "Pickup token or technician session is required.");
}
//# sourceMappingURL=pickupAccessValidation.js.map
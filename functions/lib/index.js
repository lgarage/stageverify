"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reopenVendorEmailEventCallable = exports.dismissVendorEmailEventCallable = exports.reparseVendorInvoiceImportCallable = exports.approveVendorInvoiceImport = exports.matchInvoiceToRecordsCallable = exports.getVendorInvoicePdf = exports.getVendorInvoiceImport = exports.listVendorInvoiceImports = exports.getInboundEmailProcessing = exports.listInboundEmailProcessing = exports.renewGmailWatch = exports.gmailInboxPushIngest = exports.triggerInboundGmailSyncCallable = exports.registerGmailWatchCallable = exports.syncInboundGmail = exports.sendVendorEmail = exports.disconnectGmailOAuth = exports.completeGmailOAuth = exports.initiateGmailOAuth = exports.processInboundVendorEmail = exports.recordVendorLocationScan = exports.markVendorDeliveriesBulk = exports.getVendorRunDeliveries = exports.getJobVendorDeliveries = exports.getLocationPublicBranding = exports.markPickupDeliveryInstalled = exports.updateVendorDeliveryStatus = exports.updateVendorItemQty = exports.submitVendorCheckin = exports.getVendorStagingOccupancy = exports.getPickupPortalData = exports.resolveReceiveZoneLookup = exports.getVendorReceiveDetails = exports.releasePlannedStagingLocation = exports.assignVendorStagingLocation = exports.markVendorDelivered = exports.recalculateDeliveryReadiness = exports.resolveMaterialIssue = exports.updatePickupChecklist = exports.recordPickupEvent = exports.validatePickupToken = exports.getPickupTokenStatus = exports.revokePickupToken = exports.generatePickupToken = exports.validateVendorSession = exports.verifyVendorPin = exports.createMaterialIssue = exports.autoSubmitDeliveries = void 0;
const admin = require("firebase-admin");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const applyDeliveryReadiness_1 = require("./applyDeliveryReadiness");
const createMaterialIssue_1 = require("./createMaterialIssue");
Object.defineProperty(exports, "createMaterialIssue", { enumerable: true, get: function () { return createMaterialIssue_1.createMaterialIssue; } });
const verifyVendorPin_1 = require("./verifyVendorPin");
Object.defineProperty(exports, "verifyVendorPin", { enumerable: true, get: function () { return verifyVendorPin_1.verifyVendorPin; } });
const recordPickupEvent_1 = require("./recordPickupEvent");
Object.defineProperty(exports, "recordPickupEvent", { enumerable: true, get: function () { return recordPickupEvent_1.recordPickupEvent; } });
const recalculateDeliveryReadiness_1 = require("./recalculateDeliveryReadiness");
Object.defineProperty(exports, "recalculateDeliveryReadiness", { enumerable: true, get: function () { return recalculateDeliveryReadiness_1.recalculateDeliveryReadiness; } });
const markVendorDelivered_1 = require("./markVendorDelivered");
Object.defineProperty(exports, "markVendorDelivered", { enumerable: true, get: function () { return markVendorDelivered_1.markVendorDelivered; } });
const processInboundVendorEmail_1 = require("./processInboundVendorEmail");
Object.defineProperty(exports, "processInboundVendorEmail", { enumerable: true, get: function () { return processInboundVendorEmail_1.processInboundVendorEmail; } });
const validateVendorSession_1 = require("./validateVendorSession");
Object.defineProperty(exports, "validateVendorSession", { enumerable: true, get: function () { return validateVendorSession_1.validateVendorSession; } });
const generatePickupToken_1 = require("./generatePickupToken");
Object.defineProperty(exports, "generatePickupToken", { enumerable: true, get: function () { return generatePickupToken_1.generatePickupToken; } });
const revokePickupToken_1 = require("./revokePickupToken");
Object.defineProperty(exports, "revokePickupToken", { enumerable: true, get: function () { return revokePickupToken_1.revokePickupToken; } });
const getPickupTokenStatus_1 = require("./getPickupTokenStatus");
Object.defineProperty(exports, "getPickupTokenStatus", { enumerable: true, get: function () { return getPickupTokenStatus_1.getPickupTokenStatus; } });
const validatePickupToken_1 = require("./validatePickupToken");
Object.defineProperty(exports, "validatePickupToken", { enumerable: true, get: function () { return validatePickupToken_1.validatePickupToken; } });
const updatePickupChecklist_1 = require("./updatePickupChecklist");
Object.defineProperty(exports, "updatePickupChecklist", { enumerable: true, get: function () { return updatePickupChecklist_1.updatePickupChecklist; } });
const resolveMaterialIssue_1 = require("./resolveMaterialIssue");
Object.defineProperty(exports, "resolveMaterialIssue", { enumerable: true, get: function () { return resolveMaterialIssue_1.resolveMaterialIssue; } });
const gmailOAuth_1 = require("./gmailOAuth");
Object.defineProperty(exports, "initiateGmailOAuth", { enumerable: true, get: function () { return gmailOAuth_1.initiateGmailOAuth; } });
Object.defineProperty(exports, "completeGmailOAuth", { enumerable: true, get: function () { return gmailOAuth_1.completeGmailOAuth; } });
Object.defineProperty(exports, "disconnectGmailOAuth", { enumerable: true, get: function () { return gmailOAuth_1.disconnectGmailOAuth; } });
const sendVendorEmail_1 = require("./sendVendorEmail");
Object.defineProperty(exports, "sendVendorEmail", { enumerable: true, get: function () { return sendVendorEmail_1.sendVendorEmail; } });
const syncInboundGmail_1 = require("./syncInboundGmail");
Object.defineProperty(exports, "syncInboundGmail", { enumerable: true, get: function () { return syncInboundGmail_1.syncInboundGmail; } });
const registerGmailWatch_1 = require("./registerGmailWatch");
Object.defineProperty(exports, "registerGmailWatchCallable", { enumerable: true, get: function () { return registerGmailWatch_1.registerGmailWatchCallable; } });
const triggerInboundGmailSyncCallable_1 = require("./triggerInboundGmailSyncCallable");
Object.defineProperty(exports, "triggerInboundGmailSyncCallable", { enumerable: true, get: function () { return triggerInboundGmailSyncCallable_1.triggerInboundGmailSyncCallable; } });
const gmailPubSubIngest_1 = require("./gmailPubSubIngest");
Object.defineProperty(exports, "gmailInboxPushIngest", { enumerable: true, get: function () { return gmailPubSubIngest_1.gmailInboxPushIngest; } });
const renewGmailWatch_1 = require("./renewGmailWatch");
Object.defineProperty(exports, "renewGmailWatch", { enumerable: true, get: function () { return renewGmailWatch_1.renewGmailWatch; } });
const inboundEmailProcessingApi_1 = require("./inboundEmailProcessingApi");
Object.defineProperty(exports, "listInboundEmailProcessing", { enumerable: true, get: function () { return inboundEmailProcessingApi_1.listInboundEmailProcessing; } });
Object.defineProperty(exports, "getInboundEmailProcessing", { enumerable: true, get: function () { return inboundEmailProcessingApi_1.getInboundEmailProcessing; } });
Object.defineProperty(exports, "listVendorInvoiceImports", { enumerable: true, get: function () { return inboundEmailProcessingApi_1.listVendorInvoiceImports; } });
Object.defineProperty(exports, "getVendorInvoiceImport", { enumerable: true, get: function () { return inboundEmailProcessingApi_1.getVendorInvoiceImport; } });
Object.defineProperty(exports, "getVendorInvoicePdf", { enumerable: true, get: function () { return inboundEmailProcessingApi_1.getVendorInvoicePdf; } });
const matchInvoiceToRecordsCallable_1 = require("./matchInvoiceToRecordsCallable");
Object.defineProperty(exports, "matchInvoiceToRecordsCallable", { enumerable: true, get: function () { return matchInvoiceToRecordsCallable_1.matchInvoiceToRecordsCallable; } });
const approveVendorInvoiceImport_1 = require("./approveVendorInvoiceImport");
Object.defineProperty(exports, "approveVendorInvoiceImport", { enumerable: true, get: function () { return approveVendorInvoiceImport_1.approveVendorInvoiceImport; } });
const reparseVendorInvoiceImportCallable_1 = require("./reparseVendorInvoiceImportCallable");
Object.defineProperty(exports, "reparseVendorInvoiceImportCallable", { enumerable: true, get: function () { return reparseVendorInvoiceImportCallable_1.reparseVendorInvoiceImportCallable; } });
const dismissVendorEmailEventCallable_1 = require("./dismissVendorEmailEventCallable");
Object.defineProperty(exports, "dismissVendorEmailEventCallable", { enumerable: true, get: function () { return dismissVendorEmailEventCallable_1.dismissVendorEmailEventCallable; } });
const reopenVendorEmailEventCallable_1 = require("./reopenVendorEmailEventCallable");
Object.defineProperty(exports, "reopenVendorEmailEventCallable", { enumerable: true, get: function () { return reopenVendorEmailEventCallable_1.reopenVendorEmailEventCallable; } });
const assignVendorStagingLocation_1 = require("./assignVendorStagingLocation");
Object.defineProperty(exports, "assignVendorStagingLocation", { enumerable: true, get: function () { return assignVendorStagingLocation_1.assignVendorStagingLocation; } });
const releasePlannedStagingLocation_1 = require("./releasePlannedStagingLocation");
Object.defineProperty(exports, "releasePlannedStagingLocation", { enumerable: true, get: function () { return releasePlannedStagingLocation_1.releasePlannedStagingLocation; } });
const getVendorReceiveDetails_1 = require("./getVendorReceiveDetails");
Object.defineProperty(exports, "getVendorReceiveDetails", { enumerable: true, get: function () { return getVendorReceiveDetails_1.getVendorReceiveDetails; } });
const resolveReceiveZoneLookup_1 = require("./resolveReceiveZoneLookup");
Object.defineProperty(exports, "resolveReceiveZoneLookup", { enumerable: true, get: function () { return resolveReceiveZoneLookup_1.resolveReceiveZoneLookup; } });
const getPickupPortalData_1 = require("./getPickupPortalData");
Object.defineProperty(exports, "getPickupPortalData", { enumerable: true, get: function () { return getPickupPortalData_1.getPickupPortalData; } });
const getVendorStagingOccupancy_1 = require("./getVendorStagingOccupancy");
Object.defineProperty(exports, "getVendorStagingOccupancy", { enumerable: true, get: function () { return getVendorStagingOccupancy_1.getVendorStagingOccupancy; } });
const submitVendorCheckin_1 = require("./submitVendorCheckin");
Object.defineProperty(exports, "submitVendorCheckin", { enumerable: true, get: function () { return submitVendorCheckin_1.submitVendorCheckin; } });
const updateVendorItemQty_1 = require("./updateVendorItemQty");
Object.defineProperty(exports, "updateVendorItemQty", { enumerable: true, get: function () { return updateVendorItemQty_1.updateVendorItemQty; } });
const updateVendorDeliveryStatus_1 = require("./updateVendorDeliveryStatus");
Object.defineProperty(exports, "updateVendorDeliveryStatus", { enumerable: true, get: function () { return updateVendorDeliveryStatus_1.updateVendorDeliveryStatus; } });
const markPickupDeliveryInstalled_1 = require("./markPickupDeliveryInstalled");
Object.defineProperty(exports, "markPickupDeliveryInstalled", { enumerable: true, get: function () { return markPickupDeliveryInstalled_1.markPickupDeliveryInstalled; } });
const getLocationPublicBranding_1 = require("./getLocationPublicBranding");
Object.defineProperty(exports, "getLocationPublicBranding", { enumerable: true, get: function () { return getLocationPublicBranding_1.getLocationPublicBranding; } });
const getJobVendorDeliveries_1 = require("./getJobVendorDeliveries");
Object.defineProperty(exports, "getJobVendorDeliveries", { enumerable: true, get: function () { return getJobVendorDeliveries_1.getJobVendorDeliveries; } });
const getVendorRunDeliveries_1 = require("./getVendorRunDeliveries");
Object.defineProperty(exports, "getVendorRunDeliveries", { enumerable: true, get: function () { return getVendorRunDeliveries_1.getVendorRunDeliveries; } });
const markVendorDeliveriesBulk_1 = require("./markVendorDeliveriesBulk");
Object.defineProperty(exports, "markVendorDeliveriesBulk", { enumerable: true, get: function () { return markVendorDeliveriesBulk_1.markVendorDeliveriesBulk; } });
const recordVendorLocationScan_1 = require("./recordVendorLocationScan");
Object.defineProperty(exports, "recordVendorLocationScan", { enumerable: true, get: function () { return recordVendorLocationScan_1.recordVendorLocationScan; } });
admin.initializeApp();
const db = admin.firestore();
const DEFAULT_AUTO_SUBMIT_MINUTES = 30;
exports.autoSubmitDeliveries = (0, scheduler_1.onSchedule)({
    schedule: "every 5 minutes",
    region: "us-central1",
    timeoutSeconds: 120,
}, async () => {
    const settingsSnap = await db
        .collection("appSettings")
        .doc("config")
        .get();
    const settings = settingsSnap.exists
        ? settingsSnap.data()
        : {};
    const autoSubmitMs = (settings.autoSubmitMinutes ?? DEFAULT_AUTO_SUBMIT_MINUTES) * 60 * 1000;
    const now = Date.now();
    const cutoffIso = new Date(now - autoSubmitMs).toISOString();
    const snap = await db
        .collection("deliveries")
        .where("status", "==", "arrived")
        .get();
    if (snap.empty)
        return;
    const eligible = snap.docs.filter((d) => {
        const data = d.data();
        if (!data.lastCheckmarkAt)
            return false;
        if (data.submittedAt)
            return false;
        return data.lastCheckmarkAt <= cutoffIso;
    });
    if (eligible.length === 0)
        return;
    for (const deliveryDoc of eligible) {
        const delivery = deliveryDoc.data();
        const deliveryId = deliveryDoc.id;
        const nowIso = new Date(now).toISOString();
        try {
            const itemsSnap = await db
                .collection("items")
                .where("deliveryOrderId", "==", deliveryId)
                .limit(501)
                .get();
            if (itemsSnap.empty || itemsSnap.size > 500)
                continue;
            const items = itemsSnap.docs.map((d) => d.data());
            const anyReceived = items.some((i) => i.qtyReceived > 0);
            if (!anyReceived)
                continue;
            // Query selects status == "arrived"; auto-submit always promotes to partial.
            const submitHistoryId = `event-auto-submit-${crypto.randomUUID()}`;
            const batch = db.batch();
            batch.update(deliveryDoc.ref, {
                status: "partial",
                submittedAt: nowIso,
                updatedAt: nowIso,
            });
            batch.set(db.collection("statusHistory").doc(submitHistoryId), {
                id: submitHistoryId,
                entityType: "delivery_order",
                entityId: deliveryId,
                fromStatus: delivery.status,
                toStatus: "partial",
                reason: "Auto-submitted after inactivity timeout",
                actorType: "system",
                actorName: "Auto-Submit",
                createdAt: nowIso,
            });
            await batch.commit();
            await (0, applyDeliveryReadiness_1.applyDeliveryReadinessTransaction)(db, deliveryId, {
                historyReason: "Auto-submit readiness recalculation",
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`autoSubmitDeliveries: delivery ${deliveryId} failed — ${message}`);
        }
    }
});
//# sourceMappingURL=index.js.map
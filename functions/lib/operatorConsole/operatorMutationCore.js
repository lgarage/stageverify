"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPhysicalLocation = buildPhysicalLocation;
exports.buildActivityEvent = buildActivityEvent;
exports.buildUsersForCustomer = buildUsersForCustomer;
exports.buildCustomerBundle = buildCustomerBundle;
exports.newCustomerRecord = newCustomerRecord;
exports.assertSpotIdentityIsolation = assertSpotIdentityIsolation;
exports.assertLocationIdsBelongToCustomer = assertLocationIdsBelongToCustomer;
const customerModels_1 = require("./customerModels");
const locationLayout_1 = require("./locationLayout");
const operatorIds_1 = require("./operatorIds");
function buildPhysicalLocation(customerId, input, nowIso) {
    const locationId = (0, operatorIds_1.newLocationId)();
    const physicalAddress = (0, locationLayout_1.copyAddress)(input.physicalAddress);
    const billingAddress = input.billingSameAsPhysical
        ? (0, locationLayout_1.copyAddress)(physicalAddress)
        : (0, locationLayout_1.copyAddress)(input.billingAddress);
    const layout = (0, locationLayout_1.buildLocationLayout)({
        customerId,
        locationId,
        groundSpotCount: input.groundSpotCount,
        shelfSpotCount: input.shelfSpotCount,
        nowIso,
    });
    return {
        locationId,
        customerId,
        locationName: input.locationName,
        physicalAddress,
        billingAddress,
        billingSameAsPhysical: input.billingSameAsPhysical,
        billingContactName: input.billingContactName,
        billingEmail: input.billingEmail,
        billingPhone: input.billingPhone,
        onboardingStatus: "NEW",
        locationStatus: "active",
        spotAllowance: input.spotAllowance ?? customerModels_1.DEFAULT_SPOT_ALLOWANCE,
        foundingPrice: true,
        monthlyPriceUsd: customerModels_1.FOUNDING_MONTHLY_USD,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        layout,
        createdAt: nowIso,
        updatedAt: nowIso,
    };
}
function buildActivityEvent(input, nowIso) {
    const event = {
        eventId: (0, operatorIds_1.newEventId)(),
        createdAt: input.createdAt ?? nowIso,
        customerId: input.customerId,
        type: input.type,
        message: input.message,
        actorUid: input.actorUid,
    };
    if (input.locationId) {
        event.locationId = input.locationId;
    }
    return event;
}
function buildUsersForCustomer(customerId, userInputs, locations, nowIso) {
    return userInputs.map((userInput) => {
        let locationIds = [];
        if (userInput.locationIds?.length) {
            locationIds = [...userInput.locationIds];
        }
        else if (userInput.locationIndexes?.length) {
            locationIds = userInput.locationIndexes
                .map((idx) => locations[idx]?.locationId)
                .filter((id) => Boolean(id));
        }
        return {
            userId: (0, operatorIds_1.newUserId)(),
            customerId,
            name: userInput.name,
            email: userInput.email,
            role: userInput.role,
            locationIds,
            createdAt: nowIso,
            updatedAt: nowIso,
        };
    });
}
function buildCustomerBundle(customer, locations, users, events) {
    return { customer, locations, users, events };
}
function newCustomerRecord(input, nowIso) {
    return {
        customerId: (0, operatorIds_1.newCustomerId)(),
        companyName: input.companyName,
        primaryContactName: input.primaryContactName,
        primaryContactEmail: input.primaryContactEmail,
        primaryContactPhone: input.primaryContactPhone,
        customerStatus: input.customerStatus ?? "prospect",
        notes: input.notes?.trim() ?? "",
        createdAt: nowIso,
        updatedAt: nowIso,
    };
}
/** Ensures globally unique spotId per visible label scope (customer + location). */
function assertSpotIdentityIsolation(locations, visibleLabel) {
    const matches = locations.flatMap((loc) => loc.layout.spots
        .filter((spot) => spot.visibleLabel === visibleLabel)
        .map((spot) => ({
        spotId: spot.spotId,
        customerId: spot.customerId,
        locationId: spot.locationId,
    })));
    const spotIds = new Set(matches.map((m) => m.spotId));
    if (spotIds.size !== matches.length) {
        throw new Error(`Spot identity collision for label ${visibleLabel}: duplicate spotId`);
    }
    const scopes = new Set(matches.map((m) => `${m.customerId}:${m.locationId}:${visibleLabel}`));
    if (scopes.size !== matches.length) {
        throw new Error(`Spot identity collision for label ${visibleLabel}: duplicate scope`);
    }
}
function assertLocationIdsBelongToCustomer(customerId, locationIds, locations) {
    const allowed = new Set(locations.filter((l) => l.customerId === customerId).map((l) => l.locationId));
    for (const locationId of locationIds) {
        if (!allowed.has(locationId)) {
            throw new Error(`Location ${locationId} does not belong to customer ${customerId}`);
        }
    }
}
//# sourceMappingURL=operatorMutationCore.js.map
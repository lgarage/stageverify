"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.copyAddress = copyAddress;
exports.buildLocationLayout = buildLocationLayout;
exports.spotCountsFromLayout = spotCountsFromLayout;
const operatorIds_1 = require("./operatorIds");
function copyAddress(address) {
    return { ...address };
}
function buildLocationLayout(input) {
    const spots = [];
    for (let i = 1; i <= input.groundSpotCount; i += 1) {
        spots.push({
            spotId: (0, operatorIds_1.newSpotId)(),
            customerId: input.customerId,
            locationId: input.locationId,
            visibleLabel: `G${i}`,
            kind: "ground",
            qrToken: null,
            createdAt: input.nowIso,
        });
    }
    for (let i = 1; i <= input.shelfSpotCount; i += 1) {
        spots.push({
            spotId: (0, operatorIds_1.newSpotId)(),
            customerId: input.customerId,
            locationId: input.locationId,
            visibleLabel: `S${i}`,
            kind: "shelf",
            qrToken: null,
            createdAt: input.nowIso,
        });
    }
    return {
        customerId: input.customerId,
        locationId: input.locationId,
        spots,
    };
}
function spotCountsFromLayout(layout) {
    const ground = layout.spots.filter((s) => s.kind === "ground").length;
    const shelf = layout.spots.filter((s) => s.kind === "shelf").length;
    return { ground, shelf, total: ground + shelf };
}
//# sourceMappingURL=locationLayout.js.map
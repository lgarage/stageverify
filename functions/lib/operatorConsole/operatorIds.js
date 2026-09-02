"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.newCustomerId = newCustomerId;
exports.newLocationId = newLocationId;
exports.newUserId = newUserId;
exports.newSpotId = newSpotId;
exports.newEventId = newEventId;
exports.newServerOperationId = newServerOperationId;
const node_crypto_1 = require("node:crypto");
/** Server-minted permanent unique ID prefixes for operator foundation entities. */
function newCustomerId() {
    return `cus_${(0, node_crypto_1.randomUUID)()}`;
}
function newLocationId() {
    return `loc_${(0, node_crypto_1.randomUUID)()}`;
}
function newUserId() {
    return `usr_${(0, node_crypto_1.randomUUID)()}`;
}
function newSpotId() {
    return `spt_${(0, node_crypto_1.randomUUID)()}`;
}
function newEventId() {
    return `evt_${(0, node_crypto_1.randomUUID)()}`;
}
function newServerOperationId() {
    return `op_${(0, node_crypto_1.randomUUID)()}`.slice(0, 64);
}
//# sourceMappingURL=operatorIds.js.map
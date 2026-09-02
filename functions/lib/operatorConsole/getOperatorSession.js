"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOperatorSession = void 0;
exports.getOperatorSessionForUid = getOperatorSessionForUid;
const https_1 = require("firebase-functions/v2/https");
const operatorAuth_1 = require("./operatorAuth");
const operatorCollections_1 = require("./operatorCollections");
exports.getOperatorSession = (0, https_1.onCall)({
    region: "us-central1",
    cors: operatorCollections_1.OPERATOR_CALLABLE_CORS,
}, async (request) => {
    if (!request.auth?.uid) {
        return { isOperator: false };
    }
    try {
        await (0, operatorAuth_1.requireOperatorAuth)(request);
        return { isOperator: true };
    }
    catch {
        return { isOperator: false };
    }
});
async function getOperatorSessionForUid(uid) {
    if (!uid)
        return { isOperator: false };
    const active = await (0, operatorAuth_1.isActiveOperator)(uid);
    return { isOperator: active };
}
//# sourceMappingURL=getOperatorSession.js.map
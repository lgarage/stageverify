"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.vertexGenerateJson = vertexGenerateJson;
const google_auth_library_1 = require("google-auth-library");
const constants_1 = require("./constants");
const auth = new google_auth_library_1.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});
function extractJsonObject(text) {
    const trimmed = text.trim();
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fence ? fence[1].trim() : trimmed;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) {
        throw new Error("model_response_not_json");
    }
    return JSON.parse(candidate.slice(start, end + 1));
}
async function vertexGenerateJson(input) {
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token.token) {
        throw new Error("vertex_auth_failed");
    }
    const url = `https://aiplatform.googleapis.com/v1/projects/${constants_1.VERTEX_PROJECT}` +
        `/locations/${constants_1.VERTEX_LOCATION}/publishers/google/models/${input.modelId}:generateContent`;
    const body = {
        systemInstruction: {
            parts: [{ text: input.systemInstruction }],
        },
        contents: [
            {
                role: "user",
                parts: [{ text: input.userText.slice(0, constants_1.MAX_EXTRACT_CHARS_FOR_MODEL) }],
            },
        ],
        generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
            thinkingConfig: {
                thinkingLevel: input.thinkingLevel,
            },
        },
    };
    const res = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token.token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`vertex_http_${res.status}:${errText.slice(0, 200).replace(/\s+/g, " ")}`);
    }
    const data = (await res.json());
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
        "";
    if (!text.trim()) {
        throw new Error("vertex_empty_response");
    }
    return extractJsonObject(text);
}
//# sourceMappingURL=vertexGenerate.js.map
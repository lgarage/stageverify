import { GoogleAuth } from "google-auth-library";
import {
  MAX_EXTRACT_CHARS_FOR_MODEL,
  VERTEX_LOCATION,
  VERTEX_PROJECT,
} from "./constants";

type ThinkingLevel = "minimal" | "low" | "medium" | "high";

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("model_response_not_json");
  }
  return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}

export async function vertexGenerateJson(input: {
  modelId: string;
  thinkingLevel: ThinkingLevel;
  systemInstruction: string;
  userText: string;
}): Promise<unknown> {
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) {
    throw new Error("vertex_auth_failed");
  }

  const url =
    `https://aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT}` +
    `/locations/${VERTEX_LOCATION}/publishers/google/models/${input.modelId}:generateContent`;

  const body = {
    systemInstruction: {
      parts: [{ text: input.systemInstruction }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: input.userText.slice(0, MAX_EXTRACT_CHARS_FOR_MODEL) }],
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
    throw new Error(
      `vertex_http_${res.status}:${errText.slice(0, 200).replace(/\s+/g, " ")}`,
    );
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
    "";
  if (!text.trim()) {
    throw new Error("vertex_empty_response");
  }
  return extractJsonObject(text);
}

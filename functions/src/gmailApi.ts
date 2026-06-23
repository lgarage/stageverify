/**
 * Gmail OAuth token refresh + send helpers (server-side only).
 * Never log tokens or refresh responses.
 */
import { defineSecret } from "firebase-functions/params";

export const gmailClientId = defineSecret("GMAIL_OAUTH_CLIENT_ID");
export const gmailClientSecret = defineSecret("GMAIL_OAUTH_CLIENT_SECRET");

export function trimSecret(value: string | undefined): string {
  return (value ?? "").trim();
}

export async function refreshGmailAccessToken(refreshToken: string): Promise<string> {
  const clientId = trimSecret(gmailClientId.value());
  const clientSecret = trimSecret(gmailClientSecret.value());
  if (!clientId || !clientSecret) {
    throw new Error("Gmail OAuth client credentials not configured");
  }

  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`token refresh failed: ${res.status}`);
  }

  const data = JSON.parse(text) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("token refresh missing access_token");
  }
  return data.access_token;
}

function encodeRfc2822Subject(subject: string): string {
  if (/^[\x20-\x7E]*$/.test(subject)) return subject;
  const encoded = Buffer.from(subject, "utf8").toString("base64");
  return `=?UTF-8?B?${encoded}?=`;
}

/** Base64url-encoded RFC 2822 message for Gmail users.messages.send. */
export function buildGmailRawMessage(
  to: string,
  from: string,
  subject: string,
  bodyText: string,
): string {
  for (const value of [to, from, subject]) {
    if (/[\r\n]/.test(value)) {
      throw new Error("invalid email header value");
    }
  }

  const message = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${encodeRfc2822Subject(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    bodyText,
  ].join("\r\n");

  return Buffer.from(message, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendGmailMessage(
  accessToken: string,
  raw: string,
): Promise<{ id: string; threadId?: string }> {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`gmail send failed: ${res.status}`);
  }

  const data = JSON.parse(text) as { id?: string; threadId?: string };
  if (!data.id) {
    throw new Error("gmail send missing message id");
  }
  return { id: data.id, threadId: data.threadId };
}

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

/** True when value contains CR or LF (RFC 2822 header injection). */
export function containsCrlfInEmailHeader(value: string): boolean {
  return /[\r\n]/.test(value);
}

export function assertSafeEmailHeaderValue(value: string, field: string): void {
  if (containsCrlfInEmailHeader(value)) {
    throw new Error(`invalid email header value: ${field}`);
  }
}

function formatEmailHeader(name: string, value: string): string {
  assertSafeEmailHeaderValue(name, "header name");
  assertSafeEmailHeaderValue(value, name);
  return `${name}: ${value}`;
}

function encodeRfc2822Subject(subject: string): string {
  assertSafeEmailHeaderValue(subject, "Subject");
  const encoded = /^[\x20-\x7E]*$/.test(subject)
    ? subject
    : `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
  assertSafeEmailHeaderValue(encoded, "Subject (encoded)");
  return encoded;
}

export interface BuildGmailRawMessageOptions {
  replyTo?: string;
  /** Friendly display name — e.g. "L. Garage Dispatch (StageVerify)" */
  fromDisplayName?: string;
  cc?: string[];
  inReplyTo?: string;
  references?: string[];
}

function formatFromHeader(fromEmail: string, displayName?: string): string {
  if (!displayName?.trim()) return fromEmail;
  assertSafeEmailHeaderValue(displayName, "From display name");
  const escaped = displayName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}" <${fromEmail}>`;
}

/** Base64url-encoded RFC 2822 message for Gmail users.messages.send. */
export function buildGmailRawMessage(
  to: string,
  from: string,
  subject: string,
  bodyText: string,
  options?: BuildGmailRawMessageOptions | string,
): string {
  const opts: BuildGmailRawMessageOptions =
    typeof options === "string" ? { replyTo: options } : (options ?? {});

  assertSafeEmailHeaderValue(to, "To");
  assertSafeEmailHeaderValue(from, "From");
  assertSafeEmailHeaderValue(subject, "Subject");
  if (opts.replyTo !== undefined) {
    assertSafeEmailHeaderValue(opts.replyTo, "Reply-To");
  }
  if (opts.cc?.length) {
    for (const cc of opts.cc) {
      assertSafeEmailHeaderValue(cc, "Cc");
    }
  }
  if (opts.inReplyTo) {
    assertSafeEmailHeaderValue(opts.inReplyTo, "In-Reply-To");
  }
  if (opts.references?.length) {
    for (const ref of opts.references) {
      assertSafeEmailHeaderValue(ref, "References");
    }
  }

  const fromHeader = formatFromHeader(from, opts.fromDisplayName);

  const headerLines = [
    formatEmailHeader("To", to),
    formatEmailHeader("From", fromHeader),
    formatEmailHeader("Subject", encodeRfc2822Subject(subject)),
  ];
  if (opts.cc?.length) {
    headerLines.push(formatEmailHeader("Cc", opts.cc.join(", ")));
  }
  if (opts.inReplyTo) {
    headerLines.push(formatEmailHeader("In-Reply-To", opts.inReplyTo));
  }
  if (opts.references?.length) {
    headerLines.push(formatEmailHeader("References", opts.references.join(" ")));
  }
  if (opts.replyTo !== undefined) {
    headerLines.push(formatEmailHeader("Reply-To", opts.replyTo));
  }
  headerLines.push(
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
  );

  const message = [...headerLines, "", bodyText].join("\r\n");

  return Buffer.from(message, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendGmailMessage(
  accessToken: string,
  raw: string,
  options?: { threadId?: string },
): Promise<{ id: string; threadId?: string }> {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      raw,
      ...(options?.threadId ? { threadId: options.threadId } : {}),
    }),
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

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Fetch RFC 822 Message-ID after send (Gmail send API returns only internal id). */
export async function getGmailMessageMetadata(
  accessToken: string,
  messageId: string,
): Promise<{ rfc822MessageId?: string; threadId?: string }> {
  const params = new URLSearchParams({
    format: "metadata",
    metadataHeaders: "Message-ID",
  });
  const res = await fetch(
    `${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`gmail metadata failed: ${res.status}`);
  }
  const data = JSON.parse(text) as {
    threadId?: string;
    payload?: { headers?: Array<{ name?: string; value?: string }> };
  };
  let rfc822MessageId: string | undefined;
  for (const h of data.payload?.headers ?? []) {
    if (h.name?.toLowerCase() === "message-id" && h.value) {
      rfc822MessageId = h.value.trim();
      break;
    }
  }
  return { rfc822MessageId, threadId: data.threadId };
}

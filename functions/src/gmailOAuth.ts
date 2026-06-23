/**
 * Gmail OAuth connection state (Phase 6 slice 1 — no send, no watch).
 *
 * Secrets (Firebase Functions secrets — never commit real values):
 *   GMAIL_OAUTH_CLIENT_ID
 *   GMAIL_OAUTH_CLIENT_SECRET
 *   GMAIL_OAUTH_REDIRECT_URI — must point at completeGmailOAuth HTTPS endpoint
 *
 * Refresh tokens stored in emailProviderSecrets/{provider} — Admin SDK only.
 * Connection metadata in emailProviderConnections/{provider} — auth read, no client write.
 */
import * as admin from "firebase-admin";
import { randomBytes } from "crypto";
import { defineSecret } from "firebase-functions/params";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";

const gmailClientId = defineSecret("GMAIL_OAUTH_CLIENT_ID");
const gmailClientSecret = defineSecret("GMAIL_OAUTH_CLIENT_SECRET");
const gmailRedirectUri = defineSecret("GMAIL_OAUTH_REDIRECT_URI");

const PROVIDER_ID = "gmail";
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

const ALLOWED_RETURN_ORIGINS = [
  "https://lgarage.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

function getDb() {
  return admin.firestore();
}

function connectionRef(db: admin.firestore.Firestore) {
  return db.collection("emailProviderConnections").doc(PROVIDER_ID);
}

function secretsRef(db: admin.firestore.Firestore) {
  return db.collection("emailProviderSecrets").doc(PROVIDER_ID);
}

function defaultConnection(): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    provider: PROVIDER_ID,
    status: "disconnected",
    updatedAt: now,
  };
}

function isAllowedReturnUrl(returnUrl: string): boolean {
  try {
    const parsed = new URL(returnUrl);
    const origin = parsed.origin;
    if (!ALLOWED_RETURN_ORIGINS.includes(origin)) return false;
    return parsed.pathname === "/" || parsed.pathname === "/stageverify/";
  } catch {
    return false;
  }
}

function settingsReturnUrl(returnUrl: string, query: string): string {
  const base = returnUrl.split("#")[0] ?? returnUrl;
  const hash = returnUrl.includes("#") ? returnUrl.slice(returnUrl.indexOf("#")) : "#/settings";
  const settingsHash = hash.includes("settings") ? hash.split("?")[0] : "#/settings";
  return `${base}${settingsHash}?${query}`;
}

async function writeAuditEvent(
  db: admin.firestore.Firestore,
  action: "connected" | "disconnected" | "token_expired",
  actorUid: string,
  connectedAccountEmail?: string,
): Promise<void> {
  const id = `audit-${PROVIDER_ID}-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const now = new Date().toISOString();
  await db.collection("emailProviderAuditEvents").doc(id).set({
    id,
    provider: PROVIDER_ID,
    action,
    actorUid,
    ...(connectedAccountEmail ? { connectedAccountEmail } : {}),
    createdAt: now,
  });
}

async function fetchGoogleAccountEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`userinfo failed: ${res.status}`);
  }
  const data = (await res.json()) as { email?: string };
  if (!data.email?.trim()) {
    throw new Error("Google userinfo missing email");
  }
  return data.email.trim();
}

async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<{ refreshToken?: string; accessToken: string }> {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`token exchange failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    refresh_token?: string;
    access_token?: string;
  };
  if (!data.access_token) {
    throw new Error("token exchange missing access_token");
  }
  return {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
  };
}

async function revokeRefreshToken(refreshToken: string): Promise<void> {
  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    });
  } catch (err) {
    console.warn("Gmail token revoke failed (continuing disconnect):", err);
  }
}

function oauthSecretsConfigured(): boolean {
  try {
    return Boolean(
      gmailClientId.value()?.trim() &&
        gmailClientSecret.value()?.trim() &&
        gmailRedirectUri.value()?.trim(),
    );
  } catch {
    return false;
  }
}

interface InitiateRequest {
  returnUrl?: string;
}

export const initiateGmailOAuth = onCall(
  {
    region: "us-central1",
    secrets: [gmailClientId, gmailClientSecret, gmailRedirectUri],
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in to connect Gmail.");
    }

    if (!oauthSecretsConfigured()) {
      throw new HttpsError(
        "failed-precondition",
        "Gmail OAuth is not configured. Set GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, and GMAIL_OAUTH_REDIRECT_URI in Firebase Functions secrets.",
      );
    }

    const data = (request.data ?? {}) as InitiateRequest;
    const returnUrl =
      typeof data.returnUrl === "string" && data.returnUrl.trim()
        ? data.returnUrl.trim()
        : "https://lgarage.github.io/stageverify/#/settings";

    if (!isAllowedReturnUrl(returnUrl)) {
      throw new HttpsError("invalid-argument", "returnUrl origin is not allowed.");
    }

    const state = randomBytes(24).toString("hex");
    const now = Date.now();
    const db = getDb();
    await db.collection("emailOAuthStates").doc(state).set({
      uid: request.auth.uid,
      returnUrl,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + OAUTH_STATE_TTL_MS).toISOString(),
    });

    const params = new URLSearchParams({
      client_id: gmailClientId.value(),
      redirect_uri: gmailRedirectUri.value(),
      response_type: "code",
      scope: GMAIL_SCOPES,
      access_type: "offline",
      prompt: "consent",
      state,
    });

    return {
      authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      state,
      configured: true,
    };
  },
);

export const completeGmailOAuth = onRequest(
  {
    region: "us-central1",
    secrets: [gmailClientId, gmailClientSecret, gmailRedirectUri],
  },
  async (req, res) => {
    const db = getDb();
    const fallbackRedirect =
      "https://lgarage.github.io/stageverify/#/settings?gmailOAuth=error&reason=unknown";

    try {
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const oauthError =
        typeof req.query.error === "string" ? req.query.error : "";

      if (oauthError) {
        res.redirect(
          302,
          settingsReturnUrl(fallbackRedirect, `gmailOAuth=error&reason=${encodeURIComponent(oauthError)}`),
        );
        return;
      }

      if (!code || !state) {
        res.redirect(302, settingsReturnUrl(fallbackRedirect, "gmailOAuth=error&reason=missing_params"));
        return;
      }

      const stateSnap = await db.collection("emailOAuthStates").doc(state).get();
      if (!stateSnap.exists) {
        res.redirect(302, settingsReturnUrl(fallbackRedirect, "gmailOAuth=error&reason=invalid_state"));
        return;
      }

      const stateData = stateSnap.data() as {
        uid: string;
        returnUrl: string;
        expiresAt: string;
      };

      if (Date.now() > Date.parse(stateData.expiresAt)) {
        await stateSnap.ref.delete();
        res.redirect(
          302,
          settingsReturnUrl(stateData.returnUrl, "gmailOAuth=error&reason=state_expired"),
        );
        return;
      }

      if (!oauthSecretsConfigured()) {
        res.redirect(
          302,
          settingsReturnUrl(stateData.returnUrl, "gmailOAuth=error&reason=not_configured"),
        );
        return;
      }

      const tokens = await exchangeCodeForTokens(
        code,
        gmailClientId.value(),
        gmailClientSecret.value(),
        gmailRedirectUri.value(),
      );

      if (!tokens.refreshToken) {
        res.redirect(
          302,
          settingsReturnUrl(stateData.returnUrl, "gmailOAuth=error&reason=no_refresh_token"),
        );
        return;
      }

      const accountEmail = await fetchGoogleAccountEmail(tokens.accessToken);
      const now = new Date().toISOString();

      await secretsRef(db).set({
        refreshToken: tokens.refreshToken,
        updatedAt: now,
      });

      await connectionRef(db).set({
        provider: PROVIDER_ID,
        status: "connected",
        connectedAccountEmail: accountEmail,
        connectedAt: now,
        connectedByUid: stateData.uid,
        updatedAt: now,
      });

      await writeAuditEvent(db, "connected", stateData.uid, accountEmail);
      await stateSnap.ref.delete();

      res.redirect(
        302,
        settingsReturnUrl(stateData.returnUrl, "gmailOAuth=success"),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("completeGmailOAuth failed:", message);
      res.redirect(302, settingsReturnUrl(fallbackRedirect, "gmailOAuth=error&reason=exchange_failed"));
    }
  },
);

export const disconnectGmailOAuth = onCall(
  {
    region: "us-central1",
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in to disconnect Gmail.");
    }

    const db = getDb();
    const secretSnap = await secretsRef(db).get();
    if (secretSnap.exists) {
      const refreshToken = (secretSnap.data() as { refreshToken?: string }).refreshToken;
      if (refreshToken) {
        await revokeRefreshToken(refreshToken);
      }
      await secretSnap.ref.delete();
    }

    const now = new Date().toISOString();
    await connectionRef(db).set(defaultConnection());
    await writeAuditEvent(db, "disconnected", request.auth.uid);

    return { ok: true };
  },
);

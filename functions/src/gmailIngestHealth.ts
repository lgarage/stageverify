export interface GmailIngestHealthErrorInfo {
  code: "oauth_unconfigured" | "token_refresh_failed";
  message: string;
  at: string;
}

export interface GmailIngestHealthState {
  lastAttemptAt?: string;
  lastSuccessfulSyncAt?: string;
  lastError?: GmailIngestHealthErrorInfo;
  lastTokenRefreshFailureAt?: string;
  tokenRefreshFailed?: boolean;
  staleAfterHours: number;
}

export type GmailIngestUnhealthyReason =
  | "token_expired"
  | "stale_no_sync"
  | "token_refresh_failed";

export interface GmailIngestHealthEvaluation {
  healthy: boolean;
  unhealthyReason?: GmailIngestUnhealthyReason;
}

const DEFAULT_STALE_AFTER_HOURS = 2;
const MS_PER_HOUR = 60 * 60 * 1000;

function parseIsoMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function sanitizeIngestErrorMessage(raw: string): string {
  let out = raw;
  out = out.replace(/refresh_token\s*=\s*[^\s&"']+/gi, "[refresh_token redacted]");
  out = out.replace(/access_token\s*=\s*[^\s&"']+/gi, "[access_token redacted]");
  out = out.replace(/client_secret\s*=\s*[^\s&"']+/gi, "[client_secret redacted]");
  out = out.replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, "Bearer [redacted]");
  out = out.replace(/\bya29\.[A-Za-z0-9._\-+/=]+/gi, "[token redacted]");
  if (out.length > 300) {
    out = out.slice(0, 297) + "...";
  }
  return out;
}

export function shouldPersistTokenExpired(refreshErrorMessage: string): boolean {
  return /token refresh failed: (400|401)\b/.test(refreshErrorMessage);
}

export function evaluateGmailIngestHealth(
  input: {
    connectionStatus: "disconnected" | "connected" | "token_expired";
    connectedAt?: string;
    ingestHealth?: GmailIngestHealthState;
  },
  nowMs: number,
): GmailIngestHealthEvaluation {
  const { connectionStatus, connectedAt, ingestHealth } = input;

  if (connectionStatus === "disconnected") {
    return { healthy: true };
  }

  if (connectionStatus === "token_expired") {
    return { healthy: false, unhealthyReason: "token_expired" };
  }

  if (connectionStatus === "connected") {
    if (ingestHealth?.tokenRefreshFailed) {
      return { healthy: false, unhealthyReason: "token_refresh_failed" };
    }

    const staleAfterHours =
      ingestHealth?.staleAfterHours ?? DEFAULT_STALE_AFTER_HOURS;
    const referenceIso =
      ingestHealth?.lastSuccessfulSyncAt ?? connectedAt;
    const referenceMs = parseIsoMs(referenceIso);

    if (referenceMs === null) {
      return { healthy: true };
    }

    const staleMs = staleAfterHours * MS_PER_HOUR;
    if (nowMs - referenceMs > staleMs) {
      return { healthy: false, unhealthyReason: "stale_no_sync" };
    }

    return { healthy: true };
  }

  return { healthy: true };
}

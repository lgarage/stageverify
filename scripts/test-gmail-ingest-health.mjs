/**
 * Gmail ingest health evaluate + sanitize (functions mirror).
 * Run: npx tsx scripts/test-gmail-ingest-health.mjs
 */
import assert from "node:assert/strict";
import {
  evaluateGmailIngestHealth,
  sanitizeIngestErrorMessage,
  shouldPersistTokenExpired,
} from "../functions/src/gmailIngestHealth.ts";

const now = Date.parse("2026-10-10T12:00:00.000Z");
const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
const threeHoursAgo = new Date(now - 3 * 60 * 60 * 1000).toISOString();

assert.deepEqual(
  evaluateGmailIngestHealth({ connectionStatus: "disconnected" }, now),
  { healthy: true },
);

assert.deepEqual(
  evaluateGmailIngestHealth({ connectionStatus: "token_expired" }, now),
  { healthy: false, unhealthyReason: "token_expired" },
);

assert.deepEqual(
  evaluateGmailIngestHealth(
    {
      connectionStatus: "connected",
      ingestHealth: { staleAfterHours: 2, tokenRefreshFailed: true },
    },
    now,
  ),
  { healthy: false, unhealthyReason: "token_refresh_failed" },
);

assert.deepEqual(
  evaluateGmailIngestHealth(
    {
      connectionStatus: "connected",
      connectedAt: threeHoursAgo,
      ingestHealth: { staleAfterHours: 2 },
    },
    now,
  ),
  { healthy: false, unhealthyReason: "stale_no_sync" },
);

assert.deepEqual(
  evaluateGmailIngestHealth(
    {
      connectionStatus: "connected",
      connectedAt: twoHoursAgo,
      ingestHealth: { staleAfterHours: 2, lastSuccessfulSyncAt: twoHoursAgo },
    },
    now,
  ),
  { healthy: true },
);

assert.deepEqual(
  evaluateGmailIngestHealth({ connectionStatus: "connected" }, now),
  { healthy: true },
);

const raw =
  "failed refresh_token=ya29.secret-value and Bearer ya29.access bit more text";
const sanitized = sanitizeIngestErrorMessage(raw);
assert.ok(!sanitized.includes("refresh_token=ya29"));
assert.ok(!sanitized.includes("Bearer ya29"));
assert.ok(sanitized.includes("[refresh_token redacted]"));
assert.ok(sanitized.includes("Bearer [redacted]"));

const long = "x".repeat(400);
assert.equal(sanitizeIngestErrorMessage(long).length, 300);

assert.equal(shouldPersistTokenExpired("token refresh failed: 400"), true);
assert.equal(shouldPersistTokenExpired("token refresh failed: 401"), true);
assert.equal(shouldPersistTokenExpired("token refresh failed: 500"), false);
assert.equal(shouldPersistTokenExpired("token refresh failed: 429"), false);

console.log("PASS: test-gmail-ingest-health (evaluate + sanitize).");

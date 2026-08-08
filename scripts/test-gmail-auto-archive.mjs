/**
 * Offline tests: archiveGmailMessageRemoveInbox removes INBOX only (never trash).
 * Run: npm run test:gmail-auto-archive
 */
import { archiveGmailMessageRemoveInbox } from "../functions/src/gmailInbound.ts";

let passed = 0;
let failed = 0;

function pass(label) {
  passed += 1;
  console.log(`PASS: ${label}`);
}

function fail(label, detail) {
  failed += 1;
  console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
}

const originalFetch = globalThis.fetch;
/** @type {Array<{ url: string, init: RequestInit }>} */
const requests = [];

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : String(input?.url ?? input);
  requests.push({ url, init: { ...init } });
  return new Response(JSON.stringify({ id: "msg-1", labelIds: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

try {
  requests.length = 0;
  await archiveGmailMessageRemoveInbox("tok-abc", "19f2d62d6949a928");
  if (requests.length !== 1) {
    fail("single modify request", `count=${requests.length}`);
  } else {
    pass("single modify request");
  }

  const req = requests[0];
  const expectedUrl =
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/19f2d62d6949a928/modify";
  if (req.url === expectedUrl) pass("modify URL + messageId encoding");
  else fail("modify URL + messageId encoding", req.url);

  if (req.init.method === "POST") pass("POST method");
  else fail("POST method", String(req.init.method));

  const auth = req.init.headers?.Authorization ?? req.init.headers?.authorization;
  if (auth === "Bearer tok-abc") pass("Authorization bearer");
  else fail("Authorization bearer", String(auth));

  let body;
  try {
    body = JSON.parse(String(req.init.body ?? "{}"));
  } catch (err) {
    fail("JSON body", err instanceof Error ? err.message : String(err));
    body = {};
  }

  if (
    Array.isArray(body.removeLabelIds) &&
    body.removeLabelIds.length === 1 &&
    body.removeLabelIds[0] === "INBOX"
  ) {
    pass("removeLabelIds is exactly [INBOX]");
  } else {
    fail("removeLabelIds is exactly [INBOX]", JSON.stringify(body));
  }

  if (!("addLabelIds" in body)) pass("no addLabelIds key");
  else fail("no addLabelIds key", JSON.stringify(body));

  if (!req.url.includes("/trash")) pass("URL is not trash");
  else fail("URL is not trash", req.url);

  // URL-encoding for special message ids
  requests.length = 0;
  await archiveGmailMessageRemoveInbox("tok", "id/with?odd");
  const encoded = requests[0]?.url ?? "";
  if (encoded.includes("/messages/id%2Fwith%3Fodd/modify")) {
    pass("messageId URL-encoded");
  } else {
    fail("messageId URL-encoded", encoded);
  }

  // Non-OK throws (soft-fail is caller's job)
  globalThis.fetch = async () =>
    new Response("forbidden", { status: 403, statusText: "Forbidden" });
  try {
    await archiveGmailMessageRemoveInbox("tok", "msg-fail");
    fail("throws on non-OK", "expected throw");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/gmail archive \(remove INBOX\) failed: 403/.test(msg)) {
      pass("throws on non-OK with archive error");
    } else {
      fail("throws on non-OK with archive error", msg);
    }
  }

  // Guard: no trash endpoint ever invoked across cases (already covered; keep explicit)
  const allUrls = requests.map((r) => r.url).join(" ");
  if (!allUrls.includes("/trash")) pass("no trash across encoded case");
  else fail("no trash across encoded case");
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

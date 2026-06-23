/**
 * CRLF header-injection hardening tests for gmailApi (offline).
 * Run: npm run test:gmail-api
 */

import {
  assertSafeEmailHeaderValue,
  buildGmailRawMessage,
  containsCrlfInEmailHeader,
} from "../functions/src/gmailApi.ts";

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

function assertThrows(fn, label) {
  try {
    fn();
    fail(label, "expected throw");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("invalid email header value")) {
      fail(label, `unexpected error: ${msg}`);
      return;
    }
    pass(label);
  }
}

if (!containsCrlfInEmailHeader("clean@example.com")) {
  pass("containsCrlfInEmailHeader clean");
} else {
  fail("containsCrlfInEmailHeader clean");
}

for (const bad of ["a\r@b.com", "a\n@b.com", "a\r\n@b.com"]) {
  if (containsCrlfInEmailHeader(bad)) {
    pass(`containsCrlfInEmailHeader detects injection (${JSON.stringify(bad)})`);
  } else {
    fail(`containsCrlfInEmailHeader detects injection (${JSON.stringify(bad)})`);
  }
}

assertThrows(
  () => assertSafeEmailHeaderValue("evil\rHeader: x", "To"),
  "assertSafeEmailHeaderValue rejects CRLF",
);

assertThrows(
  () => buildGmailRawMessage("to\r@x.com", "from@x.com", "Sub", "body"),
  "buildGmailRawMessage rejects CRLF in To",
);
assertThrows(
  () => buildGmailRawMessage("to@x.com", "from\n@x.com", "Sub", "body"),
  "buildGmailRawMessage rejects CRLF in From",
);
assertThrows(
  () => buildGmailRawMessage("to@x.com", "from@x.com", "Sub\rject", "body"),
  "buildGmailRawMessage rejects CRLF in Subject",
);
assertThrows(
  () =>
    buildGmailRawMessage("to@x.com", "from@x.com", "Sub", "body", "reply\n@x.com"),
  "buildGmailRawMessage rejects CRLF in Reply-To",
);

try {
  const raw = buildGmailRawMessage(
    "vendor@example.com",
    "dispatcher@shop.example",
    "Need more info — PO 123",
    "Please confirm delivery date.\r\nThanks.",
  );
  if (typeof raw === "string" && raw.length > 20) {
    pass("buildGmailRawMessage accepts valid headers (body CRLF ok)");
  } else {
    fail("buildGmailRawMessage accepts valid headers (body CRLF ok)", "empty raw");
  }
} catch (err) {
  fail(
    "buildGmailRawMessage accepts valid headers (body CRLF ok)",
    err instanceof Error ? err.message : String(err),
  );
}

try {
  const raw = buildGmailRawMessage(
    "vendor@example.com",
    "dispatcher@shop.example",
    "Unicode subject — café",
    "Body",
    "reply@shop.example",
  );
  if (typeof raw === "string" && raw.length > 20) {
    pass("buildGmailRawMessage accepts Reply-To and encoded subject");
  } else {
    fail("buildGmailRawMessage accepts Reply-To and encoded subject", "empty raw");
  }
} catch (err) {
  fail(
    "buildGmailRawMessage accepts Reply-To and encoded subject",
    err instanceof Error ? err.message : String(err),
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

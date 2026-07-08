# Vendor Email Overnight Handoff — 2026-07-07

> **Audit time:** 2026-07-07T02:20Z (UTC) · **Repo HEAD:** `2c197dc` · **Live UI:** v0.0.23 · **Reply ingest flag:** **ON** (controlled flag-on test ran tonight)

---

## Executive summary

Overnight read-only audit + full verify suite **passed**. No code or deploy changes made tonight.

**Important state change since earlier flag-off audit (~01:46Z):** `emailReplyIngestEnabled` is now **`true`** with `emailReplyIngestSince: 2026-07-07T01:57:42.389Z`. Dan's controlled-reply-test-1 reply at `01:58:32Z` was **`reply_processed`** → one inbound `vendorEmailEvents` doc in Needs Review (`matchedBy: threadId`). Earlier `no_pdf` doc (`inbound-19f3a416ff6d112a`, `01:46:23Z`) was **not** reprocessed. **Do not flip the flag without Dan's explicit go/rollback.**

**Push ingest still broken** — all recent `gmailInboxPushIngest` logs show `unparseable push payload — skipping`. Poll/manual sync (`triggerInboundGmailSyncCallable` / scheduled `syncInboundGmail`) is sufficient for controlled tests.

---

## State snapshot (Job A)

| Item | Value |
|------|-------|
| **main HEAD** | `2c197dc` — `fix: calmer Vendor Reply Needs Review copy for matched threads` |
| **package.json version** | `0.0.23` |
| **Live gh-pages sidebar** | `v0.0.23` (prod `verify:dispatcher-nav` PASS) |
| **Live bundle hash** | `index-CTk3fXjO.js` (matches local build `dist/assets/index-CTk3fXjO.js`) |
| **gmailInboxPushIngest revision** | `gmailinboxpushingest-00020-cay` (deployed 2026-07-07T01:09Z) |
| **emailReplyIngestEnabled** | `true` |
| **emailReplyIngestSince** | `2026-07-07T01:57:42.389Z` |
| **Gmail connected** | `svbotmail@gmail.com` (`emailProviderConnections/gmail`) |
| **Latest vendorEmailEvents** | Inbound `vee-ed04f69e-…` Re: controlled-reply-test-1 (`pending_review`, `threadId` match) |
| **Needs Review** | 1 pending inbound (matched vendor reply — calm copy on prod) |
| **INV-P411190 / order 4046362** | `delivery-vii-vii-19f2d62d6949a928-page-0` — `status: complete`, `vendorInvoiceNumber: P411190`, `updatedAt: 2026-07-07T02:13:34.292Z` (no `deliveryOrderId` on inbound reply event — not reply-router mutation) |
| **test5 / bounce** | test5 outbound only (`vee-d2a54848`); **no** inbound processing for test5/bounce threads |

---

## Reply ingest safety (Job B)

| Check | Result |
|-------|--------|
| Duplicates | No duplicate gmail ids in listed inbound processing |
| no_pdf reprocessing | Old `01:46:23Z` reply stays `no_pdf`; new `01:58:32Z` message is separate gmail id → `reply_processed` |
| Wrong-thread matches | Controlled reply matched `threadId` to outbound `vee-974911f3` — expected |
| Delivery mutations | Inbound event has `deliveryOrderId: null`; emulator + prod audit show no ingest-driven status write on linked delivery |
| Shell creation | None from reply ingest |
| Unexpected Needs Review | 1 expected inbound from flag-on test (matched tier, not Suspicious) |
| Push payload | **All recent logs:** `gmailInboxPushIngest: unparseable push payload — skipping` — **no** `push for {email} historyId=` success lines |

**Push root-cause hypothesis (report only — do not fix tonight):** Pub/Sub delivers messages where `event.data.message.data` base64-decodes to JSON missing `emailAddress` + `historyId` (or wrong encoding). `parseGmailPushNotification` in `functions/src/gmailInbound.ts` returns null. Likely Eventarc/Pub/Sub envelope vs raw Gmail notification shape mismatch. Poll + manual sync work; push is not blocking controlled flag-on.

**Stale Gmail 404 noise:** `syncInboundGmail: message 19f3a2e9dfccab1e failed — 404` on every manual sync (orphan history id) — unrelated to controlled test.

---

## UI/UX v0.0.23 (Job C)

| Area | Status |
|------|--------|
| Matched calm copy | `emailReviewHelpers.ts` — matched tier → "Vendor Reply — Needs Review" + calm secondary; Suspicious only for spoof/ambiguous/unmatched |
| Raw email toggle | Prod `verify:dispatcher-nav` PASS — `tier=matched_vendor_reply; original email toggle works` |
| Vendor Comms button | Stable x across Dashboard + Staging Map (Δ≤4px); persistent on all tabs |
| Modal labels | NAVY labels readable; helper text visible |
| Ref footer + signature | `assembleOutboundEmailBody` — default signature before `---\nRef: SV-<uuid>` |

---

## Test suite (Job D)

| Script | Result |
|--------|--------|
| `npm run build` | PASS |
| `cd functions && npm run build` | PASS |
| `npm run verify:dispatcher-nav` (prod) | PASS — sidebar v0.0.23 |
| `npm run verify:invoice-review` (prod) | PASS |
| `npm run test:vendor-email-reply-router` | PASS (15/15 emulator) |
| `npm run test:email-thread-matching` | PASS (42/42) |
| `npm run verify:inbound-email-ingest` | PASS (61/61) |
| `npm run away:validate` | OK |

No failures to classify.

---

## Dead test email (Job E)

| Finding | Detail |
|---------|--------|
| `test@stageverify.dev` | **Not used** anywhere in repo |
| `STAGEVERIFY_TEST_EMAIL` | Required in `.env.local` for Playwright prod verifies + seeds |
| Emulator fallback | `dispatcher-test@stageverify.test` in `test-process-inbound-vendor-email.mjs`, `test-approve-vendor-invoice-import.mjs`, `test-match-invoice-records.mjs` only |
| **Recommendation** | **No change tonight.** Keep `.env.local` email as prod dispatcher test account. Document canonical test email in handoff; do not hardcode a new default without Dan confirming CI/secrets. |

---

## Ranked next steps for Dan (Job G)

1. **Review Needs Review strip on prod** — 1 matched inbound from controlled-reply-test-1; confirm calm copy + Show/Hide Original Email; dismiss or link manually when satisfied.
2. **Decide flag posture** — keep `emailReplyIngestEnabled: true` for more controlled tests, or rollback per § Rollback below before broader pilot.
3. **Fresh controlled reply** — if continuing flag-on: send **new** reply after `emailReplyIngestSince`; do not expect old `no_pdf` docs to reprocess.
4. **Push ingest investigation** (read-only first) — compare raw Pub/Sub message envelope vs `parseGmailPushNotification` expectations; logging-only fix candidate if zero behavior risk.
5. **Gmail watch fields** — `watchExpiration` / `lastHistoryId` null on connection doc; confirm watch registration if relying on push later.
6. **Stale 404 message** — `19f3a2e9dfccab1e` causes `errors=1` on every manual sync; optional cleanup when safe.
7. **Pub/Sub live path** — IAM OK (`gmail-api-push@system.gserviceaccount.com` publisher); push decode fix unlocks real-time ingest.
8. **Invoice Review queue** — empty tonight; approved archive has linked P411190 row.
9. **Queue empty** — `npm run away:next -- --minimal` → no queued away items; product next from `CURRENT_STATE.md` / `docs/roadmap.md` Phase 6.

---

## Rollback (if Dan wants flag off)

1. Firestore `appSettings/config`: set `emailReplyIngestEnabled: false` (or remove field).
2. Optionally remove `emailReplyIngestSince`.
3. **Do not** reprocess existing `no_pdf` or `reply_processed` docs.
4. Dismiss/link the pending inbound Needs Review item (`vee-ed04f69e-…`) manually if no longer needed.
5. `git revert` only if a bad deploy shipped — not needed for flag toggle alone.

---

## New-conversation handoff prompt (copy-paste)

```text
Continue StageVerify vendor email / reply ingest work at c:\Projects\stageverify.

## Read first (mandatory)
- PROJECT_STATUS/HANDOFF_VENDOR_EMAIL_2026-07-07.md (this overnight audit)
- PROJECT_STATUS/CURRENT_STATE.md
- PROJECT_STATUS/WARGAME_VENDOR_EMAIL_LAYER.md
- PROJECT_STATUS/gotcha-map.json (vendor-email / inbound triggers)

## Ground truth @ audit (2026-07-07T02:20Z)
- HEAD: 2c197dc (v0.0.23 live on gh-pages; bundle index-CTk3fXjO.js)
- emailReplyIngestEnabled: TRUE since 2026-07-07T01:57:42.389Z
- Controlled flag-on test SUCCEEDED: inbound vee-ed04f69e Re: controlled-reply-test-1 (threadId match, pending_review)
- Old flag-off no_pdf doc inbound-19f3a416ff6d112a (01:46:23Z) NOT reprocessed — expected
- test5/bounce threads IGNORE — outbound test5 only (vee-d2a54848)
- Delivery 4046362 / P411190: complete (delivery-vii-vii-19f2d62d6949a928-page-0)
- Push ingest BROKEN: gmailInboxPushIngest logs only "unparseable push payload" (revision gmailinboxpushingest-00020-cay)
- Poll/manual sync works (triggerInboundGmailSyncCallable / syncInboundGmail)

## HARD STOPS
- Do NOT flip emailReplyIngestEnabled without Dan explicit "go" or rollback request
- Do NOT send real vendor emails
- Do NOT deploy Firestore rules or broad Firebase without Sonnet security gate PASS
- Do NOT mutate delivery status / create shells from replies in uncontrolled tests
- Do NOT reprocess old no_pdf or reuse test5/bounce threads
- Do NOT fix push ingest unless trivial logging-only with zero behavior risk

## Verify commands (all exist in package.json)
npm run build
cd functions && npm run build
npm run verify:dispatcher-nav
STAGEVERIFY_BASE_URL=https://lgarage.github.io/stageverify npm run verify:dispatcher-nav
npm run verify:invoice-review
npm run test:vendor-email-reply-router
npm run test:email-thread-matching
npm run verify:inbound-email-ingest
npm run away:validate

## Likely next tasks (Dan picks one)
A) Review/dismiss prod Needs Review inbound (vee-ed04f69e) + confirm v0.0.23 calm copy
B) Controlled second reply after emailReplyIngestSince OR rollback flag to false
C) Read-only push payload investigation (gmailPubSubIngest.ts + parseGmailPushNotification)
D) Clean stale Gmail 404 id 19f3a2e9dfccab1e from sync history

## Ship loop
- Bump package.json patch before substantive UI/CF ships (currently 0.0.23)
- Sonnet security gate before push on backend-write-critical
- Dan verifies on https://lgarage.github.io/stageverify

startedAt: <ISO when you begin>
Session mode: ask Dan A) Active now vs B) Away planning if unclear.
```

---

## Overnight audit checklist (11 items)

| # | Item | Result |
|---|------|--------|
| 1 | gcloud / project | `stageverify-db` (firebase CLI default) |
| 2 | Pub/Sub IAM | `gmail-api-push@system.gserviceaccount.com` → `roles/pubsub.publisher` OK |
| 3 | Gmail watch | Connected `svbotmail@gmail.com`; `watchExpiration`/`lastHistoryId` null on doc |
| 4 | Push ingest | **Failing** — unparseable payload only |
| 5 | Poll/manual sync | **Working** — controlled reply ingested via sync |
| 6 | Outbound tracked email | Clean subjects on recent sends; Ref footer in body |
| 7 | Reply observed | Yes — `01:58:32Z` reply → `reply_processed` + inbound event |
| 8 | Flag state | **ON** since `01:57:42Z` (changed after earlier flag-off audit) |
| 9 | No uncontrolled status mutation | Inbound reply has no delivery link; 4046362 complete likely separate action |
| 10 | Safe to continue controlled tests? | **Yes** — with Dan aware flag is ON and 1 Needs Review pending |
| 11 | Enable/rollback steps | Rollback § above; fresh reply required after any new `emailReplyIngestSince` |

---

*Verified against: live Firestore (dispatcher auth), CF logs, prod Playwright verifies, local/emulator tests, `2c197dc` tree.*

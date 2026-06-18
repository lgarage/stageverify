# Overnight agent prompt (copy into new conversation)

Paste this as your **first message** in a new Cursor chat (Agent mode):

---

Run **away-015** through **away-020** in order from `PROJECT_STATUS/away-list.json`.

Follow `executionProtocol` exactly:

1. Predecessor must be `status: done` before starting the next item.
2. Run **every** `verifyBeforeNext` command for the item — all must exit 0.
3. **Halt on fail** — mark item `blocked` in away-list.json, log to away-status.json, STOP the batch.
4. On `escalateWhen` or `escalateBeforeShip`: run **Sonnet 4.6 security review** before push/deploy; fix HIGH risk before continuing.
5. After each item: set `status: done`, append `{id, status, commit, note}` to away-status.json, commit, push, deploy UI/CF as required.

Read first: `PROJECT_STATUS/CURRENT_STATE.md`, `PROJECT_STATUS/MODEL_DOSSIER.md` § agent-lessons.

**Prerequisites:** `.env.local` must have `STAGEVERIFY_TEST_EMAIL` / `STAGEVERIFY_TEST_PASSWORD`. For verify scripts that need auth: `node scripts/playwright-auth-setup.mjs` if token expired.

**away-015 note:** Slice 3 readiness panel may already be in the repo — ship it (commit/deploy) then verify; do not re-implement.

---

## Batch summary

| ID | Focus | Verify gate |
|----|--------|-------------|
| away-015 | Ship Slice 3 job readiness panel | build, verify:dispatcher-nav, verify:pickup |
| away-016 | Expected Materials on pickup | build, verify:pickup |
| away-017 | Unstaged deliveries visible (detail) | build, verify:pickup |
| away-018 | Shop stock Not Pulled / Pulled | build, verify:pickup |
| away-019 | CF clears staging on full pickup | functions build, test:pickup-authority, verify:pickup + Sonnet + CF deploy |
| away-020 | Deploy + prod verify | build, verify:pickup, verify:dispatcher-nav, verify:pickup:prod |

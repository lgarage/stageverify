# StageVerify session summary (~2 KB cap)

**Process SSOT:** `.cursor/rules/lean-agent-process.mdc` (**PR #257 process**; D-94 alias).

## Last shipped
**v0.0.365** — vendor Complete delivery tap repair (PR #249). FE-only; local+prod `verify:vendor-run-job-actions` PASS. **Waiting Dan iPhone retest.**

## Standing policy
- **MVP 100% done** — Dan approves **every merge and deploy**; no auto-merge / auto-deploy.
- **Risk tier:** `npm run gate:tier` (path rules in `scripts/gate-check.mjs`) **before coding** — Composer self-label never decides tier.
- **HIGH (summary):** `firestore.rules`; auth/PIN/roles in `src/` or `functions/` (path heuristic); billing/money in product paths; all `functions/` except `lib/`; CI/gate config (workflows, `gate-check`, hooks, deploy wiring). Ambiguous → HIGH.
- **Sonnet:** **required** (no end date) on `firestore.rules`, auth/PIN/roles, billing/money paths — Grok + Sonnet model lines in review evidence. CI/gate-config-only HIGH does **not** require Sonnet. Harness **never** auto-drops Sonnet; MODEL EVIDENCE tally may **suggest** after 10 clean same-`job-type` jobs — **Dan decides**.

## Session start (lean)
1. Read **PR #257 process** + **this file** only.
2. `git fetch origin main && git pull origin main`; confirm `a69dc81c` (PR #257) is ancestor of HEAD (`git merge-base --is-ancestor a69dc81c HEAD`).
3. Open `CURRENT_STATE.md`, `MEMORY.md`, `DECISIONS.md`, `MODEL_DOSSIER.md` **only when the task needs them**.

## HIGH PR workflow (short)
Commit → HIGH review of **that SHA** → open draft PR with review-evidence block including `reviewed-commit: <sha>`. Later commits need re-review unless **fixture-only** and listed as `post-review-commits:` in the PR body.

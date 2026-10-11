# StageVerify session summary (~2 KB cap)

**Process SSOT:** `.cursor/rules/lean-agent-process.mdc` (**PR #257 process**; D-94 alias).

## Last shipped
**v0.0.365** — vendor Complete delivery tap (PR #249). **Waiting Dan iPhone retest.**

## Standing policy
- **MVP 100% done** — Dan approves **every merge and deploy**; no auto-merge / auto-deploy.
- **Risk tier:** `npm run gate:tier` (path rules in `scripts/gate-check.mjs`) **before coding** — Composer self-label never decides tier.
- **HIGH:** `firestore.rules`; auth/PIN/roles (`src/`/`functions/` heuristic); billing/money; all `functions/` except `lib/`; CI/gate. Ambiguous → HIGH. Reviewer: **Grok 4.7, reasoning_effort HIGH, fast OFF, context 256k** → `grok-4.7-high`. `cursor-grok-4.6-high` only PR **#258**/**#259**.
- **256k context:** standard window only (never 500k/max). One small PR; read only needed files. Approaching the cap → stop and hand off. Report `context-used:` (peak tokens or `n/a`).
- **Sonnet:** **required** (no end date) on `firestore.rules`, auth/PIN/roles, billing/money paths — Grok + Sonnet model lines in review evidence. CI/gate-config-only HIGH does **not** require Sonnet. Harness **never** auto-drops Sonnet; MODEL EVIDENCE tally may **suggest** after 10 clean same-`job-type` jobs — **Dan decides**.

## Session start (lean)
1. Read **PR #257 process** + **this file** only.
2. `git fetch origin main && git pull origin main`; confirm `a69dc81c` (PR #257) is ancestor of HEAD (`git merge-base --is-ancestor a69dc81c HEAD`).
3. Open `CURRENT_STATE.md`, `MEMORY.md`, `DECISIONS.md`, `MODEL_DOSSIER.md` **only when the task needs them**.

## HIGH PR workflow (short)
Commit → HIGH review of **that SHA** → open draft PR with review-evidence block including `reviewed-commit: <sha>`. Later commits need re-review unless **fixture-only** and listed as `post-review-commits:` in the PR body.

# StageVerify session summary (~2 KB cap)

**Process SSOT:** `.cursor/rules/lean-agent-process.mdc` (**PR #257 process**; D-94 alias).

## Last shipped
**v0.0.365** — vendor Complete delivery tap (PR #249). **Waiting Dan iPhone retest.**

## Standing policy
- **MVP 100% done** — Dan approves **every merge and deploy**; no auto-merge / auto-deploy.
- **Risk tier:** `npm run gate:tier` (path rules in `scripts/gate-check.mjs`) **before coding** — Composer self-label never decides tier.
- **HIGH:** `firestore.rules`; auth/PIN/roles; billing/money; all `functions/` except `lib/`; CI/gate. Ambiguous → HIGH. Reviewer slug **`grok-4.7-high`**; `cursor-grok-4.6-high` only PR **#258**/**#259**. Evidence **`model:`** = gate slug; **`model-self-report:`** separate, not required by CI.
- **256k context:** standard window only. `context-used:` = peak from Agents-window **context ring**; `n/a` only if no number shown.
- **Sonnet (2026-10-11):** required on backup paths — run without asking; no optional runs; record `job-type:` + `sonnet-unique-findings:`. CI/gate-only HIGH exempt. Harness never auto-drops; tally may suggest — **Dan decides**.
- **Gate/process merges:** merge, close, or batch open PRs first (now **#258**/**#259**) so they are not forced into re-review.
- **CI watch:** builders stop at PR handoff; never self-subscribe to CI — orchestrator or Spot only.

## Session start (lean)
1. Read **PR #257 process** + **this file** only.
2. `git fetch origin main && git pull origin main`; confirm `a69dc81c` (PR #257) is ancestor of HEAD (`git merge-base --is-ancestor a69dc81c HEAD`).
3. Open `CURRENT_STATE.md`, `MEMORY.md`, `DECISIONS.md`, `MODEL_DOSSIER.md` **only when the task needs them**.

## HIGH PR workflow (short)
Commit → HIGH review of **that SHA** → open draft PR with review-evidence block including `reviewed-commit: <sha>`. Later commits need re-review unless **fixture-only** and listed as `post-review-commits:` in the PR body.

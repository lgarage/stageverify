# iPhone / Cursor Cloud Agent setup (Dan checklist)

Short steps to make StageVerify buildable from Cursor Cloud Agents on iPhone.

## 1. Get bootstrap files on a branch

Merge the PR (or ensure branch includes `.cursor/environment.json`, `AGENTS.md`, and `scripts/verify-cloud-env.mjs`).

## 2. Create or update the Cursor environment

1. Open [cursor.com/agents](https://cursor.com/agents) → **Environments**.
2. Create/save an environment for **`lgarage/stageverify`**, or start a Cloud Agent from the branch so `.cursor/environment.json` **install** runs (`npm ci` + Playwright Chromium).

## 3. Add secrets (dashboard only — never in git)

| Secret | Required |
|--------|----------|
| `STAGEVERIFY_TEST_EMAIL` | Yes — Playwright protected routes |
| `STAGEVERIFY_TEST_PASSWORD` | Yes |
| `FIREBASE_TOKEN` | Optional — only if deploying CF/rules from cloud |

## 4. Save environment snapshot

After the first successful install completes, **save snapshot** so future agents skip cold `npm ci` when unchanged.

## 5. Run from iPhone

Start a **Cloud Agent** on that environment for branch work, reviews, and verifies.

For the full ship-loop (push to `main`, `npm run deploy`, prod `:prod` verifies), use **Remote Control** on your Mac unless the prompt explicitly allows cloud push/deploy.

## 6. Verify readiness

In the agent terminal:

```bash
npm run verify:cloud-env
```

Expect PASS on repo config; secrets PASS only after step 3. Then run `node scripts/playwright-auth-setup.mjs` before protected-route Playwright scripts.

## Harness parity (D-20 — same rules as desktop)

Cloud and iPhone Composer sessions read the same `.cursor/rules/` from the repo. **No mobile-lite orchestration** — ship-loop tiers, repair loop, planning verify loop, verification ladder, security gate, stall-advisor, Ship/Critical/Work/Planning verifiers, evidence lines, and fix-closure bind all clients identically (`model-gates.mdc` § Platform parity).

### Exceptions (physically impossible on mobile/cloud only)

| Exception | Why | Desktop equivalent |
|-----------|-----|-------------------|
| Secrets in Environments UI | Agent cannot tap dashboard; Dan sets secrets once (step 3 above) | `.env.local` on Mac |
| Branch-only / no `main` push | Default cloud workflow unless prompt allows push | Direct push from desktop |
| Remote Control for prod ship | Full gh-pages deploy + `:prod` verify often from Mac | Local `npm run deploy` |

Repair requests (fix/debug/try again/correct this) follow the same repair loop as desktop — `repair-verifier:` + `fix-verified:` required; Composer never self-closes.

Planning questions ("what's next", "what else can be worked on", ranked options, away planning) follow the same planning verify loop as desktop — `planning-verifier:` + verdict PASS required before present; Composer never self-closes.

## 7. Dual-lane mobile autonomy (build on phone, drain on PC)

Converged Fable ↔ Grok protocol — **documentation only**; no new `away-list.json` schema. See `AGENTS.md` § Dual-lane for full text.

| Lane | Owns | Never |
|------|------|-------|
| **Mobile / cloud** | Feature branch, PR, `npm run build`, local `verify:*`, `npm run verify:pr-loop` | Merge `main`, `npm run deploy`, `:prod`, `away:ship` |
| **PC / Mac** | Merge, deploy, `:prod`, Ship Verifier, security gate, `away:ship` | — |

**Handoff:** When mobile opens a PR, set the away item to existing **`blocked`** status (not `queued`) with PR number in a free-text note — prevents `away:next` from rebuilding the same item. PC merges and closes via `away:ship` so `built` keeps its sole meaning (shipped on main).

**Classifier trial** (paste into PR description after `npm run verify:pr-loop -- --json`):

```text
## PR loop classifier
npm run verify:pr-loop -- --branch <branch> --json
autonomy.mergeAllowed / deployAllowed / prodVerifyPreMerge: false / false / false
PC must: merge → deploy → :prod → away:ship
```

**Pain log:** If you wanted to ship from the phone and could not, tell the agent **"log pain: …"** — one dated line in `PROJECT_STATUS/HARNESS_V1_FREEZE.md`. Schema increments wait for a **second** dated mobile friction event (D-16).

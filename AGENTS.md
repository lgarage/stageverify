# StageVerify — Agent instructions

Repository for the StageVerify staging/verification app (React + Firebase). Cloud agents and desktop agents share the same codebase; paths and ship workflow differ on Linux VMs.

**Dan's primary dev machine:** Windows PC (`C:\Projects\stageverify`). Cloud VM uses `/workspace`.

## Desktop Windows PC (Cursor)

Same harness as cloud — **D-94** `lean-agent-process.mdc` is the only alwaysApply rule; other `.cursor/rules/` are on-demand (D-32 parity). **Rule updates:** commit `.cursor/rules/` to the repo so desktop and cloud share the same files on pull.

| Task | Command (from `C:\Projects\stageverify`) |
|------|----------------------------------------|
| Hot-tier auto-sync (D-23) | `npm run away:validate` — writes CURRENT_STATE + Phase Tracker + roadmap from `verify:location-phaseN` prod PASS |
| Quick drift check | `npm run away:sync` (dry-run) · `npm run away:sync -- --write` |
| Ship one away item | `npm run away:ship -- --id away-NNN --commit <hash> --note "..."` |

Scripts use `path.join` + repo-relative paths — identical on Windows and Linux. `readText()` normalizes CRLF.

`npm ci`/`npm install` auto-installs the pre-push gate hook (`scripts/install-git-hooks.mjs` via npm `prepare`); HIGH commits/PRs must carry `security-gate-id:` as a lowercase UUID or `bc-<uuid>` **and** `model: grok-4.7-high` (**Grok 4.7, reasoning_effort HIGH, fast OFF, context 256k**). Grandfathered `cursor-grok-4.6-high` only when CI sets `GATE_PR_NUMBER` to **258** or **259**. No agent may exceed a 256k context window.
Bypass exists (advisory-vs-malice; use only when Dan approves): `git push --no-verify` works in every shell; the env form is shell-specific — bash `GATE_SKIP=1 git push`, PowerShell `$env:GATE_SKIP="1"; git push`, cmd `set GATE_SKIP=1 && git push` (the hook runs under Git's sh and reads the inherited env on all three). **CI never honors `GATE_SKIP` or `--no-verify`** — PR `gate-check` always runs the real evidence check.

## Cursor Cloud specific instructions

### Workspace paths

- Cloud VMs use **`/workspace`** as the repo root — not Windows `C:\Projects\stageverify`.
- Run all npm/node commands from `/workspace`.

### Session start

1. Read **PR #257 process** `.cursor/rules/lean-agent-process.mdc` and `PROJECT_STATUS/STATE_SUMMARY.md` before coding. Open `CURRENT_STATE.md`, `MEMORY.md`, or `DECISIONS.md` only when the task needs them.
2. Before work: **`git fetch origin main && git pull origin main`**, then confirm `a69dc81c` is an ancestor of HEAD (`git merge-base --is-ancestor a69dc81c HEAD`). Run **`npm run gate:tier`** on planned paths before coding (tier from paths, not Composer self-label). **Sonnet** stays required on today’s `requiresSonnetBackup()` paths with **no end date**; harness never auto-drops Sonnet. Dan approves every merge and deploy. Other `.cursor/rules/*` are on-demand.
3. **Planning questions** (“what’s next”, “what can mobile do”, ranked options): **`git fetch origin main && git pull origin main`** first.
4. Desktop, mobile Cursor, and cloud VM share the same repo rules (D-32). **Environment is auto-detected (D-35)** — never keyed to Dan saying "phone/mobile". No mobile-lite orchestration.
5. For scope disputes, load `PROJECT_STATUS/svscope_simple.md` on demand only.

### Harness parity exceptions (mobile/cloud only)

Differs from desktop **only** where physically impossible — document here, not in separate rule files:

- **Secrets** — Dan must set `STAGEVERIFY_TEST_EMAIL`, `STAGEVERIFY_TEST_PASSWORD`, and optional `FIREBASE_TOKEN` in Cursor Environments UI (see below).
- **Ship to main / gh-pages** — default: feature branch + **draft PR**. **D-94:** Dan approves every merge and deploy (including mobile UI). No auto-merge. No auto-deploy.

### Ship workflow from cloud

- Prefer a **feature branch + draft PR**. Do **not** push to `main` or merge unless Dan approved (D-94).
- After Dan approves deploy: `npm run deploy` for the FE bundle; CF/rules only when that approval named those targets. Rollback hash before deploy; smoke after.
- **HIGH** (D-94): `firestore.rules`, auth/PIN/roles, core-loop write CFs, billing, CI/gate — Grok reviews the final diff; that review may double as `security-gate-id:` + `model:` if it covers security. Sonnet backup only (rules / auth/PIN/roles / billing, Grok FAIL/HIGH, ladder-5, or Dan asks). Record `ladder-step:`. No D-60 four-pass loop.

### Required secrets (names only — set in Cursor Environments dashboard)

| Secret | Purpose |
|--------|---------|
| `STAGEVERIFY_TEST_EMAIL` | Playwright / protected-route verify login |
| `STAGEVERIFY_TEST_PASSWORD` | Playwright / protected-route verify login |
| `FIREBASE_TOKEN` | *(optional)* `firebase deploy` for CF or rules from cloud |

Never commit credentials. Do not invent passwords or tokens in the repo.

After secrets exist in the environment, run once (or when Firebase token expires ~1h):

```bash
npm run dev   # separate terminal or background
node scripts/playwright-auth-setup.mjs
```

Saves `playwright/.auth/state.json` (gitignored) for dispatcher/settings verifies.

### Firebase CLI

Prefer **`npx firebase-tools`** (or `npx firebase`) instead of a global install in `environment.json` install step.

### Minew / NDA

Never paste Minew API docs, login URLs, credentials, or NDA material into cloud agent context. Minew HTTP calls are server-side only (`functions/src/`). Public UI uses StageVerify QR URLs only (`#/r?`, `#/p?`).

### Dan setup checklist

See **`docs/cloud-agent-iphone-setup.md`** for Cursor dashboard steps (environment, secrets, snapshot, iPhone agent).

### Readiness check

```bash
npm run verify:cloud-env
```

### Dependency install (two packages)

This repo has **two** npm packages: the root frontend and `functions/` (Cloud Functions). Both need installs. The startup update script / `.cursor/environment.json` install runs `npm ci` in the root **and** `npm ci --prefix functions`, plus `npx playwright install chromium`. `functions/` deps are only needed for `npm run build:functions` and the emulator-backed `test:*` scripts — the Vite dev server (`npm run dev`), `npm run build`, and `npm run lint` do not need them.

### Running the app in dev

`npm run dev` serves the React app at **`http://localhost:5173/stageverify/`** (note the `/stageverify/` base path). The client (`src/firebase.ts`) talks to **live Firebase `stageverify-db`** — there is no emulator wiring in the browser app.

- **Public/demo routes** (`/#/demo/pickup-scan`, `/#/demo/vendor-scan`, `/#/receive`, `/#/pickup`) and dev seeding (`seedFirestore`) require writing `deliveries`/`items` to Firestore, which `firestore.rules` blocks for **unauthenticated** clients. Without a login these demo flows render but show "Invalid or expired pickup link" / "Missing or insufficient permissions" in the console. This is expected, not a build problem.
- **Dispatcher/settings/protected routes** and the Playwright `verify:*` scripts need a real login. Set `STAGEVERIFY_TEST_EMAIL` / `STAGEVERIFY_TEST_PASSWORD` (see secrets table above) and run `node scripts/playwright-auth-setup.mjs` while `npm run dev` is up. Note: `scripts/playwright-auth-setup.mjs` writes an effectively empty `playwright/.auth/state.json` because Firebase persists auth in **IndexedDB**, which Playwright `storageState` does not capture — verify scripts re-login per session using the env credentials rather than relying on that file.
- **Pickup completion gotcha:** the public pickup portal (`/#/pickup?t=…`) loads via a token-gated CF, but `recordPickupEvent` (the "Order Pickup Complete" action) first does a client-side `getDoc(deliveries/…)`, which the live Firestore rules only allow for authenticated users. An unauthenticated pickup session therefore shows "Pickup could not be saved (permission denied)…" on completion. To drive the full flow to the "All Items Picked Up!" screen in dev, authenticate the browser session first (log in, then open the pickup URL in the same context). The core CF logic itself is covered offline by `npm run test:pickup-authority` (emulators, no secrets).

### Emulator-backed tests (core CF flows, no secrets / no live Firebase)

The `test:*` and `test:firestore-rules` scripts invoke the `firebase` CLI **directly** (not `npx`), so `firebase` must be on `PATH`. Java (for the Firestore emulator) is present on the VM. The CLI is **not** in the update script; install it once per VM if missing:

```bash
sudo env "PATH=$(dirname "$(command -v node)"):$PATH" "$(command -v npm)" install -g firebase-tools
```

Then core flows run end-to-end against emulators with no secrets, e.g.:

```bash
npm run test:pickup-authority     # recordPickupEvent + recalculateDeliveryReadiness via emulated Firestore/Functions
npm run test:mark-vendor-delivered
```

Pure-logic tests need neither the CLI nor emulators: `npm run test:readiness`, `npm run test:invoice-parser`, `npm run test:email-parser`.

### Lint state

`npm run lint` runs but the committed codebase currently has pre-existing ESLint errors (unused vars, `preserve-caught-error`, `prefer-const`, react-refresh). These are not caused by environment setup.

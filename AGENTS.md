# StageVerify — Agent instructions

Repository for the StageVerify staging/verification app (React + Firebase). Cloud agents and desktop agents share the same codebase; paths and ship workflow differ on Linux VMs.

**Dan's primary dev machine:** Windows PC (`C:\Projects\stageverify`). Cloud VM uses `/workspace`.

## Desktop Windows PC (Cursor)

Same harness as cloud — `.cursor/rules/` **alwaysApply** on desktop (D-20 platform parity). No separate mobile-lite orchestration.

| Task | Command (from `C:\Projects\stageverify`) |
|------|----------------------------------------|
| Hot-tier auto-sync (D-23) | `npm run away:validate` — writes CURRENT_STATE + Phase Tracker + roadmap from `verify:location-phaseN` prod PASS |
| Quick drift check | `npm run away:sync` (dry-run) · `npm run away:sync -- --write` |
| Ship one away item | `npm run away:ship -- --id away-NNN --commit <hash> --note "..."` |

Scripts use `path.join` + repo-relative paths — identical on Windows and Linux. `readText()` normalizes CRLF.

## Cursor Cloud specific instructions

### Workspace paths

- Cloud VMs use **`/workspace`** as the repo root — not Windows `C:\Projects\stageverify`.
- Run all npm/node commands from `/workspace`.

### Session start

1. Read `PROJECT_STATUS/CURRENT_STATE.md` and `PROJECT_STATUS/MEMORY.md` before coding.
2. Follow `.cursor/rules/` **alwaysApply** rules identically to desktop — ship-loop tiers, repair loop, planning verify loop, Q&A verify loop, hot-tier auto-sync (D-23), verification ladder, security gate, stall-advisor, and mandatory evidence lines (`model-gates.mdc` § Platform parity, D-20–D-23). No mobile-lite orchestration.
3. For scope disputes, load `PROJECT_STATUS/svscope_simple.md` on demand only.

### Harness parity exceptions (mobile/cloud only)

Differs from desktop **only** where physically impossible — document here, not in separate rule files:

- **Secrets** — Dan must set `STAGEVERIFY_TEST_EMAIL`, `STAGEVERIFY_TEST_PASSWORD`, and optional `FIREBASE_TOKEN` in Cursor Environments UI (see below).
- **Ship to main / gh-pages** — prefer feature branch + PR from cloud; full ship-loop to `main` + `npm run deploy` on Dan's **Windows PC** (desktop Cursor) unless the prompt explicitly allows cloud push/deploy.

### Ship workflow from cloud

- Prefer a **feature branch + PR**; do **not** push to `main` unless Dan explicitly says so in the prompt.
- Full local ship-loop (build → Playwright → commit → push → `npm run deploy`) on cloud is branch/PR-only unless Dan explicitly allows main push; **desktop Windows PC** runs the full loop locally by default.
- **High-risk** changes still need Dan approval **before** implement/deploy: Cloud Functions (`functions/**`), `firestore.rules`, auth/session/route guards, Gmail watch/Pub/Sub, secrets/config, schema migrations.

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

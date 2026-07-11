# StageVerify — Agent instructions

Repository for the StageVerify staging/verification app (React + Firebase). Cloud agents and desktop agents share the same codebase; paths and ship workflow differ on Linux VMs.

## Cursor Cloud specific instructions

### Workspace paths

- Cloud VMs use **`/workspace`** as the repo root — not Windows `C:\Projects\stageverify`.
- Run all npm/node commands from `/workspace`.

### Session start

1. Read `PROJECT_STATUS/CURRENT_STATE.md` and `PROJECT_STATUS/MEMORY.md` before coding.
2. Follow rules in `.cursor/rules/` (ship-loop, model-gates, product guardrails).
3. For scope disputes, load `PROJECT_STATUS/svscope_simple.md` on demand only.

### Ship workflow from cloud

- Prefer a **feature branch + PR**; do **not** push to `main` unless Dan explicitly says so in the prompt.
- Full local ship-loop (build → Playwright → commit → push → `npm run deploy`) is usually done from Dan's Mac via **Remote Control** when iPhone Cloud Agent is read-only or branch-only.
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

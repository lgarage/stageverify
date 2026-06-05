# AECS Phase 4 Status

> **Updated:** 2026-06-05 | **Updater:** v0.2.0 | **MED-2 validated** — not committed; awaiting Dan approval

## StageVerify boundary

**StageVerify is the AECS development host, not a normal update target.** Use updater/rollback only on disposable temp test directories (`update.test.mjs`, `rollback-progress.test.mjs`). Do **not** run `aecs:update:write` or `aecs:rollback:write` against this repo without an approved migration plan.

## Shipped in working tree (post-MED-2)

- `aecs/updater/` — update + rollback CLIs, backup/transaction/progress/classify/ownership
- `aecs/updater/lib/progress.mjs` — install/update/**rollback-in-progress** sentinels + blocking gates
- `aecs/updater/rollback-progress.test.mjs` — 15 MED-2 scenarios
- `update.test.mjs` — 31 core scenarios + E2E
- `docs/aecs/phase-4-plan.md` — binding plan including rollback progress schema
- Installer collision fix — update-mode allows rule replacement when disk matches install record
- npm scripts: `aecs:update`, `aecs:update:write`, `aecs:rollback`, `aecs:rollback:list`, `aecs:rollback:write`

## Decisions

| Topic | Decision |
|-------|----------|
| Default mode | Dry-run; `--write` required for mutations |
| Source | Local canonical only — no remote download |
| Downgrade | Blocked unless `--allow-downgrade` |
| Backup location | `.cursor/aecs/backups/<transactionId>/` |
| Backup integrity | sha256 checksums — **not** cryptographically signed |
| Transactions | Transaction-like tracking — **not** fully atomic FS transaction |
| Auto-rollback | **Not implemented** — operator runs `aecs:rollback:write` explicitly |
| Rollback auto-resume | **Not implemented** — incomplete rollback blocks writes until manual resolution |
| Recovery flags | No `--ignore-drift` or similar unsupported flags |
| Retention | Keep all backups; no auto-delete in Phase 4 |
| Rollback completeness | Restores backed files, removes update-added files, restores metadata |
| Ownership changes | Blocked per manifest/registry transition policy |
| In-progress sentinels | `install-in-progress` + `update-in-progress` + `rollback-in-progress` block writes (fail-closed) |
| Rollback progress path | `.cursor/aecs/rollback-in-progress` (JSON, schema 0.2.0) |
| Rollback cleanup timing | Clear rollback + update sentinels **only after post-rollback verify passes** |
| Partial rollback failure | Preserve record (`failed` / `verify-failed`), expose last step + txn ids |
| Missing backup source | Fail-closed — blocks all update writes |
| Drift on rollback | Block before any added-file deletion |
| Schema migration | Accept `0.1.0` install records; write `0.2.0` post-update |

## Rollback-in-progress blocking

| Operation | When incomplete rollback present |
|-----------|----------------------------------|
| `install --write` | **Blocked** (also when update-in-progress present) |
| `update --write` | **Blocked** |
| `rollback --write` | **Blocked** (no silent restart) |
| `rollback` dry-run / `--list` | Allowed (read-only inspect) |
| `aecs:verify` | Allowed (read-only) |

Exception: rollback write still allowed when `update-in-progress` transaction **matches** the backup being restored (failed-update recovery path).

## Verify before commit

```bash
npm run aecs:test   # install + update + hardening + rollback-progress suites
npm run build
git rev-parse "pre-aecs-phase4^{commit}"   # expect bf1f512
```

## Limitations (Phase 5+)

- No signed manifests or remote update channel
- No automatic backup retention pruning
- No `--force` for local modifications
- No `--ignore-drift` rollback recovery flag
- No filesystem-level atomic transaction / file locking (race window documented)
- No CLI to clear rollback-in-progress — manual operator removal after recovery
- Brain repo install path not supported
- Windows symlink tests best-effort (EPERM skipped)

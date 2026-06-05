# AECS Phase 3 Status

> **Updated:** 2026-06-05 | **Installer:** v0.1.0 | **Fix validated** — not committed; awaiting Dan approval


## StageVerify boundary

**StageVerify is the AECS development host, not a normal install target.** Use the installer only on future greenfield repos and disposable temp test directories (install.test.mjs). Do **not** run ecs:install:write against this repo without a separate approved migration plan.

## Shipped in working tree

- `aecs/installer/` — install + verify CLIs, shared lib, 15 scenario tests
- `docs/aecs/phase-3-plan.md` — binding plan for Phase 3 scope
- npm scripts: `aecs:install`, `aecs:install:write`, `aecs:verify`, `aecs:test`

## Decisions

| Topic | Decision |
|-------|----------|
| Runtime | Node `.mjs` (no new deps; `node:test` for scenarios) |
| Default mode | Dry-run; `--write` required for mutations |
| Canonical source block | Refuse install when `target === source` or target has `aecs/dev/` |
| Rule seeding | Six portable templates → `.cursor/rules/` with placeholder substitution |
| Project memory | Seed `PROJECT_STATUS/CURRENT_STATE.md` only when absent |
| `composer-orchestrator.mdc` | Not installed (project-owned; Phase 3+ split deferred) |

## Sonnet review (2026-06-05)

**PASS WITH NOTES** — no HIGH findings. Applied MED fixes: adapter `targetName` validation, pre-mkdir symlink walk, `install-in-progress` sentinel + verify `INSTALL_INCOMPLETE`, symlink skip in verify walk.

## Limitations (Phase 4)

- No updater, rollback CLI, `--force`, or timestamped backups (`.gitkeep` only)
- No brain repo / `~/.cursor/skills` install path
- No signed manifests or install audit log file
- Windows symlink tests best-effort (EPERM skipped)

## Verify before commit

```bash
npm run aecs:test
npm run build
```

## Disposable-repo validation (2026-06-05)

**Overall: PASSED** — Windows drive-letter casing defect fixed; full disposable re-validation on lowercase `c:\` target.

| Step | Result |
|------|--------|
| Dry-run | PASS — lowercase `c:\Users\...\aecs-val-manual`; 21 planned ops |
| Write install | PASS — lowercase drive `--target` succeeds (was FAIL before fix) |
| Verify | PASS — read-only; zero findings |
| Idempotent reinstall | PASS — skip-identical on rules; metadata rewrites |
| Project-owned collision | PASS — adapter binding BLOCK (`ok: false`, exit 2) |
| Local AECS modification | PASS — drift BLOCK; no silent overwrite |
| Project memory | PASS — seeded on first install; preserved on reinstall |
| Invalid/boundary targets | PASS — nonexistent, file-not-dir, traversal, canonical-source block |
| Malformed install record | PASS — `INSTALL_RECORD_INCOMPLETE`, `INSTALL_FILES_MISSING` (install.test.mjs) |
| Partial failure | PASS — test 14: unrelated files untouched |
| Contamination scan | NOTE — 6 hits expected for `stageverify` adapter; no secrets/credentials |
| Cleanup | PASS — disposable repo deleted; StageVerify `.cursor/aecs/` unchanged |

### Defect (fixed)

**MED — Windows drive-letter casing false positive in `assertNoSymlinkEscape`:** `--target c:\Users\...` made `safeRealpath` return lowercase `c:` for not-yet-created paths while the existing root resolved to `C:`, so case-sensitive `startsWith` failed with `Symlink escape detected`.

**Correction:** `isInsideRoot()` in `aecs/installer/lib/paths.mjs` — case-insensitive containment on `win32` with trailing-separator child check; used by `resolveUnderRoot` and `assertNoSymlinkEscape`. Non-Windows unchanged (case-sensitive, `/` separator).

### Regression tests (`aecs/installer/paths.test.mjs`)

1. Uppercase root, lowercase candidate drive — OK
2. Lowercase root, uppercase candidate — OK
3. Outside root (different drive/path) — blocked
4. Sibling prefix `repo-evil` vs `repo` — blocked
5. `..` traversal via `resolveUnderRoot` — blocked
6. Symlink escape — still blocked (EPERM skip on Windows without elevation)
7. Non-Windows `isInsideRoot` — case-sensitive (platform param mock)
8. Write install with lowercase `c:\` target — succeeds on Windows

`npm run aecs:test` — 24/24 pass (9 paths + 15 install scenarios).

### Limitations confirmed

- Brain repo (`C:/Projects/cursor-agent-brain`) not in denylist — Phase 4 generic consideration; only canonical-source and `aecs/dev/` guards apply today.
- Windows symlink escape test skipped (EPERM without elevation).
- `stageverify` adapter intentionally substitutes project-specific deploy/rules strings into installed rules.

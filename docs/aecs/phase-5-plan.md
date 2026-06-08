# AECS Phase 5 Plan — Release-Ready Local Portability Package

> **Status:** IMPLEMENTATION COMPLETE (v0.2.0) — Dan approved; awaiting commit  
> **Generated:** 2026-06-08  
> **Inputs:** [`phase-4-plan.md`](./phase-4-plan.md), [`phase-4-status.md`](../../aecs/dev/docs/phase-4-status.md)  
> **Authority:** Meta/planning + tooling — not live agent guidance until installed targets adopt outputs.

---

## Goal

Produce a **local-only, operator-ready AECS release artifact** from `aecs/core/` and Phase 3–4 CLIs so a new git repo can be bootstrapped, updated, verified, and rolled back **without remote downloads, signing, or StageVerify-specific contamination**.

Phase 5 closes the gap between "works in stageverify dev host tests" and "another developer can adopt AECS from a documented local package."

## In scope (Phase 5)

| Capability | Location |
|------------|----------|
| Local export CLI (dry-run default) | `aecs/release/export.mjs` |
| Release payload rules | `aecs/release/lib/payload.mjs` |
| Operator guide | `aecs/release/OPERATOR-GUIDE.md` |
| Release checklist | `aecs/release/RELEASE-CHECKLIST.md` |
| Compatibility matrix | `aecs/release/COMPATIBILITY.md` |
| Release notes (0.2.0 track) | `aecs/release/RELEASE-NOTES-0.2.0.md` |
| Export scenario tests | `aecs/release/export.test.mjs` |
| npm scripts | `aecs:export`, `aecs:export:write`, extend `aecs:test` |
| Status doc | `aecs/dev/docs/phase-5-status.md` |

## Out of scope (Phase 6+)

- Remote manifest download / package registry publish
- Cryptographic signing, signing keys, unattended updates
- Brain repo (`cursor-agent-brain`) install path or SKILL changes
- `--force` overwrite of local modifications
- Filesystem file locking / atomic multi-file transactions
- Automatic backup retention pruning
- `--ignore-drift` rollback recovery flag
- `composer-orchestrator.mdc` split or broad rules redesign
- StageVerify product (`src/`) changes
- Installing/updating **stageverify** or **cursor-agent-brain** as targets

---

## Release artifact layout

Exported directory (local copy or zip — zip is operator step, not automated download):

```
aecs-release-<version>/
├── aecs/
│   ├── manifest.json          # canonical version + file hashes
│   ├── core/                  # Layer 1 portable payload
│   ├── adapters/              # project-adapter.template.json only
│   ├── installer/             # install + verify CLIs
│   ├── updater/               # update + rollback CLIs
│   └── release/               # operator docs (this phase)
└── release-metadata.json      # export provenance (no secrets)
```

**Excluded from export:** `aecs/dev/**` (Layer 2 AECS evolution memory), `aecs/examples/**` (dev-host project-specific references), and `aecs/adapters/*.bindings.json` (active bindings are project-owned).

---

## Version model (Phase 5 alignment)

| Term | Source | Phase 5 action |
|------|--------|----------------|
| **AECS core version** | `aecs/manifest.json` → `aecsVersion` | `0.2.0` at approved release cut; export validates hashes at current version |
| **Installer CLI** | `INSTALLER_VERSION` (`0.1.0`) | Unchanged — install semantics stable |
| **Updater CLI** | `UPDATER_VERSION` (`0.2.0`) | Documented in release notes |
| **Export CLI** | `EXPORT_VERSION` (`0.1.0`) | New — packaging only |

**Release cut ceremony (human-gated):** bump `aecsVersion` → refresh manifest hashes → run full `aecs:test` → export → disposable acceptance → Dan approves commit.

---

## Export workflow (dry-run default)

```
1. Validate source manifest integrity (hashes, required files)
2. Refuse export when output is inside source root or AECS dev host target
3. Build file list from payload rules (include installer/updater; exclude dev/)
4. Dry-run: print planned copy set + release-metadata preview
5. --write: copy tree + write release-metadata.json
6. Post-export: operator runs disposable install/update acceptance (documented)
```

No network I/O. No elevation. Node `fs` only.

---

## Operator workflows (documented, not new CLIs)

| Workflow | Command |
|----------|---------|
| Export package | `npm run aecs:export:write -- --output <dir>` |
| Greenfield install | `npm run aecs:install:write -- --target <repo> [--adapter <name>]` |
| Verify install | `npm run aecs:verify -- --target <repo>` |
| Update | `npm run aecs:update:write -- --target <repo> --source <export-dir>` |
| Rollback | `npm run aecs:rollback:write -- --target <repo> --transaction <id>` |

Bootstrap guidance covers: git init, optional adapter authoring, brain skill symlink (manual, documented — not installed by AECS).

---

## Disposable acceptance test (Phase 5 gate)

Run only in temp directories — **never** against stageverify, `.cursor/aecs/` on live host, or cursor-agent-brain:

```
1. aecs:export:write → temp export dir
2. aecs:install:write --source <export> --target <temp-repo>
3. aecs:verify --target <temp-repo>
4. (optional) aecs:update dry-run from host source
5. Delete temp dirs
```

---

## Security gates

| ID | Check |
|----|-------|
| SEC-P5-1 | Export refuses output inside source root (path boundary) |
| SEC-P5-2 | `aecs/dev/` never included in release payload |
| SEC-P5-3 | Manifest hash validation before export (supply-chain integrity, local-only) |
| SEC-P5-4 | No secrets in `release-metadata.json` or operator docs |
| SEC-P5-5 | No remote fetch, no shell interpolation |
| SEC-P5-6 | Export does not mutate source tree |
| SEC-P5-7 | Preserve Phase 3/4 fail-closed install/update/rollback semantics — export is read-only on source |
| SEC-P5-8 | Operator docs warn against write-mode on production hosts |

---

## Test matrix (export — 8 minimum)

| # | Scenario |
|---|----------|
| 1 | Dry-run — no writes |
| 2 | Successful export with `--write` |
| 3 | Exported manifest passes `loadSourceManifest` validation |
| 4 | `aecs/dev/` and `aecs/examples/` excluded |
| 5 | `installer/` and `updater/` included |
| 6 | Output path inside source root — blocked |
| 7 | `release-metadata.json` written with version + file count |
| 8 | Disposable acceptance: export → install → verify |

**Regression:** all 85 existing AECS tests must pass unchanged.

---

## Completion criteria

- [ ] `docs/aecs/phase-5-plan.md` and `aecs/dev/docs/phase-5-status.md` exist
- [ ] Export CLI + tests implemented
- [ ] Operator guide, checklist, compatibility matrix, release notes written
- [ ] `npm run aecs:test` — 93+ pass (85 regression + 8 export)
- [ ] `npm run build` clean
- [ ] Disposable acceptance documented and executed once in session
- [x] Dan approves before commit (2026-06-08)

---

## Migration (Phase 4 → Phase 5)

No install-record schema change. Export is additive tooling. Targets installed at `aecsVersion: 0.1.0` remain valid; release notes document optional upgrade path to `0.2.0` via `aecs:update:write`.

---

*Phase 5 plan created 2026-06-08 — local portability packaging; remote trust deferred to Phase 6+.*

# AECS Release Notes — 0.2.0

> **Distribution:** Local export only (`npm run aecs:export:write`). Not published to npm or remote registry.  
> **Signed:** `false` — sha256 integrity only, not cryptographic authenticity.  
> **AECS product version:** `0.2.0` (`aecs/manifest.json` → `aecsVersion`)

## Summary

Phase 4 delivered safe update, verified backup, and rollback CLIs. Phase 5 adds **local release packaging** and operator documentation so AECS can be adopted on greenfield repos without using stageverify as an install target.

## Included in export package

- `aecs/core/**` — portable rule templates and schemas
- `aecs/installer/**` — install + verify (tool v0.1.0)
- `aecs/updater/**` — update + rollback (tool v0.2.0)
- `aecs/adapters/project-adapter.template.json` — generic adapter template only
- `aecs/release/**` — operator docs (this file set)
- `release-metadata.json` — per-file sha256, payload digest, `signed: false`

## Excluded

- `aecs/dev/**` — AECS development memory (Layer 2)
- `aecs/examples/**` — dev-host reference only (StageVerify example stays in development repository)
- `aecs/adapters/*.bindings.json` — active bindings are project-owned in target repos
- StageVerify product (`src/`, `functions/`)
- cursor-agent-brain / global skill binaries
- `.cursor/aecs/` backups, sentinels, git metadata

## CLI versions at 0.2.0

| Component | Version | Notes |
|-----------|---------|-------|
| AECS core (`aecsVersion`) | `0.2.0` | Canonical portable core version |
| Installer tool | `0.1.0` | Install semantics stable |
| Updater / Rollback tool | `0.2.0` | Phase 4 delivery |
| Export tool | `0.1.0` | Phase 5 packaging |
| Install record schema | `0.1.0` | Independent of product version |
| Update/backup schema | `0.2.0` | Independent of product version |

## Test coverage at close

- 85 regression tests (Phases 3–4)
- 15 export/acceptance tests (Phase 5)
- **100 total**

## Security posture (unchanged from Phase 4)

- Dry-run default on all mutating CLIs
- sha256 integrity — not cryptographic signing
- Fail-closed on conflicts, drift, malformed records
- No remote fetch, no elevated permissions
- Export refuses overwrite; partial exports marked `.export-incomplete`

## Upgrade path

1. Export new package from AECS dev host
2. `aecs:update` dry-run on target
3. `aecs:update:write` — backup created automatically
4. `aecs:verify` on target
5. Rollback available via `aecs:rollback:write` if needed

Targets installed at `aecsVersion: 0.1.0` may upgrade to `0.2.0` via `aecs:update:write`.

## Deferred to Phase 6+

- Remote distribution and signed manifests
- Brain repo install path automation
- Backup retention policy
- File locking for concurrent updates
- `--force` / `--ignore-drift` recovery flags

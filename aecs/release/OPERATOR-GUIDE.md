# AECS Operator Guide — Local Portability (Phase 5)

> **Audience:** Humans bootstrapping AECS on a new git repo from a local export.  
> **Model:** Local copy only — no remote download, no signing, no unattended updates.

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Node.js 18+ | CLIs are `.mjs`; `node:test` for regression |
| Git repository | Target must be a directory with `.git/` |
| AECS export directory | From dev host `npm run aecs:export:write` (see §1) |
| cursor-agent-brain (optional) | Manual `~/.cursor/skills/agent-ops` symlink — **not** installed by AECS |

## Never use as targets

- **stageverify** (AECS development host — has `aecs/dev/`)
- **cursor-agent-brain**
- Any repo without a disposable backup / git reset plan

## Command contexts

| Where you run | How to invoke | Notes |
|---------------|---------------|-------|
| AECS dev host (has `package.json`) | `npm run aecs:export`, `aecs:export:write` | Builds portable package |
| Exported package directory | `node aecs/installer/install.mjs`, `node aecs/installer/verify.mjs`, `node aecs/updater/update.mjs`, `node aecs/updater/rollback.mjs` | **No `package.json` in export** — use `node` paths below |
| Target project repo | Receives installed files only | `--target` points here |

All mutating CLIs default to **dry-run**. Pass `--write` explicitly to apply changes.

## 1. Create export package (on AECS dev host)

```bash
# Dry-run (default) — preview file list
npm run aecs:export -- --output C:/temp/aecs-release

# Write export (empty output directory required)
npm run aecs:export:write -- --output C:/temp/aecs-release
```

Verify `release-metadata.json` exists with `signed: false`, per-file sha256 entries, `aecsVersion: 0.2.0`, and `aecs/dev/` is absent.
Active adapter bindings (`aecs/adapters/*.bindings.json`) are **not** shipped — only `project-adapter.template.json`.

Project-specific adapter examples (e.g. StageVerify reference) live in the **AECS development repository** under `aecs/examples/` and are **not** included in the portable export.

## 2. Greenfield install

```bash
cd C:/temp/aecs-release

# Dry-run (default)
node aecs/installer/install.mjs --target C:/Projects/my-new-repo --profile composer-default

# Apply
node aecs/installer/install.mjs --target C:/Projects/my-new-repo --profile composer-default --write
```

Default install is **project-neutral** — no adapter is activated unless you pass `--adapter`.

### Creating a project adapter

1. Copy `aecs/adapters/project-adapter.template.json` in your **target repo** to `aecs/adapters/<your-project>.bindings.json`.
2. Customize `targetName`, deploy, verify, and memory paths for your project.
3. Install or update with `--adapter <your-project>`.

**Do not manually edit** AECS-owned generated files (`.cursor/aecs/installed-manifest.json`, `ownership.json`). Edit `aecs/core/` on the dev host and re-export.

**Project memory** (`PROJECT_STATUS/**`, `docs/roadmap.md`, etc.) is project-owned — AECS seeds `PROJECT_STATUS/CURRENT_STATE.md` only when absent.

## 3. Verify installation

```bash
node aecs/installer/verify.mjs --target C:/Projects/my-new-repo
```

Exit 0 = install record, installed file hashes, and portable core checks pass. (Release package integrity is verified at install-from-export time via `install.mjs` / `update.mjs`, not re-verified by this command.)

## 4. Update from newer export

```bash
# Dry-run first (default)
node aecs/updater/update.mjs --target C:/Projects/my-new-repo --source C:/temp/aecs-release-newer

# Apply (creates checksum-verified backup — not cryptographically signed)
node aecs/updater/update.mjs --target C:/Projects/my-new-repo --source C:/temp/aecs-release-newer --write
```

Blocked when local modifications exist — resolve manually; no `--force` in Phase 5.

## 5. Rollback

```bash
node aecs/updater/rollback.mjs --target C:/Projects/my-new-repo --list
node aecs/updater/rollback.mjs --target C:/Projects/my-new-repo --transaction <txn-id>
node aecs/updater/rollback.mjs --target C:/Projects/my-new-repo --transaction <txn-id> --write
```

Rollback clears sentinels **only after** post-rollback verify passes.

## 6. Brain skill (manual)

AECS installs project rules and `agent-ops.mdc` bridge template. Global tier table still loads from:

```
~/.cursor/skills/agent-ops  →  cursor-agent-brain git clone
```

Set `AECS_BRAIN_REPO_PATH` if your brain clone is elsewhere. AECS does **not** modify brain in Phase 5.

## Version model

| Field | Meaning |
|-------|---------|
| `aecsVersion` in `aecs/manifest.json` | Canonical portable core version (`0.2.0`) |
| `releaseTrack` in `release-metadata.json` | Local distribution track (`0.2.0`) — not a remote registry version |
| `installerVersion` / `exportVersion` | Tooling versions — independent of `aecsVersion` |
| `schemaVersion` in install/update records | Record format — independent of `aecsVersion` |

## Failure recovery

| Sentinel | Meaning | Action |
|----------|---------|--------|
| `.cursor/aecs/install-in-progress` | Partial install | Inspect disk; git reset or delete partial files; remove sentinel manually |
| `.cursor/aecs/update-in-progress` | Partial update | Run rollback if backup exists; else manual restore |
| `.cursor/aecs/rollback-in-progress` | Partial rollback | Read JSON `recoveryGuidance`; fix drift; remove sentinel after verify |
| `.export-incomplete` in export dir | Partial export | Delete directory and re-export to empty path |

No auto-resume. No `--ignore-drift`. No remote signing.

## Security defaults

- Dry-run default on install, update, rollback, export
- Fail-closed on hash mismatch, path escape, local modifications
- sha256 integrity checks — **not** cryptographic signatures
- Export refuses non-empty output directories

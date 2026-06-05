# AECS Phase 4 Plan — Safe Updates, Backups, Conflict Handling, Rollback

> **Status:** IMPLEMENTATION (v0.2.0) — no commit until Dan approves  
> **Generated:** 2026-06-05  
> **Inputs:** [`phase-3-plan.md`](./phase-3-plan.md), [`phase-3-status.md`](../../aecs/dev/docs/phase-3-status.md)  
> **Authority:** Meta/planning + tooling — not live agent guidance until installed targets adopt outputs.

---

## Goal

Safe **updater** and **rollback** CLIs that upgrade an existing AECS installation from local canonical source, with conflict detection, verified backups, transaction tracking, and fail-closed semantics — **dry-run by default**.

## In scope (Phase 4)

| Capability | Location |
|------------|----------|
| Update CLI (dry-run default) | `aecs/updater/update.mjs` |
| Rollback CLI (dry-run default) | `aecs/updater/rollback.mjs` |
| Backup + transaction | `aecs/updater/lib/backup.mjs`, `transaction.mjs`, `progress.mjs` |
| Conflict classification | `aecs/updater/lib/classify.mjs`, `ownership.mjs` |
| Update plan builder | `aecs/updater/lib/update-plan.mjs` |
| Rollback engine | `aecs/updater/lib/rollback-engine.mjs` |
| Version compatibility | `aecs/updater/lib/version.mjs` |
| Scenario tests (temp dirs) | `aecs/updater/update.test.mjs` (31+ cases) |
| npm scripts | `aecs:update`, `aecs:update:write`, `aecs:rollback`, `aecs:rollback:list`, `aecs:rollback:write`, extended `aecs:test` |

## Out of scope (Phase 5+)

- Remote manifest download / cryptographically signed manifests
- Brain repo / `~/.cursor/skills` install path
- Auto-delete backup retention policy (define format; manual cleanup default)
- `--force` overwrite of local modifications
- Unsupported recovery flags (e.g. `--ignore-drift`) — not available in Phase 4
- StageVerify product (`src/`) changes

---

## Version model

| Term | Source | Meaning |
|------|--------|---------|
| **Canonical source version** | `aecs/manifest.json` → `aecsVersion` | Version of portable core at update source |
| **Installed version** | `.cursor/aecs/installed-manifest.json` → `aecsVersion` | Version recorded at last install/update |
| **Target version** | Source manifest at update time | Intended version after successful update |
| **Schema version** | `schemaVersion` in install/backup records | Record format (`0.1.0` install, `0.2.0` post-update) |

**Upgrade direction:** `target > installed` (semver tuple compare).  
**Downgrade:** blocked unless `--allow-downgrade` explicit.  
**Same version:** no-op when `sourceManifestSha256` unchanged and plan has zero mutations.

---

## File change classifications (manifest evidence)

Classification uses **ownership registry + install record**, not path alone:

| Classification | Evidence | Typical disposition |
|----------------|----------|---------------------|
| `aecs-owned` | `ownership.json` → `owned-by-core` | auto-replace if disk matches record |
| `generated` | `ownership.json` → `generated` | recreate after verify |
| `project-owned` | manifest `projectOwned` or registry | **block** if differs |
| `local-override` | disk hash ≠ installed record hash | **block** |
| `adapter-regenerated` | rule template substitution | auto if unchanged on disk |
| `new` | in target plan, absent from install record | auto-add |
| `removed` | in install record, absent from target plan | auto-remove after backup |
| `unchanged` | hashes match | skip |
| `ownership-changed` | registry ownership differs between versions | **block** |
| `unknown` | path not in registry or manifest | **block** |

### Ownership transition policy

| Transition | Disposition |
|------------|-------------|
| unchanged | normal |
| `generated` → `generated` (metadata) | allowed |
| `owned-by-core` → `owned-by-core` | allowed |
| `owned-by-project` → `owned-by-core` | **block** |
| `owned-by-core` → `owned-by-project` | **block** |
| `generated` ↔ `owned-by-project` | **block** |
| ambiguous/missing prior ownership + mutation on installed path | **block** (fail-closed) |

---

## Update workflow (dry-run default)

```
1. Check install-in-progress / update-in-progress / rollback-in-progress sentinels (fail-closed)
2. Validate installation record (schema, files[], paths)
3. Validate source manifest (integrity, hashes)
4. Version compatibility (downgrade gate)
5. Recalc integrity (installed files vs recorded sha256)
6. Detect local changes / conflicts (classify.mjs + ownership registry)
7. Build dry-run plan (classifications + actions)
8. Block if unresolved conflicts
9. Write update-in-progress sentinel (write mode only)
10. Verified backup (all change/remove candidates + prior install record; missing required source → fail)
11. Apply safely (per-file writes; deletes only backed files)
12. Write new installation record (schema 0.2.0, transactionId)
13. Run read-only verify
14. On verify fail: leave update-in-progress; expose rollback transaction id
15. On verify pass: clear update-in-progress
16. Audit metadata in backup manifest (no secrets)
```

**Not atomic:** Phase 4 uses transaction-like tracking with verified backups and rollback — not a single atomic filesystem transaction. Partial failure may leave mixed state; rollback is the recovery path.

**No auto-rollback:** verify failure does not automatically invoke rollback; operator must run `aecs:rollback:write` explicitly.

---

## Conflict policy

### Safe auto

- Unchanged AECS-owned on disk replaced by newer canonical content
- New AECS-owned files added
- Generated adapters/rules recreated when disk matches install record
- Obsolete unchanged AECS-owned removed (after backup)
- Metadata regenerated after successful verify

### Block (fail-closed)

- Locally modified AECS-owned (disk ≠ install record)
- Project-owned collision
- Ownership change between versions (see table above)
- Ambiguous ownership on mutated installed paths
- Malformed install record or ownership JSON
- Source manifest checksum mismatch
- Backup creation or verification failure (including missing required backup source)
- Invalid manifest JSON or missing referenced files
- Downgrade without `--allow-downgrade`
- Path traversal / symlink escape
- Install-in-progress, update-in-progress, or incomplete rollback-in-progress sentinel present (update/install write)
- Post-failed-update drift detected during rollback (no `--ignore-drift` flag)

**No silent merge. No force overwrite default.**

---

## In-progress sentinels

| Sentinel | Path | Meaning |
|----------|------|---------|
| Install | `.cursor/aecs/install-in-progress` | Partial install — blocks update, rollback, and install write |
| Update | `.cursor/aecs/update-in-progress` | Partial update — blocks new updates; rollback allowed when transaction id matches |
| Rollback | `.cursor/aecs/rollback-in-progress` | Partial or unverified rollback — blocks install/update/rollback **write** until manually resolved |

**Race limitation:** check-then-write window exists between sentinel probe and write. Two concurrent updaters may race; Phase 4 documents this; Phase 5+ may add file locking.

### Rollback-in-progress schema (`.cursor/aecs/rollback-in-progress`)

Non-sensitive JSON only (`schemaVersion: 0.2.0`):

| Field | Purpose |
|-------|---------|
| `operation` | Always `rollback` |
| `rollbackTransactionId` | Id for this rollback attempt |
| `sourceBackupTransactionId` | Backup transaction being restored |
| `startedAt` | ISO timestamp |
| `status` | `in-progress` → `pending-verify` → cleared on success; `failed` / `verify-failed` on error |
| `plannedOperationCount` | Total apply steps |
| `completedOperationCount` / `completedOperationIds` | Progress evidence |
| `currentOperation` | In-flight step (when safe) |
| `lastSuccessfulStep` | Last completed op id (`action:relPath`) |
| `failure` | Concise error + `atOperation` when applicable |
| `recoveryGuidance` | Operator instructions — **no auto-resume** |

**Lifecycle:** create record before first rollback mutation → update after each successful op → `pending-verify` after apply → run verify → clear rollback + update sentinels **only** after verify passes. On apply or verify failure, preserve record and block all write CLIs (fail-closed).

**Read-only inspect:** dry-run rollback, backup list, and verify may run while rollback incomplete; they must **not** clear sentinels.

---

## Backup format

**Location:** `.cursor/aecs/backups/<transactionId>/`

```
manifest.json          # transaction metadata, versions, rollback plan, file list
installed-manifest.json  # prior install record snapshot
ownership.json           # prior ownership snapshot
checksums.json           # sha256 map of backed files (integrity, not crypto-signed)
files/<relPath>          # mirrored relative paths (URL-encoded slashes)
```

Backup manifest `rollback` object tracks:

- `filesBeforeUpdate` — paths from prior install record
- `filesAdded` — paths introduced by update
- `filesChanged` — paths overwritten
- `filesRemoved` — paths deleted by update
- `metadataReplaced` — installed-manifest.json + ownership.json

- All paths resolved under `targetRoot` via `resolveUnderRoot`
- Integrity verified (sha256 checksums) before live writes — **not** cryptographic signing
- Missing required backup source → **fail** (no silent skip)
- Retention: keep all backups; no auto-delete in Phase 4
- No unrelated files; no secrets in logs or backup manifest

---

## Rollback design

| Step | Behavior |
|------|----------|
| List | `aecs:rollback:list` — read backup manifests, sort by time |
| Dry-run | Preview restore set + added-file removal; detect conflicts with current disk |
| Validate | Check backup checksums; reject corrupt backups |
| In-progress | Allow when update-in-progress transaction matches; block install-in-progress |
| Drift detect | If install-record file hash ≠ disk → **block** (before any deletion) |
| Added-file drift | If update-added file modified since update → **block** before removal |
| Write | Restore backed files; **remove** update-added files not in prior install record |
| Metadata | Restore prior installed-manifest.json + ownership.json |
| Preserve | Never touch project-owned paths outside transaction |
| Verify | Run `aecs:verify` after restore (Version A) |
| Cleanup | Clear update-in-progress + rollback-in-progress **only after verify passes** |
| Partial failure | Preserve rollback-in-progress with `failed` status + last step; block writes until manual resolution |
| No auto-resume | Operator must inspect, fix drift, remove sentinel manually — no silent rollback restart |

---

## CLI

```bash
# Update — dry-run (default)
npm run aecs:update -- --target /path/to/repo [--source /aecs-host] [--adapter name]

# Apply update
npm run aecs:update:write -- --target /path/to/repo [options]

# Downgrade (explicit)
npm run aecs:update:write -- --target /path --allow-downgrade

# List backups
npm run aecs:rollback:list -- --target /path/to/repo

# Rollback dry-run
npm run aecs:rollback -- --target /path/to/repo --transaction <id>

# Apply rollback
npm run aecs:rollback:write -- --target /path/to/repo --transaction <id>
```

| Flag | Default | Purpose |
|------|---------|---------|
| `--target` | (required) | Installed git repo root |
| `--source` | auto (AECS host) | Local canonical source only |
| `--write` | false | Perform mutations |
| `--allow-downgrade` | false | Permit target version < installed |
| `--transaction` | (rollback required) | Backup transaction id |

---

## Security gates

- Path traversal / boundary escape (`resolveUnderRoot`, `assertNoSymlinkEscape`)
- Symlink/junction escape on mkdir walk (reuse installer `fs-safe.mjs`)
- No shell interpolation — Node `fs` only
- Malformed manifests → fail closed
- Backup tampering detected via checksum verification (sha256, not signed)
- Rollback poisoning blocked (validate manifest + checksums inside target root)
- Downgrade / version confusion blocked by default
- Partial failure reported with transaction id; no silent success
- Self-modification of governance: updater refuses canonical source / `aecs/dev/` targets

---

## Test matrix (31 minimum)

| # | Scenario |
|---|----------|
| 1–26 | Core scenarios (dry-run, update, rollback, collisions, paths, downgrade, no-op, audit) |
| 27 | Rollback removes Version B-only files |
| 28 | Ownership change blocks update |
| 29 | Install-in-progress blocks update |
| 30 | Update-in-progress blocks concurrent update |
| 31 | Missing required backup source blocks writes |
| 32–46 | MED-2 rollback-in-progress (15 scenarios in `rollback-progress.test.mjs`) |
| E2E | install A → verify → dry-run update B → write → verify B → local mod blocks → rollback dry-run → write rollback → verify A restored |

**Disposable E2E only** — never run write mode against StageVerify, brain repo, or `.cursor/aecs/` on live hosts.

---

## Migration (Phase 3 → Phase 4)

- Accept `installed-manifest.json` with `schemaVersion: 0.1.0`
- Post-update records use `schemaVersion: 0.2.0` with `lastTransactionId`, `updatedAt`, `updaterVersion`
- No destructive migration of existing installs; first update upgrades record format

---

*Phase 4 plan updated 2026-06-05 — MED-2 rollback-in-progress sentinel, blocking rules, verify-gated cleanup.*

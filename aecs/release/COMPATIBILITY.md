# AECS Compatibility Matrix — Phase 5 (Local Distribution)

| Environment | Install | Update | Rollback | Export | Notes |
|-------------|---------|--------|----------|--------|-------|
| Windows 10/11 | ✅ Tested | ✅ Tested | ✅ Tested | ✅ Tested | Drive-letter casing fix (bf1f512) |
| macOS | ⚠️ Expected | ⚠️ Expected | ⚠️ Expected | ⚠️ Expected | Paths use `path.sep`; not CI-verified |
| Linux | ⚠️ Expected | ⚠️ Expected | ⚠️ Expected | ⚠️ Expected | Symlink tests run; limited CI |
| Node 18+ | ✅ Required | ✅ | ✅ | ✅ | ESM `.mjs` |
| Node 16 | ❌ | ❌ | ❌ | ❌ | Not supported |

## Target requirements

| Requirement | Gate |
|-------------|------|
| Git repo (`.git/` exists) | Install/update/rollback |
| Writable target tree | All write modes |
| Not AECS dev host (`aecs/dev/` absent) | Install blocked on dev hosts |
| Not canonical source root | Install/update self-modification guard |

## Known limitations (Phase 5)

| Limitation | Workaround |
|------------|------------|
| No remote update channel | Copy export directory manually |
| No signed manifests | Verify sha256 via `aecs:verify` |
| No `--force` on local edits | Resolve conflicts manually |
| No file locking | Avoid concurrent write CLIs |
| No backup auto-prune | Manual cleanup of `.cursor/aecs/backups/` |
| No rollback-in-progress clear CLI | Manual sentinel removal after recovery |
| Brain skill not installed | Manual `~/.cursor/skills/agent-ops` setup |
| Windows symlink escape test | EPERM skip without elevation |

## Version compatibility

| Installed `aecsVersion` | Update from | Notes |
|-------------------------|-------------|-------|
| `0.1.0` | `0.1.0` / `0.2.0` export | Schema `0.1.0` → `0.2.0` on first update |
| `0.2.0` | `0.2.0+` export | Normal upgrade path (same or higher `aecsVersion`) |
| Any | Lower version | Blocked unless `--allow-downgrade` |

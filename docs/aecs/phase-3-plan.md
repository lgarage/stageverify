# ACES Phase 3 Plan — Installer and Installation Verification

> **Branding:** **ACES** (formerly AECS). Paths unchanged (`aecs/`). SV product first — [`aecs/README.md`](../../aecs/README.md).
> **Status:** IMPLEMENTATION (v0.1.0) — no commit until Dan approves  
> **Generated:** 2026-06-05  
> **Inputs:** [`phase-2-plan.md`](./phase-2-plan.md), [`aecs-phase1-audit.md`](../aecs-phase1-audit.md) §6  
> **Authority:** Meta/planning + tooling — not live agent guidance until installed targets adopt outputs.

---

## Goal

Safe v1 **installer** and **read-only verifier** that copy portable AECS core into a target git repo, generate `.cursor/aecs/` install state, seed rule templates with placeholder substitution, and detect collisions — **dry-run by default**.

## In scope (Phase 3)

| Capability | Location |
|------------|----------|
| Install CLI (dry-run default) | `aecs/installer/install.mjs` |
| Verify CLI (read-only) | `aecs/installer/verify.mjs` |
| Shared library | `aecs/installer/lib/*.mjs` |
| Scenario tests (temp dirs) | `aecs/installer/install.test.mjs` |
| npm scripts | `aecs:install`, `aecs:install:write`, `aecs:verify`, `aecs:test` |

## Out of scope (Phase 4+)

- Full updater, migrations, rollback command, `--force`
- Brain repo / `~/.cursor/skills` install
- `composer-orchestrator.mdc` split or broad rules redesign
- StageVerify product (`src/`) changes
- Signed manifests, automated backups (foundation only)

---

## Install topology

```
SOURCE (AECS host, e.g. stageverify/)
  aecs/manifest.json
  aecs/core/**          → copied to target/aecs/core/**
  aecs/adapters/*.json  → optional copy via --adapter

TARGET (greenfield or existing project)
  aecs/                 ← payload copy
  .cursor/rules/*.mdc   ← from *.mdc.template (substituted) if absent or identical
  .cursor/aecs/         ← generated install state
    installed-manifest.json
    ownership.json
    backups/.gitkeep
```

**Runtime rule:** Cursor loads `.cursor/rules/` only. Templates in `aecs/core/rules/` are canonical source; install may seed rules on greenfield targets.

---

## CLI

```bash
# Dry-run (default) — plan only, zero writes
npm run aecs:install -- --target /path/to/repo [--adapter stageverify] [--profile composer-default]

# Apply install
npm run aecs:install:write -- --target /path/to/repo [options]

# Read-only verification
npm run aecs:verify -- --target /path/to/repo
```

| Flag | Default | Purpose |
|------|---------|---------|
| `--target` | (required) | Destination git repo root |
| `--write` | false | Perform writes (dry-run when omitted) |
| `--adapter` | none | Copy `aecs/adapters/<name>.bindings.json` |
| `--profile` | `sonnet-default` | Orchestration profile for placeholders |
| `--source` | auto (parent of `aecs/installer`) | AECS host root |

---

## Ownership and collision policy

| Situation | Action |
|-----------|--------|
| Target path missing | Create (on `--write`) |
| Content identical to planned install | Skip — **already installed** |
| `manifest.projectOwned` path exists and differs | **BLOCK** — project-owned collision |
| Previously installed AECS rule differs from plan | **BLOCK** — local-override collision |
| Ambiguous path (`..`, outside root, symlink escape) | **BLOCK** |
| `PROJECT_STATUS/**` exists | **Preserve** — never overwrite non-empty memory |

No silent overwrites.

---

## Version record

**File:** `.cursor/aecs/installed-manifest.json`

```json
{
  "schemaVersion": "0.1.0",
  "aecsVersion": "0.1.0",
  "installerVersion": "0.1.0",
  "installedAt": "2026-06-05T12:00:00.000Z",
  "profile": "sonnet-default",
  "adapter": "stageverify",
  "sourceRoot": "/abs/path/to/aecs-host",
  "sourceManifest": "aecs/manifest.json",
  "sourceManifestSha256": "<sha256>",
  "files": [
    {
      "canonical": "aecs/core/rules/model-audit-gate.mdc.template",
      "installedAs": ".cursor/rules/model-audit-gate.mdc",
      "sha256": "<sha256>"
    }
  ]
}
```

---

## Verification checks

1. `installed-manifest.json` schema + version readable  
2. Every recorded file exists; SHA-256 matches recorded hash  
3. Canonical `aecs/core/**` hashes match `aecs/manifest.json`  
4. `ownership.json` consistent with manifest + install record  
5. No path escape in recorded paths  
6. Project-owned paths outside AECS write set untouched  
7. Cursor integration: `.cursor/rules/` gate files present when install claimed  
8. Portable core: no forbidden hard-coded paths in `aecs/core/**`  
9. No duplicate orchestration authority markers (single profile in install record)  
10. Secrets/forbidden path patterns absent from installed payload  

---

## Security requirements

- All paths resolved under `targetRoot` via `realpath` before write  
- Reject `..` segments and symlink/junction escapes (best-effort on Windows)  
- No shell interpolation — Node `fs` only  
- Malformed manifest → fail closed  
- Partial failure: atomic write via temp file + rename per file  
- Install log optional (Phase 4): `.cursor/aecs/install.log` gitignored  

---

## Test matrix (14 scenarios)

| # | Scenario |
|---|----------|
| 1 | Dry run on clean temp repo — no writes |
| 2 | Successful install on clean temp |
| 3 | Verify successful install |
| 4 | Re-install identical content |
| 5 | Collision — project-owned file conflict |
| 6 | Collision — locally modified AECS rule |
| 7 | Existing project memory preserved |
| 8 | Invalid/missing target |
| 9 | Path traversal / boundary escape |
| 10 | Symlink escape (skip if OS unsupported) |
| 11 | Partial/malformed install record |
| 12 | Portable core forbidden paths |
| 13 | No writes during dry run |
| 14 | Failure does not alter unrelated files |

---

## Rollback

Phase 3 does not implement rollback. Use git in target repo or delete `.cursor/aecs/` + `aecs/` manually. Phase 4 adds `.cursor/aecs/backups/`.

---

*Phase 3 plan created 2026-06-05 — installer implementation follows this document.*

# AECS Phase 5 Status

> **Updated:** 2026-06-08 | **AECS product:** v0.2.0 | **Export tool:** v0.1.0 | **Distribution:** local-only, unsigned — ready for commit (Dan approved)

## Scope decision

**Phase 5 = release-ready local portability package.** Confirmed by repository evidence:

- Phases 1–4 committed (`e8f5c7c` → `18a54c0`); `pre-aecs-phase4` → `bf1f512`
- 85/85 AECS regression tests pass at Phase 4 close
- No export/bootstrap operator docs existed
- Phase 4 explicitly deferred remote/signing/retention to Phase 5+
- `cloneAecsSource` test helper excluded installer/updater — real adoption needs packaged CLIs

**Rejected for Phase 5:** remote distribution, cryptographic signing, brain repo install automation, `--force`, file locking.

## StageVerify boundary

**Unchanged.** StageVerify remains AECS dev host only. `aecs/examples/` (including StageVerify adapter reference) is **development-repository only** — excluded from default export payload. Export → install → update → rollback acceptance runs on **disposable temp repos** only.

## Shipped in working tree (Phase 5)

- `docs/aecs/phase-5-plan.md` — binding plan
- `aecs/release/export.mjs` — local export CLI (dry-run default)
- `aecs/release/lib/payload.mjs` — payload inclusion rules (excludes dev + examples)
- `aecs/release/export.test.mjs` — 15 scenarios + disposable E2E
- `aecs/release/lib/integrity.mjs` — per-file hashes, payloadDigest, install verify hook
- `aecs/examples/` — dev-host reference only (not in portable export)
- `aecs/adapters/project-adapter.template.json` — generic template; active bindings excluded from export
- `aecs/release/OPERATOR-GUIDE.md`
- `aecs/release/RELEASE-CHECKLIST.md`
- `aecs/release/COMPATIBILITY.md`
- `aecs/release/RELEASE-NOTES-0.2.0.md`
- npm scripts: `aecs:export`, `aecs:export:write`

## Decisions (Dan approved 2026-06-08)

| Topic | Decision |
|-------|----------|
| Distribution model | Local directory copy only — operator may zip manually |
| Signing | None — sha256 integrity only (Phase 4 model preserved) |
| Payload | Include installer + updater + generic template; exclude `aecs/dev/`, `aecs/examples/`, `adapters/*.bindings.json` |
| Adapter packaging | StageVerify binding stays in dev repo `aecs/examples/` only; default install project-neutral |
| Version bump | `aecsVersion` → `0.2.0`; `releaseTrack` → `0.2.0`; installer/export/updater tool versions unchanged |
| Operator commands | Export dir uses `node aecs/.../*.mjs` (no package.json in export) |
| Brain repo | Manual skill setup documented — no AECS install path |
| Bootstrap | Greenfield install via existing Phase 3 CLI from export |
| Acceptance | Export → install:write → verify on temp repo |

## Verify before commit

```bash
npm run aecs:test   # 100 expected (85 + 15 export)
npm run build
```

## Limitations (Phase 6+)

- Remote manifest download / registry publish
- Signed manifests and signing keys
- Automatic backup retention
- `--force` / `--ignore-drift`
- Filesystem file locking
- Brain repo / `~/.cursor/skills` install automation
- Rollback-in-progress clear CLI

## Deferred Phase 6+

See `docs/aecs/phase-5-plan.md` § Out of scope.

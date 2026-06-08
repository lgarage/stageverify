# AECS Release Checklist — Local 0.2.0 Track

> Human gate before commit/tag. No remote publish in Phase 5.

## Pre-export

- [ ] `npm run aecs:test` — all regression + export tests pass
- [ ] Test count in RELEASE-NOTES-0.2.0.md matches `npm run aecs:test` output
- [ ] `npm run build` — clean (sanity; AECS does not touch `src/`)
- [ ] `aecs/manifest.json` hashes match disk (export validates automatically)
- [ ] `aecsVersion` is `0.2.0` in `aecs/manifest.json` and export metadata
- [ ] `RELEASE-NOTES-0.2.0.md` reviewed for accuracy

## Export

- [ ] `npm run aecs:export -- --output <temp>` — dry-run file list reviewed
- [ ] `npm run aecs:export:write -- --output <temp>` — write succeeds
- [ ] Confirm `aecs/dev/` and `aecs/examples/` **absent** in export
- [ ] Confirm no StageVerify-named files in export
- [ ] Confirm `installer/` and `updater/` present
- [ ] `release-metadata.json` — `localOnly: true`, `signed: false`

## Disposable acceptance

- [ ] Export → install:write → verify on **temp repo only**
- [ ] Optional: update dry-run from host source
- [ ] Temp dirs deleted after test
- [ ] **Not** run against stageverify, brain repo, or live `.cursor/aecs/`

## Documentation

- [ ] `OPERATOR-GUIDE.md` paths/commands current
- [ ] `COMPATIBILITY.md` environments accurate
- [ ] `phase-5-status.md` decisions recorded

## Commit gate (Dan)

- [ ] Dan approves scope and version bump
- [ ] Conventional commit: `feat(aecs): Phase 5 local release packaging`
- [ ] Tag optional: `aecs-v0.2.0` (local track — not npm publish)

## Explicitly NOT in this release

- [ ] No remote registry publish
- [ ] No signing keys or signed manifests
- [ ] No brain repo changes
- [ ] No write-mode against production hosts

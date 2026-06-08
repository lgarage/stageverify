# AECS Examples (development repository only)

> **Not in portable export.** This directory is dev-host reference material only — excluded from `npm run aecs:export:write` payload. Copy and adapt patterns for your project; do not treat as canonical AECS core.

## Adapters

Integration bindings live in the **target project** at `aecs/adapters/<project>.bindings.json`.
They are **project-owned** — the installer never overwrites an existing adapter file.

1. Copy `adapters/project-adapter.template.json` from the export package to your repo as `aecs/adapters/<your-project>.bindings.json`.
2. Customize `targetName`, deploy commands, verify scripts, and memory paths.
3. Install or update with `--adapter <your-project>` only after the file exists in your repo.

The `stageverify.bindings.json` example here is **StageVerify dev-host reference only**.
Do not use `--adapter stageverify` on greenfield projects.

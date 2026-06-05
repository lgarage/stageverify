# Orchestration Rationale (AECS Layer 2)

> AECS development memory — not loaded by Cursor at runtime.

## Problem

Global `cursor-agent-brain/SKILL.md` §10 declares Sonnet 4.6 as orchestrator (wait-for-proceed).
StageVerify's `.cursor/rules/agent-ops.mdc` declares Composer 2.5 Fast (announce-and-go).
Both load every session — instruction conflict.

## Resolution (Phase 2)

1. **Orchestration profiles** in brain SKILL.md (`sonnet-default` | `composer-default`).
2. **Project bridge** (`agent-ops.mdc`) declares active profile explicitly.
3. **Authority rule:** project `.cursor/rules/` wins on orchestration; SKILL wins on outcome schema and tier table.
4. **Trials** moved to per-project `.cursor/trials.json`.

## StageVerify choice

Profile: `composer-default` — no behavior change from pre-Phase-2 sessions.

## References

- `docs/aecs/phase-2-plan.md` — binding decisions
- `C:/Projects/cursor-agent-brain/docs/orchestration-profiles.md` — profile definitions
- `aecs/adapters/stageverify.bindings.json` — Layer 3 integration bindings

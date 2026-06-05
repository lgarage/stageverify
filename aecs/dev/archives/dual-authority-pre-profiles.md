# Dual Authority — Pre-Profiles Snapshot

> Archived 2026-06-05 — superseded by orchestration profiles § in brain SKILL.md + `agent-ops.mdc` bridge.
> Read-only audit trail; not loaded by Cursor.

## Original conflict (from portable-ai-os-report.md)

**The central portability blocker:** A dual orchestration policy conflict. The global
`cursor-agent-brain/SKILL.md` declares **Sonnet 4.6 as the orchestrator** (§10), while
stageverify's `.cursor/rules/` declare **Composer 2.5 Fast as orchestrator and default worker**.
Agents loading both rule sets must reconcile contradictory instructions every session.

## Pre-Phase-2 authority map

```
Cursor system prompt
    └── User rules (global)
            └── Workspace rules (.cursor/rules/*.mdc, alwaysApply)
                    ├── ship-loop.mdc
                    ├── parallel-agent-strategy.mdc
                    ├── composer-orchestrator.mdc
                    ├── model-dispatch-gate.mdc
                    ├── model-audit-gate.mdc
                    ├── session-cleanup-gate.mdc
                    └── agent-ops.mdc — declares Composer override (undocumented globally)
                            └── agent-ops SKILL.md
                                    └── CONFLICT: SKILL §10 Sonnet vs Composer override
```

## Phase 2 resolution

See `aecs/dev/docs/orchestration-rationale.md` and `docs/aecs/phase-2-plan.md` § Single orchestration authority resolution plan.

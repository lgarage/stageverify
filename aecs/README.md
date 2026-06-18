# ACES — Agent Control Engineering System

> **Branding:** The control-plane builder is **ACES**. Older docs and code paths still say **AECS** or use the `aecs/` directory prefix — same system; paths are unchanged until a dedicated rename release.

## StageVerify-first prototype (this repo)

**StageVerify is the product.** **ACES is the builder prototype hosted inside this repo.**

| Layer | What | Where |
|-------|------|--------|
| **Shipped product** | Material readiness app, Firestore, UI, CF | Repo root `src/`, `functions/`, `svscope_simple.md` |
| **ACES builder** | Portable rules, installer, manifest, memory bindings | `aecs/`, `.cursor/aecs/`, `docs/aecs/` |

**Agent rule:** Read `PROJECT_STATUS/CURRENT_STATE.md` and product scope **before** ACES meta-work. ACES changes must not block StageVerify shipping or widen agent scope into control-plane refactors unless Dan asks.

## What ACES is

ACES turns a working agent control plane (rules, gates, ship loop, memory tiers, away queue) into something **portable, installable, and auditable** across target projects.

Three layers (unchanged from audit):

1. **Portable core** — `aecs/core/` (rule templates, schemas)
2. **ACES dev memory** — `aecs/dev/`, `docs/aecs/` (plans, status — not Cursor-loaded by default)
3. **Target-project memory** — `PROJECT_STATUS/`, `docs/project_state.md` (StageVerify state)

## Where to read

| Topic | File |
|-------|------|
| Phase 1 audit | `docs/aecs-phase1-audit.md` |
| Phase plans | `docs/aecs/phase-*.md` |
| Live orchestration (SV) | `.cursor/rules/` + `agent-ops` skill |
| Product authority | `PROJECT_STATUS/svscope_simple.md` |
| Installer / export | `aecs/release/OPERATOR-GUIDE.md`, `package.json` `aecs:*` scripts |

## Path naming note

Directory and npm script prefixes remain **`aecs/`** (e.g. `npm run aecs:export`) to avoid breaking the v0.2 installer. Documentation and conversation use **ACES** as the product name.

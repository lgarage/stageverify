## Mini Librarian Indexer (live)

**Pattern:** index first → slice only what you need — never ingest whole markdown files to find one §.

| Step | Command / file |
| ---- | -------------- |
| 1. Router | `PROJECT_STATUS/MEMORY.md` (hot tier STOP) |
| 2. Dossier index | `PROJECT_STATUS/dossier-index.json` |
| 3. Slice one § | `npm run dossier:slice -- --tag agent-lessons` or `--id qr-routing` |
| 4. List tags | `npm run dossier:slice -- --list` |
| 5. Concern lookup | `npm run context:lookup -- --concern "vendor receive"` |
| 6. Task gotcha map | `npm run context:gotcha -- --task "pickup portal qr"` (orchestrator steps 6–8; prepends lessons §) |
| 7. Lessons § slice | `npm run context:lessons -- --type ui-component/drawer-copy` (estimate-log type/subtype) |
| 8. Drift check | `npm run away:validate` (fails on librarian-lessons-index ↔ file drift; dossier-index drift; **indexer-memory.json slice/anchor drift** for packet injection) |
| 9. Indexer ingest | `npm run indexer:ingest -- --summary "…" [--category …] [--trigger "a,b"]` — intelligent classify; overflow → `indexer-memory.json` |
| 10. Indexer retrieval | Auto-injected in `npm run away:next -- --packet` when queue item matches `triggerTerms` + type/subtype |

Token-efficiency planning: `PROJECT_STATUS/archives/LIBRARIAN_TOKEN_EFFICIENCY.md`. Full ACES roles below remain deferred.

**Lessons learned SSOT:** `PROJECT_STATUS/LIBRARIAN_LESSONS.md` is the single canonical rolling log for agent lessons (≤40 active lines; archive rotates to `archives/librarian-lessons-archive.md`). **`librarian-lessons-index.json`** maps estimate-log **type/subtype** → § line ranges; agents load slices via `npm run context:lessons -- --type <type>/<subtype>` after the archetype gate — never ingest the full file. `gotcha-map.json` and `npm run context:gotcha` prepend matched § on task triggers; ship/completion adds one bullet via `npm run lessons:append -- --type … --bullet "…"` (index ranges refresh automatically). **`indexer-memory.json`** holds structured overflow (decisions, timing signals, future ideas) with deterministic retrieval by trigger term + type/subtype — references SSOTs, never copies them. `MODEL_DOSSIER.md` § agent-lessons keeps domain-deep pickup/QR detail; `estimate-log.md` owns timing audit only.

**Indexer promotion rules:** `npm run indexer:ingest` classifies overflow into categories; `indexer-memory.json` entries use unique `triggerTerms` (no duplicate gotcha-map triggers). Promote to `gotcha-map.json` only when a trigger is high-signal and task-specific (`promotionCandidate: true` + `--apply-gotcha` after review). Promote to `LIBRARIAN_LESSONS.md` via `--category lesson` (not a full-file copy). Packet retrieval caps at top 2 indexer matches and skips injection when gotcha + lessons § already cover the same domain. Run `npm run away:validate` after ingest — slice line ranges must match SSOT anchors.

**Learning loop (worker → future packet):** Hard-earned fixes ship via `npm run away:ship -- --learned "…"` (or `--failure` + `--fix`); capture runs inline to `indexer-memory.json` — no manual `indexer:ingest`. `--note` auto-parses `root cause:`, `fix:`, `prod verify fail`, `stale gh-pages`, `Pages build stuck`. **`verify:*` failures** auto-queue to `learning-pending.json` via `run-verify-with-learning.mjs` wrapper; **`npm run deploy` failures** (timeout, Pages build stuck/errored, live bundle mismatch) auto-queue via `deploy-gh-pages.mjs` → same pending store; `away:ship` merges pending into indexer-memory. `npm run away:validate` runs `indexer:demo-packet` + `indexer:demo-verify-failure` + `indexer:demo-deploy-failure` regressions. Future work: `npm run away:next -- --packet` injects `gateWarnings` + lessons § + top-2 indexer matches + unmerged pending deploy/verify learnings. Promote high-signal gates to `gotcha-map.json` via `--apply-gotcha` when ready.

---

Knowledge System Hierarchy

Librarian
├── Retriever
├── Indexer
├── Note Taker
├── Archivist
├── Verifier
├── Context Packet Builder
└── Specialist Agents

---

Librarian

Responsibilities:

- Own StageVerify memory.
- Coordinate knowledge workers.
- Route knowledge tasks.
- Answer questions.
- Maintain knowledge relationships.
- Present information conversationally.

Rules:

- Does not orchestrate software development.
- Does not replace Composer.
- Does not directly implement software.

---

Retriever

Responsibilities:

- Search indexes first.
- Retrieve top relevant records.
- Load full records only when needed.
- Support conversational retrieval.

Rules:

- Never load entire knowledge base except for explicit audits.

---

Indexer

Responsibilities:

- Maintain indexes.
- Maintain tags.
- Maintain timestamps.
- Maintain record relationships.
- Maintain status lists.

Rules:

- Keep indexes lightweight.
- Optimize for fast retrieval.

---

Note Taker

Responsibilities:

- Convert conversations into structured drafts.
- Identify Ideas.
- Identify Decisions.
- Identify Active Discussions.
- Identify open questions.
- Preserve original wording temporarily.

Rules:

- Drafts only.
- Librarian decides.
- Verifier confirms.

---

Archivist

Responsibilities:

- Compress old memories.
- Remove duplicate knowledge after verification.
- Create summaries.
- Promote important memories.
- Mark stale memories.
- Recommend archival.
- Rebuild indexes.
- Preserve historical context.
- Maintain long-term efficiency.

Rules:

- Never permanently delete memories automatically.
- Never remove original wording before verification.
- Preserve important historical decisions.
- Maintain rollback capability.

Operation:

Runs periodically.

Examples:

- nightly
- weekly
- on-demand

The Archivist exists to prevent knowledge bloat while preserving important history.

---

Verifier

Responsibilities:

- Verify summaries.
- Verify categorization.
- Verify indexes.
- Verify relationships.
- Verify imports.
- Verify duplicate merges.
- Verify timestamps.
- Verify no information loss.

Rules:

- Validate affected records only.
- Auto-fix obvious issues.
- Roll back uncertain changes.
- Explain failures.

---

Context Packet Builder

Responsibilities:

- Build concise Composer context.
- Gather relevant discussions.
- Gather Ideas.
- Gather Decisions.
- Gather Lessons Learned.
- Gather Current Work.
- Gather risks.
- Gather unresolved questions.
- Include model/agent guidance.

Rules:

- Only for meaningful work.
- Keep packets concise.
- Never dump entire memory.

---

Specialist Agents

Purpose:

Future bounded knowledge workers.

Examples:

- Model Selection Specialist
- Security Knowledge Specialist
- Testing Knowledge Specialist
- Deployment Knowledge Specialist

Rules:

- Narrow responsibility.
- Reusable.
- Optional.
- Called only when relevant.

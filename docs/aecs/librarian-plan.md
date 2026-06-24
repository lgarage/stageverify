## Mini Librarian Indexer (live)

**Pattern:** index first → slice only what you need — never ingest whole markdown files to find one §.

| Step | Command / file |
| ---- | -------------- |
| 1. Router | `PROJECT_STATUS/MEMORY.md` (hot tier STOP) |
| 2. Dossier index | `PROJECT_STATUS/dossier-index.json` |
| 3. Slice one § | `npm run dossier:slice -- --tag agent-lessons` or `--id qr-routing` |
| 4. List tags | `npm run dossier:slice -- --list` |
| 5. Concern lookup | `npm run context:lookup -- --concern "vendor receive"` |
| 6. Drift check | `npm run away:validate` (warns on index ↔ file line drift) |

Token-efficiency planning: `PROJECT_STATUS/LIBRARIAN_TOKEN_EFFICIENCY.md`. Full ACES roles below remain deferred.

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

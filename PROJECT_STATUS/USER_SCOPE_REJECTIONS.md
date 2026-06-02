# User scope rejections (living log)

> **Purpose:** Things Dan did **not** want that an agent still built (or kept as dead UI).
> Agents: read this at session start when touching **portal nav**, **Settings**, or **dispatcher shell**.
> Dan: append rows when you correct the agent — one line is enough.

## How agents should use this

1. **Do not re-introduce** patterns listed under "Rejected" unless Dan explicitly asks again.
2. **Prefer separate routes** over `?focus=` scroll hacks when a sidebar label implies its own page.
3. **Do not add sidebar items** that are placeholders (`to: "#"` / `preventDefault`) — wire a real route or omit the item.
4. If unsure whether UI is duplicate of an existing page, **ask once** before implementing.
5. Log new rejections here in the same commit that removes the unwanted behavior (keeps log honest).

## Rejected (confirmed by Dan)

| Date | What was built | Why rejected | Correct approach |
|------|----------------|--------------|------------------|
| 2026-06-02 | **Deliveries** sidebar item on dispatcher portal | Same screen as **Dispatcher Dashboard** (only scrolled to the table) | One nav item: Dispatcher Dashboard only |
| 2026-06-02 | **Vendors** → Settings (`/settings?focus=vendors`) | Settings and Vendors are different areas; should not share one tab | Dedicated `/vendors` route + sidebar link; Settings = workflow + staging spots only |

## Add your own (template)

Copy a row when something shipped that you did not ask for:

```markdown
| YYYY-MM-DD | Short description of what shipped | Why you didn't want it | What you wanted instead |
```

## Open — Dan to fill in

Things you've mentioned in chat that may still need a row here (confirm and edit):

- *(Add anything else you remember — e.g. extra buttons, columns, auto-refresh, combined pages, docs/rules you didn't want committed, etc.)*

## Related project rules

- `composer-orchestrator.mdc` — Scope Discipline (do exactly what was asked)
- `MODEL_DOSSIER.md` § agent-lessons — verification and public-route mistakes (different category: bugs, not unwanted features)

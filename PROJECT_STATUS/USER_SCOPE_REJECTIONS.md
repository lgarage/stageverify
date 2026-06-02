# User scope rejections (lean log)

> **Max 8 rows below.** When full, move oldest to `PROJECT_STATUS/archives/scope-rejections.md` and keep this file short.
> Read only when changing **portal nav**, **Settings**, or **dispatcher shell**.
> **Learning ≠ more docs** — prefer one row here + delete bad UI in code; do not add new `.cursor/rules` for each mistake.

## Rules (short)

- Do not re-ship rejected patterns unless Dan asks again.
- No placeholder sidebar links (`#` / `preventDefault`).
- Separate route beats `?focus=` scroll when the label is its own area.
- Unsure if UI duplicates an existing page → ask once, then build.

## Rejected

| Date | Built | Instead |
|------|-------|---------|
| 2026-06-02 | **Deliveries** sidebar (same as Dispatcher Dashboard) | Dashboard only |
| 2026-06-02 | **Vendors** on Settings (`?focus=vendors`) | `/vendors` page; Settings = workflow + staging |

## Dan: add a row

One table line when something shipped you didn't want. Say in chat: *"log scope rejection: …"* — agent adds row + removes the feature in the same commit.

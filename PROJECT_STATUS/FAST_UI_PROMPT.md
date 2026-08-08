# Fast UI pass — copy-paste prompt

Use for **routine frontend/UI-only** changes (layout, copy, colors, spacing). Paste into **Agent mode** (not Multitask).

**D-65 routing:**
- **Simple UI** (wording, labels, column swaps, obvious CSS, straightforward visibility) → **Composer 2.5 Fast** + mechanical `verify:*` / D-42 / D-51. No Sol. No multi-Grok stack.
- **Visual-judgment UI** (theme, contrast, dark/light, a11y, complex layout, redesign) → **Sol** via Task `gpt-5.6-sol-high` **directly** (do not attempt Medium as Task) + readability DoD; ≤1 Grok UI judgment lane if warranted.

Backend deploy policy — see `.cursor/rules/ship-loop.mdc`; do not auto-deploy Firebase without Dan approval.

---

Fast UI pass.

Task:
[Describe the exact UI/layout/copy change.]

Scope:
Frontend/UI only.

Use:
- Agent mode
- **Composer** for simple UI · **Sol High Task** only for visual-judgment UI
- Mechanical verify (D-42/D-51) — Grok only if D-65 lane table warrants
- One agent only
- No scouts unless blocked

Do not change:
- readiness/status logic
- Firestore persistence
- Firestore rules
- Cloud Functions
- Gmail behavior
- pickup token behavior
- vendor check-in behavior
- data models unless required for a compile-only type fix

Instructions:
- Read only the files needed.
- Do not do a broad repo audit.
- Keep the change narrow.
- Preserve existing behavior.
- Capture D-51 before/after for visible UI.
- Run the affected route `verify:*` with contrast asserts.
- Do **not** stack Solution + Build Checker + UI Playwright + Ship unless risk justifies (D-65).
- Tiny-fast-safe → `ship-verifier: N/A (tiny-fast-safe — D-65)` after mechanical deploy checks.

Done when:
- Change matches the request
- Build clean
- Route verify PASS
- Evidence lines match lanes that actually fired

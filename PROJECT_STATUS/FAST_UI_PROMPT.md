# Fast UI pass — copy-paste prompt

Use for **routine frontend/UI-only** changes (layout, copy, colors, spacing). Paste into **Agent mode** (not Multitask). One agent, narrow scope. Backend deploy policy (Firestore rules, Cloud Functions, Gmail) — see `.cursor/rules/ship-loop.mdc`; do not auto-deploy without Dan approval.

---

Fast UI pass.

Task:
[Describe the exact UI/layout/copy change.]

Scope:
Frontend/UI only.

Use:
- Agent mode
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
- Use visual judgment: balanced, readable, usable.
- Use focused Playwright script when it covers the route (see composer-orchestrator: script may replace screenshots).
- Update PROJECT_STATUS/CURRENT_STATE.md with one brief line if user-visible layout shipped.

Validation:
- git status
- npm run build
- Route verify (pick closest; **confirm script names in `package.json` if unsure**):
  - Dispatcher drawer → `npm run verify:delivery-consistency`
  - Pickup portal → `npm run verify:pickup`
  - Receive/vendor → `npm run verify:vendor-delivered` (or closest receive script)
  - Settings/staging → `npm run verify:settings-staging`
  - Dispatcher nav/sidebar only → `npm run verify:dispatcher-nav`
- npm run away:validate

Ship:
- commit, push origin/main, deploy gh-pages (frontend-only default per ship-loop.mdc)
- Do NOT deploy Firestore rules, CF, backend without Dan approval (high-risk tier — ship-loop.mdc § Two-tier ship model)

Production verification (same route area as local):
- **Dispatcher drawer (any drawer ship):**  
  `STAGEVERIFY_BASE_URL=https://lgarage.github.io/stageverify npm run verify:delivery-consistency`  
  **and** `STAGEVERIFY_BASE_URL=https://lgarage.github.io/stageverify npm run verify:phase5-email`
- **Other routes:** matching `:prod` script if in `package.json`, else `STAGEVERIFY_BASE_URL=https://lgarage.github.io/stageverify` + route script
- `verify:dispatcher-nav` on prod only if nav/sidebar/settings routing changed
- If prod verify fails once right after deploy, wait ~15s and retry once

Final report (max ~8 lines):
1. Verdict
2. Files changed
3. What changed
4. Validation
5. Deploy/prod verify
6. Commit
7. Notes/blockers

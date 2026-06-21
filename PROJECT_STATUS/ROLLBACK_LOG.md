# Rollback log

## 2026-06-21 — Marketing landing page revert

- Marketing landing page commit reverted: `7f13631`
- Revert commit: `63aff33`
- Unrelated commit preserved: `06ef6ad`
- Build passed
- Lint has 48 pre-existing errors
- Route smoke checks passed for `/`, `/receive`, `/pickup`, `/login`, and `/demo/vendor-scan`
- Full verify scripts still need separate cleanup for fixture/timeout/base-path reliability
- Production gh-pages was redeployed after revert
- Root route should redirect to `/receive` after cache refresh

**Standing instruction (Dan):** Do not make marketing website changes in the StageVerify app repo.

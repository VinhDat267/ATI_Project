# 2026-10-02 · FE-01 · Safety and honest UI

- Task: `docs/handoff/tasks/FE-01-safety-and-honest-ui.md`.
- Base: `c6d6e89`; implementation commit: `1698506c90807fe1e5ec6ec3a68070b047b7a292`.
- Branch: `vinhdat/fix-fe-01-safety-honest-ui`.
- PR: pending independent review.

## Behavior delivered

1. Escape, backdrop and close only dismiss partial-failure UI. A paused notice reopens it; Stop needs explicit confirmation.
2. Production Vite builds contain neither admin nor demo passwords. Demo quick fill requires development, explicit opt-in, sandbox mode and a separate SANDBOX_USER account. `npm run check` scans a real build using synthetic environment/file sentinels without printing them.
3. `/api/services` returns registered tools, configured state and last connection-check status/time; failed checks invalidate prior success. Launchpad and settings use this metadata, refresh after configuration changes and show no unregistered service.
4. Samples require actual catalog tools; missing configuration disables the corresponding action. GitHub issue → Trello → Slack replaces unsupported PR/move-to-Done promises. Sheets is removed from runnable samples.
5. `/api/health` supplies runtimeMode; sandbox shows the fixed warning, live hides it. Unknown metadata is labeled unknown.
6. Landing removes unmeasured timing/savings/absolute-security promises, separates current and planned integrations and accurately describes AES-256-GCM, allowlists and approval before writes.
7. Failed conversation creation/rejection preserves valid UI state; missing plan ID disables approval. Network messages are Vietnamese; temporary session/refresh failures preserve tokens, while definitive 401 clears them.

## Evidence

- RED: partial modal 2 failures; login helper 5 failures; API metadata 3 failures; temporary-refresh retention 2 failures; App safety and honest launchpad/landing failures. Additional copy and settings regressions each failed before correction.
- `npm run check`: exit 0; 524 v3 tests (11 schema + 53 adapters + 128 planner + 25 executor + 146 API + 161 web), 66 offline evaluations; typecheck/build, production-secret scan, 1 launcher and 3 local-environment checks pass.
- `npm run test:browser:v3`: exit 0, 9/9 (default 5, clarification 1, partial failure 2, three-service 1). Real HTTP/SSE + PostgreSQL; sandbox planner/adapters. Esc leaves SQL plan status partial and sends no Stop; reopening allows Skip, and Stop transitions only after confirmation.
- Desktop/mobile failure screenshots captured in a separate output directory. Local evidence: `C:/Users/VinhDat/.codex/visualizations/2026/10/01/01a0f5ad-f541-7050-a1fd-85db4dc484de/FE-01`. Raw logs/screenshots are not committed.
- Setup failures were isolated: one fresh database lacked migrations; the second migration started before PostgreSQL accepted connections. Readiness was verified, migrations applied and the full gate rerun to exit 0.
- Existing assertions changed only where they encoded the removed behavior: auto-admin quick fill, Esc-to-Stop, static healthy/unsupported samples, premature sample rendering, health JSON shape and inaccurate copy.
- Independent review: pending. CI: pending PR.

## Limits and next handoff

- No live provider calls, external-service writes, real credential reads or new visual direction. Sandbox/browser success is not live-service acceptance.
- Last connection checks are process-local and reset after server restart; unknown checks are shown as unchecked.
- AUTH-01, W3-00, FE-02 remain separate cards. CURRENT-STATE/ROADMAP are intentionally unchanged; reviewer updates after merge.
- Primary checkout and its unrelated dirty files remain untouched. Keep this worktree while the PR is open.

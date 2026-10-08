# FE-09 implementation plan

Authority: FE-09 task card and approved UI redesign spec (07/10), source React prototypes Account/Users/History. Scope: frontend pages, route composition, dependent tests, handoff. Backend and schema remain outside this task.

1. Establish isolated dependencies and focused baseline; write failing FE-09 tests for prototype route ownership, verified approval, Google modal, and history Enter/Esc/cursor/late draft behavior.
2. Copy Account source JSX/CSS and connect account API, preserving protected transport and name draft/session guards. Copy Users JSX/CSS and connect paginated admin API, verified approval, confirmation and truthful counts. Copy History JSX/CSS, remove unsupported metadata/demo/filter/receipt controls and connect own conversations with guarded rename and cursor loading.
3. Update selectors in existing account/admin/routing/browser tests without removing behavior assertions. Run focused unit and real PostgreSQL/browser gates. Resolve failures through evidence.
4. Capture paired app/prototype images at 1440x900 and 375x812 light/dark; assert no horizontal overflow and record SHA256 plus supported differences.
5. Run full check and canonical browser suite; update task Results and one handoff log; commit scoped files and hand off to parent for independent review/PR/exact-head CI.

Pre-flight: FE-08 owns AuthGate/auth pages in another checkout; parent owns canonical runner FE-08/FE-09 discovery. FE-09 owns App.tsx. Shared client edit limited to Google unlink method after parent agreement. No shared CSS changes.

Ruling: Account email verification uses authenticated user emailVerified (account profile API does not return this field); omit a verification badge when the field is absent, rather than invent verification.

Evidence directory: C:/Users/VinhDat/orca/artifacts/fe-09 (outside repository). Baseline focused: 35/35, exit 0. An initial command used the wrong Vite config root; corrected to npm workspace command before baseline.

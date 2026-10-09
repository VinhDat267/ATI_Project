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

Implementation rulings and checkpoints:

- Google current-password verification requires AUTH-07 / PR #120. FE-09 is stacked on `fix/auth-google-unlink-password` at `1792f120ed02842cb57688d182867d8462333705`; the frontend retains protected transport and replaces the compatibility caller with the source modal. Backend changes remain in the prerequisite PR.
- Admin counts are unfiltered server totals. The members tab combines separate active/disabled pages (up to 40 rows), advances while either stream has another page, and makes no fixed rows-per-page claim. Omit the prototype role filter because this API cannot filter by role; role changes remain supported.
- History omits unsupported demo statistics, group/status/tool filters, prompt/tool chips and receipts. Titles, dates, actual statuses, cursor and `/c/:id` come from the own-conversation API.
- UserNavMenu receives optional local trigger/menu classes after parent agreement; defaults remain intact. This preserves source avatar styling outside the Cockpit stylesheet. The page CSS files remain byte-identical to the source.
- Real deferred responses prove name/history draft ownership and release busy flags after a user/search change. Rename focus returns after the editor DOM closes on Enter/Escape.
- The native no-email approval fixture forwards an actual HTTP 503 response and proves the user stays pending through retry. Runtime loading keeps the API under its own TypeScript compiler settings.
- Independent review found valid all-space current passwords rejected locally. The empty guard now checks the literal value; real hash/API/browser controls verify a 12-space password is accepted without trimming.
- Independent review found the password meter stale after successful clearing. The hook reads the actual input after conditional cleanup; two deferred tests prove zero after clearing and preservation of the newer draft and its length.
- Visual packet: 40 PNGs (12 required app/prototype pairs, four extra Users member pairs, eight open-menu states), SHA256 manifest and comparison HTML outside the repository. Prior packets retain the discovered unstyled avatar and unsupported role-filter state.

Local checks are implementation evidence. Parent owns independent review, Vietnamese PR, exact-head CI and merge coordination. Merge prerequisite #120 first, then retarget the frontend PR to main; no automatic merge.

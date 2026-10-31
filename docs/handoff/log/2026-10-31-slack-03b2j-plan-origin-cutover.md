# 31/10/2026 · 03B2J plan origin cutover

Worktree `feat/slack-03b2j` from `6dbbaa9b` (PR #216, not merged). Temporary Postgres `ati-03b2j-pg` at `127.0.0.1:56541`, tmpfs, removed only when this session ends.

RED: `tests/integration/slack-plan-origin-runtime.test.ts` failed to import `slack-plan-origin-backfill.ts`.

GREEN: same file 3/3. With `execution-routes`, `execution-security` and `memory-execution-snapshot`: 18/18.

Not claimed: full `npm run check`, browser suite, or GitHub CI. A full `chat-api` run on this machine failed tests that also fail on `6dbbaa9b` without this diff (`validateSlackBinding is not a function`, `fixture policy denied`).

M2 remains open. 03B2K and public read are documents only in this branch.

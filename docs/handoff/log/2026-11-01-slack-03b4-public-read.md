# SLACK-03B4 · Public approved personal Slack reads

Date:01/11/2026 (Asia/Bangkok). Card:[SLACK-03B4](../tasks/SLACK-03B4-public-read-integration.md).
Branch:`feat/slack-03b4-public-read`. Initial source base:`c63a24f6` (03B3); staging advanced to merge`3d90e862`, tree equal to that base (`git diff --exit-code` exit0). Only that empty-tree fast-forward was adopted; no product delta from base integration.

## Implemented
- Dedicated `planSlackRead`: user request plus tool/actor metadata only; no gather, history or working-memory Slack payload. Eight core reads, bounded provider call with real AbortSignal; model connections are discarded. Literal resource IDs must be supplied by the user or be the selected caller's own ID. Ordinary workflow write rule stays in force.
- Owned authenticated `POST /api/conversations/:id/slack-read-plans` creates a correlated user turn and a server-bound approval preview. Current planning/manual-lookup/storage permission is checked before the model, then connection identity and policy epoch are checked again before storage. Durable results require explicit storage permission for1day.
- Real server composition wires the03B3 private wrapper, token manager, binding resolver, guarded executor and transactional result registration. OAuth loopback `/api` is adapted to the read adapter's existing origin contract; native URL pinning remains in the wrapper. Personal tools never use a shared sandbox fallback.
- Cockpit read opt-in, explicit selection for multiple workspaces, sole-workspace auto-selection, selected workspace/actor labels, read-specific approval and result projections. No Slack request before approval. Results are fetched from guarded HTTP views; source payloads are absent from SSE/replay.
- Reload notices immediately clear messages, plan/results, streaming data and the current history title. Shared owner/source-generation guards also cover ordinary route history and execution reconciliation. Polls coalesce, abort after8seconds and clear old data if authority cannot be refreshed. Old owner/route/epoch replies cannot restore a cache. Slack receipt details use the same display allowlist.

## TDD and independent review
RED observed for missing dedicated planner/public route/read UI, pre-approval transport, message rendering, source/title cache clearing and owner-late responses. PostgreSQL/HTTP tests use actual repositories, sessions, private schemas, wrapper transport and approval. Browser uses actual server bootstrap, real OAuth HTTP fixture, database consent attestations and signed lifecycle ingress; it makes no native/provider/model call.

Fresh independent whole-branch reviewer reported three findings: late route history could restore invalidated messages; overlapping slow polls could starve revalidation; legacy receipt details exposed raw output. Root graded all Important and fixed them in one pass.
- Delayed history and execution replies across source invalidation/owner switch: RED→GREEN.
- Coalesced reload and actual20ms AbortSignal deadline: RED→GREEN. Additional delayed route reply after a timed-out poll: RED→GREEN.
- Complete receipt DOM with internal provenance sentinel: RED→GREEN.
- Focused final regressions: **24/24**, exit0, including existing execution/history-race cases. Earlier cockpit regression set: **85/85**, exit0.

Independent reviewer used source inspection only for03B4 and did not independently rerun tests. Root verified the fixes through the reproduced failures and final suites. Native Slack/model acceptance, final CI and universal server-side assurance were not inferred from that bounded review. Backend authority evidence comes from the actual tests and accepted03B3 guard implementation.

## Verification record
- First fullcheck before review fixes: exit0,3320v3+406eval+1launcher+66Node=3793. Superseded by the final source below.
- Browser after fixes: **4/4**, exit0,375/1440 light/dark, actual request→preview→approval→selected-workspace result→signed deletion→DOM cleared. Screenshots inspected for375light and1440dark; no screen-reader claim.
- Post-fix fullcheckr2: exit1;1170API tests had one legacy03B2F assertion time out after5seconds while status was still`approved`. A simultaneous frontend/browser load was active. The target also timed out once during concurrent web tests, then passed in isolation once idle (1pass,14skipped, exit0; no >1second PostgreSQL blockers observed). No test timeout or product code was changed to hide it. Final fullcheck is run without a simultaneous browser process.
- Final `npm run check`r3: **exit0**,3327v3 (283schemas+519adapters+388planner+51executor+1170API+916web),406eval,1launcher,66Node = **3800** checks/tests. Typecheck/build/build-security passed. Raw SHA256:`8BC02A14844B3066FFD0766EE4B8F212AC975D851E26CC20A705573A141CF0FE`. Same final product as the successful post-fix browser; only documentation was edited afterward.
- Publication/exact-head CI: pending at commit; reviewer must record the published head, green CI and merge-tree identity before staging acceptance. Implementation evidence is not a remote CI claim.

## Scope decisions and remaining work
- The public planner does not consume Slack outputs or use result references: list resources first, then supply the selected literal ID in a new request. Internal03B3 retains guarded references. Cost: an extra user turn for name resolution.
- Results with conversation history require workspace permission to store for1day; retention0 remains available only in the private transient wrapper. Cost: a valid connection alone does not enable this durable path.
- Source-derived proposal/digest intents, writes04C, authorization fanout/six watermarks/rotation recovery, three modes/Inbox, API reconciliation, native Free/Pro/two-user/model, fullF3/F4 and main/live rollout remain open. Existing origin backfill was not applied to production.
- Implementation does not edit CURRENT-STATE/ROADMAP. Main checkout's unrelated Trello work is untouched. Reviewer records canonical status after accepted staging merge.

# SLACK-03B2E · Message selectors and working-memory lifecycle

Status: IN_PROGRESS. Base `d87d857cffeed09d58c5cde9bbed30ed400d8766`; branch `VinhDat267/slack-m2-core-lifecycle-20261030`. Direct Codex implementation. Parent: [03B2](SLACK-03B2-derived-lineage-and-purge.md); [delivery M2](../SLACK-DELIVERY.md). [Runtime plan](../../superpowers/plans/2026-10-30-slack-03b2e-message-memory-runtime.md).

Deliverable: the real MessageRepo writer commits message/metadata or selected working-memory entries and server provenance atomically; ordinary HTTP/history hydration reads guard the same persisted selectors; native cleanup physically erases those selectors using durable, fenced invalidation intents even with flags off. Preserve unrelated service entries. Legacy or incomplete lineage fails closed. Historical PLAN_ONLY interfaces and migration numbers are not runtime contracts.

Owner: Backend, `apps/chat-api/`, one new migration after0020, this card/plan and one implementation log. No main/feature-flag changes. No other implementer agents.

Acceptance:

- [x] Real PostgreSQL RED→GREEN: same-transaction writer/registry rollback; canonical version/fingerprint; precise metadata/memory erasure; retain Trello/Google entries; wrong-owner and mixed-owner rejection.
- [x] Actual MessageRepo reads and chat history/memory hydration mask invalid data before reuse; malformed/legacy/uncovered selectors fail closed; no model/client provenance is trusted.
- [x] Revoke/edit/delete/policy/TTL block before purge; consumer retains lease/barrier/cutoff fences and handles the new selectors and working-memory kind.
- [x] Real AbortSignal and PostgreSQL contention tests; no weakened guard or fictitious DB mock.
- [ ] Freeze base/code, fullcheck, one independent read-only whole-branch Codex review, exact published-head CI check/browser, merge-tree comparison before staging acceptance.

Other core kinds (`plan_step_arg`, `scheduled_workflow_arg`, `audit_log_entry`) require the next integrated card. Slack-derived plan/schedule publication remains gated until their writers/readers/handlers exist. Public read routing03B3/03B4, future06 kinds, fullF3/F4 and native Slack/model acceptance remain open.

## Kết quả

Message/metadata/memory runtime implemented. Three independent-reviewP2 fixed with real RED→GREEN: singular memory entities, gather→SSE-cache leakage and planning-only purpose hydration. Final frozen code/test head `c19103a797c9fe18f33dcbe8b70aacc03b22e20b`: fullcheck3666PASS, exit0, typecheck/build/securityPASS. Independent whole-branch review plus exact-head purpose verification PASS with no actionableP1/P2/P3; fresh integration20/20PASS, prior focused95 and actual-server2PASS remain separate evidence. Published-head CI/check/browser and staging merge-tree verification remain pending publication gates. [Evidence and limits](../log/2026-10-30-slack-03b2e-message-memory-runtime.md). No native acceptance; full legacy backfill, derived TTL cascade, other three core kinds and public read integration remain open underM2.

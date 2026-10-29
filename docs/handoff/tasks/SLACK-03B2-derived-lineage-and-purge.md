# SLACK-03B2 Â· Pháº£ Há»‡ Nguá»“n Báº£n Sao PhÃ¡i Sinh & Cascade Purge Bá»n Vá»¯ng

**Tráº¡ng thÃ¡i:** Dá»° THáº¢O Káº¾ HOáº CH â€” THáº¨M Äá»ŠNH Bá»žI ÄIá»€U PHá»I VIÃŠN (DOCS ONLY, chÆ°a thá»±c thi code runtime).
**NhÃ¡nh cÃ´ng viá»‡c dá»± kiáº¿n:** `docs/slack-03b2-derived-plan` (Draft PR vÃ o `integration/slack-personal-20261029`).
**Ná»n Ä‘á»‘i chiáº¿u:** `e9088d5e76e95fa65e3be019226835371e40908d` (trÃªn `integration/slack-personal-20261029`).
**Vai trÃ² sá»Ÿ há»¯u:** Backend Engineer (sá»Ÿ há»¯u Ä‘á»™c quyá»n `apps/chat-api/` vÃ  `db/v3/`).
**Phá»¥ thuá»™c:**
- **SLACK-01** (Foundation contracts `SlackBinding`, `SlackSourceRef`, `SlackModelPolicy`, fixture HTTP, probe offline) â€” ÄÃƒ HOÃ€N Táº¤T (`fc12e3fb`).
- **SLACK-02** (OAuth, connections, processing consents) â€” Äang tÃ­ch há»£p qua PR #184/#192.
- **SLACK-03A** (Schema contracts `SlackPolicyEpoch`, `SlackDerivedCopyRef`, `SlackSourceLineage`, `SlackPurgeTarget` vá»›i 6 scopes bao gá»“m `policy_epoch_invalidated`, PR #194, head `bc8d6b69`) â€” ÄÃƒ CHáº¤P THUáº¬N.
- **SLACK-03B1** (Raw source store, durable barriers, queue, policy consumer â€” sibling `feat/slack-03b1-source-store`, `ctx_29765fc6b1b7`, PR #196) â€” CHÆ¯A ÄÆ¯á»¢C CHáº¤P THUáº¬N RUNTIME; giao diá»‡n consumer Ä‘Æ°á»£c xÃ¢y dá»±ng dá»±a trÃªn há»£p Ä‘á»“ng Ä‘Ã³ng bÄƒng (`frozen interfaces`).
- **SLACK-03C1** (Read adapters â€” sibling `feat/slack-03c1-read-adapters`, `ctx_89198a2a3d9d`) â€” CHÆ¯A ÄÆ¯á»¢C CHáº¤P THUáº¬N RUNTIME.
- **SLACK-04A** (Ingress contracts â€” `2026-10-29-slack-source-ingress-contracts.md` / `msg_150cb7b10000`) â€” ÄÃƒ CHáº¤P THUáº¬N GIAO Æ¯á»šC.

**Task cha:** [`docs/handoff/tasks/SLACK-03-tool-catalog-and-source-lifecycle.md`](SLACK-03-tool-catalog-and-source-lifecycle.md).
**Káº¿ hoáº¡ch chi tiáº¿t:** [`docs/superpowers/plans/2026-10-30-slack-03b2-derived-lineage-and-purge.md`](../../superpowers/plans/2026-10-30-slack-03b2-derived-lineage-and-purge.md).

---

## 1. Má»¥c TiÃªu & Ranh Giá»›i Pháº¡m Vi Bounded

Card nÃ y thiáº¿t káº¿ cÆ¡ cháº¿ Ä‘Äƒng kÃ½ pháº£ há»‡ chuáº©n hÃ³a bá»n vá»¯ng (`slack_derived_copies` vÃ  `slack_derived_provenance_segments`) cho má»i báº£n sao phÃ¡i sinh mang dá»¯ liá»‡u Slack, gáº¯n káº¿t nguyÃªn tá»­ vá»›i thao tÃ¡c ghi thá»±c táº¿ trong má»™t giao dá»‹ch PostgreSQL, rÃ o cháº¯n kiá»ƒm tra toÃ n diá»‡n trÆ°á»›c má»i thao tÃ¡c Ä‘á»c/render/model-use/SSE/lá»‹ch trÃ¬nh, vÃ  bá»™ cháº¡y cascade purge (`SlackCascadePurgeRunner`) cho Ä‘Ãºng **7 nhÃ³m báº£n sao phÃ¡i sinh** chuáº©n táº¯c theo tiÃªu chuáº©n nghiá»‡m thu F3.

### 1.1. Ranh Giá»›i PhÃ¢n Táº§ng Bounded Scope:
1. **03B1 (Nguá»“n ThÃ´) vs 03B2 (Báº£n Sao PhÃ¡i Sinh - Card nÃ y):**
   - 03B1 chá»‰ quáº£n lÃ½ báº£ng dá»¯ liá»‡u nguá»“n thÃ´ `slack_sources` (tráº§n TTL cá»©ng `<= 7 ngÃ y`), rÃ o cháº¯n tá»©c thá»i `slack_invalidation_barriers`, hÃ ng Ä‘á»£i `slack_invalidation_intents`, vÃ  xÃ³a dÃ²ng nguá»“n thÃ´. HoÃ n thÃ nh 03B1 KHÃ”NG Ä‘á»“ng nghÄ©a hoÃ n táº¥t cascade purge F3.
   - 03B2 sá»Ÿ há»¯u sá»• bá»™ chuáº©n hÃ³a cá»§a má»i báº£n sao phÃ¡i sinh (`SLACK_DERIVED_TARGET_KINDS`), quáº£n lÃ½ trÃ­ch Ä‘oáº¡n (tráº§n TTL `<= 30 ngÃ y`), má»Ÿ rá»™ng bá»™ quÃ©t fanout sá»± kiá»‡n chÃ­nh sÃ¡ch Ä‘á»ƒ bao gá»“m cáº£ cÃ¡c epoch chá»‰ tá»“n táº¡i á»Ÿ báº£n sao phÃ¡i sinh, vÃ  Ä‘iá»u phá»‘i cascade purge thá»±c sá»± xÃ³a sáº¡ch ná»™i dung/trÃ­ch Ä‘oáº¡n khá»i database vÃ  bá»™ nhá»›.
2. **03B2 vs 03B3 (Executor):**
   - 03B2 cung cáº¥p giao diá»‡n tháº©m Ä‘á»‹nh `IExecutorSlackLineageGuard` Ä‘á»ƒ kiá»ƒm tra rÃ o cháº¯n trÆ°á»›c khi phÃ¢n giáº£i tham sá»‘ vÃ  serialize káº¿t quáº£. 03B3 Ä‘á»™c quyá»n sá»Ÿ há»¯u logic kiá»ƒm tra binding vÃ  tÃ­nh toÃ n váº¹n hash trÆ°á»›c dispatch trong `packages/executor/`.
3. **03B2 vs 03C (Adapters) & 04A (Ingress):**
   - 03C sá»Ÿ há»¯u adapter Ä‘á»c vÃ  thu tháº­p transient (`retentionDays: 0`). Quyá»n Ä‘á»c táº¡m thá»i khÃ´ng pháº£i quyá»n lÆ°u trá»¯; viá»‡c chuyá»ƒn hÃ³a sang báº£n sao phÃ¡i sinh Ä‘Ã²i há»i tham chiáº¿u chÃ­nh sÃ¡ch má»¥c Ä‘Ã­ch `'storage'` riÃªng biá»‡t dÆ°á»›i cÃ¹ng epoch thu tháº­p.
   - 04A sá»Ÿ há»¯u webhook ingress vÃ  gá»i `stageInTransaction` cá»§a 03B1. 03B2 tiÃªu thá»¥ hÃ ng Ä‘á»£i intent tá»« 03B1 Ä‘á»ƒ thá»±c thi cascade purge.
4. **03B2 vs 06 (Inbox & Digest):**
   - CÃ¡c thá»±c thá»ƒ `proposal_excerpt` vÃ  `daily_digest_entry` thuá»™c vá» cÃ¡c module Inbox/Digest tÆ°Æ¡ng lai cá»§a SLACK-06. 03B2 thiáº¿t láº­p rÃ o cháº¯n fail-closed: tá»« chá»‘i lÆ°u trá»¯ trÃ­ch Ä‘oáº¡n náº¿u chÆ°a Ä‘Äƒng kÃ½ há»£p Ä‘á»“ng pháº£ há»‡.

---

## 2. PhÃ¢n Chia Module & Quyá»n Sá»Ÿ Há»¯u (Module Ownership)

TuÃ¢n thá»§ nghiÃªm ngáº·t quy chuáº©n táº¡i [`docs/team-workflow.md`](../../team-workflow.md):
- **Backend Engineer (Sá»Ÿ há»¯u Ä‘á»™c quyá»n card nÃ y):**
  - CÆ¡ sá»Ÿ dá»¯ liá»‡u: `db/v3/0018_slack_derived_lineage_and_purge.sql`
  - Repository: `apps/chat-api/src/db/repositories/slack-derived-lineage-repo.ts`
  - Dá»‹ch vá»¥ pháº£ há»‡ & kiá»ƒm tra: `apps/chat-api/src/services/slack/slack-derived-lineage-store.ts`
  - Bá»™ cháº¡y cascade purge: `apps/chat-api/src/services/slack/slack-cascade-purge-runner.ts`
  - Giao diá»‡n báº£o vá»‡: `apps/chat-api/src/services/slack/slack-lineage-guards.ts`
  - Kiá»ƒm thá»­: `apps/chat-api/tests/db/slack-derived-lineage-repo.test.ts`, `apps/chat-api/tests/services/slack/slack-cascade-purge.test.ts`, `apps/chat-api/tests/services/slack/slack-derived-guards.test.ts`
- **KhÃ´ng xÃ¢m pháº¡m vÃ¹ng sá»Ÿ há»¯u cá»§a vai trÃ² khÃ¡c:**
  - AI Engineer (`packages/planner/`, `packages/tool-schemas/`, `prompts/`): Chá»‰ Ä‘á» xuáº¥t giao diá»‡n `IPlannerSlackLineageGuard`, khÃ´ng trá»±c tiáº¿p sá»­a mÃ£ planner.
  - Integration Engineer (`packages/tool-adapters/`): Chá»‰ tiÃªu thá»¥ frozen types tá»« `@wap/tool-schemas`.
  - Frontend Engineer (`apps/chat-web/`): KhÃ´ng sá»­a mÃ£ frontend; cung cáº¥p DTOs an toÃ n Ä‘Ã£ Ä‘Æ°á»£c che/redact sáº¡ch.

---

## 3. Báº£ng Ãnh Xáº¡ Äá»™ Bao Phá»§ 7 NhÃ³m Báº£n Sao PhÃ¡i Sinh (Coverage Table)

| Target Kind | Báº£ng & Cá»™t LÆ°u Trá»¯ Thá»±c Táº¿ | TÃ¡c Giáº£ Ghi (Writers) | TÃ¡c Giáº£ Äá»c (Readers) | Há»£p Äá»“ng Báº£n Sao PhÃ¡i Sinh | Bá»™ Xá»­ LÃ½ Purge (Purge Handler) | ThÃ nh Pháº§n TÆ°Æ¡ng Lai & Cá»•ng Fail-Closed |
|---|---|---|---|---|---|---|
| `chat_history_message` | `messages.content`, `messages.metadata` (JSONB) | `MessageRepo.createMessage`, `ChatService.prepareResponse` / `write` | `MessageRepo.listMessages`, `ChatService` (prompt history, SSE stream), `GET /api/conversations/:id/messages` | `targetKind: 'chat_history_message'`, `targetId: messages.id` (UUID), toÃ n bá»™ phÃ¢n Ä‘oáº¡n nguá»“n gá»‘c trong `slack_derived_provenance_segments` | `ChatHistoryMessagePurgeHandler`: XÃ³a/redact ná»™i dung tin nháº¯n thÃ nh `[Ná»™i dung nguá»“n Slack Ä‘Ã£ bá»‹ thu há»“i/xÃ³a]`, táº©y sáº¡ch snippet Slack trong metadata JSON; náº¿u tin trá»£ lÃ½ tá»•ng há»£p tá»« nguá»“n bá»‹ thu há»“i vÃ  khÃ´ng thá»ƒ tÃ¡ch rá»i, redact toÃ n bá»™ tin trá»£ lÃ½ Ä‘Ã³ nhÆ°ng giá»¯ cáº¥u trÃºc lÆ°á»£t há»™i thoáº¡i. | KhÃ´ng cÃ³ (ThÃ nh pháº§n hiá»‡n há»¯u trong `apps/chat-api`). |
| `working_memory_entity` | `messages` (`role = 'system'`, `metadata->>'type' = 'working_memory'`, `metadata->'state'` JSONB) | `ChatService.processMessage` (ghi dÃ²ng system snapshot bá»™ nhá»›) | `ChatService.processMessage` (Ä‘á»c `lastMemory` khÃ´i phá»¥c `memory.fromJSON`) | `targetKind: 'working_memory_entity'`, `targetId: messages.id`, `targetSubId: entityKey` | `WorkingMemoryEntityPurgeHandler`: Cáº­p nháº­t `metadata->'state'`, xÃ³a triá»‡t Ä‘á»ƒ thá»±c thá»ƒ bá»‹ thu há»“i (`delete state.__observed[slackKey]`) hoáº·c reset snapshot náº¿u bá»‹ Ã´ nhiá»…m chÃ©o; cháº·n model dÃ¹ng láº¡i dá»¯ kiá»‡n cÅ©. | KhÃ´ng cÃ³ (ThÃ nh pháº§n hiá»‡n há»¯u trong `apps/chat-api`). |
| `plan_step_arg` | `plans.plan_json` (`steps[].args`), `plans.plan_text`, `execution_steps.args_json`, `execution_steps.output_json`, `execution_steps.error_json`, `messages.metadata->'plan'` | `PlanRepo.createPlan`, `ChatService`, `StepRepo.createStep`, `StepRepo.updateStepStatus` | `PlanRepo.getPlan`, `PlanRepo.getPendingPlan`, `ExecutionService`, `ExecutorRunner`, `GET /api/conversations/:id/plan` | `targetKind: 'plan_step_arg'`, `targetId: plans.id` / `execution_steps.id`, `targetSubId: stepId` | `PlanStepArgPurgeHandler`: Náº¿u káº¿ hoáº¡ch Ä‘ang `pending`, chuyá»ƒn ngay sang `superseded`/`expired` (vÃ´ hiá»‡u hÃ³a phÃª duyá»‡t); náº¿u káº¿ hoáº¡ch Ä‘Ã£ thá»±c thi, scrub sáº¡ch args/output/error JSON vÃ  `plan_text` cáº£ á»Ÿ `plans`, `execution_steps` vÃ  message metadata. | KhÃ´ng cÃ³ (ThÃ nh pháº§n hiá»‡n há»¯u trong `apps/chat-api` & `packages/executor`). |
| `proposal_excerpt` | ChÆ°a cÃ³ báº£ng (Thuá»™c SLACK-06 Inbox Proposals, vÃ­ dá»¥ `slack_proposals.excerpt`) | ChÆ°a cÃ³ (Dá»‹ch vá»¥ Inbox tÆ°Æ¡ng lai á»Ÿ SLACK-06) | ChÆ°a cÃ³ (MÃ n duyá»‡t Ä‘á» xuáº¥t tÆ°Æ¡ng lai á»Ÿ SLACK-06) | `targetKind: 'proposal_excerpt'`, `targetId: proposal.id`, má»i phÃ¢n Ä‘oáº¡n provenance | `ProposalExcerptPurgeHandler`: ÄÃ¡nh dáº¥u Ä‘á» xuáº¥t `revoked_by_source_purge`, táº©y sáº¡ch trÃ­ch Ä‘oáº¡n khá»i payload Ä‘á» xuáº¥t. | **Cá»•ng Fail-Closed:** ThÃ nh pháº§n Inbox tÆ°Æ¡ng lai Báº®T BUá»˜C pháº£i Ä‘Äƒng kÃ½ vÃ o `SlackDerivedLineageStore` trÆ°á»›c khi persist. Náº¿u chÆ°a Ä‘Äƒng kÃ½, tá»« chá»‘i lÆ°u trá»¯ trÃ­ch Ä‘oáº¡n. NghiÃªm cáº¥m Ä‘Ã³ng F3 sá»›m khi chÆ°a hoÃ n thÃ nh component nÃ y. |
| `daily_digest_entry` | ChÆ°a cÃ³ báº£ng (Thuá»™c SLACK-06 Daily Digest, vÃ­ dá»¥ `slack_digests.entries`) | ChÆ°a cÃ³ (Worker sinh digest tÆ°Æ¡ng lai á»Ÿ SLACK-06) | ChÆ°a cÃ³ (API/UI xem digest tÆ°Æ¡ng lai á»Ÿ SLACK-06) | `targetKind: 'daily_digest_entry'`, `targetId: digest.id`, `targetSubId: entryId` | `DailyDigestEntryPurgeHandler`: Táº©y sáº¡ch má»¥c digest chá»©a trÃ­ch Ä‘oáº¡n hoáº·c Ä‘Ã¡nh dáº¥u toÃ n bá»™ entry lÃ  `purged`. | **Cá»•ng Fail-Closed:** Dá»‹ch vá»¥ Daily Digest tÆ°Æ¡ng lai Báº®T BUá»˜C Ä‘Äƒng kÃ½ pháº£ há»‡ trÆ°á»›c khi lÆ°u trá»¯ trÃ­ch Ä‘oáº¡n. Náº¿u chÆ°a Ä‘Äƒng kÃ½, tá»« chá»‘i lÆ°u trá»¯. |
| `scheduled_workflow_arg` | `schedules.request`, `schedules.recurrence`, `schedule_runs.plan_id`, `schedule_runs.error`, `messages.metadata->'proposal'` | `ScheduleService.createSchedule` / `saveFields`, `ScheduleRunner.createRun` | `ScheduleRunner.runDue`, `ScheduleRepo.ownedSchedule`, `ScheduleRepo.listForUser` | `targetKind: 'scheduled_workflow_arg'`, `targetId: schedules.id` / `schedule_runs.id` | `ScheduledWorkflowArgPurgeHandler`: Táº¡m dá»«ng lá»‹ch cháº¡y (`status = 'paused'`, `pause_reason = 'slack_source_invalidated'`), lÃ m sáº¡ch `schedules.request` (hoáº·c thay báº±ng mÃ´ táº£ khÃ´ng nháº¡y cáº£m), scrub `schedule_runs.error` vÃ  há»§y káº¿ hoáº¡ch phÃ¡i sinh liÃªn káº¿t. NgÄƒn cháº·n tÃ¡i sinh dá»¯ liá»‡u nguá»“n Ä‘Ã£ xÃ³a sau khi regrant. | KhÃ´ng cÃ³ (ThÃ nh pháº§n hiá»‡n há»¯u trong `apps/chat-api`). |
| `audit_log_entry` | Báº£n ghi audit ná»™i bá»™ DB / nháº­t kÃ½ thá»±c thi `execution_steps` / system audit | `AdminUserRepo`, `ExecutionService`, `SlackPurgeRunner` | Quáº£n trá»‹ viÃªn há»‡ thá»‘ng, audit query | `targetKind: 'audit_log_entry'`, `targetId: audit_id` | `AuditLogEntryPurgeHandler`: Báº±ng chá»©ng audit append-only tá»‘i thiá»ƒu khÃ´ng chá»©a ná»™i dung: táº©y sáº¡ch ná»™i dung/untrusted payload Slack khá»i báº£n ghi audit, chá»‰ lÆ°u biÃªn nháº­n tombstone (`purged_at`, `reason`, `tombstone_id`) vÃ  metadata khÃ´ng nháº¡y cáº£m. | KhÃ´ng cÃ³ (ThÃ nh pháº§n hiá»‡n há»¯u trong `apps/chat-api`). |

---

## 4. Thiáº¿t Káº¿ CÆ¡ Sá»Ÿ Dá»¯ Liá»‡u & Há»£p Äá»“ng Giao Diá»‡n Chuáº©n Táº¯c

### 4.1. Migration DDL: `db/v3/0018_slack_derived_lineage_and_purge.sql`
```sql
-- Migration 0018: Normalized Registry for Slack-Derived Lineage & Cascade Purge Tracking
CREATE TABLE IF NOT EXISTS slack_derived_copies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_kind TEXT NOT NULL CHECK (target_kind IN (
    'chat_history_message',
    'working_memory_entity',
    'plan_step_arg',
    'proposal_excerpt',
    'daily_digest_entry',
    'scheduled_workflow_arg',
    'audit_log_entry'
  )),
  target_id TEXT NOT NULL,
  target_sub_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'tombstoned', 'purged')),
  tombstoned_at TIMESTAMPTZ,
  purged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT uq_slack_derived_copies_target UNIQUE (target_kind, target_id, target_sub_id)
);

CREATE INDEX IF NOT EXISTS idx_slack_derived_copies_active
  ON slack_derived_copies(target_kind, target_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS slack_derived_provenance_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  derived_copy_id UUID NOT NULL REFERENCES slack_derived_copies(id) ON DELETE CASCADE,
  segment_index INT NOT NULL CHECK (segment_index >= 0),
  capture_id UUID NOT NULL,
  owner_source_key TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  ati_user_id UUID NOT NULL,
  connection_id UUID NOT NULL,
  workspace_id TEXT NOT NULL,
  slack_user_id TEXT NOT NULL,
  identity_version INT NOT NULL CHECK (identity_version > 0),
  provider_profile_id TEXT NOT NULL,
  config_fingerprint TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  consent_revision TEXT NOT NULL CHECK (consent_revision ~ '^[1-9][0-9]*$'),
  provider_revision TEXT NOT NULL CHECK (provider_revision ~ '^[1-9][0-9]*$'),
  policy_purpose TEXT NOT NULL DEFAULT 'storage' CHECK (policy_purpose = 'storage'),
  retention_days INT NOT NULL CHECK (retention_days > 0 AND retention_days <= 30),
  captured_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT uq_slack_derived_provenance_segment UNIQUE (derived_copy_id, segment_index),
  CONSTRAINT chk_slack_derived_provenance_ttl CHECK (expires_at > captured_at AND expires_at <= captured_at + INTERVAL '30 days')
);

CREATE INDEX IF NOT EXISTS idx_slack_derived_provenance_lookup
  ON slack_derived_provenance_segments(workspace_id, resource_type, resource_id, revision);
CREATE INDEX IF NOT EXISTS idx_slack_derived_provenance_binding
  ON slack_derived_provenance_segments(ati_user_id, connection_id, identity_version);
CREATE INDEX IF NOT EXISTS idx_slack_derived_provenance_epoch
  ON slack_derived_provenance_segments(provider_profile_id, policy_version, consent_revision, provider_revision);
CREATE INDEX IF NOT EXISTS idx_slack_derived_provenance_expires
  ON slack_derived_provenance_segments(expires_at);
```

### 4.2. Há»£p Äá»“ng ÄÄƒng KÃ½ Pháº£ Há»‡ Chuáº©n HÃ³a (`SlackDerivedLineageStore`)
```ts
export interface ProvenanceSegmentInput {
  captureId: string; // UUID capture váº­t lÃ½ trong slack_sources
  sourceRef: SlackSourceRef;
  acquisitionPolicyRef: SlackPolicyReference;
  storagePolicyRef: SlackPolicyReference; // purpose: 'storage', requestedRetentionDays <= 30
  capturedAt: string;
}

export interface RegisterDerivedCopyInput {
  targetKind: SlackDerivedTargetKind;
  targetId: string;
  targetSubId?: string;
  segments: ProvenanceSegmentInput[]; // Báº®T BUá»˜C Ä‘á»§ táº¥t cáº£ cÃ¡c segments cho multi-workspace artifact
}

export interface ISlackDerivedLineageStore {
  /**
   * ÄÄƒng kÃ½ pháº£ há»‡ nguyÃªn tá»­ cÃ¹ng client transaction vá»›i thao tÃ¡c ghi thá»±c táº¿.
   * Thá»±c hiá»‡n:
   * 1. KhÃ³a cÃ¡c hÃ ng tháº©m quyá»n FOR SHARE (connection -> provider -> consent).
   * 2. Kiá»ƒm tra khÃ´ng cÃ³ rÃ o cháº¯n pending/provisional nÃ o trong slack_invalidation_barriers.
   * 3. Ãp tráº§n TTL <= 30 ngÃ y vÃ  kiá»ƒm tra sameSlackPolicyEpoch giá»¯a acquisition vÃ  storage.
   * 4. Ghi nháº­n slack_derived_copies vÃ  toÃ n bá»™ slack_derived_provenance_segments.
   */
  registerDerivedCopyInTransaction(
    client: pg.PoolClient,
    input: RegisterDerivedCopyInput
  ): Promise<{ derivedCopyId: string }>;

  /**
   * Tháº©m Ä‘á»‹nh an toÃ n trÆ°á»›c khi Ä‘á»c/render/tráº£ DTO.
   * Kiá»ƒm tra Táº¤T Cáº¢ cÃ¡c phÃ¢n Ä‘oáº¡n á»§y quyá»n:
   * - Náº¿u Báº¤T Ká»² phÃ¢n Ä‘oáº¡n nÃ o cÃ³ barrier pending/failed/provisional -> cháº·n truy cáº­p.
   * - Náº¿u Báº¤T Ká»² phÃ¢n Ä‘oáº¡n nÃ o cÃ³ policy epoch bá»‹ thay Ä‘á»•i hoáº·c háº¿t háº¡n TTL -> cháº·n truy cáº­p.
   * Tráº£ vá» káº¿t quáº£ phÃ¢n Ä‘á»‹nh rÃµ rÃ ng: cho phÃ©p hoáº·c lÃ½ do bá»‹ cháº·n.
   */
  assertDerivedCopyAllowed(
    targetKind: SlackDerivedTargetKind,
    targetId: string,
    targetSubId?: string
  ): Promise<
    | { allowed: true }
    | { allowed: false; reason: 'blocked_by_barrier' | 'epoch_invalidated' | 'retention_expired' | 'not_found'; safeTombstoneOnly?: string }
  >;
}
```

### 4.3. Há»£p Äá»“ng Cascade Purge Runner (`SlackCascadePurgeRunner`)
```ts
export interface ISlackCascadePurgeHandler {
  readonly targetKind: SlackDerivedTargetKind;
  /** Thá»±c hiá»‡n táº©y sáº¡ch/redact báº£n sao thá»±c táº¿ trong DB dÆ°á»›i client transaction */
  purgeTarget(client: pg.PoolClient, targetId: string, targetSubId: string, reason: SlackTombstoneReason): Promise<void>;
}

export interface ISlackCascadePurgeRunner {
  /**
   * Xá»­ lÃ½ má»™t invalidation intent tá»« hÃ ng Ä‘á»£i slack_invalidation_intents.
   * Äiá»u phá»‘i:
   * 1. Gá»i 03B1 raw source purge cho slack_sources.
   * 2. TÃ¬m kiáº¿m táº¥t cáº£ derived copies khá»›p scope cá»§a SlackPurgeTarget qua provenance segments.
   * 3. Thá»±c thi purge handler tÆ°Æ¡ng á»©ng cho tá»«ng copy thá»±c táº¿.
   * 4. ÄÃ¡nh dáº¥u status = 'purged' trong slack_derived_copies.
   * Chá»‰ hoÃ n táº¥t intent khi Táº¤T Cáº¢ cÃ¡c copies Ä‘Ã£ Ä‘Æ°á»£c xá»­ lÃ½ sáº¡ch sáº½.
   */
  processInvalidationIntent(intentId: string): Promise<{ rawPurged: number; derivedPurged: number }>;
}
```

### 4.4. Giao Diá»‡n Báº£o Vá»‡ RiÃªng Biá»‡t Cho Planner & Executor (Ownership Separation)
```ts
// Äá» xuáº¥t cho AI Engineer (Planner Owner)
export interface IPlannerSlackLineageGuard {
  filterHydratedHistory(messages: ChatMessage[]): Promise<ChatMessage[]>;
  sanitizeWorkingMemory(state: Record<string, unknown>): Promise<Record<string, unknown>>;
}

// Äá» xuáº¥t cho Backend Engineer (Executor Owner)
export interface IExecutorSlackLineageGuard {
  assertPlanStepsExecutable(planId: string, steps: PlanStep[]): Promise<void>;
  sanitizeStepOutputForStorage(stepId: string, output: unknown): Promise<unknown>;
}
```

---

## 5. Giao Thá»©c KhÃ³a DÃ²ng & TÃ­nh NguyÃªn Tá»­ (Lock Ordering Hierarchy)

Äá»ƒ loáº¡i trá»« triá»‡t Ä‘á»ƒ nguy cÆ¡ deadlock giá»¯a cÃ¡c tÃ¡c vá»¥ ghi pháº£ há»‡, Ä‘á»c dá»¯ liá»‡u, duyá»‡t káº¿ hoáº¡ch vÃ  thu há»“i sá»± kiá»‡n, toÃ n bá»™ há»‡ thá»‘ng tuÃ¢n thá»§ nghiÃªm ngáº·t **thá»© tá»± khÃ³a dÃ²ng má»™t chiá»u**:

```
[1. conversations (FOR UPDATE)]
       â†“
[2. schedules (FOR UPDATE)]
       â†“
[3. plans (FOR UPDATE)]
       â†“
[4. slack_connections (FOR SHARE)]
       â†“
[5. slack_trusted_providers (FOR SHARE)]
       â†“
[6. slack_processing_consents (FOR SHARE)]
       â†“
[7. slack_invalidation_barriers (SELECT check / lock)]
       â†“
[8. slack_derived_copies & slack_derived_provenance_segments (INSERT/UPDATE)]
       â†“
[9. Target Artifact Writes (messages, execution_steps, etc.)]
```

- **Quy táº¯c báº£o vá»‡:** Tuyá»‡t Ä‘á»‘i khÃ´ng bao giá» Ä‘i ngÆ°á»£c chiá»u mÅ©i tÃªn. Khi má»™t tÃ¡c vá»¥ thu há»“i (vÃ­ dá»¥ `revokeConsent` cá»§a 02B) khÃ³a `slack_processing_consents` FOR UPDATE, tÃ¡c vá»¥ ghi pháº£ há»‡ Ä‘ang chá» khÃ³a FOR SHARE sáº½ Ä‘Æ°á»£c tuáº§n tá»± hÃ³a an toÃ n dÆ°á»›i PostgreSQL MVCC; khÃ´ng xáº£y ra hiá»‡n tÆ°á»£ng race condition lá»t báº£n ghi sau khi revoke.
- **Báº£o toÃ n hÃ nh vi non-Slack:** Khi ghi cÃ¡c tin nháº¯n hoáº·c káº¿ hoáº¡ch khÃ´ng chá»©a dá»¯ liá»‡u Slack, nhÃ¡nh logic bá» qua hoÃ n toÃ n cÃ¡c bÆ°á»›c 4-8, giá»¯ nguyÃªn 100% hiá»‡u nÄƒng vÃ  hÃ nh vi cá»§a mÃ£ nguá»“n hiá»‡n cÃ³.

---

## 6. Xá»­ LÃ½ PhÃ¢n Äoáº¡n Äa Workspace/User & ChÃ­nh SÃ¡ch Redaction

1. **PhÃ¢n Äoáº¡n Äa Workspace Báº¯t Buá»™c:**
   - Má»—i `SlackDerivedCopyRef` cá»§a 03A Ä‘áº¡i diá»‡n cho **Má»˜T** phÃ¢n Ä‘oáº¡n á»§y quyá»n (`binding`).
   - Má»™t artifact tá»•ng há»£p (vÃ­ dá»¥ báº£n tÃ³m táº¯t hoáº·c káº¿ hoáº¡ch Ä‘a kÃªnh/Ä‘a workspace) Báº®T BUá»˜C pháº£i lÆ°u trá»¯ **Táº¤T Cáº¢** cÃ¡c phÃ¢n Ä‘oáº¡n provenance trong `slack_derived_provenance_segments`.
   - NghiÃªm cáº¥m quy táº¯c "last source wins" hoáº·c "first workspace wins".
2. **ChÃ­nh SÃ¡ch XÃ³a PhÃ¢n Äoáº¡n vs ToÃ n Bá»™ Artifact:**
   - Náº¿u dá»¯ liá»‡u Slack cÃ³ thá»ƒ tÃ¡ch rá»i (vÃ­ dá»¥ metadata JSON hoáº·c arg cá»¥ thá»ƒ), xÃ³a/redact trÆ°á»ng cá»¥ thá»ƒ Ä‘Ã³.
   - Náº¿u ná»™i dung sinh bá»Ÿi model lÃ  há»—n há»£p (mixed text) khÃ´ng thá»ƒ bÃ³c tÃ¡ch an toÃ n giá»¯a cÃ¡c nguá»“n: **Redact toÃ n bá»™ pháº§n vÄƒn báº£n do model sinh**, thay báº±ng thÃ´ng bÃ¡o vÃ´ hiá»‡u hÃ³a, Ä‘á»“ng thá»i báº£o toÃ n nguyÃªn váº¹n tin nháº¯n gá»‘c do ngÆ°á»i dÃ¹ng viáº¿t. Tuyá»‡t Ä‘á»‘i khÃ´ng há»©a háº¹n thuáº­t toÃ¡n string regex redaction tÃ¹y Ã½ cÃ³ nguy cÆ¡ sÃ³t lá»t dá»¯ liá»‡u.
3. **BiÃªn Nháº­n Audit Báº¥t Biáº¿n Tá»‘i Thiá»ƒu:**
   - Khi purge `audit_log_entry`, lÆ°u giá»¯ biÃªn nháº­n gá»“m `(purged_at, reason, target_kind, target_id, tombstone_id)` Ä‘á»ƒ phá»¥c vá»¥ kiá»ƒm toÃ¡n vÃ  Ä‘iá»u tra sá»± cá»‘; xÃ³a bá» hoÃ n toÃ n chuá»—i vÄƒn báº£n hoáº·c JSON payload cá»§a Slack. KhÃ´ng bao giá» phá»¥c há»“i láº¡i dá»¯ liá»‡u Slack Ä‘Ã£ xÃ³a khi ngÆ°á»i dÃ¹ng káº¿t ná»‘i láº¡i (regrant).

---

## 7. TiÃªu ChÃ­ Nghiá»‡m Thu Cá»¥ Thá»ƒ (Acceptance Criteria)

- [ ] **AC1 (Durable Normalized Registry):** Báº£ng `slack_derived_copies` vÃ  `slack_derived_provenance_segments` Ä‘Æ°á»£c táº¡o thÃ nh cÃ´ng qua migration `0018`, lÆ°u trá»¯ Ä‘áº§y Ä‘á»§ má»i phÃ¢n Ä‘oáº¡n á»§y quyá»n Ä‘a workspace vá»›i tráº§n TTL `<= 30 ngÃ y`.
- [ ] **AC2 (Atomic Lineage & Artifact Write):** Má»i thao tÃ¡c ghi báº£n sao phÃ¡i sinh cá»§a Slack Ä‘Æ°á»£c thá»±c thi trong cÃ¹ng 1 giao dá»‹ch PostgreSQL vá»›i hÃ ng tháº©m quyá»n Ä‘Æ°á»£c khÃ³a FOR SHARE theo Ä‘Ãºng thá»© tá»± chá»‘ng deadlock.
- [ ] **AC3 (Pre-Read Provenance & Barrier Guard):** TrÆ°á»›c khi tráº£ DTO qua HTTP, SSE stream, hoáº·c náº¡p vÃ o context cá»§a model/planner, hÃ m `assertDerivedCopyAllowed` kiá»ƒm tra Táº¤T Cáº¢ cÃ¡c phÃ¢n Ä‘oáº¡n; tá»« chá»‘i ngay láº­p tá»©c náº¿u cÃ³ barrier pending/failed hoáº·c policy epoch bá»‹ thay Ä‘á»•i.
- [ ] **AC4 (Full 7 Kinds Cascade Purge Coverage):** Bá»™ cháº¡y cascade purge cÃ³ Ä‘áº§y Ä‘á»§ handler cho Ä‘Ãºng 7 kinds: `chat_history_message`, `working_memory_entity`, `plan_step_arg`, `proposal_excerpt`, `daily_digest_entry`, `scheduled_workflow_arg`, `audit_log_entry`.
- [ ] **AC5 (Fail-Closed Gates for Future Components):** CÃ¡c thá»±c thá»ƒ `proposal_excerpt` vÃ  `daily_digest_entry` cá»§a SLACK-06 Ä‘Æ°á»£c thiáº¿t láº­p rÃ o cháº¯n fail-closed rÃµ rÃ ng; khÃ´ng cho phÃ©p lÆ°u trá»¯ trÃ­ch Ä‘oáº¡n náº¿u chÆ°a tÃ­ch há»£p handler hoÃ n chá»‰nh.
- [ ] **AC6 (Crash Mid-Handler Resilience & Idempotency):** Náº¿u tiáº¿n trÃ¬nh purge bá»‹ crash khi Ä‘ang xá»­ lÃ½ giá»¯a chá»«ng (vÃ­ dá»¥ xong 3/7 handlers), khi khá»Ÿi Ä‘á»™ng láº¡i pháº£i tiáº¿p tá»¥c xá»­ lÃ½ cÃ¡c handlers cÃ²n láº¡i báº±ng cÆ¡ cháº¿ lease/idempotency mÃ  khÃ´ng gÃ¢y trÃ¹ng láº·p hay lá»—i.
- [ ] **AC7 (Policy Event Fanout with Derived-Only Epochs):** QuÃ©t sá»± kiá»‡n chÃ­nh sÃ¡ch (revocation/epoch change) thu tháº­p Ä‘áº§y Ä‘á»§ cÃ¡c epoch tá»« `slack_derived_provenance_segments` ngay cáº£ khi dá»¯ liá»‡u nguá»“n thÃ´ trong `slack_sources` Ä‘Ã£ bá»‹ xÃ³a trÆ°á»›c Ä‘Ã³.
- [ ] **AC8 (No Scope Creep & Clean Boundaries):** Chá»‰ bá»• sung 3 tÃ i liá»‡u tÃ i liá»‡u hoáº¡ch Ä‘á»‹nh; khÃ´ng sá»­a Ä‘á»•i mÃ£ nguá»“n sáº£n pháº©m, khÃ´ng sá»­a `CURRENT-STATE.md` hay `ROADMAP.md`.

---

## 8. Lá»‡nh Kiá»ƒm Tra & Cá»•ng Báº±ng Chá»©ng (Command & Evidence Gates)

> ToÃ n bá»™ cÃ¡c lá»‡nh dÆ°á»›i Ä‘Ã¢y lÃ  kiá»ƒm tra dá»± kiáº¿n cho giai Ä‘oáº¡n thi cÃ´ng mÃ£ nguá»“n, sá»­ dá»¥ng PostgreSQL 16 tháº­t. Trong phiÃªn láº­p káº¿ hoáº¡ch nÃ y, toÃ n bá»™ Ä‘Æ°á»£c Ä‘Ã¡nh dáº¥u `[Proposed: NOT_RUN]`.

```powershell
# 1. [Proposed: NOT_RUN] Kiá»ƒm tra Migration DDL 0018 trÃªn PG16 tháº­t
# npm run migrate:v3

# 2. [Proposed: NOT_RUN] Kiá»ƒm tra Repository & Atomic Lock Order Concurrency (2 PG clients)
# npm test -w @wap/chat-api -- tests/db/slack-derived-lineage-repo.test.ts

# 3. [Proposed: NOT_RUN] Kiá»ƒm tra Cascade Purge Runner cho cáº£ 7 Target Kinds & Crash Recovery
# npm test -w @wap/chat-api -- tests/services/slack/slack-cascade-purge.test.ts

# 4. [Proposed: NOT_RUN] Kiá»ƒm tra RÃ o Cháº¯n Pre-Read, SSE & Memory Sanitize
# npm test -w @wap/chat-api -- tests/services/slack/slack-derived-guards.test.ts

# 5. [Proposed: NOT_RUN] Kiá»ƒm tra ToÃ n Diá»‡n Typecheck ToÃ n Repo
# npm run typecheck:v3

# 6. Kiá»ƒm tra Quy chuáº©n Khoáº£ng Tráº¯ng vÃ  Git Diff (DOCS ONLY)
git diff --check e9088d5e..HEAD
```

---

## 9. Káº¿t Quáº£ Thá»±c Thi (DÃ nh Cho Agent Thi CÃ´ng)

*(Pháº§n nÃ y Ä‘Æ°á»£c Ä‘á»ƒ trá»‘ng cho agent thi cÃ´ng ghi láº¡i káº¿t quáº£ REDâ†’GREEN, commit hashes vÃ  log kiá»ƒm thá»­ thá»±c táº¿ sau khi Ä‘Æ°á»£c phÃ¢n cÃ´ng thá»±c hiá»‡n mÃ£ nguá»“n).*

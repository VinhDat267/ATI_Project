# Slack Personal Assistant â€” SLACK-03B2: Derived-Source Lineage & Cascade Purge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Triá»ƒn khai sá»• bá»™ chuáº©n hÃ³a pháº£ há»‡ báº£n sao phÃ¡i sinh Slack (`slack_derived_copies` & `slack_derived_provenance_segments`), cá»•ng ghi nguyÃªn tá»­ trong cÃ¹ng 1 giao dá»‹ch PostgreSQL vá»›i tráº­t tá»± khÃ³a dÃ²ng chá»‘ng deadlock, rÃ o cháº¯n kiá»ƒm tra toÃ n diá»‡n trÆ°á»›c khi Ä‘á»c/render/SSE/model-use, vÃ  bá»™ cháº¡y cascade purge (`SlackCascadePurgeRunner`) cho Ä‘Ãºng 7 nhÃ³m báº£n sao phÃ¡i sinh chuáº©n táº¯c theo tiÃªu chuáº©n nghiá»‡m thu F3.

**Architecture:** Deep Modules táº¡i `apps/chat-api` vÃ  `db/v3`. Báº£o toÃ n má»i phÃ¢n Ä‘oáº¡n á»§y quyá»n Ä‘a workspace (`SlackDerivedCopyRef` segment), tráº§n TTL trÃ­ch Ä‘oáº¡n `<= 30 ngÃ y`. Tráº­t tá»± khÃ³a má»™t chiá»u: `conversations` -> `schedules` -> `plans` -> `connections` -> `providers` -> `consents` -> `barriers` -> `lineage` -> `target writes`. Cá»•ng fail-closed cho cÃ¡c thá»±c thá»ƒ Inbox/Digest tÆ°Æ¡ng lai cá»§a SLACK-06.

**Tech Stack:** Node.js 22+, TypeScript 5.6+, Express 5, PostgreSQL 16 (`pg` pool), Vitest.
**Dependencies:** SLACK-01 (Foundation), SLACK-02 (OAuth/Consents), SLACK-03A (Schema contracts, PR #194 `bc8d6b69`), SLACK-03B1 (Raw store/intents queue - frozen interfaces).
**Task Card:** [`docs/handoff/tasks/SLACK-03B2-derived-lineage-and-purge.md`](../../handoff/tasks/SLACK-03B2-derived-lineage-and-purge.md).

---

## 1. Bounded Scope & Core Invariants

1. **Ranh Giá»›i Bounded Scope 03B2:**
   - 03B1 chá»‰ quáº£n lÃ½ nguá»“n thÃ´ `slack_sources` (tráº§n `<= 7 ngÃ y`), rÃ o cháº¯n `slack_invalidation_barriers` vÃ  hÃ ng Ä‘á»£i Ã½ Ä‘á»‹nh `slack_invalidation_intents`. HoÃ n thÃ nh 03B1 KHÃ”NG Ä‘Ã³ng F3.
   - 03B2 quáº£n lÃ½ báº£n sao phÃ¡i sinh (`SLACK_DERIVED_TARGET_KINDS`), trÃ­ch Ä‘oáº¡n tráº§n `<= 30 ngÃ y`, vÃ  Ä‘iá»u phá»‘i cascade purge thá»±c sá»± xÃ³a sáº¡ch ná»™i dung/trÃ­ch Ä‘oáº¡n khá»i database vÃ  in-memory.
   - 03B3 quáº£n lÃ½ binding executor vÃ  hash validation trong `packages/executor`.
   - Cá»•ng fail-closed: `proposal_excerpt` vÃ  `daily_digest_entry` thuá»™c SLACK-06 chÆ°a cÃ³ báº£ng/service; cáº¥m táº¡o stub rá»—ng giáº£ vá» Ä‘Ã³ng F3; báº¯t buá»™c fail-closed tá»« chá»‘i persist trÃ­ch Ä‘oáº¡n náº¿u chÆ°a Ä‘Äƒng kÃ½ lineage.
2. **Normalized Multi-Segment Registry:**
   - Má»—i `SlackDerivedCopyRef` Ä‘áº¡i diá»‡n cho 1 phÃ¢n Ä‘oáº¡n á»§y quyá»n. Artifact Ä‘a workspace báº¯t buá»™c lÆ°u trá»¯ Táº¤T Cáº¢ cÃ¡c phÃ¢n Ä‘oáº¡n trong `slack_derived_provenance_segments`. Cáº¥m "first workspace wins" hoáº·c "last source wins".
   - PhÃ¢n biá»‡t UUID capture váº­t lÃ½ (`capture_id` tá»« `slack_sources`) vá»›i khÃ³a tÃ i nguyÃªn logic `owner_source_key`.
   - Quyá»n Ä‘á»c transient (`retentionDays: 0`) KHÃ”NG cho phÃ©p lÆ°u trá»¯ text phÃ¡i sinh; lÆ°u trá»¯ Ä‘Ã²i há»i storage policy riÃªng, cÃ¹ng epoch thu tháº­p, excerpt ceiling `<= 30 ngÃ y`.
3. **Ghi NguyÃªn Tá»­ & Tráº­t Tá»± KhÃ³a DÃ²ng Chá»‘ng Deadlock:**
   - ÄÄƒng kÃ½ pháº£ há»‡ vÃ  ghi artifact Ä‘Ã­ch thá»±c táº¿ Báº®T BUá»˜C náº±m trong 1 client transaction PostgreSQL.
   - Tráº­t tá»± khÃ³a: `conversations` (FOR UPDATE) -> `schedules` (FOR UPDATE) -> `plans` (FOR UPDATE) -> `slack_connections` (FOR SHARE) -> `slack_trusted_providers` (FOR SHARE) -> `slack_processing_consents` (FOR SHARE) -> kiá»ƒm tra barrier -> ghi lineage -> ghi artifact.
   - Non-Slack writers giá»¯ nguyÃªn 100% hÃ nh vi; caller/model khÃ´ng thá»ƒ giáº£ máº¡o cá» kiá»ƒm chá»©ng.
4. **Pre-Read Guards & In-Memory Transport:**
   - TrÆ°á»›c khi tráº£ DTO qua HTTP, SSE stream, náº¡p vÃ o planner context, hoáº·c cháº¡y scheduled dispatch: kiá»ƒm tra Táº¤T Cáº¢ cÃ¡c phÃ¢n Ä‘oáº¡n trong provenance segments. Náº¿u cÃ³ rÃ o cháº¯n pending/failed/provisional hoáº·c epoch thay Ä‘á»•i hoáº·c háº¿t TTL -> CHáº¶N Äá»¨NG.
   - Táº©y sáº¡ch in-memory copies/cache trÆ°á»›c transport; model generation há»—n há»£p khÃ´ng thá»ƒ bÃ³c tÃ¡ch an toÃ n thÃ¬ redact toÃ n bá»™ cÃ¢u sinh cá»§a model, báº£o toÃ n tin nháº¯n ngÆ°á»i dÃ¹ng.
5. **Cascade Purge & ChÃ­nh SÃ¡ch Sá»± Kiá»‡n Fanout:**
   - Bá»™ quÃ©t fanout sá»± kiá»‡n chÃ­nh sÃ¡ch (revocation/epoch invalidation) Báº®T BUá»˜C quÃ©t cáº£ `slack_derived_provenance_segments`, khÃ´ng chá»‰ `slack_sources`. KhÃ´ng cÃ³ báº£n ghi thÃ´ khÃ´ng cÃ³ nghÄ©a lÃ  khÃ´ng cÃ³ derived copy cáº§n purge.
   - Intent chá»‰ hoÃ n táº¥t khi cáº£ nguá»“n thÃ´ vÃ  TOÃ€N Bá»˜ 7 nhÃ³m derived copies Ä‘Ã£ Ä‘Æ°á»£c xÃ³a sáº¡ch. Idempotent retry, hÃ ng Ä‘á»£i `SKIP LOCKED`, crash mid-handler (vÃ­ dá»¥ crash sau 3/7 handlers) restart xá»­ lÃ½ tiáº¿p khÃ´ng trÃ¹ng láº·p.
   - Audit proof append-only tá»‘i thiá»ƒu khÃ´ng chá»©a payload raw/untrusted text; khÃ´ng phá»¥c há»“i dá»¯ liá»‡u Ä‘Ã£ xÃ³a sau regrant.

---

## 2. Coverage Mapping Table (7 Target Kinds)

| Target Kind | Báº£ng & Cá»™t LÆ°u Trá»¯ Thá»±c Táº¿ | Writers | Readers | Purge Handler | Component TÆ°Æ¡ng Lai & Gate |
|---|---|---|---|---|---|
| `chat_history_message` | `messages.content`, `messages.metadata` | `MessageRepo.createMessage`, `ChatService` | `MessageRepo.listMessages`, `ChatService` (prompt history, SSE) | `ChatHistoryMessagePurgeHandler`: Redact content thÃ nh tombstone, scrub Slack metadata JSON, redact mixed model generation. | Hiá»‡n há»¯u trong `chat-api`. |
| `working_memory_entity` | `messages` (`role='system'`, `metadata->>'type'='working_memory'`) | `ChatService.processMessage` | `ChatService` (`memory.fromJSON`) | `WorkingMemoryEntityPurgeHandler`: XÃ³a observed entity khá»i state JSON (`delete state.__observed[k]`), ngÄƒn model tÃ¡i dÃ¹ng dá»¯ kiá»‡n. | Hiá»‡n há»¯u trong `chat-api`. |
| `plan_step_arg` | `plans.plan_json`, `plan_text`, `execution_steps.args_json`, `output_json`, `error_json` | `PlanRepo.createPlan`, `StepRepo.createStep`, `ChatService` | `PlanRepo.getPlan`, `ExecutionService`, `ExecutorRunner` | `PlanStepArgPurgeHandler`: Chuyá»ƒn pending plan sang `superseded`/`expired`; scrub args/output/error JSON vÃ  plan_text. | Hiá»‡n há»¯u trong `chat-api` & `executor`. |
| `proposal_excerpt` | ChÆ°a cÃ³ báº£ng (Inbox Proposals SLACK-06) | Dá»‹ch vá»¥ Inbox tÆ°Æ¡ng lai | UI duyá»‡t Ä‘á» xuáº¥t tÆ°Æ¡ng lai | `ProposalExcerptPurgeHandler`: ÄÃ¡nh dáº¥u `revoked_by_source_purge`, scrub excerpts. | **Fail-Closed:** Báº¯t buá»™c Ä‘Äƒng kÃ½ lineage trÆ°á»›c khi persist. |
| `daily_digest_entry` | ChÆ°a cÃ³ báº£ng (Daily Digest SLACK-06) | Digest worker tÆ°Æ¡ng lai | API/UI xem digest tÆ°Æ¡ng lai | `DailyDigestEntryPurgeHandler`: Scrub excerpt khá»i digest entry hoáº·c Ä‘Ã¡nh dáº¥u purged. | **Fail-Closed:** Báº¯t buá»™c Ä‘Äƒng kÃ½ lineage trÆ°á»›c khi persist. |
| `scheduled_workflow_arg` | `schedules.request`, `recurrence`, `schedule_runs.plan_id`, `error` | `ScheduleService.createSchedule` / `saveFields`, `ScheduleRunner` | `ScheduleRunner.runDue`, `ScheduleRepo.ownedSchedule` | `ScheduledWorkflowArgPurgeHandler`: Táº¡m dá»«ng schedule (`pause_reason='slack_source_invalidated'`), scrub request/error, há»§y plan phÃ¡i sinh. | Hiá»‡n há»¯u trong `chat-api`. |
| `audit_log_entry` | In-database audit tables / `execution_steps` / system logs | `AdminUserRepo`, `ExecutionService`, `SlackPurgeRunner` | Admin audit queries | `AuditLogEntryPurgeHandler`: Append-only proof tá»‘i thiá»ƒu: scrub Slack payload, chá»‰ giá»¯ tombstone receipt (`purged_at`, `reason`, `tombstone_id`). | Hiá»‡n há»¯u trong `chat-api`. |

---

## 3. Database DDL: `db/v3/0018_slack_derived_lineage_and_purge.sql`

```sql
CREATE TABLE IF NOT EXISTS slack_derived_copies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_kind TEXT NOT NULL CHECK (target_kind IN (
    'chat_history_message', 'working_memory_entity', 'plan_step_arg',
    'proposal_excerpt', 'daily_digest_entry', 'scheduled_workflow_arg', 'audit_log_entry'
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
CREATE INDEX IF NOT EXISTS idx_slack_derived_copies_active ON slack_derived_copies(target_kind, target_id) WHERE status = 'active';

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
CREATE INDEX IF NOT EXISTS idx_slack_derived_provenance_lookup ON slack_derived_provenance_segments(workspace_id, resource_type, resource_id, revision);
CREATE INDEX IF NOT EXISTS idx_slack_derived_provenance_binding ON slack_derived_provenance_segments(ati_user_id, connection_id, identity_version);
CREATE INDEX IF NOT EXISTS idx_slack_derived_provenance_epoch ON slack_derived_provenance_segments(provider_profile_id, policy_version, consent_revision, provider_revision);
CREATE INDEX IF NOT EXISTS idx_slack_derived_provenance_expires ON slack_derived_provenance_segments(expires_at);
```

---

## 4. Architecture Interfaces & Lock Order Hierarchy

```ts
export interface ProvenanceSegmentInput {
  captureId: string;
  sourceRef: SlackSourceRef;
  acquisitionPolicyRef: SlackPolicyReference;
  storagePolicyRef: SlackPolicyReference;
  capturedAt: string;
}

export interface RegisterDerivedCopyInput {
  targetKind: SlackDerivedTargetKind;
  targetId: string;
  targetSubId?: string;
  segments: ProvenanceSegmentInput[];
}

export interface ISlackDerivedLineageStore {
  registerDerivedCopyInTransaction(client: pg.PoolClient, input: RegisterDerivedCopyInput): Promise<{ derivedCopyId: string }>;
  assertDerivedCopyAllowed(targetKind: SlackDerivedTargetKind, targetId: string, targetSubId?: string): Promise<
    { allowed: true } | { allowed: false; reason: 'blocked_by_barrier' | 'epoch_invalidated' | 'retention_expired' | 'not_found'; safeTombstoneOnly?: string }
  >;
}

export interface ISlackCascadePurgeHandler {
  readonly targetKind: SlackDerivedTargetKind;
  purgeTarget(client: pg.PoolClient, targetId: string, targetSubId: string, reason: SlackTombstoneReason): Promise<void>;
}

export interface ISlackCascadePurgeRunner {
  processInvalidationIntent(intentId: string): Promise<{ rawPurged: number; derivedPurged: number }>;
}

export interface IPlannerSlackLineageGuard {
  filterHydratedHistory(messages: ChatMessage[]): Promise<ChatMessage[]>;
  sanitizeWorkingMemory(state: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface IExecutorSlackLineageGuard {
  assertPlanStepsExecutable(planId: string, steps: PlanStep[]): Promise<void>;
  sanitizeStepOutputForStorage(stepId: string, output: unknown): Promise<unknown>;
}
```

---

## 5. Execution Tasks & Real Test Matrix (Proposed NOT_RUN)

### Phase 1: Database Migration
- [ ] **Task 1.1:** Táº¡o file migration `db/v3/0018_slack_derived_lineage_and_purge.sql` theo Ä‘Ãºng DDL má»¥c 3.
- [ ] **Task 1.2:** [Proposed: NOT_RUN] Cháº¡y `npm run migrate:v3` xÃ¡c minh schema PostgreSQL 16.

### Phase 2: Repository & Concurrency Lock Layer
- [ ] **Task 2.1:** [Proposed: NOT_RUN] Viáº¿t test `apps/chat-api/tests/db/slack-derived-lineage-repo.test.ts`:
  - 2 client PostgreSQL tháº­t: Client 1 ghi `registerDerivedCopyInTransaction` (khÃ³a FOR SHARE connection -> provider -> consent); Client 2 gá»i `revokeConsent` (FOR UPDATE consent); xÃ¡c minh khÃ´ng deadlock vÃ  khÃ´ng lá»t dá»¯ liá»‡u.
  - Multi-workspace artifact lÆ°u trá»¯ Ä‘á»§ má»i phÃ¢n Ä‘oáº¡n; tá»« chá»‘i náº¿u thiáº¿u phÃ¢n Ä‘oáº¡n hoáº·c sai epoch.
  - NULL constraints, cascade deletion foreign keys, vÃ  kiá»ƒm tra tráº§n TTL `<= 30 ngÃ y`.
- [ ] **Task 2.2:** Triá»ƒn khai `SlackDerivedLineageRepo` Ä‘áº¡t toÃ n bá»™ test (GREEN).

### Phase 3: Service Layer, Pre-Read & Transport Guards
- [ ] **Task 3.1:** [Proposed: NOT_RUN] Viáº¿t test `apps/chat-api/tests/services/slack/slack-derived-guards.test.ts`:
  - `assertDerivedCopyAllowed` cháº·n Ä‘á»c khi cÃ³ barrier pending/failed/provisional trong `slack_invalidation_barriers`.
  - SSE stream vÃ  in-memory hydration bá»‹ cháº·n phÃ¡t tÃ¡n dá»¯ liá»‡u ngay khi barrier Ä‘Æ°á»£c kÃ­ch hoáº¡t.
  - Delayed old observation bá»‹ tá»« chá»‘i khi gáº¯n vá»›i fresh grant (`sameSlackPolicyEpoch` mismatch).
  - PhÃ¢n Ä‘á»‹nh rÃµ rÃ ng: model text há»—n há»£p bá»‹ redact toÃ n bá»™ cÃ¢u sinh, giá»¯ láº¡i tin nháº¯n ngÆ°á»i dÃ¹ng.
- [ ] **Task 3.2:** Triá»ƒn khai `SlackDerivedLineageStore` vÃ  cÃ¡c guards (GREEN).

### Phase 4: Cascade Purge Runner cho cáº£ 7 Target Kinds
- [ ] **Task 4.1:** [Proposed: NOT_RUN] Viáº¿t test `apps/chat-api/tests/services/slack/slack-cascade-purge.test.ts`:
  - CÃ i Ä‘áº·t sentinels Slack phÃ¢n biá»‡t trong tá»«ng target field: `messages.content`, `messages.metadata`, `working_memory` state, `plans.plan_json`, `execution_steps.args_json`/`output_json`, `schedules.request`, `audit_log_entry`.
  - Thá»±c thi purge: queries xÃ¡c nháº­n sentinels Slack bá»‹ xÃ³a/redact sáº¡ch sáº½; sentinels khÃ´ng liÃªn quan cá»§a user khÃ¡c/workspace khÃ¡c giá»¯ nguyÃªn.
  - Crash mid-handler: mÃ´ phá»ng crash sau 3/7 handlers; restart hoÃ n táº¥t 4 handlers cÃ²n láº¡i khÃ´ng trÃ¹ng láº·p.
  - Fail-closed cho `proposal_excerpt` vÃ  `daily_digest_entry`: tá»« chá»‘i lÆ°u trá»¯ náº¿u chÆ°a cÃ³ registration.
  - Policy fanout: quÃ©t vÃ  xá»­ lÃ½ thÃ nh cÃ´ng intent cho cÃ¡c epoch chá»‰ tá»“n táº¡i á»Ÿ derived copies khi raw sources Ä‘Ã£ trá»‘ng.
- [ ] **Task 4.2:** Triá»ƒn khai 7 purge handlers vÃ  `SlackCascadePurgeRunner` (GREEN).

### Phase 5: Verification & Review Gates
- [ ] **Task 5.1:** Kiá»ƒm tra toÃ n bá»™ markdown links, path claims, vÃ  giá»›i háº¡n dÃ²ng `<= 350 lines`.
- [ ] **Task 5.2:** Cháº¡y kiá»ƒm tra quy chuáº©n git diff: `git diff --check e9088d5e..HEAD`.
- [ ] **Task 5.3:** XÃ¡c nháº­n chá»‰ commit Ä‘Ãºng 3 files tÃ i liá»‡u, khÃ´ng Ä‘á»¥ng mÃ£ nguá»“n hoáº·c `CURRENT-STATE.md`.

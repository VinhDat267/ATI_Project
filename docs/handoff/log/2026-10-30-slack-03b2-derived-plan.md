# 30/10/2026 Â· SLACK-03B2 â€” Láº­p Káº¿ Hoáº¡ch Pháº£ Há»‡ Nguá»“n Báº£n Sao PhÃ¡i Sinh & Cascade Purge Bá»n Vá»¯ng (PR Draft)

**TÃ¡c giáº£:** Backend Planning Owner (Antigravity gemini-3.8-flash-high).
**á»¦y quyá»n Ä‘iá»u phá»‘i:** Äiá»u phá»‘i viÃªn trÆ°á»Ÿng (Coordinator `term_c4dfa448-7670-4256-8dac-d0a1c9157a1d`) phÃ¢n cÃ´ng thá»±c thi Task `task_7f3de3be3eab`, Dispatch `ctx_411b66f7cced`.
**NhÃ¡nh cÃ´ng viá»‡c:** `docs/slack-03b2-derived-plan` (tÃ¡ch tá»« integration commit `e9088d5e76e95fa65e3be019226835371e40908d` trÃªn `integration/slack-personal-20261029`).
**TÃ i liá»‡u sá»Ÿ há»¯u duy nháº¥t:**
1. Task card: [`docs/handoff/tasks/SLACK-03B2-derived-lineage-and-purge.md`](../tasks/SLACK-03B2-derived-lineage-and-purge.md)
2. Implementation plan: [`docs/superpowers/plans/2026-10-30-slack-03b2-derived-lineage-and-purge.md`](../../superpowers/plans/2026-10-30-slack-03b2-derived-lineage-and-purge.md)
3. Handoff log: [`docs/handoff/log/2026-10-30-slack-03b2-derived-plan.md`](2026-10-30-slack-03b2-derived-plan.md)

**Phá»¥ thuá»™c & Há»£p Ä‘á»“ng CÆ¡ sá»Ÿ:**
- **Integration Head (`e9088d5e`):** ÄÃ£ tÃ­ch há»£p vÃ  cháº¥p thuáº­n há»£p Ä‘á»“ng SLACK-01, 02 vÃ  schema 03A `bc8d6b69` (Ä‘áº§y Ä‘á»§ `SlackBinding`, `SlackSourceRef`, `SlackPolicyEpoch`, `SlackSourceLineage`, `SlackDerivedCopyRef`, vÃ  `SlackPurgeTarget` vá»›i 6 scopes bao gá»“m `policy_epoch_invalidated`).
- **Giao Æ°á»›c 03B1 (Kho nguá»“n thÃ´ & HÃ ng Ä‘á»£i vÃ´ hiá»‡u hÃ³a):** Äá»“ng bá»™ cháº·t cháº½ vá»›i sibling owner `ctx_29765fc6b1b7` trÃªn nhÃ¡nh `feat/slack-03b1-source-store`. Táº­n dá»¥ng cáº¥u trÃºc giao dá»‹ch `stageInTransaction(client, { sourceEventKey, effects: [{ effectKey, barrier, purgeTarget? }] })` vÃ  hÃ ng Ä‘á»£i `slack_invalidation_intents`.
- **Giao Æ°á»›c 03C1 (Adapter Ä‘á»c):** Äá»“ng bá»™ vá»›i sibling owner `ctx_89198a2a3d9d` trÃªn `feat/slack-03c1-read-adapters`. Kháº³ng Ä‘á»‹nh rÃµ: quyá»n Ä‘á»c transient (`retentionDays: 0`) khÃ´ng tá»± Ä‘á»™ng cáº¥p quyá»n lÆ°u trá»¯ text phÃ¡i sinh; viá»‡c lÆ°u trá»¯ Ä‘Ã²i há»i storage policy riÃªng biá»‡t dÆ°á»›i cÃ¹ng epoch thu tháº­p.
- **Ranh giá»›i Thá»±c thi:** PhiÃªn nÃ y thuáº§n tÃºy tÃ i liá»‡u káº¿ hoáº¡ch (DOCS-ONLY); giá»¯ nguyÃªn toÃ n bá»™ mÃ£ nguá»“n sáº£n pháº©m vÃ  tÃ i liá»‡u cá»§a cÃ¡c agent khÃ¡c; khÃ´ng thi cÃ´ng mÃ£ runtime má»›i, khÃ´ng gá»i native Slack API, khÃ´ng gá»i model AI trÃªn ná»™i dung Slack, khÃ´ng sá»­a `CURRENT-STATE.md` hay `ROADMAP.md`.

---

## 1. Trá»ng TÃ¢m Kiáº¿n TrÃºc SLACK-03B2 (F3 Cascade Purge & Lineage)

Káº¿ hoáº¡ch SLACK-03B2 hoÃ n thiá»‡n máº¯t xÃ­ch trá»ng yáº¿u cá»§a tiÃªu chuáº©n nghiá»‡m thu F3 (Cascade Purge):

### 1.1. Sá»• Bá»™ Chuáº©n HÃ³a Äa PhÃ¢n Äoáº¡n (Multi-Segment Normalized Registry):
- Kháº¯c phá»¥c giá»›i háº¡n cá»§a `SlackDerivedCopyRef` hiá»‡n táº¡i (vá»‘n chá»‰ Ä‘áº¡i diá»‡n cho 1 phÃ¢n Ä‘oáº¡n á»§y quyá»n Ä‘Æ¡n láº»). Má»™t artifact tá»•ng há»£p Ä‘a workspace/Ä‘a kÃªnh (vÃ­ dá»¥: káº¿ hoáº¡ch hÃ nh Ä‘á»™ng hoáº·c ghi chÃº bá»™ nhá»›) báº¯t buá»™c lÆ°u trá»¯ Ä‘áº§y Ä‘á»§ **Táº¤T Cáº¢** cÃ¡c phÃ¢n Ä‘oáº¡n á»§y quyá»n trong báº£ng phá»¥ `slack_derived_provenance_segments`.
- PhÃ¢n biá»‡t rÃµ rÃ ng giá»¯a UUID capture váº­t lÃ½ (`capture_id` tá»« `slack_sources`) vÃ  khÃ³a tÃ i nguyÃªn logic `owner_source_key`.
- Ãp Ä‘áº·t tráº§n TTL trÃ­ch Ä‘oáº¡n do mÃ¡y chá»§ quyáº¿t Ä‘á»‹nh: `<= 30 ngÃ y` (`retention_days INT CHECK (retention_days > 0 AND retention_days <= 30)`), Ä‘á»“ng thá»i bá»‹ giá»›i háº¡n bá»Ÿi quyá»n háº¡n tá»‘i thiá»ƒu cá»§a cÃ¡c phÃ¢n Ä‘oáº¡n cáº¥u thÃ nh. Loáº¡i bá» hoÃ n toÃ n kháº£ nÄƒng dÃ¹ng cá» `isExcerpt` Ä‘á»ƒ lÃ¡ch luáº­t lÆ°u trá»¯ nguá»“n thÃ´ 7 ngÃ y.

### 1.2. Ghi Pháº£ Há»‡ NguyÃªn Tá»­ CÃ¹ng Giao Dá»‹ch Vá»›i Dá»¯ Liá»‡u ÄÃ­ch (Atomic Write Gate):
- ÄÄƒng kÃ½ pháº£ há»‡ vÃ o `slack_derived_copies` / `slack_derived_provenance_segments` vÃ  ghi artifact Ä‘Ã­ch thá»±c táº¿ (`messages`, `plans`, `execution_steps`, `schedules`) Ä‘Æ°á»£c Ä‘Ã³ng gÃ³i trong **CÃ™NG 1 TRANSACTION PostgreSQL** (`pg.PoolClient`).
- TuÃ¢n thá»§ nghiÃªm ngáº·t **tráº­t tá»± khÃ³a má»™t chiá»u chá»‘ng deadlock**:
  `conversations` (FOR UPDATE) -> `schedules` (FOR UPDATE) -> `plans` (FOR UPDATE) -> `slack_connections` (FOR SHARE) -> `slack_trusted_providers` (FOR SHARE) -> `slack_processing_consents` (FOR SHARE) -> kiá»ƒm tra barrier -> ghi lineage -> ghi artifact Ä‘Ã­ch.
- TÃ¡c vá»¥ ghi non-Slack Ä‘Æ°á»£c báº£o toÃ n tuyá»‡t Ä‘á»‘i, bá» qua bÆ°á»›c khÃ³a Slack Ä‘á»ƒ giá»¯ nguyÃªn 100% hiá»‡u nÄƒng vÃ  logic hiá»‡n cÃ³.

### 1.3. RÃ o Cháº¯n Pre-Read, In-Memory & Transport Guards:
- TrÆ°á»›c khi tráº£ DTO qua HTTP routes, SSE stream (`message`, `plan`, `step_output`), hoáº·c náº¡p lá»‹ch sá»­ vÃ o prompt cá»§a planner: hÃ m `assertDerivedCopyAllowed` duyá»‡t qua **Táº¤T Cáº¢** cÃ¡c phÃ¢n Ä‘oáº¡n provenance. Náº¿u cÃ³ báº¥t ká»³ rÃ o cháº¯n nÃ o (pending, failed, hoáº·c provisional) hoáº·c epoch bá»‹ thay Ä‘á»•i hoáº·c háº¿t háº¡n TTL -> cháº·n truy cáº­p ngay láº­p tá»©c.
- PhÃ¢n Ä‘á»‹nh ráº¡ch rÃ²i chÃ­nh sÃ¡ch xÃ³a/redact: náº¿u vÄƒn báº£n sinh bá»Ÿi model lÃ  há»—n há»£p (mixed text) khÃ´ng thá»ƒ bÃ³c tÃ¡ch an toÃ n giá»¯a cÃ¡c nguá»“n, redact toÃ n bá»™ cÃ¢u do model sinh (thay báº±ng tombstone thÃ´ng bÃ¡o thu há»“i) vÃ  báº£o toÃ n tin nháº¯n ngÆ°á»i dÃ¹ng.
- CÃ´ng bá»‘ 2 giao diá»‡n báº£o vá»‡ riÃªng biá»‡t: `IPlannerSlackLineageGuard` cho AI Engineer (Planner) vÃ  `IExecutorSlackLineageGuard` cho Backend Engineer (Executor).

### 1.4. Bá»™ Cháº¡y Cascade Purge HoÃ n Chá»‰nh Cho 7 NhÃ³m Báº£n Sao PhÃ¡i Sinh (`SlackCascadePurgeRunner`):
- Má»Ÿ rá»™ng hÃ ng Ä‘á»£i vÃ´ hiá»‡u hÃ³a `slack_invalidation_intents` cá»§a 03B1: intent chá»‰ hoÃ n táº¥t khi cáº£ nguá»“n thÃ´ láº«n toÃ n bá»™ cÃ¡c báº£n sao phÃ¡i sinh liÃªn quan Ä‘Ã£ Ä‘Æ°á»£c purge/redact sáº¡ch sáº½.
- Thiáº¿t káº¿ Ä‘á»§ bá»™ xá»­ lÃ½ (Purge Handlers) cho Ä‘Ãºng 7 kinds:
  1. `chat_history_message`: Scrub `messages.content` vÃ  `metadata` JSON.
  2. `working_memory_entity`: Scrub observed entity khá»i `metadata->'state'`.
  3. `plan_step_arg`: VÃ´ hiá»‡u hÃ³a pending plans; scrub args/output/error JSON vÃ  `plan_text`.
  4. `proposal_excerpt`: ÄÃ¡nh dáº¥u `revoked_by_source_purge`, scrub trÃ­ch Ä‘oáº¡n (Cá»•ng Fail-Closed cho Inbox SLACK-06).
  5. `daily_digest_entry`: Scrub trÃ­ch Ä‘oáº¡n khá»i digest (Cá»•ng Fail-Closed cho Digest SLACK-06).
  6. `scheduled_workflow_arg`: Táº¡m dá»«ng schedule (`pause_reason='slack_source_invalidated'`), scrub request/error, há»§y plan phÃ¡i sinh.
  7. `audit_log_entry`: Báº±ng chá»©ng audit append-only tá»‘i thiá»ƒu khÃ´ng chá»©a payload untrusted; chá»‰ giá»¯ tombstone receipt.
- QuÃ©t fanout sá»± kiá»‡n chÃ­nh sÃ¡ch (revocation/epoch change) thu tháº­p Ä‘áº§y Ä‘á»§ cÃ¡c epoch tá»« `slack_derived_provenance_segments`, báº£o Ä‘áº£m cÃ¡c báº£n sao phÃ¡i sinh váº«n Ä‘Æ°á»£c purge sáº¡ch dÃ¹ dá»¯ liá»‡u thÃ´ Ä‘Ã£ háº¿t háº¡n trÆ°á»›c Ä‘Ã³.
- Kháº£ nÄƒng chá»‘ng chá»‹u lá»—i (Crash resilience): Xá»­ lÃ½ báº±ng `SKIP LOCKED`, kiá»ƒm tra idempotent trÃªn tá»«ng handler; náº¿u tiáº¿n trÃ¬nh bá»‹ dá»«ng giá»¯a chá»«ng (vÃ­ dá»¥ xong 3/7 handlers), khi restart sáº½ tiáº¿p tá»¥c 4 handlers cÃ²n láº¡i mÃ  khÃ´ng gÃ¢y trÃ¹ng láº·p hay lá»—i.

---

## 2. Báº£ng Äá»‘i SoÃ¡t 7 Kinds & Cá»•ng Fail-Closed ThÃ nh Pháº§n TÆ°Æ¡ng Lai

ToÃ n bá»™ 7 nhÃ³m báº£n sao phÃ¡i sinh Ä‘Æ°á»£c Ä‘á»‘i soÃ¡t chi tiáº¿t trong báº£ng coverage cá»§a Task Card vÃ  Implementation Plan:
- 5 nhÃ³m hiá»‡n há»¯u (`chat_history_message`, `working_memory_entity`, `plan_step_arg`, `scheduled_workflow_arg`, `audit_log_entry`): ÄÃ£ xÃ¡c Ä‘á»‹nh chÃ­nh xÃ¡c cÃ¡c báº£ng SQL (`messages`, `plans`, `execution_steps`, `schedules`, `schedule_runs`), repositories vÃ  services thá»±c táº¿ trong codebase.
- 2 nhÃ³m tÆ°Æ¡ng lai thuá»™c SLACK-06 (`proposal_excerpt`, `daily_digest_entry`): ÄÆ°á»£c thiáº¿t láº­p cá»•ng kiá»ƒm soÃ¡t fail-closed tÆ°á»ng minh. Tuyá»‡t Ä‘á»‘i khÃ´ng táº¡o handler giáº£ Ä‘á»‹nh trá»‘ng rá»—ng Ä‘á»ƒ tá»± tuyÃªn bá»‘ hoÃ n thÃ nh 100% F3; báº¯t buá»™c cÃ¡c thÃ nh pháº§n Inbox/Digest pháº£i Ä‘Äƒng kÃ½ há»£p Ä‘á»“ng pháº£ há»‡ trÆ°á»›c khi Ä‘Æ°á»£c phÃ©p lÆ°u trá»¯ trÃ­ch Ä‘oáº¡n.

---

## 3. Thu Gá»n Báº£n Káº¿ Hoáº¡ch Äáº¡t Chuáº©n (Budget <= 350 DÃ²ng)

Báº£n káº¿ hoáº¡ch triá»ƒn khai [`docs/superpowers/plans/2026-10-30-slack-03b2-derived-lineage-and-purge.md`](../../superpowers/plans/2026-10-30-slack-03b2-derived-lineage-and-purge.md) Ä‘Æ°á»£c xÃ¢y dá»±ng cháº·t cháº½, chÃ­nh xÃ¡c vÃ  Ä‘áº¡t Ä‘á»™ dÃ i **189 dÃ²ng** (náº±m sÃ¢u trong giá»›i háº¡n `<= 350 dÃ²ng`), táº­p trung vÃ o cÃ¡c contracts, DDL migration 0018, lock hierarchy, coverage table vÃ  real test matrix.

---

## 4. Báº±ng Chá»©ng XÃ¡c Minh CÆ¡ Há»c

| Háº¡ng má»¥c kiá»ƒm tra | Lá»‡nh thá»±c hiá»‡n | Káº¿t quáº£ thá»±c táº¿ |
|---|---|---|
| **Ranh giá»›i Module & Tá»‡p Sá»Ÿ há»¯u** | `git status --porcelain` | Chá»‰ táº¡o Ä‘Ãºng 3 tá»‡p tÃ i liá»‡u SLACK-03B2 má»›i; khÃ´ng cÃ³ tá»‡p thá»«a, khÃ´ng sá»­a mÃ£ nguá»“n, khÃ´ng sá»­a `CURRENT-STATE.md` hay `ROADMAP.md` |
| **Kiá»ƒm tra CÃº phÃ¡p & Whitespace** | `git diff --check e9088d5e..HEAD` | **EXIT 0**; hoÃ n toÃ n sáº¡ch sáº½, khÃ´ng cÃ³ trailing whitespace hay conflict marker |
| **TÃ­nh Há»£p Lá»‡ Cá»§a ÄÆ°á»ng Dáº«n & LiÃªn Káº¿t** | Kiá»ƒm tra chÃ©o giá»¯a Task card, Plan vÃ  Log | Táº¥t cáº£ liÃªn káº¿t markdown tÆ°Æ¡ng Ä‘á»‘i Ä‘á»u trá» chÃ­nh xÃ¡c Ä‘áº¿n cÃ¡c file hiá»‡n há»¯u trong workspace |
| **Äá»™ DÃ i Báº£n Káº¿ Hoáº¡ch (Line Budget)** | `(Get-Content docs/superpowers/plans/2026-10-30-slack-03b2-derived-lineage-and-purge.md).Count` | **189 dÃ²ng** (Thá»a mÃ£n yÃªu cáº§u `<= 350 dÃ²ng`) |
| **Kiá»ƒm Thá»­ MÃ£ Nguá»“n (Test Run Status)** | Docs-only scope | **Proposed NOT_RUN** (TuÃ¢n thá»§ nghiÃªm ngáº·t chá»‰ Ä‘áº¡o DOCS-ONLY; khÃ´ng cháº¡y `npm install` hay táº£i npx bÃªn ngoÃ i) |

---

## 5. Tráº¡ng ThÃ¡i HoÃ n ThÃ nh & BÃ n Giao

1. Cáº£ 3 tÃ i liá»‡u SLACK-03B2 Ä‘Ã£ Ä‘Æ°á»£c khá»Ÿi táº¡o hoÃ n chá»‰nh, Ä‘áº¡t chuáº©n ká»¹ thuáº­t cao nháº¥t.
2. Kiá»ƒm tra hÃ²m thÆ° Ä‘iá»u phá»‘i viÃªn (`orca orchestration check`) Ä‘á»ƒ báº£o Ä‘áº£m khÃ´ng cÃ³ thÃ´ng Ä‘iá»‡p chá»‰ Ä‘áº¡o bá»• sung.
3. Commit Ä‘Ãºng 3 file tÃ i liá»‡u, push lÃªn nhÃ¡nh `docs/slack-03b2-derived-plan` vÃ  má»Ÿ Draft PR vÃ o `integration/slack-personal-20261029`.
4. Gá»­i bÃ¡o cÃ¡o `worker_done` kÃ¨m tÃ³m táº¯t 3 cÃ¢u theo Ä‘Ãºng quy chuáº©n Ä‘iá»u phá»‘i Orca.

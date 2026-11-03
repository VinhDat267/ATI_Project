# SLACK-04A · Signed HTTP Ingress, Challenge Verification & Durable Commit ACK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thiết lập điểm tiếp nhận sự kiện webhook HTTPS ký số từ Slack Events API (`POST /api/slack/events`), thu thập buffer raw body trước JSON middleware, xác thực HMAC-SHA256 phiên bản `v0` trực tiếp trên byte thô không roundtrip UTF-8 cùng cửa sổ độ tươi timestamp bounded `<= 300s`, phản hồi thử thách `url_verification` chuẩn Slack không bắt buộc `api_app_id`, áp dụng mô hình Body-Free Receipt kết hợp hợp đồng watermark 6 chiều ngăn chặn backfill F1, áp dụng thiết kế rào cản tạm thời trước probe (provisional read block) theo từng binding cụ thể phối hợp qua giao diện transaction-bound thống nhất `stageInTransaction` với 03B1 dưới cùng owner advisory lock với TokenManager, và cam kết lưu trữ bền vững trước khi phản hồi HTTP 200.

**Architecture:**
- **Mount Route & Stream Handling:** Route `POST /api/slack/events` mount TRƯỚC `express.json()`. Middleware stream có trần cứng 1 MB (1.048.576 bytes) và timeout 5.000 ms. Khi vượt trần, trả lời HTTP 413 `Payload Too Large` và chỉ đóng kết nối sau khi phản hồi đã hoàn tất gửi đi (`res.on('finish')`).
- **Mật mã HMAC v0 Trực tiếp trên Raw Buffer:** `createHmac('sha256', secret).update('v0:' + timestampHeader + ':').update(rawBody).digest('hex')`. Tuyệt đối không gọi `.toString('utf8')` trước khi băm. So sánh bằng `crypto.timingSafeEqual` sau khi đối soát độ dài 67 ký tự (`^v0=[0-9a-f]{64}$`). Header timestamp kiểm tra regex nghiêm ngặt `/^\d{1,10}$/` với độ lệch `<= 300s`.
- **Thử thách URL Chuẩn Slack & Ràng buộc Sự kiện Nghiệp vụ:** Nhánh `url_verification` chấp nhận payload chuẩn `{ token, challenge, type }` không bắt buộc `api_app_id` (nếu có thì phải khớp), phản hồi HTTP 200 `{ challenge }` tức thì không ghi DB. Nhánh `event_callback` bắt buộc có `api_app_id` khớp cấu hình và `team_id` hợp lệ (tuyệt đối không fallback sang `authorizations[0]`).
- **Body-Free Receipt & Hợp đồng Watermark 6 Chiều F1:** `slack_event_receipts` chỉ lưu routing metadata tối thiểu, tuyệt đối không lưu text/blocks tin nhắn. Lưu `source_event_time` bất biến từ epoch Slack (strict regex `/^\d{1,10}(\.\d{1,6})?$/`, fail-closed nếu thiếu, cấm `Date.now()`). Worker 04B áp dụng watermark chặn backfill: `source_event_time >= MAX(processing_start, consent_grant, identity_epoch, provider_attestation, config_revision, resume)`.
- **Thẩm quyền Thu hồi & Rào cản Tạm thời Theo Từng Binding (Provisional Barrier Before Probe):**
  - Tài liệu chính thức Slack `tokens_revoked` chỉ cung cấp danh sách User IDs (`tokens.oauth`), HOÀN TOÀN KHÔNG có token ID hay grant generation ID. Do đó, `connected_at < event_time` một mình không phải bằng chứng credential hiện tại bị thu hồi (kịch bản: token cũ bị thu hồi sau khi grant mới đã tạo; tương tự với `app_uninstalled` đến muộn sau khi app đã reinstall). Timestamp chỉ là gợi ý thứ tự, không phải thẩm quyền thu hồi thế hệ hiện tại.
  - *Quy trình thận trọng per-binding:*
    1. Một sự kiện có thể ảnh hưởng tới nhiều actor/kết nối; mỗi kết nối có thế hệ (`identity_version`) và credential fingerprint riêng biệt. Dưới cùng owner advisory lock (`withOwner(userId)`):
       - Bắt generation hiện tại và cấu trúc 5 trường `SlackBinding` (`atiUserId`, `connectionId`, `workspaceId`, `slackUserId`, `identityVersion`);
       - Commit một rào cản đọc tạm thời dạng barrier-only (provisional read block per-binding, không kèm `purgeTarget`) qua giao diện thống nhất 03B1 `stageInTransaction(client, input)` trước ACK, **BẢO LƯU PRIVATE CONFIG** trong database (không xóa `config`);
    2. Trả lời HTTP 200 ACK cho Slack sau khi transaction bền vững đã commit;
    3. Sau ACK, worker chạy probe metadata-only `auth.test` có CAS guard trên `(connectionId, identityVersion)` với captured credential:
       - *Xác nhận invalid/revoked:* Ngắt kết nối dứt khoát (`status = 'disconnected'`, `config = NULL`, tăng `identity_version`, reset `refresh_in_flight`), gọi `stageInTransaction` ghi purgeTarget thế hệ cũ chính xác qua 03B1;
       - *Xác nhận valid (cùng actor & workspace):* Thu hồi thuộc về grant cũ; grant mới vẫn hợp lệ! Gỡ bỏ DUY NHẤT rào cản tạm thời này, không purge snapshot mới, giữ nguyên trạng thái active (trừ khi đã có disconnect thủ công hoặc barrier khác can thiệp);
       - *Lỗi mạng/timeout/rate-limit (unknown):* Giữ nguyên fail-closed ở trạng thái `reconnect_required`.
- **Đồng bộ Khóa Advisory Lock với TokenManager:**
  - `SlackTokenManager` giữ `withOwner(userId)` (`pg_advisory_lock`) qua lượt refresh mạng và lưu `UPDATE slack_connections SET config... WHERE id` không có CAS.
  - Các mutation vòng đời BẮT BUỘC phối hợp cùng owner advisory lock (`withOwner(userId)`) và khóa dòng, đồng thời lập kế hoạch tích hợp CAS có giới hạn (`WHERE id = $1 AND identity_version = $2`) để tuần tự hóa với khoảng thời gian refresh token mạng.
- **Rào cản Đọc F3 Thống nhất Qua 03B1 `stageInTransaction` (Loại bỏ Bảng Cạnh tranh):**
  Ingress phối hợp trực tiếp với giao diện 03B1 `stageInTransaction(client, { sourceEventKey, effects })` trong cùng transaction DB trước ACK 200:
  - `tokens_revoked` / `app_uninstalled` (trước probe): Barrier-only `effectKey = 'provisional:' + connId`, `barrierType: 'connection'`, mang full binding, `provisional: true`.
  - `message_deleted`: Mục tiêu `resource_lifecycle` (`tombstoneReason: 'source_deleted'`), rào cản vĩnh viễn, ngăn chặn resurrection khi edit đến muộn.
  - `message_changed`: Mục tiêu `resource_lifecycle` (`tombstoneReason: 'source_edited'`), vô hiệu hóa đơn điệu revision cũ (`revision < editTs`), bảo toàn revision mới.
- **Cam kết Bền vững Trước ACK & Wakeup Bounded:** Chỉ trả lời HTTP 200 SAU KHI receipt, intent và barrier đã commit thành công trong 1 transaction PostgreSQL (`BEGIN ... COMMIT`). Consumer hook in-memory chỉ là wakeup bất đồng bộ có giới hạn (best-effort fire-and-forget `.catch(() => {})`), không await làm block/500 sau commit. Khi crash/restart, worker 04B quét lại các trạng thái `pending_*` qua `SKIP LOCKED`. Lỗi DB trả về 500/503 để Slack retry.

**Tech Stack:** Node.js `^22.12.0 || >=24.0.0`, TypeScript 5.8, Express 5.2.1, PostgreSQL 16 (`pg.Pool`), Supertest 7, Vitest 4.
**Spec & Contracts:** [Slack Personal Design v3](../specs/2026-10-28-slack-personal-oauth-design.md) (Mục 4.4, 5, 8, 9.1, 9.2, 10); Hợp đồng `03A` PR #194 `bc8d6b69`; 03B1 plan `b7c6716c`; Quyết định kỹ thuật chuẩn tắc `e9088d5e` (`docs/handoff/decisions/2026-10-29-slack-source-ingress-contracts.md`); Integration `7c6c65d8`.
**Staging Base:** `b757ae081751168fdcbcfdddf73713d4a1d9109d`.

---

## Global Constraints & Security Invariants

1. **Thứ tự Mount:** Router `slack-events.ts` bắt buộc mount TRƯỚC `express.json()` trong `app.ts`.
2. **Buffer Nguyên bản:** HMAC SHA-256 `v0` tính trực tiếp trên buffer nhị phân, không gọi `.toString('utf8')`. So sánh bằng `crypto.timingSafeEqual` sau khi đối soát độ dài buffer 67 bytes.
3. **Giới hạn Stream:** Tối đa 1.048.576 bytes (1 MB), timeout 5.000 ms. Quá 1 MB gửi HTTP 413, chỉ hủy socket sau `res.on('finish')`.
4. **Timestamp Bounded & Parse Nghiêm ngặt:** Header `X-Slack-Request-Timestamp` khớp `/^\d{1,10}$/` và `|now - ts| <= 300s`. Timestamp sự kiện trong body (`event_ts`, `event_time`) parse bằng regex `/^\d{1,10}(\.\d{1,6})?$/`, nghiêm cấm `parseFloat` chấp nhận suffix junk.
5. **Thử thách URL vs Sự kiện Thường:** `url_verification` không bắt buộc `api_app_id` (nếu có phải khớp); `event_callback` bắt buộc có `api_app_id` khớp cấu hình và `team_id` hợp lệ (cấm fallback `authorizations[0]`).
6. **Body-Free Receipt & Watermark 6 Chiều:** Receipt không lưu body text. Worker 04B bắt buộc đối soát `source_event_time >= MAX(processing_start, consent_grant, identity_epoch, provider_attestation, config_revision, resume)`.
7. **Bảo toàn Credential & Rào cản Tạm thời Per-Binding:** Không đoán định thế hệ grant từ timestamp/userID. Dưới `withOwner(userId)`, commit provisional barrier per-binding và giữ private `config` dưới `reconnect_required`; chỉ xóa `config = NULL` khi probe `auth.test` xác nhận credential đã bị revoke.
8. **Tuần tự hóa Lock với TokenManager & Giới hạn Chờ Bounded Lock:** Mọi mutation trạng thái kết nối phối hợp cùng owner advisory lock (`withOwner(userId)`) của TokenManager và CAS guard (`identity_version`). Vì TokenManager có thể giữ khóa tới 10s trong lúc refresh mạng, ingress bắt buộc dùng bounded lock acquisition (`pg_try_advisory_xact_lock` hoặc lock_timeout <= 2.000 ms). Khi lock bận, ingress trả về HTTP 503 ngay lập tức để Slack retry (tuyệt đối không trả về 200 trước khi commit).
9. **Rào cản Đọc Thống nhất 03B1 `stageInTransaction`:** Sử dụng API duy nhất `stageInTransaction` với `sourceEventKey` có namespace, `effectKey` duy nhất, hỗ trợ barrier-only auth validation trước ACK; cấm bảng tombstone cạnh tranh.
10. **F4 Lifecycle & Bounded Wakeup:** Vòng đời hoạt động cả khi `MYSLACK_AUTOMATION_ENABLED=off`. In-process hook chỉ là wakeup bounded, không await sau commit làm lỗi HTTP 200.
11. **Bảo vệ Bí mật & Cổng Mã nguồn:** Không log raw body, token, secret. Không thi công code runtime trước khi 03C read, 03A, 02B được nghiệm thu tích hợp.

---

## File Structure & Module Ownership

| File | Module Ownership | Trách Nhiệm Kỹ Thuật |
|---|---|---|
| `db/v3/[proposed: NNNN_slack_event_receipts.sql]` | Backend | DDL bảng `slack_event_receipts` (body-free) và `slack_lifecycle_intents` |
| `apps/chat-api/src/config/slack-ingress-env.ts` | Backend | Cấu hình signing secret, app ID từ biến môi trường |
| `apps/chat-api/src/services/slack/slack-signature.ts` | Backend | HMAC-SHA256 v0 trên raw buffer, timingSafeEqual, timestamp bounded regex `/^\d{1,10}$/` |
| `apps/chat-api/src/db/repositories/slack-event-receipt-repo.ts` | Backend | Lưu trữ receipt, intent và commit rào cản F3 qua 03B1 `stageInTransaction` nguyên tử trong 1 transaction PG |
| `apps/chat-api/src/services/slack/slack-ingress-service.ts` | Backend | Điều phối challenge, F4 lifecycle, provisional barrier per-binding under owner lock, bounded wakeup |
| `apps/chat-api/src/routes/slack-events.ts` | Backend | Route Express 5 với middleware bounded raw buffer, timeout 5s, HTTP 413 an toàn |
| `apps/chat-api/src/app.ts` (Modify) | Backend | Mount router `slack-events` TRƯỚC `express.json()` |
| `apps/chat-api/src/server.ts` (Modify) | Backend | Khởi tạo repo và service ingress trong server bootstrap |
| `apps/chat-api/tests/services/slack-signature.test.ts` | Backend | Unit test HMAC raw buffer, timing safe equal, bounded timestamp |
| `apps/chat-api/tests/db/slack-event-receipt-repo.test.ts` | Backend | Integration test repo trên PG 16 thật: atomic commit receipt+intent+barrier qua 03B1, idempotency |
| `apps/chat-api/tests/routes/slack-events-ingress.test.ts` | Backend | HTTP test: mounting order, challenge chuẩn, missing app/team ID, 413, 500 on DB error |
| `apps/chat-api/tests/routes/slack-events-lifecycle.test.ts` | Backend | Integration test F4 lifecycle: provisional barrier, old revoke after new grant, TokenManager lock race |

---

## Typed Interfaces & Consumer Contracts

```ts
import type { SlackBinding, SlackResourceType } from '@wap/tool-schemas';
import type { SlackPurgeTarget, SlackPolicyEpoch } from '@wap/tool-schemas';

export interface SlackSignatureInput {
  signatureHeader: string | undefined;
  timestampHeader: string | undefined;
  rawBody: Buffer;
  signingSecret: string;
  nowMs?: number;
}

export type SlackSignatureVerificationResult =
  | { ok: true; timestamp: number }
  | { ok: false; status: 400 | 401; code: 'INVALID_TIMESTAMP' | 'INVALID_SIGNATURE' | 'MALFORMED_HEADER'; error: string };

export interface SlackEventEnvelope {
  token?: string;
  team_id?: string;
  api_app_id?: string;
  type: 'url_verification' | 'event_callback' | 'app_rate_limited';
  challenge?: string;
  event_id?: string;
  event_time?: number; // Integer seconds Unix epoch từ Slack
  event_context?: string;
  authorizations?: Array<{ enterprise_id: string | null; team_id: string | null; user_id: string; is_bot: boolean }>;
  event?: {
    type: string;
    event_ts?: string;
    user?: string;
    channel?: string;
    ts?: string;
    subtype?: string;
    deleted_ts?: string;
    message?: { ts: string; user?: string; edited?: { user: string; ts: string } };
    previous_message?: { ts: string; user?: string };
    tokens?: { oauth?: string[]; bot?: string[] };
    [key: string]: unknown;
  };
}

export interface SlackEventReceiptRow {
  id: string;
  slack_app_id: string;
  event_id: string;
  team_id: string;
  event_type: string;
  source_event_ts: string;
  source_event_time: Date;
  event_context: string | null;
  channel_id: string | null;
  message_ts: string | null;
  status: 'pending_fanout' | 'pending_lifecycle' | 'discarded' | 'processed' | 'failed';
  discard_reason: string | null;
  created_at: Date;
  processed_at: Date | null;
}

export type SlackLifecycleIntentPayload =
  | { intentType: 'token_revocation_validation'; binding: SlackBinding; credentialFingerprint: string; barrierId: string; sourceEventTime: Date }
  | { intentType: 'app_uninstall_validation'; binding: SlackBinding; credentialFingerprint: string; barrierId: string; sourceEventTime: Date }
  | { intentType: 'message_deleted'; workspaceId: string; channelId: string; messageTs: string; deletedTs: string; sourceEventTime: Date }
  | { intentType: 'message_changed'; workspaceId: string; channelId: string; messageTs: string; editTs: string; sourceEventTime: Date };

/** Rào cản Bền vững Phân định theo Kiểu (Discriminated Durable Barrier) */
export type SlackDurableBarrier =
  | { barrierType: 'connection'; binding: SlackBinding; provisional?: boolean; reason: string }
  | { barrierType: 'channel'; binding: SlackBinding; channelId: string; reason: string }
  | { barrierType: 'epoch'; epoch: SlackPolicyEpoch; reason: string }
  | { barrierType: 'resource'; workspaceId: string; resourceType: SlackResourceType; resourceId: string; minValidRevision?: string; reason: string };

/** Hợp đồng Đầu vào Phối hợp Rào cản Vô hiệu hóa Đọc 03B1 (Thống nhất) */
export interface SlackInvalidationEffect {
  effectKey: string; // NONNULL unique effect key (ví dụ 'provisional:' + connectionId)
  barrier: SlackDurableBarrier;
  purgeTarget?: SlackPurgeTarget; // Tùy chọn: bỏ qua khi chỉ cần rào cản tạm thời trước probe
}

export interface StageInTransactionInput {
  sourceEventKey: string; // namespaced "app_id:event_id" hoặc "policy_event:id"
  effects: SlackInvalidationEffect[];
}

export interface StageInTransactionResult {
  receiptId: string; // Bắt buộc trả về
  barrierIds: string[];
  intentIds: string[];
}

/** Giao diện Phối hợp Rào cản Vô hiệu hóa Đọc từ 03B1 (Transaction-Bound) */
export interface SlackTransactionBoundInvalidationService {
  stageInTransaction(client: import('pg').PoolClient, input: StageInTransactionInput): Promise<StageInTransactionResult>;
}

/** Hợp đồng Watermark 6 Chiều F1 (Cho Consumer Worker 04B) */
export interface SlackWorkerWatermarks {
  processingStartWatermark: Date;
  consentGrantWatermark: Date;
  identityEpochWatermark: Date;
  providerAttestationWatermark: Date;
  configRevisionWatermark: Date;
  resumeWatermark: Date;
}
```

---

## Database Migration (`NNNN_slack_event_receipts.sql`)

```sql
CREATE TABLE IF NOT EXISTS slack_event_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_app_id text NOT NULL,
  event_id text NOT NULL,
  team_id text NOT NULL,
  event_type text NOT NULL,
  source_event_ts text NOT NULL,
  source_event_time timestamptz NOT NULL,
  event_context text,
  channel_id text,
  message_ts text,
  status text NOT NULL DEFAULT 'pending_fanout' CHECK (status IN ('pending_fanout', 'pending_lifecycle', 'discarded', 'processed', 'failed')),
  discard_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE(slack_app_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_slack_event_receipts_lookup ON slack_event_receipts (slack_app_id, event_id);
CREATE INDEX IF NOT EXISTS idx_slack_event_receipts_status_created ON slack_event_receipts (status, created_at);

CREATE TABLE IF NOT EXISTS slack_lifecycle_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES slack_event_receipts(id) ON DELETE CASCADE,
  team_id text NOT NULL,
  effect_key text NOT NULL,
  intent_type text NOT NULL CHECK (intent_type IN ('token_revocation_validation', 'app_uninstall_validation', 'message_deleted', 'message_changed')),
  payload_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  UNIQUE(receipt_id, effect_key)
);
CREATE INDEX IF NOT EXISTS idx_slack_lifecycle_intents_pending ON slack_lifecycle_intents (status, created_at) WHERE status = 'pending';
```

---

## Detailed Task Breakdown

### Task 1: Proposed DB Migration & Atomic Receipt Repository with 03B1 Coordination
- [ ] **Step 1 (RED Test):** Viết `tests/db/slack-event-receipt-repo.test.ts` trên PG 16 thật:
  - T1.1: Tạo receipt `pending_fanout` body-free với `source_event_ts` và `source_event_time`, không có text/blocks.
  - T1.2: Ràng buộc UNIQUE `(slack_app_id, event_id)`: insert trùng trả về `{ inserted: false, receipt }` idempotent.
  - T1.3: Concurrency 10 insert đồng thời: đúng 1 insert thành công, 9 trả về existing.
  - T1.4: Transaction nguyên tử receipt + lifecycle intent + 03B1 barrier: fail barrier -> rollback toàn bộ.
  - T1.5: Phối hợp rào cản tạm thời (provisional barrier) cho `tokens_revoked`: bắt generation per-binding, 1 sự kiện ảnh hưởng >= 2 bindings/generations khác nhau lưu >= 2 intent với `UNIQUE(receipt_id, effect_key)`, commit qua `stageInTransaction`, giữ `config`.
  - T1.6: Idempotency duplicate delivery: sự kiện gửi lại với receipt đã tồn tại không tạo thêm intent trùng lặp.
  - T1.7: Rào cản 03B1 cho `message_deleted` (tombstone vĩnh viễn) và `message_changed` (`min_valid_revision = edit_ts`), ngăn chặn resurrection.
- [ ] **Step 2:** Chạy test; mong đợi FAIL (chưa có DDL/repo).
- [ ] **Step 3 (GREEN Implementation):** Tạo migration `NNNN_slack_event_receipts.sql` và triển khai `SlackEventReceiptRepo.recordReceiptAtomic` phối hợp với `SlackTransactionBoundInvalidationService.stageInTransaction`.
- [ ] **Step 4:** Chạy lại test; mong đợi PASS trên PG 16 thật.

### Task 2: Cryptographic Signature & Freshness Verifier
- [ ] **Step 1 (RED Test):** Viết `tests/services/slack-signature.test.ts`:
  - T2.1: Chữ ký hợp lệ `v0=...` tạo từ HMAC raw buffer byte thô -> `{ ok: true, timestamp }`.
  - T2.2: Buffer chứa ký tự non-ASCII tiếng Việt và byte lạ -> xác thực đạt khi băm raw byte, lỗi nếu UTF-8 decode.
  - T2.3: Thiếu header hoặc sai độ dài digest (!= 64 hex chars) -> 400 / 401, không ném `RangeError` trong `timingSafeEqual`.
  - T2.4: Timestamp chứa khoảng trắng, dấu cộng, số thập phân hoặc lệch quá 300s -> từ chối bằng regex `/^\d{1,10}$/`.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3 (GREEN Implementation):** Viết `apps/chat-api/src/services/slack/slack-signature.ts` với `timingSafeEqual` an toàn và regex `/^\d{1,10}$/`.
- [ ] **Step 4:** Chạy lại test; mong đợi PASS.

### Task 3: Ingress Service, Provisional Barrier under Owner Lock & Lifecycle Dispatcher
- [ ] **Step 1 (RED Test):** Viết `tests/services/slack-ingress-service.test.ts`:
  - T3.1: Thử thách `url_verification` chuẩn không có `api_app_id` -> 200 `{ challenge }` tức thì, không ghi DB receipt.
  - T3.2: Thử thách có `api_app_id` khớp -> 200; `api_app_id` sai -> 400 `APP_ID_MISMATCH`.
  - T3.3: Sự kiện `event_callback` thiếu `api_app_id` hoặc thiếu `team_id` -> 400 (không fallback sang authorizations[0]).
  - T3.4: Parse timestamp nghiêm ngặt bằng `/^\d{1,10}(\.\d{1,6})?$/`: từ chối suffix junk như `'1730214000abc'`.
  - T3.5: Cờ automation tắt: discard tin thường trong memory; 4 sự kiện vòng đời F4 vẫn commit nguyên tử trước ACK 200.
  - T3.6: Provisional barrier under bounded owner lock: dùng `pg_try_advisory_xact_lock` hoặc timeout 2s; khi TokenManager đang giữ lock refresh mạng, ingress trả về HTTP 503 nhanh chóng (không fake 200, không timeout vô hạn); retry khi lock mở trả về HTTP 200.
  - T3.7: In-process hook là non-blocking wakeup: hook lỗi/chậm không làm chậm hoặc fail phản hồi 200 sau khi DB commit.
  - T3.8: Malformed lifecycle event fields: fail-closed, không fall through sang automation message processing.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3 (GREEN Implementation):** Viết `SlackIngressService` với owner advisory lock coordination, strict parsing, provisional barrier per-binding và best-effort wakeup.
- [ ] **Step 4:** Chạy lại test; mong đợi PASS.

### Task 4: Express Raw Body Middleware & Ingress Route
- [ ] **Step 1 (RED Test):** Viết `tests/routes/slack-events-ingress.test.ts` (Supertest):
  - T4.1: Raw buffer streaming với HMAC hợp lệ -> 200.
  - T4.2: Payload stream vượt 1 MB -> 413 `Payload Too Large`, socket chỉ đóng sau `res.finish`.
  - T4.3: Stream timeout 5.000 ms hoặc aborted -> hủy an toàn.
  - T4.4: Chữ ký sai -> 401; JSON malformed -> 400; DB commit lỗi -> 500/503.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3 (GREEN Implementation):** Viết `apps/chat-api/src/routes/slack-events.ts` với middleware bounded stream.
- [ ] **Step 4:** Chạy lại test; mong đợi PASS.

### Task 5: Server DI Wiring & Express Mount Ordering
- [ ] **Step 1 (Integration Verification):**
  - Mount router `/api/slack/events` TRƯỚC `express.json()` trong `apps/chat-api/src/app.ts`.
  - Bootstrap repo và service trong `apps/chat-api/src/server.ts`.
- [ ] **Step 2:** Kiểm tra typecheck: `npm run typecheck:v3`; mong đợi 0 lỗi.

### Task 6: Full Integration Suite on Real PostgreSQL & Test Matrix
- [ ] **Step 1 (Test Matrix Definition):**
  - Ma trận kiểm thử bao gồm:
    1. Kịch bản Old-token revoke AFTER newer grant (`Grant 1 -> Grant 2 -> Revoke Grant 1 delayed`): provisional barrier probe `auth.test` xác nhận Grant 2 valid, gỡ provisional barrier mà không ngắt kết nối Grant 2.
    2. Revoke confirmed by probe: `auth.test` trả về invalid -> disconnect dứt khoát + tăng `identity_version` + purge exact old generation.
    3. Fractional same-second (`connected_at = t + 0.354s`, `event_time = t`): provisional barrier + metadata probe có CAS guard.
    4. Concurrency race với `SlackTokenManager`: Refresh in-flight dưới `withOwner(userId)` tuần tự hóa với webhook revocation, CAS guard ngăn chặn overwrite.
    5. Owner lock concurrency & busy timeout: TokenManager giữ `withOwner` qua mạng, webhook nhận revocation -> ingress trả về 503 nhanh chóng; sau khi lock giải phóng, retry trả về 200.
    6. Multi-binding lifecycle event: 1 `tokens_revoked` chứa >= 2 user/binding khác nhau -> tạo >= 2 intent độc lập với `UNIQUE(receipt_id, effect_key)` dưới cùng receipt; duplicate receipt idempotency.
    7. Out-of-order edit/delete: `message_deleted` trước `message_changed` -> tin nhắn đã xóa không bị hồi sinh.
    8. Mọi cờ tính năng tắt (`MYSLACK_ENABLED=off`, `MYSLACK_AUTOMATION_ENABLED=off`) -> F4 lifecycle vẫn commit nguyên tử trước ACK.
- [ ] **Step 2:** Trạng thái tài liệu: Toàn bộ kiểm thử trên được đánh dấu `NOT_RUN` trong phiên lập kế hoạch tài liệu (chờ nghiệm thu 03C/03A/02B).
- [ ] **Step 3:** Kiểm tra chất lượng tài liệu: `git diff --check b757ae08 HEAD`, kiểm tra toàn bộ liên kết markdown nội bộ.

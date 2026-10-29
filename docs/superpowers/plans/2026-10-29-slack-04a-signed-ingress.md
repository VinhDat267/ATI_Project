# SLACK-04A · Signed HTTP Ingress, Challenge Verification & Durable Commit ACK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thiết lập điểm tiếp nhận sự kiện webhook HTTPS ký số từ Slack Events API (`POST /api/slack/events`), thu thập buffer raw body trước JSON middleware, xác thực HMAC-SHA256 phiên bản `v0` trực tiếp trên byte thô không roundtrip UTF-8 cùng cửa sổ độ tươi timestamp bounded `<= 300s`, phản hồi thử thách `url_verification` chuẩn Slack không bắt buộc `api_app_id`, áp dụng mô hình Body-Free Receipt kết hợp hợp đồng watermark 6 chiều ngăn chặn backfill F1, phân định rõ ràng 3 trường hợp epoch interval `[t, t+1)` bảo toàn credential khi ambiguity, phối hợp rào cản đọc F3 nguyên tử qua giao diện của 03B1 (`commitLifecycleInvalidation`) trước ACK 200, và bảo đảm cam kết bền vững giao dịch trên PostgreSQL trước khi phản hồi Slack.

**Architecture:**
- **Mount Route & Stream Handling:** Route `POST /api/slack/events` mount TRƯỚC `express.json()`. Middleware stream có trần cứng 1 MB (1.048.576 bytes) và timeout 5.000 ms. Khi vượt trần, trả lời HTTP 413 `Payload Too Large` và chỉ đóng kết nối sau khi phản hồi đã hoàn tất gửi đi (`res.on('finish')`).
- **Mật mã HMAC v0 Trực tiếp trên Raw Buffer:** `createHmac('sha256', secret).update('v0:' + timestampHeader + ':').update(rawBody).digest('hex')`. Tuyệt đối không gọi `.toString('utf8')` trước khi băm. So sánh bằng `crypto.timingSafeEqual` sau khi đối soát độ dài 67 ký tự (`^v0=[0-9a-f]{64}$`). Header timestamp kiểm tra regex nghiêm ngặt `/^\d{1,10}$/` với độ lệch `<= 300s`.
- **Thử thách URL Chuẩn Slack & Ràng buộc Sự kiện Nghiệp vụ:** Nhánh `url_verification` chấp nhận payload chuẩn `{ token, challenge, type }` không bắt buộc `api_app_id` (nếu có thì phải khớp), phản hồi HTTP 200 `{ challenge }` tức thì không ghi DB. Nhánh `event_callback` bắt buộc có `api_app_id` khớp cấu hình và `team_id` hợp lệ (tuyệt đối không fallback sang `authorizations[0]`).
- **Body-Free Receipt & Hợp đồng Watermark 6 Chiều F1:** `slack_event_receipts` chỉ lưu routing metadata tối thiểu, tuyệt đối không lưu text/blocks tin nhắn. Lưu `source_event_time` bất biến từ epoch Slack (strict regex `/^\d{1,10}(\.\d{1,6})?$/`, fail-closed nếu thiếu, cấm `Date.now()`). Worker 04B áp dụng watermark chặn backfill: `source_event_time >= MAX(processing_start, consent_grant, identity_epoch, provider_attestation, config_revision, resume)`.
- **Phân định Interval Epoch 3 Trường Hợp Cho `tokens_revoked` / `app_uninstalled`:** Với integer-second `t = event_time`:
  1. *Trước rõ ràng (`connected_at < to_timestamp(t)`):* Ngắt kết nối dứt khoát: `status = 'disconnected'`, `config = NULL`, tăng `identity_version`, reset `refresh_in_flight = false`.
  2. *Bất định cùng giây (`connected_at >= to_timestamp(t) AND connected_at < to_timestamp(t + 1)`):* Không xóa token! Chuyển `status = 'reconnect_required'`, giữ encrypted token riêng tư trong `config` (chặn toàn bộ content query), tăng `identity_version`, reset `refresh_in_flight = false`, ghi intent ambiguity để worker giải quyết bằng metadata-only `auth.test` có CAS guard chống race reconnect/refresh.
  3. *Mới hơn rõ ràng (`connected_at >= to_timestamp(t + 1)`):* Bỏ qua (stale delayed event).
  Token IDs tuyệt đối không xuất hiện trong receipts, intents hay DTOs.
- **Rào cản Đọc F3 Thống nhất Qua 03B1 (Loại bỏ Tombstone Cạnh tranh):** Không tạo bảng tombstone riêng thiếu provenance. Ingress phối hợp trực tiếp với giao diện 03B1 `stageInTransaction(client, input)` (`SlackTransactionBoundInvalidationService`) trong cùng transaction DB trước ACK 200:
  - `tokens_revoked` / `app_uninstalled`: Mục tiêu `authorization_disconnect` theo binding/epoch cũ, không dùng `app:*` toàn workspace gây chặn cài đặt lại.
  - `message_deleted`: Mục tiêu `resource_lifecycle` (`tombstoneReason: 'source_deleted'`), rào cản vĩnh viễn, ngăn chặn resurrection khi edit đến muộn.
  - `message_changed`: Mục tiêu `resource_lifecycle` (`tombstoneReason: 'source_edited'`), vô hiệu hóa đơn điệu revision cũ (`revision < editTs`), bảo toàn revision mới.
- **Cam kết Bền vững Trước ACK & Wakeup Bounded:** Chỉ trả lời HTTP 200 SAU KHI receipt, intent và barrier đã commit thành công trong 1 transaction PostgreSQL (`BEGIN ... COMMIT`). Các consumer hook in-memory chỉ là wakeup bất đồng bộ có giới hạn (best-effort fire-and-forget `.catch(() => {})`), không await làm block/500 sau commit. Khi crash/restart, worker 04B quét lại các trạng thái `pending_*` qua `SKIP LOCKED`. Lỗi DB trả về 500/503 để Slack retry.

**Tech Stack:** Node.js `^22.12.0 || >=24.0.0`, TypeScript 5.8, Express 5.2.1, PostgreSQL 16 (`pg.Pool`), Supertest 7, Vitest 4.
**Spec & Contracts:** [Slack Personal Design v3](../specs/2026-10-28-slack-personal-oauth-design.md) (Mục 4.4, 5, 8, 9.1, 9.2, 10); Hợp đồng `03A` PR #194 `bc8d6b69`; 03B1 plan `c6118cdd`; Integration `7c6c65d8`.
**Staging Base:** `b757ae081751168fdcbcfdddf73713d4a1d9109d`.

---

## Global Constraints & Security Invariants

1. **Thứ tự Mount:** Router `slack-events.ts` bắt buộc mount TRƯỚC `express.json()` trong `app.ts`.
2. **Buffer Nguyên bản:** HMAC SHA-256 `v0` tính trực tiếp trên buffer nhị phân, không gọi `.toString('utf8')`. So sánh bằng `crypto.timingSafeEqual` sau khi đối soát độ dài buffer 67 bytes.
3. **Giới hạn Stream:** Tối đa 1.048.576 bytes (1 MB), timeout 5.000 ms. Quá 1 MB gửi HTTP 413, chỉ hủy socket sau `res.on('finish')`.
4. **Timestamp Bounded & Parse Nghiêm ngặt:** Header `X-Slack-Request-Timestamp` khớp `/^\d{1,10}$/` và `|now - ts| <= 300s`. Timestamp sự kiện trong body (`event_ts`, `event_time`) parse bằng regex `/^\d{1,10}(\.\d{1,6})?$/`, nghiêm cấm `parseFloat` chấp nhận suffix junk.
5. **Thử thách URL vs Sự kiện Thường:** `url_verification` không bắt buộc `api_app_id` (nếu có phải khớp); `event_callback` bắt buộc có `api_app_id` khớp cấu hình và `team_id` hợp lệ (cấm fallback `authorizations[0]`).
6. **Body-Free Receipt & Watermark 6 Chiều:** Receipt không lưu body text. Worker 04B bắt buộc đối soát `source_event_time >= MAX(processing_start, consent_grant, identity_epoch, provider_attestation, config_revision, resume)`.
7. **Bảo toàn Credential khi Ambiguity:** Trường hợp cùng giây `[t, t+1)` giữ encrypted token riêng tư trong `config` dưới `status = 'reconnect_required'`, tăng `identity_version`, reset `refresh_in_flight`. Xóa `config = NULL` CHỈ khi ngắt kết nối dứt khoát `< t`.
8. **Rào cản Đọc Thống nhất 03B1:** Commit barrier F3 trực tiếp qua `commitLifecycleInvalidation` trong transaction trước ACK 200. Scope theo binding/epoch cũ, cấm workspace-global tombstone `app:*` không generation.
9. **F4 Lifecycle & Bounded Wakeup:** Vòng đời hoạt động cả khi `MYSLACK_AUTOMATION_ENABLED=off`. In-process hook chỉ là wakeup bounded, không await sau commit làm lỗi HTTP 200.
10. **Bảo vệ Bí mật & Cổng Mã nguồn:** Không log raw body, token, secret. Không thi công code runtime trước khi 03C read, 03A, 02B được nghiệm thu tích hợp.

---

## File Structure & Module Ownership

| File | Module Ownership | Trách Nhiệm Kỹ Thuật |
|---|---|---|
| `db/v3/[proposed: NNNN_slack_event_receipts.sql]` | Backend | DDL bảng `slack_event_receipts` (body-free) và `slack_lifecycle_intents` |
| `apps/chat-api/src/config/slack-ingress-env.ts` | Backend | Cấu hình signing secret, app ID từ biến môi trường |
| `apps/chat-api/src/services/slack/slack-signature.ts` | Backend | HMAC-SHA256 v0 trên raw buffer, timingSafeEqual, timestamp bounded regex `/^\d{1,10}$/` |
| `apps/chat-api/src/db/repositories/slack-event-receipt-repo.ts` | Backend | Lưu trữ receipt, intent và commit rào cản F3 qua 03B1 nguyên tử trong 1 transaction PG |
| `apps/chat-api/src/services/slack/slack-ingress-service.ts` | Backend | Điều phối challenge, F4 lifecycle, coarse-time interval resolver `[t, t+1)`, bounded wakeup |
| `apps/chat-api/src/routes/slack-events.ts` | Backend | Route Express 5 với middleware bounded raw buffer, timeout 5s, HTTP 413 an toàn |
| `apps/chat-api/src/app.ts` (Modify) | Backend | Mount router `slack-events` TRƯỚC `express.json()` |
| `apps/chat-api/src/server.ts` (Modify) | Backend | Khởi tạo repo và service ingress trong server bootstrap |
| `apps/chat-api/tests/services/slack-signature.test.ts` | Backend | Unit test HMAC raw buffer, timing safe equal, bounded timestamp |
| `apps/chat-api/tests/db/slack-event-receipt-repo.test.ts` | Backend | Integration test repo trên PG 16 thật: atomic commit receipt+intent+barrier, idempotency |
| `apps/chat-api/tests/routes/slack-events-ingress.test.ts` | Backend | HTTP test: mounting order, challenge chuẩn, missing app/team ID, 413, 500 on DB error |
| `apps/chat-api/tests/routes/slack-events-lifecycle.test.ts` | Backend | Integration test F4 lifecycle: interval epoch `[t, t+1)`, credential retention, 03B1 barrier |

---

## Typed Interfaces & Consumer Contracts

```ts
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
  | { intentType: 'tokens_revoked'; teamId: string; appId: string; revokedActorIds: string[]; eventTime: number; resolution: 'disconnected' | 'ambiguous_reconnect_required'; capturedGeneration?: number }
  | { intentType: 'app_uninstalled'; teamId: string; appId: string; eventTime: number }
  | { intentType: 'message_deleted'; teamId: string; channelId: string; messageTs: string; deletedTs: string; sourceEventTime: Date }
  | { intentType: 'message_changed'; teamId: string; channelId: string; messageTs: string; editTs: string; sourceEventTime: Date };

/** Hợp đồng Watermark 6 Chiều F1 (Cho Consumer Worker 04B) */
export interface SlackWorkerWatermarks {
  processingStartWatermark: Date;
  consentGrantWatermark: Date;
  identityEpochWatermark: Date;
  providerAttestationWatermark: Date;
  configRevisionWatermark: Date;
  resumeWatermark: Date;
}

/** Hợp đồng Đầu vào Phối hợp Rào cản Vô hiệu hóa Đọc 03B1 */
export interface StageLifecycleInvalidationInput {
  target: import('@wap/tool-schemas').SlackPurgeTarget;
  eventId: string;
  sourceEventTs: string;
}

/** Giao diện Phối hợp Rào cản Vô hiệu hóa Đọc từ 03B1 (Transaction-Bound) */
export interface SlackTransactionBoundInvalidationService {
  stageInTransaction(client: import('pg').PoolClient, input: StageLifecycleInvalidationInput): Promise<void>;
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
  intent_type text NOT NULL CHECK (intent_type IN ('tokens_revoked', 'app_uninstalled', 'message_deleted', 'message_changed')),
  payload_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  UNIQUE(receipt_id, intent_type)
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
  - T1.5: Interval `[t, t+1)` cho `tokens_revoked`: `< t` ngắt kết nối (`status='disconnected'`, `config=NULL`); `[t, t+1)` chuyển `reconnect_required`, giữ `config`, tăng `identity_version`; `>= t+1` không ảnh hưởng.
  - T1.6: Rào cản 03B1 cho `message_deleted` (tombstone vĩnh viễn) và `message_changed` (`min_valid_revision = edit_ts`), ngăn chặn resurrection.
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

### Task 3: Ingress Service, Coarse-time Interval Resolver & Lifecycle Dispatcher
- [ ] **Step 1 (RED Test):** Viết `tests/services/slack-ingress-service.test.ts`:
  - T3.1: Thử thách `url_verification` chuẩn không có `api_app_id` -> 200 `{ challenge }` tức thì, không ghi DB receipt.
  - T3.2: Thử thách có `api_app_id` khớp -> 200; `api_app_id` sai -> 400 `APP_ID_MISMATCH`.
  - T3.3: Sự kiện `event_callback` thiếu `api_app_id` hoặc thiếu `team_id` -> 400 (không fallback sang authorizations[0]).
  - T3.4: Parse timestamp nghiêm ngặt bằng `/^\d{1,10}(\.\d{1,6})?$/`: từ chối suffix junk như `'1730214000abc'`.
  - T3.5: Cờ automation tắt: discard tin thường trong memory; 4 sự kiện vòng đời F4 vẫn commit nguyên tử trước ACK 200.
  - T3.6: Coarse-time interval 3 ca: `< t` (disconnect), `[t, t+1)` (reconnect_required + giữ config), `>= t+1` (unaffected).
  - T3.7: In-process hook là non-blocking wakeup: hook lỗi/chậm không làm chậm hoặc fail phản hồi 200 sau khi DB commit.
  - T3.8: Malformed lifecycle event fields: fail-closed, không fall through sang automation message processing.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3 (GREEN Implementation):** Viết `SlackIngressService` với interval resolver, strict parsing, credential preservation và best-effort wakeup.
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
    1. Fractional same-second (`connected_at = t + 0.354s`, `event_time = t`) -> `status = 'reconnect_required'`, giữ token, ghi ambiguity intent.
    2. Delayed old revoke (`event_time = t`, `connected_at = t + 2s`) -> kết nối mới nguyên vẹn.
    3. Delayed old grant (`connected_at = t - 5s`, `event_time = t`) -> ngắt kết nối dứt khoát.
    4. Concurrency race: refresh token in-flight song song với revoke -> CAS guard trên `identity_version` abort refresh an toàn.
    5. Out-of-order edit/delete: `message_deleted` trước `message_changed` -> tin nhắn đã xóa không bị hồi sinh.
    6. Mọi cờ tính năng tắt (`MYSLACK_ENABLED=off`, `MYSLACK_AUTOMATION_ENABLED=off`) -> F4 lifecycle vẫn commit nguyên tử trước ACK.
- [ ] **Step 2:** Trạng thái tài liệu: Toàn bộ kiểm thử trên được đánh dấu `NOT_RUN` trong phiên lập kế hoạch tài liệu (chờ nghiệm thu 03C/03A/02B).
- [ ] **Step 3:** Kiểm tra chất lượng tài liệu: `git diff --check b757ae08 HEAD`, kiểm tra toàn bộ liên kết markdown nội bộ.

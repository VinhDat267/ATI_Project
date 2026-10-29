# SLACK-04A · Signed HTTP Ingress, Challenge Verification & Durable Commit ACK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây dựng hạ tầng tiếp nhận sự kiện webhook HTTPS ký số từ Slack Events API (`POST /api/slack/events`), thu thập buffer raw body trước khi phân tích JSON, băm mật mã trực tiếp trên byte thô không roundtrip UTF-8, xác minh chữ ký HMAC-SHA256 phiên bản `v0` cùng cửa sổ thời gian timestamp bounded `<= 300s`, phản hồi thử thách `url_verification` chuẩn Slack tức thì mà không tạo job/receipt, thiết lập mô hình biên nhận không chứa nội dung (Body-Free Receipt) kết hợp hợp đồng watermark không backfill nhằm giải quyết triệt để xung đột giữa F1 consent và ngân sách ACK 3s của Slack, đảm bảo xử lý vòng đời F4 độc lập với cờ tính năng, thiết lập rào cản vô hiệu hóa đọc F3 nguyên tử trước ACK khớp với schema database hiện hành (`status = 'disconnected'`), và cam kết lưu trữ bền vững nguyên tử (atomic durable receipt commit) trước khi trả lời HTTP 200.

**Architecture:**
- **Mount Route trước JSON Middleware:** Điểm tiếp nhận `POST /api/slack/events` được định tuyến trong Express **TRƯỚC** khi gọi `app.use(express.json())`. Sử dụng middleware thu thập raw body buffer có giới hạn dung lượng cứng 1 MB (1.048.576 bytes), timeout stream 5.000 ms và xử lý hủy kết nối (`aborted`). Khi vượt quá 1 MB -> trả về HTTP 413 `Payload Too Large` và chỉ đóng kết nối sau khi phản hồi đã hoàn tất gửi đi.
- **Mật mã HMAC-SHA256 & Băm Trực tiếp Byte Thô:** Xác thực `X-Slack-Signature` và `X-Slack-Request-Timestamp` trực tiếp trên buffer byte thô: `createHmac('sha256', secret).update('v0:' + timestampHeader + ':').update(rawBody).digest('hex')`. Tuyệt đối không chuyển đổi sang UTF-8 string trước khi băm để bảo vệ an toàn các chuỗi byte non-ASCII hoặc dữ liệu nhị phân lạ. Kiểm tra độ dài digest buffer trước khi gọi `crypto.timingSafeEqual` để chống timing attack và ngăn crash `RangeError`. Kiểm tra timestamp bằng regex chặt chẽ `/^\d{1,10}$/` với độ lệch tối đa 300 giây.
- **Xác thực Thử thách URL Chuẩn Slack Docs:** Phân tích JSON chỉ sau khi chữ ký hợp lệ. Chấp nhận payload `url_verification` chuẩn ([Slack Reference](https://docs.slack.dev/reference/events/url_verification/)) chứa `{ token, challenge, type }` mà không bắt buộc có `api_app_id`; nếu có truyền `api_app_id` thì kiểm tra phải khớp. Không ghi database receipt hay enqueue job cho sự kiện thử thách. Ngược lại, các sự kiện nghiệp vụ (`event_callback`) bắt buộc có `api_app_id` khớp cấu hình và `team_id` hợp lệ (tuyệt đối không fallback sang `authorizations[0]`).
- **Kiến trúc Biên nhận Không chứa Nội dung & Hợp đồng Ngăn chặn Backfill F1:**
  - Bảng `slack_event_receipts` chỉ lưu trữ các định danh định tuyến tối thiểu (`id, slack_app_id, event_id, team_id, event_type, source_event_ts, source_event_time, event_context, channel_id, message_ts, status, created_at, processed_at`). Tuyệt đối không lưu văn bản tin nhắn thô (`text` / `blocks`).
  - Hợp đồng thời gian nguồn bất biến (`source_event_time` parsed từ epoch Slack, fail-closed nếu thiếu, không fallback `Date.now()`).
  - Worker 04B tuân thủ hợp đồng watermark không backfill: chỉ xử lý nếu `source_event_time >= MAX(processing_start_watermark, consent_grant_watermark, identity_epoch_watermark)`, triệt tiêu hoàn toàn nguy cơ quét bù sự kiện xảy ra trước khi cấp quyền hoặc trước khi kết nối.
- **Cam kết Bền vững Nguyên tử Trước ACK (Atomic Durable Commit ACK):** Đối với các sự kiện cần xử lý, chỉ trả lời HTTP 200 SAU KHI receipt, intent liên quan và rào cản F3 đã được commit thành công trong một transaction PostgreSQL duy nhất (`BEGIN ... COMMIT`). Bản thân bản ghi receipt với trạng thái `status: 'pending_fanout' | 'pending_lifecycle'` là trạng thái có thẩm quyền bền vững. In-process hook chỉ đóng vai trò thông báo đánh thức (wakeup notification); nếu máy chủ gặp sự cố sập nguồn sau ACK 200, tiến trình phục hồi khởi động (startup recovery) và queue worker ở 04B sẽ quét tìm trạng thái pending qua `SKIP LOCKED`. Nếu database lỗi -> trả về HTTP 500/503 để Slack kích hoạt retry tự nhiên.
- **Chống Trùng lặp Idempotency trên PostgreSQL:** Khóa duy nhất `UNIQUE (slack_app_id, event_id)` trên `slack_event_receipts`. Sự kiện retry cùng `event_id` được xử lý qua `ON CONFLICT DO NOTHING`, trả về HTTP 200 ngay lập tức mà không sinh duplicate queue intent hay duplicate tombstones.
- **Độc lập Cờ Tính năng & Vòng đời F4 & Rào cản Đọc F3 Authoritative Trước ACK:**
  - Ingress hoạt động độc lập với cờ `MYSLACK_ENABLED`, `MYSLACK_AUTOMATION_ENABLED` và trạng thái tạm dừng của người dùng.
  - Khi cờ automation tắt: Tin nhắn thường được xác thực chữ ký và discard ngay trong memory (không ghi receipt/job). Nhưng cả 4 loại sự kiện vòng đời (`tokens_revoked`, `app_uninstalled`, `message_deleted`, `message_changed`) BẮT BUỘC được commit nguyên tử vào database trước khi trả lời HTTP 200.
  - **Khớp Schema Database Hiện hành (`0014_slack_oauth_connections.sql`):** Bảng `slack_connections` có ràng buộc cứng `CHECK (status IN ('active', 'reconnect_required', 'disconnected'))` và `CHECK ((status = 'disconnected' AND config IS NULL) OR status <> 'disconnected')`. Tuyệt đối không dùng `status = 'revoked'`.
  - **Xử lý Coarse-time Epoch Cho `tokens_revoked` & `app_uninstalled`:** Payload Slack không có microsecond `event_ts` cho token revoke, chỉ có `event_time` dạng số nguyên giây. Phân loại 3 trường hợp:
    1. *Trước rõ ràng (`connSec < event_time`):* Cập nhật `status = 'disconnected'`, `config = NULL`, tăng `identity_version`, xóa cờ refresh;
    2. *Sau rõ ràng (`connSec > event_time`):* Bỏ qua (stale replay);
    3. *Cùng giây (`connSec === event_time`):* Chuyển sang `status = 'reconnect_required'`, `config = NULL`, tăng `identity_version`, và ghi intent ambiguity để worker kiểm tra lại qua `auth.test`.
  - **Rào cản Đọc Authoritative Cho `message_deleted` & `message_changed`:** Tạo bảng `slack_source_tombstones` ghi nhận `resource_id` (`deleted_ts` hoặc `message_ts`) và `min_valid_revision` (`edit_ts`). Rào cản này được ghi trực tiếp trong transaction của Ingress trước ACK 200, ngăn chặn ngay lập tức việc đọc lại tin nhắn đã xóa (chống resurrection) và vô hiệu hóa revision cũ trong khi đợi worker dọn dẹp vật lý bất đồng bộ.
- **Quyền Sở hữu Trạng thái Tạm dừng (Pause Ownership):** Trạng thái tạm dừng (`pause`) là cấu hình riêng của từng người dùng trong từng workspace, không áp dụng mức toàn workspace (`isWorkspacePaused(teamId)` đã bị loại bỏ). Ingress chỉ kiểm tra cờ máy chủ toàn cục; việc kiểm tra pause cá nhân, chấp thuận F1 và watermark do worker 04B thực thi ở thời điểm phân phối quyền.
- **Phân rã Ranh giới 04A vs 04B vs 04C:**
  - 04A (Kế hoạch này): Signed ingress, buffer streaming, HMAC crypto verification, challenge response, body-free receipt atomic commit, F4 lifecycle intent capture, F3 authoritative read barriers (`slack_connections` & `slack_source_tombstones`).
  - 04B (Kế hoạch sau): Authorizations fanout worker gọi `apps.event.authorizations.list` qua app-level token (`authorizations:read`) như hạ tầng nội bộ, map user connections, watermark filtering, queue worker `SKIP LOCKED`.
  - 04C (Kế hoạch sau): Outbox ledger, Echo Guard phân biệt bot echo vs người dùng gõ tay, trạng thái ngắt mạng `UNKNOWN` không retry write mù.

**Tech Stack:** Node.js `^22.12.0 || >=24.0.0`, TypeScript 5.8, Express 5.2.1, PostgreSQL 16 (`pg.Pool`), Supertest 7, Vitest 4.
**Spec chuẩn tắc:** [Slack cá nhân và trợ lý công việc trong ATI](../specs/2026-10-28-slack-personal-oauth-design.md) (Mục 4.4, 5, 8, 9.1, 9.2, 10).
**Task card tương ứng:** [`docs/handoff/tasks/SLACK-04A-signed-ingress.md`](../../handoff/tasks/SLACK-04A-signed-ingress.md).
**Staging Base:** `b757ae081751168fdcbcfdddf73713d4a1d9109d`.

---

## Global Constraints & Security Invariants

1. **Mounting Order:** Router `slack-events.ts` phải được mount TRƯỚC `express.json()` trong `apps/chat-api/src/app.ts`. Tuyệt đối không cho phép `express.json()` chạy trước trên route này.
2. **Buffer Nguyên bản Không Roundtrip:** Chữ ký HMAC SHA-256 `v0` phải được tính trực tiếp trên buffer nhị phân nguyên bản nhận được từ socket (`hmac.update('v0:' + timestampHeader + ':').update(rawBody)`). Tuyệt đối không gọi `.toString('utf8')` trước khi băm.
3. **Giới hạn Dung lượng & Timeout Stream:** Giới hạn tối đa 1.048.576 bytes (1 MB). Timeout đọc stream 5.000 ms. Khi vượt ngưỡng, gửi phản hồi HTTP 413 `Payload Too Large` và chỉ đóng kết nối sau khi phản hồi đã hoàn tất gửi đi.
4. **Bảo vệ chống Timing Attack:** So sánh chữ ký bằng `crypto.timingSafeEqual` sau khi đã đối soát độ dài buffer (`Buffer.byteLength(expected) === Buffer.byteLength(received)`).
5. **Cửa sổ Timestamp Bounded Chống Replay:** Header `X-Slack-Request-Timestamp` phải khớp regex `/^\d{1,10}$/` và thỏa mãn `|Math.floor(Date.now() / 1000) - Number(timestampHeader)| <= 300`. Bất kỳ khoảng trắng, số thực hay ký tự lạ đều bị từ chối bằng HTTP 400 (`INVALID_TIMESTAMP`).
6. **Xác thực Thử thách URL Độc lập App ID:** Nhánh `url_verification` chấp nhận payload không có `api_app_id` theo đúng tài liệu Slack. Sự kiện `event_callback` bắt buộc có `api_app_id` khớp cấu hình và `team_id` hợp lệ.
7. **Body-Free Receipt & Hợp đồng Watermark No-Backfill:** Bảng `slack_event_receipts` tuyệt đối không có cột lưu văn bản tin nhắn thô (`text` / `blocks`). Lưu `source_event_time` bất biến; fail-closed nếu thiếu; worker 04B áp dụng watermark chặn hoàn toàn việc backfill sự kiện quá khứ.
8. **Commit Trước ACK Bằng Transaction Nguyên tử:** Chỉ trả lời HTTP 200 cho sự kiện cần xử lý SAU KHI receipt, intent và rào cản F3 đã commit thành công trong một transaction PostgreSQL duy nhất. Lỗi DB bắt buộc trả về 500/503.
9. **F4 Lifecycle Invariant & Rào cản F3 Khớp Schema Thực:**
   - Ingress và xử lý 4 loại sự kiện vòng đời (`tokens_revoked`, `app_uninstalled`, `message_deleted`, `message_changed`) vẫn hoạt động khi `MYSLACK_AUTOMATION_ENABLED=off`.
   - `tokens_revoked` chỉ thu hồi user IDs trong `tokens.oauth` (bỏ qua `tokens.bot`), cập nhật đúng schema `status = 'disconnected'`, `config = NULL`, tăng `identity_version`, reset `refresh_in_flight = false`, scope theo `app_id`, `workspace_id`, `actor_id`.
   - Xử lý coarse-time epoch chặt chẽ (trước rõ ràng -> disconnected; sau rõ ràng -> bỏ qua; cùng giây -> reconnect_required + ambiguous intent).
   - `message_deleted` và `message_changed` ghi rào cản `slack_source_tombstones` trước ACK 200, ngăn chặn resurrection nguồn đã xóa và vô hiệu hóa revision cũ.
10. **Không Rò rỉ Dữ liệu:** Không log raw body, access token, secret, hoặc nội dung tin nhắn ra console, log files, SSE hoặc public API responses.

---

## Review Focus & Attack Vectors

1. **Bảo toàn Byte Nhị phân & Non-ASCII Payload:** Gửi request chứa chuỗi byte non-ASCII hoặc chuỗi byte UTF-8 không hợp lệ. *Kỳ vọng:* Băm trực tiếp trên buffer rawBody bảo đảm chữ ký khớp chính xác với kết quả từ phía Slack, không bị biến dạng do decode string.
2. **Timing Attack & Format Header Chữ ký:** Gửi header chữ ký ngắn hơn 64 hex ký tự, dài hơn, hoặc non-hex. *Kỳ vọng:* Kiểm tra độ dài trước khi gọi `timingSafeEqual`, trả về HTTP 401 `Unauthorized` mà không ném `RangeError`.
3. **Replay & Timestamp Manipulation:** Gửi timestamp chứa khoảng trắng đầu/cuối (`' 1730214000 '`), số thực (`'1730214000.5'`), hoặc lệch quá 300s. *Kỳ vọng:* Regex `/^\d{1,10}$/` từ chối ngay với HTTP 400 `INVALID_TIMESTAMP`.
4. **Stream Flooding & Socket Termination:** Gửi payload lớn hơn 1 MB. *Kỳ vọng:* Trả về HTTP 413 `Payload Too Large`, client nhận đủ mã phản hồi trước khi socket đóng.
5. **Định dạng Thử thách URL Chuẩn:** Gửi payload `url_verification` chuẩn của Slack chỉ có `token`, `challenge`, `type` (không có `api_app_id`). *Kỳ vọng:* Trả về HTTP 200 `{ challenge }` tức thì mà không ném lỗi thiếu `api_app_id`.
6. **Sự kiện Thiếu Team ID / App ID:** Gửi `event_callback` thiếu `api_app_id` hoặc thiếu `team_id`. *Kỳ vọng:* Từ chối với HTTP 400, không fallback sang `authorizations[0]`.
7. **Crash / Gián đoạn Giữa Receipt và Intent/Tombstone:** Giả lập lỗi DB khi đang ghi intent vòng đời hoặc tombstone. *Kỳ vọng:* Transaction rollback toàn bộ, không có receipt hay rào cản mồ côi, trả về HTTP 500/503 để Slack retry.
8. **Bảo vệ Epoch Cho Revoke & Reinstall Race:**
   - Case A: `connected_at < event_time` -> Ngắt kết nối thành công (`status = 'disconnected'`).
   - Case B: `connected_at > event_time` -> Không thu hồi nhầm kết nối mới (stale replay).
   - Case C: `connected_at` trong cùng một giây với `event_time` -> Chuyển sang `reconnect_required`, ghi intent ambiguous để kiểm chứng lại bằng `auth.test`.
9. **Rào cản Đọc Tức thì Chống Resurrection Tin nhắn Đã xóa:** Gửi sự kiện `message_deleted` -> Kiểm tra `slack_source_tombstones` được commit trước ACK. Bất kỳ request đọc nguồn nào sau thời điểm này đều bị chặn ngay lập tức dù queue purge chưa chạy xong.
10. **Vô hiệu hóa Revision Cũ của Tin nhắn Đã sửa:** Gửi sự kiện `message_changed` -> Ghi tombstone với `min_valid_revision = edit_ts`. Yêu cầu đọc revision cũ hơn bị chặn, revision mới được phép.
11. **Phân biệt User Token vs Bot Token:** Gửi `tokens_revoked` chỉ có `tokens.bot`. *Kỳ vọng:* Không thu hồi bất kỳ kết nối cá nhân nào của người dùng ATI.

---

## File Structure & Module Ownership

| File | Module Ownership | Trách Nhiệm Kỹ Thuật |
|---|---|---|
| `db/v3/[proposed: NNNN_slack_event_receipts.sql]` | Backend | Migration tạo bảng `slack_event_receipts` (body-free với source_event_time), `slack_lifecycle_intents`, và `slack_source_tombstones` |
| `apps/chat-api/src/config/slack-ingress-env.ts` | Backend | Đọc và kiểm tra cấu hình signing secret, app ID từ biến môi trường |
| `apps/chat-api/src/services/slack/slack-signature.ts` | Backend | Mật mã HMAC-SHA256 v0 không roundtrip UTF-8, kiểm tra độ tươi timestamp bounded `/^\d{1,10}$/`, timingSafeEqual |
| `apps/chat-api/src/db/repositories/slack-event-receipt-repo.ts` | Backend | Repository quản lý receipt, intent vòng đời và rào cản F3 (tombstone & connection disconnect) nguyên tử trong 1 transaction PostgreSQL |
| `apps/chat-api/src/services/slack/slack-ingress-service.ts` | Backend | Điều phối xử lý sự kiện: challenge chuẩn, F4 lifecycle 4 loại sự kiện, rào cản F3 tức thì, coarse-time epoch handling, ordinary event discard, queue dispatch |
| `apps/chat-api/src/routes/slack-events.ts` | Backend | Router Express 5.2.1 với middleware raw buffer bounded, stream timeout, phản hồi 413 chuẩn và route `POST /api/slack/events` |
| `apps/chat-api/src/app.ts` (Modify) | Backend | Mount router `slack-events` TRƯỚC `express.json()`, inject dependencies |
| `apps/chat-api/src/server.ts` (Modify) | Backend | Khởi tạo repo và service ingress trong quá trình bootstrap máy chủ |
| `apps/chat-api/tests/services/slack-signature.test.ts` | Backend | Test unit chuyên sâu bộ kiểm tra mật mã chữ ký, timestamp bounded, non-ASCII/invalid UTF-8 bytes |
| `apps/chat-api/tests/db/slack-event-receipt-repo.test.ts` | Backend | Test repository trên PostgreSQL 16 thật: transaction nguyên tử receipt+intent+tombstone, concurrency, unique constraint, idempotency |
| `apps/chat-api/tests/routes/slack-events-ingress.test.ts` | Backend | Test tích hợp HTTP supertest: route mounting, challenge chuẩn không có app_id, challenge có app_id đúng/sai, event_callback thiếu app_id/team_id, invalid sig, replay, 413, DB error |
| `apps/chat-api/tests/routes/slack-events-lifecycle.test.ts` | Backend | Test tích hợp HTTP: F4 lifecycle khi automation tắt/bật, 4 loại sự kiện, rào cản F3 khớp schema thực (`status='disconnected'`), coarse-time epoch check, tombstone |

---

## Typed Interfaces & Consumer Contracts

### 1. Ingress Configuration & Signature Types
```ts
// apps/chat-api/src/services/slack/slack-signature.ts
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
```

### 2. Envelope & Event Receipt Types
```ts
// apps/chat-api/src/db/repositories/slack-event-receipt-repo.ts
export interface SlackEventEnvelope {
  token?: string;
  team_id?: string;
  api_app_id?: string;
  type: 'url_verification' | 'event_callback' | 'app_rate_limited';
  challenge?: string;
  event_id?: string;
  event_time?: number; // Integer seconds epoch từ Slack
  event_context?: string;
  authorizations?: Array<{
    enterprise_id: string | null;
    team_id: string | null;
    user_id: string;
    is_bot: boolean;
    is_enterprise_install: boolean;
  }>;
  event?: {
    type: string;
    event_ts?: string;
    user?: string;
    channel?: string;
    ts?: string;
    subtype?: string;
    deleted_ts?: string;
    message?: {
      ts: string;
      user?: string;
      edited?: { user: string; ts: string };
    };
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

export interface SlackSourceTombstoneRow {
  id: string;
  workspace_id: string;
  channel_id: string;
  resource_id: string;
  min_valid_revision: string | null;
  tombstoned_at: Date;
  reason: 'deleted' | 'edited' | 'uninstalled' | 'revoked';
}

export type SlackLifecycleIntentPayload =
  | {
      intentType: 'tokens_revoked';
      teamId: string;
      revokedUserIds: string[];
      eventTime: number;
      resolution: 'disconnected' | 'ambiguous_reconnect_required';
      capturedGeneration?: number;
    }
  | {
      intentType: 'app_uninstalled';
      teamId: string;
      appId: string;
      eventTime: number;
    }
  | {
      intentType: 'message_deleted';
      teamId: string;
      channelId: string;
      messageTs: string;
      deletedTs: string;
      sourceEventTime: Date;
    }
  | {
      intentType: 'message_changed';
      teamId: string;
      channelId: string;
      messageTs: string;
      editTs: string;
      sourceEventTime: Date;
    };

export interface RecordReceiptAtomicInput {
  slackAppId: string;
  eventId: string;
  teamId: string;
  eventType: string;
  sourceEventTs: string;
  sourceEventTime: Date;
  eventContext?: string | null;
  channelId?: string | null;
  messageTs?: string | null;
  status: 'pending_fanout' | 'pending_lifecycle' | 'discarded';
  discardReason?: string | null;
  lifecycleIntent?: SlackLifecycleIntentPayload;
  tombstone?: {
    channelId: string;
    resourceId: string;
    minValidRevision?: string | null;
    reason: 'deleted' | 'edited' | 'uninstalled' | 'revoked';
  };
}
```

### 3. Decoupled Consumer Hooks for 04B and 03B/02B
```ts
// apps/chat-api/src/services/slack/slack-ingress-service.ts
/** Consumer Hook cho Giai đoạn 04B (Queue & Authorizations Fanout) */
export interface SlackQueueIntentHook {
  onEventReceived(receipt: SlackEventReceiptRow): Promise<void>;
}

/** Consumer Hook cho Giai đoạn 03B/02B (Lifecycle Cascade Purge) */
export interface SlackLifecyclePurgeHook {
  onLifecycleStaged(intent: { id: string; teamId: string; payload: SlackLifecycleIntentPayload }): Promise<void>;
}

/** Hợp đồng Watermark Ngăn Chặn Backfill F1 (dành cho Consumer Worker 04B) */
export interface SlackWorkerWatermarks {
  processingStartWatermark: Date;
  consentGrantWatermark: Date;
  identityEpochWatermark: Date;
}

/** Dependency Injection cho SlackIngressService */
export interface SlackIngressServiceOptions {
  receiptRepo: SlackEventReceiptRepo;
  appId: string;
  isAutomationEnabled: () => boolean;
  queueHook?: SlackQueueIntentHook;
  lifecycleHook?: SlackLifecyclePurgeHook;
  clock?: () => number;
}
```

---

## Detailed Task Breakdown

### Task 1: Proposed Database Migration & Atomic Receipt Repository (PostgreSQL 16)

**Files:**
- Create: `db/v3/NNNN_slack_event_receipts.sql` (Proposed migration)
- Create: `apps/chat-api/src/db/repositories/slack-event-receipt-repo.ts`
- Create: `apps/chat-api/tests/db/slack-event-receipt-repo.test.ts`

- [ ] **Step 1 (RED Test):** Viết database test `apps/chat-api/tests/db/slack-event-receipt-repo.test.ts` sử dụng `createMigratedSchema('slack_receipts')`:
  - Test 1: Tạo receipt mới thành công với trạng thái `pending_fanout`, `source_event_ts`, `source_event_time` và các trường routing định danh tối thiểu, không có cột body text.
  - Test 2: Ràng buộc UNIQUE `(slack_app_id, event_id)` trên PG thật: Gọi `recordReceiptAtomic` lần 2 với cùng `(app_id, event_id)` -> trả về `{ inserted: false, receipt: existingRow }`, không ném lỗi duplicate key ra ngoài.
  - Test 3: Concurrency test: Dùng `Promise.all` bắn 10 lệnh INSERT cùng một `(app_id, event_id)` đồng thời -> đúng 1 câu lệnh thành công chèn mới (`inserted: true`), 9 câu lệnh còn lại trả về bản ghi đã chèn (`inserted: false`).
  - Test 4: Transaction nguyên tử Receipt + Intent + Tombstone: Chèn receipt kèm `lifecycleIntent` và `tombstone` trong cùng transaction; nếu tombstone insert lỗi (giả lập cú pháp sai) -> toàn bộ transaction rollback, không có receipt hay intent mồ côi nào được lưu lại.
  - Test 5: Rào cản Epoch Revoke F3 Khớp Schema Hiện hành:
    - Khi ghi intent `tokens_revoked`, repository cập nhật bảng `slack_connections`:
      `SET status = 'disconnected', config = NULL, identity_version = identity_version + 1, refresh_in_flight = false`
      cho các bản ghi có `workspace_id = $1 AND actor_id = ANY($2) AND status IN ('active', 'reconnect_required') AND connected_at < to_timestamp($3)`.
    - Đảm bảo thỏa mãn ràng buộc `CHECK (status IN ('active', 'reconnect_required', 'disconnected'))` và `CHECK ((status = 'disconnected' AND config IS NULL) OR status <> 'disconnected')`.
  - Test 6: Xử lý Coarse-time Epoch & Ambiguity Fencing:
    - Test ca cùng giây (`connected_at` có cùng số nguyên giây với `event_time`) -> cập nhật `status = 'reconnect_required'`, `config = NULL`, tăng `identity_version`, và ghi intent ambiguity để worker giải quyết bằng `auth.test`.
    - Test ca kết nối mới hơn (`connected_at > to_timestamp(event_time)`) -> kết nối không bị thu hồi nhầm.
  - Test 7: Rào cản Đọc Tức thì Bằng Tombstone:
    - `message_deleted`: Ghi tombstone vào `slack_source_tombstones` với `resource_id = deleted_ts, reason = 'deleted'`, ngăn chặn resurrection.
    - `message_changed`: Ghi tombstone với `resource_id = message_ts, min_valid_revision = edit_ts, reason = 'edited'`, vô hiệu hóa revision cũ và cho phép revision mới.
- [ ] **Step 2:** Chạy `npm test -w @wap/chat-api -- tests/db/slack-event-receipt-repo.test.ts`; mong đợi FAIL do chưa có file SQL và Repo.
- [ ] **Step 3 (GREEN Implementation):**
  - Viết file SQL `db/v3/NNNN_slack_event_receipts.sql`:
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

    CREATE INDEX IF NOT EXISTS idx_slack_event_receipts_lookup
      ON slack_event_receipts (slack_app_id, event_id);

    CREATE INDEX IF NOT EXISTS idx_slack_event_receipts_status_created
      ON slack_event_receipts (status, created_at);

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

    CREATE INDEX IF NOT EXISTS idx_slack_lifecycle_intents_pending
      ON slack_lifecycle_intents (status, created_at)
      WHERE status = 'pending';

    -- Rào cản Đọc Tức thì F3 Bền vững Trước ACK
    CREATE TABLE IF NOT EXISTS slack_source_tombstones (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id text NOT NULL,
      channel_id text NOT NULL,
      resource_id text NOT NULL,
      min_valid_revision text,
      tombstoned_at timestamptz NOT NULL DEFAULT now(),
      reason text NOT NULL CHECK (reason IN ('deleted', 'edited', 'uninstalled', 'revoked')),
      UNIQUE (workspace_id, channel_id, resource_id)
    );

    CREATE INDEX IF NOT EXISTS idx_slack_source_tombstones_lookup
      ON slack_source_tombstones (workspace_id, channel_id, resource_id);
    ```
  - Triển khai `SlackEventReceiptRepo` với phương thức `recordReceiptAtomic(input: RecordReceiptAtomicInput)`.
- [ ] **Step 4:** Chạy lại `npm test -w @wap/chat-api -- tests/db/slack-event-receipt-repo.test.ts`; mong đợi PASS toàn bộ tests trên PostgreSQL 16.

---

### Task 2: Cryptographic Signature & Freshness Verifier

**Files:**
- Create: `apps/chat-api/src/services/slack/slack-signature.ts`
- Create: `apps/chat-api/tests/services/slack-signature.test.ts`

- [ ] **Step 1 (RED Test):** Viết unit test `apps/chat-api/tests/services/slack-signature.test.ts`:
  - Test 1: Chữ ký hợp lệ đúng chuẩn `v0=...` tạo từ `crypto.createHmac('sha256', secret)` trên buffer raw byte thô -> trả về `{ ok: true, timestamp }`.
  - Test 2: Chữ ký trên buffer chứa ký tự non-ASCII tiếng Việt và byte nhị phân lạ -> xác thực thành công khi băm trực tiếp buffer, thất bại nếu bị UTF-8 roundtrip sai.
  - Test 3: Thiếu header `X-Slack-Signature` hoặc `X-Slack-Request-Timestamp` -> trả về `{ ok: false, status: 400, code: 'MALFORMED_HEADER' }`.
  - Test 4: Header timestamp chứa khoảng trắng đầu/cuối (`' 1730214000 '`), dấu cộng (`'+1730214000'`), số thập phân (`'1730214000.5'`) hoặc ký tự chữ -> trả về `{ ok: false, status: 400, code: 'INVALID_TIMESTAMP' }`.
  - Test 5: Timestamp lệch quá 300s trong quá khứ hoặc tương lai -> trả về `{ ok: false, status: 400, code: 'INVALID_TIMESTAMP' }`.
  - Test 6: Chữ ký sai nội dung hoặc khác secret -> trả về `{ ok: false, status: 401, code: 'INVALID_SIGNATURE' }`.
  - Test 7: Chữ ký có độ dài digest khác 64 hex ký tự (ngắn hơn, dài hơn) -> trả về `{ ok: false, status: 401 }` mà không làm bung exception `RangeError` trong `crypto.timingSafeEqual`.
- [ ] **Step 2:** Chạy `npm test -w @wap/chat-api -- tests/services/slack-signature.test.ts`; mong đợi FAIL do chưa có module.
- [ ] **Step 3 (GREEN Implementation):**
  - Triển khai hàm `verifySlackSignature(input: SlackSignatureInput): SlackSignatureVerificationResult`:
    ```ts
    import { createHmac, timingSafeEqual } from 'node:crypto';

    export function verifySlackSignature(input: SlackSignatureInput): SlackSignatureVerificationResult {
      const { signatureHeader, timestampHeader, rawBody, signingSecret, nowMs = Date.now() } = input;
      if (!signatureHeader || !timestampHeader || typeof signatureHeader !== 'string' || typeof timestampHeader !== 'string') {
        return { ok: false, status: 400, code: 'MALFORMED_HEADER', error: 'Missing required Slack signature headers' };
      }
      const trimmedTimestamp = timestampHeader.trim();
      // Nghiêm cấm khoảng trắng, dấu cộng, số thập phân: bắt buộc khớp chính xác chuỗi số nguyên không dấu
      if (trimmedTimestamp !== timestampHeader || !/^\d{1,10}$/.test(timestampHeader)) {
        return { ok: false, status: 400, code: 'INVALID_TIMESTAMP', error: 'Timestamp header must be a bounded integer string without whitespace' };
      }
      const timestamp = Number(timestampHeader);
      const currentSeconds = Math.floor(nowMs / 1000);
      if (Math.abs(currentSeconds - timestamp) > 300) {
        return { ok: false, status: 400, code: 'INVALID_TIMESTAMP', error: 'Timestamp is outside the 300s freshness window' };
      }
      if (!signatureHeader.startsWith('v0=') || signatureHeader.length !== 67 || !/^v0=[0-9a-f]{64}$/.test(signatureHeader)) {
        return { ok: false, status: 401, code: 'INVALID_SIGNATURE', error: 'Signature header has invalid format or length' };
      }

      // Băm trực tiếp byte thô, tuyệt đối không gọi rawBody.toString('utf8')
      const hmac = createHmac('sha256', signingSecret);
      hmac.update(`v0:${timestampHeader}:`);
      hmac.update(rawBody);
      const expectedSignature = 'v0=' + hmac.digest('hex');

      const expectedBuf = Buffer.from(expectedSignature, 'utf8');
      const headerBuf = Buffer.from(signatureHeader, 'utf8');
      if (expectedBuf.byteLength !== headerBuf.byteLength || !timingSafeEqual(expectedBuf, headerBuf)) {
        return { ok: false, status: 401, code: 'INVALID_SIGNATURE', error: 'Signature mismatch' };
      }
      return { ok: true, timestamp };
    }
    ```
- [ ] **Step 4:** Chạy lại `npm test -w @wap/chat-api -- tests/services/slack-signature.test.ts`; mong đợi PASS 100%.

---

### Task 3: Ingress Service, Coarse-time Epoch Resolver & Lifecycle Intent Dispatcher

**Files:**
- Create: `apps/chat-api/src/services/slack/slack-ingress-service.ts`
- Create: `apps/chat-api/tests/services/slack-ingress-service.test.ts`

- [ ] **Step 1 (RED Test):** Viết unit test `apps/chat-api/tests/services/slack-ingress-service.test.ts`:
  - Test 1: Thử thách `type: 'url_verification'` chuẩn Slack không có `api_app_id` -> trả về `{ status: 200, body: { challenge } }` ngay lập tức, không ghi DB receipt.
  - Test 2: Thử thách `url_verification` có `api_app_id` khớp -> trả về 200; nếu có `api_app_id` sai -> trả về 400 `APP_ID_MISMATCH`.
  - Test 3: Sự kiện `event_callback` thiếu `api_app_id` hoặc sai `api_app_id` -> trả về `{ status: 400, error: 'APP_ID_MISMATCH' }`.
  - Test 4: Sự kiện `event_callback` thiếu `team_id` -> trả về `{ status: 400, error: 'TEAM_ID_REQUIRED' }`, không fallback sang `authorizations[0]`.
  - Test 5: Thiếu timestamp sự kiện (`event_ts` và `event_time`) -> fail-closed trả về `{ status: 400, error: 'MISSING_EVENT_TIMESTAMP' }`, không tự bịa timestamp hay fallback sang `Date.now()`.
  - Test 6: Sự kiện `message.*` hợp lệ khi cờ automation bật -> commit receipt atomic với `pending_fanout`, `source_event_time`, phát thông báo `queueHook.onEventReceived`, trả về `{ status: 200, body: { ok: true } }`.
  - Test 7: Sự kiện `message.*` khi cờ automation tắt -> trả về `{ status: 200, body: { ok: true } }`, KHÔNG gọi `queueHook`, KHÔNG ghi receipt chờ consent.
  - Test 8: Sự kiện `tokens_revoked` chỉ thu hồi user IDs trong `tokens.oauth` (bỏ qua `tokens.bot`), ghi intent và rào cản F3 nguyên tử với resolution tương ứng theo epoch, trả về 200.
  - Test 9: Sự kiện `message_deleted` và `message_changed` -> ghi nhận rào cản tombstone trực tiếp trước ACK 200, trả về 200.
  - Test 10: Database commit thất bại -> trả về `{ status: 500, error: 'DB_COMMIT_FAILED' }`, không trả 200 giả.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3 (GREEN Implementation):**
  - Triển khai `SlackIngressService`:
    ```ts
    export class SlackIngressService {
      constructor(private options: SlackIngressServiceOptions) {}

      async handleEvent(envelope: SlackEventEnvelope): Promise<{ status: number; body?: unknown; error?: string }> {
        // 1. Xử lý thử thách url_verification theo chuẩn Slack: không bắt buộc api_app_id
        if (envelope.type === 'url_verification') {
          if (envelope.api_app_id && envelope.api_app_id !== this.options.appId) {
            return { status: 400, error: 'App ID mismatch' };
          }
          if (typeof envelope.challenge !== 'string' || !envelope.challenge || envelope.challenge.length > 256) {
            return { status: 400, error: 'Invalid challenge parameter' };
          }
          return { status: 200, body: { challenge: envelope.challenge } };
        }

        // 2. Với event_callback thông thường: api_app_id và team_id là bắt buộc
        if (envelope.type !== 'event_callback' || !envelope.event || !envelope.event_id) {
          return { status: 200, body: { ok: true } }; // An toàn bỏ qua event envelope không thuộc phạm vi xử lý
        }
        if (!envelope.api_app_id || envelope.api_app_id !== this.options.appId) {
          return { status: 400, error: 'App ID mismatch or missing' };
        }
        if (!envelope.team_id || typeof envelope.team_id !== 'string') {
          return { status: 400, error: 'team_id is required' }; // Tuyệt đối không fallback sang authorizations[0]
        }

        const event = envelope.event;
        const teamId = envelope.team_id;
        const eventType = event.type;

        // Trích xuất timestamp có thẩm quyền bất biến; fail-closed nếu thiếu
        const sourceEventTs = event.event_ts || event.ts || (envelope.event_time ? String(envelope.event_time) : undefined);
        if (!sourceEventTs) {
          return { status: 400, error: 'Event timestamp is required' };
        }
        const sourceEventTime = new Date(parseFloat(sourceEventTs) * 1000);
        if (isNaN(sourceEventTime.getTime())) {
          return { status: 400, error: 'Invalid event timestamp' };
        }

        // 3. Phân loại sự kiện vòng đời F4: tokens_revoked, app_uninstalled, message_deleted, message_changed
        let lifecycleIntent: SlackLifecycleIntentPayload | undefined;
        let tombstone: RecordReceiptAtomicInput['tombstone'] | undefined;

        if (eventType === 'tokens_revoked') {
          const userIds = Array.isArray(event.tokens?.oauth) ? event.tokens!.oauth : [];
          if (userIds.length > 0 && envelope.event_time) {
            lifecycleIntent = {
              intentType: 'tokens_revoked',
              teamId,
              revokedUserIds: userIds,
              eventTime: envelope.event_time,
              resolution: 'disconnected',
            };
          }
        } else if (eventType === 'app_uninstalled') {
          const eventTime = envelope.event_time ?? Math.floor(sourceEventTime.getTime() / 1000);
          lifecycleIntent = { intentType: 'app_uninstalled', teamId, appId: this.options.appId, eventTime };
          tombstone = { channelId: '*', resourceId: `app:${this.options.appId}`, reason: 'uninstalled' };
        } else if (eventType === 'message' && event.subtype === 'message_deleted') {
          const channelId = event.channel || '';
          const messageTs = event.deleted_ts || event.previous_message?.ts || '';
          if (channelId && messageTs) {
            const deletedTs = event.deleted_ts || messageTs;
            lifecycleIntent = { intentType: 'message_deleted', teamId, channelId, messageTs, deletedTs, sourceEventTime };
            tombstone = { channelId, resourceId: deletedTs, minValidRevision: null, reason: 'deleted' };
          }
        } else if (eventType === 'message' && event.subtype === 'message_changed') {
          const channelId = event.channel || '';
          const messageTs = event.message?.ts || event.previous_message?.ts || '';
          const editTs = event.message?.edited?.ts || sourceEventTs;
          if (channelId && messageTs) {
            lifecycleIntent = { intentType: 'message_changed', teamId, channelId, messageTs, editTs, sourceEventTime };
            tombstone = { channelId, resourceId: messageTs, minValidRevision: editTs, reason: 'edited' };
          }
        }

        if (lifecycleIntent) {
          const { receipt } = await this.options.receiptRepo.recordReceiptAtomic({
            slackAppId: this.options.appId,
            eventId: envelope.event_id,
            teamId,
            eventType: event.subtype ? `message.${event.subtype}` : eventType,
            sourceEventTs,
            sourceEventTime,
            status: 'pending_lifecycle',
            lifecycleIntent,
            tombstone,
          });
          if (this.options.lifecycleHook) {
            await this.options.lifecycleHook.onLifecycleStaged({ id: receipt.id, teamId, payload: lifecycleIntent });
          }
          return { status: 200, body: { ok: true } };
        }

        // 4. Nhánh sự kiện thông thường: Kiểm tra cờ automation toàn cục
        if (!this.options.isAutomationEnabled()) {
          return { status: 200, body: { ok: true } }; // Discard trong memory khi automation tắt
        }

        // 5. Commit nguyên tử receipt với status pending_fanout
        const { inserted, receipt } = await this.options.receiptRepo.recordReceiptAtomic({
          slackAppId: this.options.appId,
          eventId: envelope.event_id,
          teamId,
          eventType,
          sourceEventTs,
          sourceEventTime,
          eventContext: envelope.event_context ?? null,
          channelId: event.channel ?? null,
          messageTs: event.ts ?? null,
          status: 'pending_fanout',
        });

        if (inserted && this.options.queueHook) {
          // Thông báo wakeup không có thẩm quyền thay thế DB
          this.options.queueHook.onEventReceived(receipt).catch(() => {});
        }

        return { status: 200, body: { ok: true } };
      }
    }
    ```
- [ ] **Step 4:** Chạy lại `npm test -w @wap/chat-api -- tests/services/slack-ingress-service.test.ts`; mong đợi PASS toàn bộ tests.

---

### Task 4: Express Raw Body Middleware & Ingress Route

**Files:**
- Create: `apps/chat-api/src/config/slack-ingress-env.ts`
- Create: `apps/chat-api/src/routes/slack-events.ts`
- Create: `apps/chat-api/tests/routes/slack-events-ingress.test.ts`

- [ ] **Step 1 (RED Test):** Viết integration test `apps/chat-api/tests/routes/slack-events-ingress.test.ts` với Supertest:
  - Test 1: Header `Content-Type: application/json` gửi body raw với chữ ký hợp lệ -> trả về 200.
  - Test 2: Payload stream vượt quá 1 MB -> trả về 413 `Payload Too Large` mà socket không bị phá sớm.
  - Test 3: Thiếu chữ ký hoặc chữ ký không khớp -> trả về 401 `Unauthorized`.
  - Test 4: Chữ ký đúng nhưng JSON body malformed -> trả về 400 `Bad Request`.
  - Test 5: Thử thách `url_verification` chuẩn không có app_id -> trả về 200 `{ challenge: 'foo' }`.
  - Test 6: Database repository ném lỗi kết nối -> trả về 500 hoặc 503.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3 (GREEN Implementation):**
  - Viết `apps/chat-api/src/routes/slack-events.ts`:
    - Tạo custom raw body collector middleware gắn vào router với timeout 5.000 ms.
    - Đọc headers `x-slack-signature` và `x-slack-request-timestamp`.
    - Gọi `verifySlackSignature(signatureHeader, timestampHeader, rawBody, signingSecret)`.
    - Gọi `JSON.parse(rawBody.toString('utf8'))`.
    - Gọi `ingressService.handleEvent(envelope)`.
    - Phản hồi mã trạng thái và JSON body tương ứng.
- [ ] **Step 4:** Chạy lại test supertest; mong đợi PASS.

---

### Task 5: Server DI Wiring & Express Mount Ordering

**Files:**
- Modify: `apps/chat-api/src/app.ts`
- Modify: `apps/chat-api/src/server.ts`

- [ ] **Step 1 (Integration Verification):**
  - Trong `apps/chat-api/src/app.ts`:
    - Khai báo option `slackEvents?: { service: SlackIngressService; signingSecret: string; appId: string }` trong `AppOptions`.
    - Mount router `/api/slack/events` **TRƯỚC** khi gọi `app.use(express.json())`:
      ```ts
      // Mount trước express.json() để giữ raw buffer nguyên vẹn cho HMAC verification
      if (options.slackEvents) {
        app.use('/api/slack/events', createSlackEventsRoutes(options.slackEvents));
      }
      app.use(express.json());
      ```
  - Trong `apps/chat-api/src/server.ts`:
    - Khởi tạo `SlackEventReceiptRepo(pool)` khi có kết nối PostgreSQL.
    - Khởi tạo `SlackIngressService` với `signingSecret` và `appId` đọc từ `validateEnv()`.
    - Truyền vào `createApp(...)`.
- [ ] **Step 2:** Kiểm tra typecheck toàn dự án: `npm run typecheck:v3`; mong đợi 0 lỗi.

---

### Task 6: Full Integration Suite on Real PostgreSQL & Supertest

**Files:**
- Create: `apps/chat-api/tests/routes/slack-events-lifecycle.test.ts`

- [ ] **Step 1 (RED Test):** Viết integration test `apps/chat-api/tests/routes/slack-events-lifecycle.test.ts` chạy trên PostgreSQL 16 thật:
  - Khởi tạo app Express thật có router Ingress mount trước `express.json()`.
  - Ca 1: Gửi 100 tin nhắn thường khi cờ automation bật -> tất cả nhận HTTP 200, trong DB có đúng 100 receipts (không có body tin nhắn).
  - Ca 2: Gửi tin nhắn thường khi cờ automation tắt -> nhận HTTP 200, trong DB không có receipt hoặc triage job nào được chèn.
  - Ca 3: Gửi sự kiện `tokens_revoked` với `tokens.oauth: ['U_ALICE']` khi cờ automation tắt -> nhận HTTP 200, kiểm tra `slack_connections` của Alice chuyển `status = 'disconnected'`, `config = NULL`, tăng `identity_version`, không ảnh hưởng tới `U_BOB`.
  - Ca 4: Gửi sự kiện `tokens_revoked` rơi vào cùng giây với thời điểm kết nối của Alice -> nhận HTTP 200, `slack_connections` chuyển sang `status = 'reconnect_required'`, `config = NULL`, ghi intent ambiguity.
  - Ca 5: Gửi sự kiện `message_deleted` khi cờ tắt -> nhận HTTP 200, kiểm tra bảng `slack_source_tombstones` có bản ghi tombstone cho `deleted_ts`, ngăn resurrection.
  - Ca 6: Gửi sự kiện `message_changed` -> nhận HTTP 200, kiểm tra bảng `slack_source_tombstones` có `min_valid_revision = edit_ts`, không lưu văn bản tin sửa đổi.
  - Ca 7: Gửi sự kiện `app_uninstalled` -> nhận HTTP 200, kiểm tra các kết nối trong workspace chuyển `status = 'disconnected'`, `config = NULL`, và ghi tombstone uninstalled.
- [ ] **Step 2:** Chạy `npm test -w @wap/chat-api -- tests/routes/slack-events-lifecycle.test.ts`; mong đợi PASS.
- [ ] **Step 3 (Full Check Verification):**
  - Chạy toàn bộ bộ test Slack backend:
    `npm test -w @wap/chat-api -- tests/services/slack-signature.test.ts tests/db/slack-event-receipt-repo.test.ts tests/routes/slack-events-ingress.test.ts tests/routes/slack-events-lifecycle.test.ts`
  - Chạy typecheck: `npm run typecheck:v3`
  - Kiểm tra whitespace git: `git diff --check b757ae08 HEAD`
- [ ] **Step 4:** Hoàn tất, chuẩn bị tài liệu bàn giao và mở Draft PR.

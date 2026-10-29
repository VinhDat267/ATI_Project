# SLACK-04A · Signed HTTP Ingress, Challenge Verification & Durable Commit ACK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây dựng hạ tầng tiếp nhận sự kiện webhook HTTPS ký số từ Slack Events API (`POST /api/slack/events`), thu thập buffer raw body trước khi phân tích JSON, xác minh chữ ký HMAC-SHA256 phiên bản `v0` cùng cửa sổ thời gian timestamp <= 300s, phản hồi thử thách `url_verification` tức thì mà không tạo job/receipt, thiết lập mô hình biên nhận không chứa nội dung (Body-Free Receipt) nhằm giải quyết triệt để xung đột giữa F1 consent và ngân sách ACK 3s của Slack, đảm bảo xử lý vòng đời F4 độc lập với cờ tính năng, và cam kết lưu trữ bền vững trước khi trả lời HTTP 200.

**Architecture:**
- **Mount Route trước JSON Middleware:** Điểm tiếp nhận `POST /api/slack/events` được định tuyến trong Express **TRƯỚC** khi gọi `app.use(express.json())`. Sử dụng middleware thu thập raw body buffer có giới hạn dung lượng cứng 1 MB (`Content-Length` > 1 MB hoặc stream vượt ngưỡng -> HTTP 413 `Payload Too Large`).
- **Mật mã HMAC-SHA256 & Timing-Safe:** Xác thực `X-Slack-Signature` và `X-Slack-Request-Timestamp` trực tiếp trên buffer nguyên bản. Bắt buộc kiểm tra độ dài digest buffer trước khi gọi `crypto.timingSafeEqual` để chống timing attack và ngăn crash `RangeError`. Độ lệch timestamp tối đa 300 giây.
- **Xác thực Thử thách URL:** Phân tích JSON chỉ sau khi chữ ký hợp lệ. Nếu `type === 'url_verification'`, lập tức trả về `{ challenge: payload.challenge }` với HTTP 200. Không ghi database receipt hay enqueue job cho sự kiện thử thách.
- **Kiến trúc Biên nhận Không chứa Nội dung (Body-Free Receipt):** Thay vì lưu văn bản tin nhắn thô (`text`) vi phạm F1 khi chưa có consent tổ chức, bảng `slack_event_receipts` chỉ lưu trữ các định danh định tuyến tối thiểu (`slack_app_id`, `event_id`, `team_id`, `event_type`, `event_ts`, `event_context`, `channel_id`, `message_ts`). Nội dung tin nhắn chỉ được đọc bất đồng bộ bởi worker ở Giai đoạn 04B bằng user token sau khi đã kiểm tra consent tổ chức.
- **Cam kết Bền vững Trước ACK (Durable Commit ACK):** Đối với các sự kiện cần xử lý, chỉ trả lời HTTP 200 SAU KHI receipt đã được commit an toàn vào PostgreSQL. Nếu database lỗi (down, pool exhausted, timeout) -> trả về HTTP 500/503 để Slack kích hoạt retry tự nhiên. Tuyệt đối không giả lập 200 khi chưa lưu được receipt.
- **Chống Trùng lặp Idempotency trên PostgreSQL:** Khóa duy nhất `UNIQUE (slack_app_id, event_id)` trên `slack_event_receipts`. Sự kiện retry cùng `event_id` được xử lý qua `ON CONFLICT DO NOTHING`, trả về HTTP 200 ngay lập tức mà không sinh duplicate queue work.
- **Độc lập Cờ Tính năng & Vòng đời F4:** Khi `MYSLACK_AUTOMATION_ENABLED=off` hoặc workspace đang pause:
  - Tin nhắn thường: Xác thực chữ ký hợp lệ -> trả về HTTP 200 và discard body ngay trong memory; không ghi receipt hay job vào DB.
  - Sự kiện vòng đời (`tokens_revoked`, `app_uninstalled`, `message_deleted`, `message_changed`): BẮT BUỘC ghi nhận intent bền vững trước khi trả về HTTP 200. `tokens_revoked` chỉ thu hồi chính xác các `user_id` bị ảnh hưởng, không thu hồi tràn lan toàn workspace.
- **Phân rã Ranh giới 04A vs 04B vs 04C:**
  - 04A (Kế hoạch này): Signed ingress, buffer handling, crypto verification, challenge response, durable body-free receipt commit, F4 lifecycle intent capture.
  - 04B (Kế hoạch sau): Authorizations fanout worker gọi `apps.event.authorizations.list` qua app-level token (`authorizations:read`) như hạ tầng nội bộ, map user connections, queue worker `SKIP LOCKED`.
  - 04C (Kế hoạch sau): Outbox ledger, Echo Guard phân biệt bot echo vs người dùng gõ tay, trạng thái ngắt mạng `UNKNOWN` không retry write mù.

**Tech Stack:** Node.js `^22.12.0 || >=24.0.0`, TypeScript 5.8, Express 5.2.1, PostgreSQL 16 (`pg.Pool`), Supertest 7, Vitest 4.
**Spec chuẩn tắc:** [Slack cá nhân và trợ lý công việc trong ATI](../specs/2026-10-28-slack-personal-oauth-design.md) (Mục 4.4, 5, 8, 9.1, 9.2, 10).
**Task card tương ứng:** [`docs/handoff/tasks/SLACK-04A-signed-ingress.md`](../../handoff/tasks/SLACK-04A-signed-ingress.md).
**Staging Base:** `b757ae081751168fdcbcfdddf73713d4a1d9109d`.

---

## Global Constraints & Security Invariants

1. **Mounting Order:** Router `slack-events.ts` phải được mount TRƯỚC `express.json()` trong `apps/chat-api/src/app.ts`. Tuyệt đối không cho phép `express.json()` chạy trước trên route này.
2. **Buffer nguyên bản (Raw Body Integrity):** Chữ ký HMAC SHA-256 `v0` phải được tính trên chính xác từng byte của buffer thô nhận được từ kết nối mạng. Không chuyển đổi chuỗi hay phân tích đối tượng trước khi kiểm tra chữ ký.
3. **Giới hạn dung lượng cứng (Bounded Buffer Limit):** Giới hạn tối đa 1.048.576 bytes (1 MB). Request vượt quá ngưỡng bị ngắt kết nối với HTTP 413 `Payload Too Large`.
4. **Bảo vệ chống Timing Attack:** Độ dài digest hex và header hex phải được so khớp trước khi gọi `crypto.timingSafeEqual` (`Buffer.byteLength(expected) === Buffer.byteLength(received)`).
5. **Cửa sổ Timestamp Chống Replay:** Bắt buộc `|Math.floor(Date.now() / 1000) - timestamp| <= 300`. Header thiếu hoặc sai định dạng ném mã lỗi HTTP 400 (`INVALID_TIMESTAMP`).
6. **Xác thực App ID Fail-Closed:** Payload `api_app_id` phải khớp với cấu hình máy chủ `MYSLACK_APP_ID`. Nếu thiếu cấu hình signing secret hoặc app ID, endpoint trả về HTTP 500/503 mà không bao giờ bỏ qua kiểm tra an ninh.
7. **Body-Free Receipt Persistence:** Bảng `slack_event_receipts` tuyệt đối không có cột lưu văn bản tin nhắn thô (`text` / `blocks`). Thỏa mãn yêu cầu F1 về bảo vệ dữ liệu khi chưa có chấp thuận tổ chức.
8. **Commit trước ACK (No ACK before DB Commit):** Chỉ trả lời HTTP 200 cho tin cần xử lý SAU KHI receipt đã được commit thành công vào PostgreSQL. Lỗi DB bắt buộc trả về 500/503.
9. **F4 Lifecycle Invariant:** Ingress và xử lý sự kiện vòng đời (`tokens_revoked`, `app_uninstalled`, `message_deleted`) vẫn hoạt động khi `MYSLACK_AUTOMATION_ENABLED=off` hoặc workspace đang pause.
10. **Không rò rỉ dữ liệu:** Không log raw body, access token, secret, hoặc nội dung tin nhắn ra console, log files, SSE hoặc public API responses.

---

## Review Focus & Attack Vectors

1. **Giả mạo Chữ ký & Timing Attack:** Request gửi chữ ký sai, digest ngắn hơn 64 hex, hoặc ký tự non-hex. *Kỳ vọng:* Không ném unhandled exception `RangeError`, trả về HTTP 401 `Unauthorized`.
2. **Tấn công Replay:** Kẻ tấn công gửi lại bản tin hợp lệ nhưng timestamp đã quá 300 giây (trong quá khứ hoặc tương lai). *Kỳ vọng:* Trả về HTTP 400 `Bad Request` (`INVALID_TIMESTAMP`).
3. **Tấn công Stream Flooding (DOS):** Request gửi stream body lớn hơn 1 MB hoặc `Content-Length: 2000000`. *Kỳ vọng:* Đóng kết nối ngay lập tức, trả về HTTP 413 `Payload Too Large`.
4. **Gián đoạn Cơ sở Dữ liệu (DB Outage During Ingress):** Giả lập PostgreSQL bị ngắt kết nối hoặc deadlock khi đang INSERT receipt. *Kỳ vọng:* Trả về HTTP 500/503, không trả 200, kích hoạt cơ chế retry của Slack.
5. **Request Trùng lặp Đồng thời (Concurrent Duplicate Webhooks):** Hai request cùng `event_id` đến đồng thời trên PostgreSQL thật. *Kỳ vọng:* Ràng buộc UNIQUE bắt được xung đột, cả hai đều trả về 200, nhưng chỉ có đúng 1 bản ghi receipt được tạo.
6. **Bảo toàn F1 khi Cờ Tắt:** Gửi tin nhắn thường khi `MYSLACK_AUTOMATION_ENABLED=off`. *Kỳ vọng:* Trả lời 200, trong database không có bất kỳ dòng nào chứa nội dung tin nhắn, không sinh queue job.
7. **Bảo vệ Vòng đời F4 khi Cờ Tắt:** Gửi sự kiện `tokens_revoked` cho một user khi cờ automation tắt. *Kỳ vọng:* Vẫn ghi nhận intent vòng đời bền vững trước khi trả lời 200, và chỉ thu hồi đúng user bị ảnh hưởng.

---

## File Structure & Module Ownership

| File | Module Ownership | Trách Nhiệm Kỹ Thuật |
|---|---|---|
| `db/v3/[proposed: NNNN_slack_event_receipts.sql]` | Backend | Migration tạo bảng `slack_event_receipts` (body-free) và `slack_lifecycle_intents` |
| `apps/chat-api/src/config/slack-ingress-env.ts` | Backend | Đọc và kiểm tra cấu hình signing secret, app ID từ biến môi trường |
| `apps/chat-api/src/services/slack/slack-signature.ts` | Backend | Mật mã HMAC-SHA256 v0, kiểm tra độ tươi timestamp 300s, timingSafeEqual |
| `apps/chat-api/src/db/repositories/slack-event-receipt-repo.ts` | Backend | Repository quản lý receipt trên PostgreSQL: atomic upsert, deduplication, lifecycle intent |
| `apps/chat-api/src/services/slack/slack-ingress-service.ts` | Backend | Điều phối xử lý sự kiện: challenge, F4 lifecycle, ordinary event discard, queue dispatch |
| `apps/chat-api/src/routes/slack-events.ts` | Backend | Router Express 5.2.1 với middleware raw buffer bounded và route `POST /api/slack/events` |
| `apps/chat-api/src/app.ts` (Modify) | Backend | Mount router `slack-events` TRƯỚC `express.json()`, inject dependencies |
| `apps/chat-api/src/server.ts` (Modify) | Backend | Khởi tạo repo và service ingress trong quá trình bootstrap máy chủ |
| `apps/chat-api/tests/services/slack-signature.test.ts` | Backend | Test unit chuyên sâu bộ kiểm tra mật mã chữ ký và timestamp |
| `apps/chat-api/tests/db/slack-event-receipt-repo.test.ts` | Backend | Test repository trên PostgreSQL 16 thật: concurrency, unique constraint, idempotency |
| `apps/chat-api/tests/routes/slack-events-ingress.test.ts` | Backend | Test tích hợp HTTP supertest: route mounting, challenge, invalid sig, replay, DB error |
| `apps/chat-api/tests/routes/slack-events-lifecycle.test.ts` | Backend | Test tích hợp HTTP: F4 lifecycle khi automation tắt/bật, precise actor revoke |

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
  event_time?: number;
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
    event_ts: string;
    user?: string;
    channel?: string;
    ts?: string;
    subtype?: string;
    deleted_ts?: string;
    message?: { ts: string; user?: string };
    previous_message?: { ts: string };
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
  event_ts: string;
  event_context: string | null;
  channel_id: string | null;
  message_ts: string | null;
  status: 'received' | 'enqueued' | 'discarded' | 'lifecycle_processed';
  discard_reason: string | null;
  created_at: Date;
  processed_at: Date | null;
}

export interface RecordReceiptInput {
  slackAppId: string;
  eventId: string;
  teamId: string;
  eventType: string;
  eventTs: string;
  eventContext?: string | null;
  channelId?: string | null;
  messageTs?: string | null;
  status?: 'received' | 'discarded' | 'lifecycle_processed';
  discardReason?: string | null;
}
```

### 3. Decoupled Consumer Hooks for 04B and 03B/02B
```ts
// apps/chat-api/src/services/slack/slack-ingress-service.ts
/** Consumer Hook cho Giai đoạn 04B (Queue & Authorizations Fanout) */
export interface SlackQueueIntentHook {
  onEventReceived(receipt: SlackEventReceiptRow): Promise<void>;
}

/** Consumer Hook cho Giai đoạn 03B/02B (Lifecycle Invalidation & Cascade Purge) */
export interface SlackLifecyclePurgeHook {
  onTokensRevoked(payload: { teamId: string; revokedUserIds: string[] }): Promise<void>;
  onAppUninstalled(payload: { teamId: string; appId: string }): Promise<void>;
  onMessageTombstone(payload: { teamId: string; channelId: string; messageTs: string }): Promise<void>;
}

/** Dependency Injection cho SlackIngressService */
export interface SlackIngressServiceOptions {
  receiptRepo: SlackEventReceiptRepo;
  appId: string;
  isAutomationEnabled: () => boolean;
  isWorkspacePaused?: (teamId: string) => Promise<boolean>;
  queueHook?: SlackQueueIntentHook;
  lifecycleHook?: SlackLifecyclePurgeHook;
  clock?: () => number;
}
```

---

## Detailed Task Breakdown

### Task 1: Proposed Database Migration & Receipt Repository (PostgreSQL 16)

**Files:**
- Create: `db/v3/NNNN_slack_event_receipts.sql` (Proposed migration)
- Create: `apps/chat-api/src/db/repositories/slack-event-receipt-repo.ts`
- Create: `apps/chat-api/tests/db/slack-event-receipt-repo.test.ts`

- [ ] **Step 1 (RED Test):** Viết database test `apps/chat-api/tests/db/slack-event-receipt-repo.test.ts` sử dụng `createMigratedSchema('slack_receipts')`:
  - Test 1: Tạo receipt mới thành công với các trường routing định danh tối thiểu, không có body text.
  - Test 2: Ràng buộc UNIQUE `(slack_app_id, event_id)` trên PG thật: Gọi `recordReceipt` lần 2 với cùng `(app_id, event_id)` -> trả về `{ inserted: false, receipt: existingRow }`, không ném unhandled duplicate key exception.
  - Test 3: Concurrency test: Dùng `Promise.all` bắn 10 lệnh INSERT cùng một `(app_id, event_id)` đồng thời -> đúng 1 câu lệnh thành công chèn mới (`inserted: true`), 9 câu lệnh còn lại trả về bản ghi đã chèn (`inserted: false`).
  - Test 4: Ghi nhận `slack_lifecycle_intents` liên kết với receipt row.
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
      event_ts text NOT NULL,
      event_context text,
      channel_id text,
      message_ts text,
      status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'enqueued', 'discarded', 'lifecycle_processed')),
      discard_reason text,
      created_at timestamptz NOT NULL DEFAULT now(),
      processed_at timestamptz,
      UNIQUE(slack_app_id, event_id)
    );

    CREATE INDEX IF NOT EXISTS idx_slack_event_receipts_lookup
      ON slack_event_receipts (slack_app_id, event_id);

    CREATE TABLE IF NOT EXISTS slack_lifecycle_intents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      receipt_id uuid REFERENCES slack_event_receipts(id) ON DELETE CASCADE,
      team_id text NOT NULL,
      intent_type text NOT NULL CHECK (intent_type IN ('tokens_revoked', 'app_uninstalled', 'message_deleted', 'message_changed')),
      payload_json jsonb NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'failed')),
      created_at timestamptz NOT NULL DEFAULT now(),
      applied_at timestamptz
    );
    ```
  - Triển khai `SlackEventReceiptRepo` với các phương thức `recordReceipt(input)`, `recordLifecycleIntent(receiptId, teamId, type, payload)`, `getReceipt(appId, eventId)`.
- [ ] **Step 4:** Chạy lại `npm test -w @wap/chat-api -- tests/db/slack-event-receipt-repo.test.ts`; mong đợi PASS toàn bộ tests trên PostgreSQL 16.

---

### Task 2: Cryptographic Signature & Freshness Verifier

**Files:**
- Create: `apps/chat-api/src/services/slack/slack-signature.ts`
- Create: `apps/chat-api/tests/services/slack-signature.test.ts`

- [ ] **Step 1 (RED Test):** Viết unit test `apps/chat-api/tests/services/slack-signature.test.ts`:
  - Test 1: Chữ ký hợp lệ đúng chuẩn `v0=...` tạo từ `crypto.createHmac('sha256', secret)` -> trả về `{ ok: true, timestamp }`.
  - Test 2: Thiếu header `X-Slack-Signature` hoặc `X-Slack-Request-Timestamp` -> trả về `{ ok: false, status: 400, code: 'MALFORMED_HEADER' }`.
  - Test 3: Timestamp không phải số nguyên (e.g. chuỗi chữ `abc`, số thực `123.45`, rỗng) -> trả về `{ ok: false, status: 400, code: 'INVALID_TIMESTAMP' }`.
  - Test 4: Timestamp quá hạn (> 300s trong quá khứ hoặc tương lai) -> trả về `{ ok: false, status: 400, code: 'INVALID_TIMESTAMP' }`.
  - Test 5: Chữ ký sai nội dung hoặc khác secret -> trả về `{ ok: false, status: 401, code: 'INVALID_SIGNATURE' }`.
  - Test 6: Chữ ký có độ dài digest khác 64 hex ký tự (ngắn hơn, dài hơn) -> trả về `{ ok: false, status: 401 }` mà không làm bung exception `RangeError` trong `crypto.timingSafeEqual`.
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
      if (!/^\d+$/.test(timestampHeader.trim())) {
        return { ok: false, status: 400, code: 'INVALID_TIMESTAMP', error: 'Timestamp header must be a valid integer' };
      }
      const timestamp = parseInt(timestampHeader.trim(), 10);
      const currentSeconds = Math.floor(nowMs / 1000);
      if (Math.abs(currentSeconds - timestamp) > 300) {
        return { ok: false, status: 400, code: 'INVALID_TIMESTAMP', error: 'Timestamp is outside the 300s freshness window' };
      }
      if (!signatureHeader.startsWith('v0=') || signatureHeader.length !== 67) {
        return { ok: false, status: 401, code: 'INVALID_SIGNATURE', error: 'Signature header has invalid format or length' };
      }
      const sigBasestring = `v0:${timestamp}:${rawBody.toString('utf8')}`;
      const expectedSignature = 'v0=' + createHmac('sha256', signingSecret).update(sigBasestring).digest('hex');

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

### Task 3: Ingress Service & Lifecycle Intent Dispatcher

**Files:**
- Create: `apps/chat-api/src/services/slack/slack-ingress-service.ts`
- Create: `apps/chat-api/tests/services/slack-ingress-service.test.ts`

- [ ] **Step 1 (RED Test):** Viết unit test `apps/chat-api/tests/services/slack-ingress-service.test.ts`:
  - Test 1: Sự kiện `type: 'url_verification'` -> trả về `{ status: 200, body: { challenge } }` ngay lập tức, không gọi DB receipt.
  - Test 2: Mismatched `api_app_id` -> trả về `{ status: 400, error: 'APP_ID_MISMATCH' }`.
  - Test 3: Sự kiện `message.*` hợp lệ khi cờ automation bật -> commit receipt bền vững, gọi `queueHook.onEventReceived`, trả về `{ status: 200, body: { ok: true } }`.
  - Test 4: Sự kiện `message.*` khi cờ automation tắt -> trả về `{ status: 200, body: { ok: true } }`, KHÔNG gọi `queueHook`, KHÔNG ghi receipt chờ consent.
  - Test 5: Sự kiện `tokens_revoked` khi cờ automation tắt -> trích xuất đúng danh sách `revokedUserIds`, lưu intent vào DB, gọi `lifecycleHook.onTokensRevoked`, trả về `{ status: 200, body: { ok: true } }`.
  - Test 6: Database lưu receipt bị lỗi ném ngoại lệ -> service trả về `{ status: 500, error: 'DB_COMMIT_FAILED' }`, không trả 200 giả.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3 (GREEN Implementation):**
  - Triển khai `SlackIngressService`:
    ```ts
    export class SlackIngressService {
      constructor(private options: SlackIngressServiceOptions) {}

      async handleEvent(envelope: SlackEventEnvelope): Promise<{ status: number; body?: unknown; error?: string }> {
        if (envelope.api_app_id && envelope.api_app_id !== this.options.appId) {
          return { status: 400, error: 'App ID mismatch' };
        }
        if (envelope.type === 'url_verification') {
          return { status: 200, body: { challenge: envelope.challenge ?? '' } };
        }
        if (envelope.type !== 'event_callback' || !envelope.event || !envelope.event_id) {
          return { status: 200, body: { ok: true } }; // An toàn bỏ qua event envelope chưa hỗ trợ
        }

        const event = envelope.event;
        const teamId = envelope.team_id || (envelope.authorizations?.[0]?.team_id ?? '');
        const eventType = event.type;
        const isLifecycle = ['tokens_revoked', 'app_uninstalled'].includes(eventType)
          || (eventType === 'message' && ['message_deleted', 'message_changed'].includes(event.subtype as string));

        // Nhánh sự kiện vòng đời F4: Vẫn xử lý dù cờ automation tắt hoặc workspace pause
        if (isLifecycle) {
          const { receipt } = await this.options.receiptRepo.recordReceipt({
            slackAppId: this.options.appId, eventId: envelope.event_id, teamId,
            eventType: event.subtype ? `message.${event.subtype}` : eventType,
            eventTs: event.event_ts || event.ts || String(Date.now()),
            status: 'lifecycle_processed',
          });
          if (eventType === 'tokens_revoked' && event.tokens?.oauth) {
            await this.options.receiptRepo.recordLifecycleIntent(receipt.id, teamId, 'tokens_revoked', { revokedUserIds: event.tokens.oauth });
            if (this.options.lifecycleHook) await this.options.lifecycleHook.onTokensRevoked({ teamId, revokedUserIds: event.tokens.oauth });
          } else if (eventType === 'app_uninstalled') {
            await this.options.receiptRepo.recordLifecycleIntent(receipt.id, teamId, 'app_uninstalled', { appId: this.options.appId });
            if (this.options.lifecycleHook) await this.options.lifecycleHook.onAppUninstalled({ teamId, appId: this.options.appId });
          }
          return { status: 200, body: { ok: true } };
        }

        // Nhánh sự kiện thông thường: Kiểm tra cờ automation và trạng thái pause
        const automationOn = this.options.isAutomationEnabled();
        const isPaused = this.options.isWorkspacePaused ? await this.options.isWorkspacePaused(teamId) : false;

        if (!automationOn || isPaused) {
          // Bỏ qua trong memory, không ghi body để chờ cấp quyền
          return { status: 200, body: { ok: true } };
        }

        // Cam kết lưu trữ bền vững receipt trước khi trả lời ACK 200
        const { inserted, receipt } = await this.options.receiptRepo.recordReceipt({
          slackAppId: this.options.appId,
          eventId: envelope.event_id,
          teamId,
          eventType,
          eventTs: event.event_ts || event.ts || String(Date.now()),
          eventContext: envelope.event_context ?? null,
          channelId: event.channel ?? null,
          messageTs: event.ts ?? null,
          status: 'received',
        });

        if (inserted && this.options.queueHook) {
          await this.options.queueHook.onEventReceived(receipt);
        }

        return { status: 200, body: { ok: true } };
      }
    }
    ```
- [ ] **Step 4:** Chạy lại `npm test -w @wap/chat-api -- tests/services/slack-ingress-service.test.ts`; mong đợi PASS.

---

### Task 4: Express Raw Body Middleware & Ingress Route

**Files:**
- Create: `apps/chat-api/src/config/slack-ingress-env.ts`
- Create: `apps/chat-api/src/routes/slack-events.ts`
- Create: `apps/chat-api/tests/routes/slack-events-ingress.test.ts`

- [ ] **Step 1 (RED Test):** Viết integration test `apps/chat-api/tests/routes/slack-events-ingress.test.ts` với Supertest:
  - Test 1: Header `Content-Type: application/json` gửi body raw với chữ ký hợp lệ -> trả về 200.
  - Test 2: Payload stream vượt quá 1 MB -> trả về 413 `Payload Too Large`.
  - Test 3: Thiếu chữ ký hoặc chữ ký không khớp -> trả về 401 `Unauthorized`.
  - Test 4: Chữ ký đúng nhưng JSON body malformed -> trả về 400 `Bad Request`.
  - Test 5: Thử thách `url_verification` -> trả về 200 `{ challenge: 'foo' }`.
  - Test 6: Database repository ném lỗi kết nối -> trả về 500 hoặc 503.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3 (GREEN Implementation):**
  - Viết `apps/chat-api/src/routes/slack-events.ts`:
    - Tạo custom raw body collector middleware gắn vào route trước khi kiểm tra chữ ký.
    - Đọc headers `x-slack-signature` và `x-slack-request-timestamp`.
    - Gọi `verifySlackSignature`. Nếu lỗi -> trả mã lỗi và return.
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
    - Di chuyển vị trí mount của route `/api/slack/events` **LÊN TRÊN ĐẦU `app.use(express.json())`**:
      ```ts
      // Phải mount trước express.json() để giữ raw buffer nguyên vẹn cho HMAC verification
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
  - Ca 3: Gửi sự kiện `tokens_revoked` với `tokens.oauth: ['U_ALICE']` khi cờ automation tắt -> nhận HTTP 200, kiểm tra bảng `slack_lifecycle_intents` có bản ghi `tokens_revoked` chứa đúng `U_ALICE`, không ảnh hưởng tới `U_BOB`.
  - Ca 4: Gửi sự kiện `message_deleted` khi cờ tắt -> nhận HTTP 200, kiểm tra bảng `slack_lifecycle_intents` có bản ghi tombstone cho `message_ts`.
- [ ] **Step 2:** Chạy `npm test -w @wap/chat-api -- tests/routes/slack-events-lifecycle.test.ts`; mong đợi PASS.
- [ ] **Step 3 (Full Check Verification):**
  - Chạy toàn bộ bộ test Slack backend:
    `npm test -w @wap/chat-api -- tests/services/slack-signature.test.ts tests/db/slack-event-receipt-repo.test.ts tests/routes/slack-events-ingress.test.ts tests/routes/slack-events-lifecycle.test.ts`
  - Chạy typecheck: `npm run typecheck:v3`
  - Kiểm tra whitespace git: `git diff --check b757ae08 HEAD`
- [ ] **Step 4:** Hoàn tất, chuẩn bị tài liệu bàn giao và mở Draft PR.

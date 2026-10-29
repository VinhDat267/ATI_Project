# SLACK-04A · Ingress Ký số, Xác thực Thử thách & Cam kết Bền vững ACK

**Trạng thái:** DỰ THẢO KẾ HOẠCH (Chờ Reviewer & Lead duyệt; chưa thực thi runtime code).
**Nhánh triển khai đề xuất:** `feat/slack-04a-signed-ingress` · **Nhánh tài liệu kế hoạch hiện tại:** `docs/slack-04a-ingress-plan`.
**Nền đối chiếu đã thẩm định (Staging base):** `b757ae081751168fdcbcfdddf73713d4a1d9109d` (bao gồm PR #187 contracts 02A, PR #190 callback isolation fix, PR #185 inventory 354 methods, PR #188 macro delivery roadmap).
**Vai trò sở hữu module:** Backend Engineer (sở hữu duy nhất `apps/chat-api/`, `db/v3/` và các scripts/fixtures liên quan; không sửa chéo `packages/tool-schemas`, `packages/tool-adapters`, `packages/executor`, `apps/chat-web`).
**Task cha:** [SLACK-04 · Ingress Ký số, Phân phối Quyền và An toàn Thực thi](SLACK-04-ingress-lifecycle-and-execution-safety.md).
**Kế hoạch kỹ thuật chi tiết:** [Kế hoạch Triển khai SLACK-04A](../../superpowers/plans/2026-10-29-slack-04a-signed-ingress.md).
**Đặc tả chuẩn tắc:** [Slack cá nhân và trợ lý công việc trong ATI](../../superpowers/specs/2026-10-28-slack-personal-oauth-design.md) (Mục 4.4, 5, 8, 9.1, 9.2, 10).
**Lộ trình tổng thể:** [Slack Remaining Delivery Plan](../../superpowers/plans/2026-10-29-slack-remaining-delivery.md) (Task 6 / Giai đoạn 04A).

> **LƯU Ý ĐIỀU KIỆN TIÊN QUYẾT (Prerequisite Boundary):**
> Việc lập kế hoạch SLACK-04A được thực hiện song song trên nhánh phân lập. Tuy nhiên, **TUYỆT ĐỐI KHÔNG thi công mã nguồn runtime SLACK-04A** cho tới khi:
> 1. SLACK-02B (Backend OAuth & Consent F1) và SLACK-03A (Source Schema contracts) được reviewer độc lập nghiệm thu và hợp nhất vào base staging;
> 2. SLACK-03C (Bộ adapter đọc cốt lõi `conversations`, `chat`, `users`) hoàn tất để cung cấp client đọc.
> Không yêu cầu merge vào nhánh `main` để tiến hành xếp chồng các nhánh đã qua review.

---

## 1. Mục tiêu và Phạm vi Kỹ thuật Bounded 04A

Card này bóc tách và định nghĩa trọn vẹn ranh giới kỹ thuật của **Giai đoạn 04A** từ task cha SLACK-04: thiết lập điểm tiếp nhận sự kiện webhook HTTPS ký số (`POST /api/slack/events`), thu thập buffer raw body trước khi phân tích JSON, xác minh chữ ký HMAC-SHA256 phiên bản `v0` cùng cửa sổ độ tươi timestamp, phản hồi thử thách `url_verification` tức thì, và thiết lập hợp đồng cam kết bền vững biên nhận (durable receipt commit) trước khi trả về ACK HTTP 200 trong vòng ngân sách 3 giây của Slack.

### 1.1. Các Nguyên tắc Bất biến (Core Technical Invariants)

1. **Thu thập Raw Buffer & Thứ tự Mount Middleware:**
   - Route `POST /api/slack/events` **BẮT BUỘC ĐƯỢC MOUNT TRƯỚC `app.use(express.json())`** trong `apps/chat-api/src/app.ts`.
   - Sử dụng middleware thu thập raw body có giới hạn dung lượng cứng (bounded payload limit, mặc định trần 1 MB). Nếu `Content-Length` hoặc stream thực tế vượt quá 1 MB -> lập tức ngắt kết nối và trả về HTTP 413 `Payload Too Large`.
   - Lưu trữ buffer nguyên bản chính xác (`req.rawBody = Buffer.concat(...)`) để tính toán mã băm. Tuyệt đối không parse JSON, không log payload, và không ghi DB trước khi chữ ký được xác thực thành công.

2. **Xác thực Chữ ký Kỹ thuật số & Chống Replay:**
   - Thu thập 2 HTTP headers: `X-Slack-Signature` và `X-Slack-Request-Timestamp`.
   - Kiểm tra định dạng: `X-Slack-Request-Timestamp` phải là chuỗi số nguyên hợp lệ biểu diễn giây Unix UTC. Độ lệch thời gian `|Math.floor(Date.now() / 1000) - timestamp|` phải `<= 300` giây (5 phút). Nếu header thiếu, không phải số nguyên, hoặc lệch quá 300 giây -> từ chối bằng HTTP 400 `Bad Request` (`INVALID_TIMESTAMP`).
   - Kiểm tra header chữ ký: Phải bắt đầu bằng tiền tố `v0=` và có đúng 64 ký tự hex digest (`v0=[0-9a-f]{64}`).
   - Tính toán digest kỳ vọng:
     ```ts
     const sigBasestring = `v0:${timestamp}:${rawBody.toString('utf8')}`;
     const expectedDigest = 'v0=' + crypto.createHmac('sha256', signingSecret).update(sigBasestring).digest('hex');
     ```
   - **Bảo vệ chống tấn công Timing Attack:** Bắt buộc kiểm tra `Buffer.byteLength(expectedDigest) === Buffer.byteLength(headerSignature)` trước khi gọi `crypto.timingSafeEqual` để loại bỏ hoàn toàn ngoại lệ `RangeError: Input buffers must have the same length`.
   - Nếu chữ ký không khớp -> từ chối bằng HTTP 401 `Unauthorized` (`INVALID_SIGNATURE`).
   - Nếu máy chủ chưa cấu hình `SLACK_SIGNING_SECRET` hoặc cấu hình rỗng -> fail-closed với HTTP 500/503 `CONFIG_MISSING`, không bao giờ bypass chữ ký.

3. **Xác thực App ID & Phản hồi URL Verification Challenge:**
   - Chỉ phân tích cú pháp JSON payload (`JSON.parse(req.rawBody.toString('utf8'))`) **SAU KHI** chữ ký đã vượt qua kiểm tra mật mã. Nếu JSON malformed -> HTTP 400 `Bad Request` (`MALFORMED_JSON`).
   - Kiểm tra `api_app_id` trong payload: Bắt buộc khớp với `MYSLACK_APP_ID` đã cấu hình. Nếu không khớp -> HTTP 400 `Bad Request` (`APP_ID_MISMATCH`).
   - Nhánh `url_verification`: Khi `payload.type === 'url_verification'`, trích xuất chuỗi `payload.challenge` và phản hồi ngay lập tức JSON `{ challenge: payload.challenge }` với HTTP 200. **TUYỆT ĐỐI KHÔNG** ghi database receipt, không tạo job, không gọi queue cho sự kiện thử thách.

4. **Kiến trúc Biên nhận Không chứa Nội dung (Body-Free Receipt) & Giải quyết Xung đột F1 vs ACK 3s:**
   - *Vấn đề xung đột:* Đặc tả F1 (Mục 4.4 & 9.1) nghiêm cấm lưu trữ nội dung Slack vào database khi chưa có chấp thuận của tổ chức (organization consent). Tuy nhiên, Slack Events API đòi hỏi phải trả lời ACK 200 trong vòng 3 giây, trong khi việc phân giải quyền fanout và kiểm tra consent diễn ra bất đồng bộ.
   - *Giải pháp kiến trúc:* Tầng Ingress **TUYỆT ĐỐI KHÔNG** lưu trữ văn bản tin nhắn thô (`text`), blocks, files hoặc attachments vào bảng receipt!
   - Bảng `slack_event_receipts` chỉ lưu trữ các định danh định tuyến bền vững tối thiểu (Minimal Durable Routing Identifiers):
     `id, slack_app_id, event_id, team_id, event_type, event_ts, event_context, channel_id, message_ts, status, created_at, processed_at`.
   - Không tồn tại cột `raw_payload` hay `body_json` không giới hạn trong bảng receipt. Việc đọc nội dung phục vụ xử lý nghiệp vụ sẽ do worker thực hiện bất đồng bộ bằng user token đã được xác thực chấp thuận tổ chức (F1 authorized retrieval) khi cần thiết.
   - Biên nhận lưu trữ có thời hạn hữu hạn (bounded retention trần 7 ngày), được dọn dẹp định kỳ bởi scheduled vacuum / maintenance.

5. **Quy tắc ACK Bền vững & Ngân sách 3 Giây:**
   - Đối với các sự kiện yêu cầu xử lý công việc: **CHỈ TRẢ LỜI ACK HTTP 200 `{ ok: true }` SAU KHI** receipt đã được commit thành công vào PostgreSQL.
   - Nếu database xảy ra lỗi (mất kết nối pool, deadlock, timeout) -> endpoint **BẮT BUỘC TRẢ VỀ HTTP 500 HOẶC 503**, không bao giờ giả lập thành công (never fake success). Mã lỗi 5xx là tín hiệu chuẩn tắc để Slack kích hoạt chính sách gửi lại (exponential backoff retry).
   - Ngân sách xử lý Ingress: Toàn bộ chuỗi thao tác (xác thực HMAC + parse JSON + kiểm tra app ID + INSERT receipt) chỉ mất < 50ms trên máy chủ, đảm bảo nằm sâu bên trong ngân sách 3 giây của Slack mà không cần dùng mock timing.
   - Khóa duy nhất idempotency: Bảng receipt sử dụng ràng buộc `UNIQUE (slack_app_id, event_id)`. Khi Slack gửi retry cùng một `event_id`, câu lệnh `INSERT ... ON CONFLICT (slack_app_id, event_id) DO NOTHING` nhận biết bản ghi đã tồn tại và trả về HTTP 200 ngay lập tức, không kích hoạt lặp queue intent.

6. **Độc lập Cờ Tính năng & Vòng đời F4 (Flag-Independent Lifecycle Invariant):**
   - Ingress endpoint và luồng xử lý vòng đời/quyền riêng tư tồn tại độc lập với cờ `MYSLACK_ENABLED` và `MYSLACK_AUTOMATION_ENABLED`. Khi ứng dụng ATI vẫn được cài đặt trên workspace Slack, endpoint không được trả lỗi 404/500 hàng loạt chỉ vì cờ ứng dụng đang tắt.
   - **Khi cờ tắt, workspace tạm dừng (pause), hoặc consent tổ chức chưa cấp:**
     - *Tin nhắn thường (`message.*`):* Được xác thực chữ ký đầy đủ -> trả lời ACK 200 và **hủy bỏ ngay trong bộ nhớ (discard in memory)**. Tuyệt đối không ghi nội dung vào DB để chờ kích hoạt quyền trong tương lai!
     - *Sự kiện vòng đời (`tokens_revoked`, `app_uninstalled`, `message_deleted`, `message_changed`):* **BẮT BUỘC ĐƯỢC GHI NHẬN BỀN VỮNG** và phát ra tín hiệu vô hiệu hóa / purge intent TRƯỚC KHI gửi lời phản hồi ACK 200!
     - *Độ chính xác danh tính:* Sự kiện `tokens_revoked` chỉ ảnh hưởng đến đúng các `user_id` bị thu hồi (được trích xuất từ payload `tokens.oauth` / `tokens.bot`), tăng `identity_version` và đánh dấu `status = 'revoked'` cho đúng kết nối đó; TUYỆT ĐỐI KHÔNG thu hồi tràn lan toàn bộ người dùng trong workspace.
     - Sự kiện chưa xác định (unknown event types): Được xác thực chữ ký và bỏ qua an toàn với log siêu dữ liệu tối thiểu (bounded metadata: `event_type`, `event_id`), không ghi log raw payload.

7. **Bảo mật Dữ liệu & Nghiêm cấm Rò rỉ Thông tin:**
   - Tuyệt đối không log raw body, access token, user token, refresh token hay nội dung tin nhắn ra console, file log, SSE hay public APIs.
   - Mọi log ghi nhận chỉ bao gồm metadata kiểm toán: `eventId`, `eventType`, `teamId`, `statusCode`, `latencyMs`, `outcome`.

8. **Ranh giới Phân phối Quyền 04B & An toàn Thực thi 04C:**
   - Card 04A **CHỈ** định nghĩa interface yêu cầu cho hàng đợi (`SlackQueueIntentHook`) và purge runner (`SlackLifecyclePurgeHook`), không triển khai chi tiết worker fanout hay bảng job của 04B.
   - Phương thức Slack `apps.event.authorizations.list` được ghi nhận chuẩn xác là **Hạ tầng Nội bộ (Internal Infrastructure)** đòi hỏi app-level token (`authorizations:read`) truyền qua header `Authorization: Bearer <app_token>`, hoàn toàn không phải công cụ nghiệp vụ hay capability user token. Bảng kiểm kê method inventory snapshot giữ nguyên trạng thái `excluded`.
   - Các cơ chế sổ cái outbox, chặn lặp echo và trạng thái ngắt mạng `UNKNOWN` được bảo lưu nguyên vẹn cho Giai đoạn 04C; không cho phép kích hoạt bất kỳ phương thức ghi nào trước khi 04C được thẩm định.

---

## 2. Ranh giới Phân quyền Module & Tệp Sở hữu (Module Ownership)

Toàn bộ công việc thuộc sở hữu duy nhất của **Backend Engineer**:

### 2.1. Tệp Cơ sở Dữ liệu & Migration (Backend Owned)
- **Tạo mới:** `db/v3/[proposed: NNNN_slack_event_receipts.sql]`
  *(Đánh số thứ tự đề xuất `NNNN` để tích hợp tuần tự sau khi chốt backend head 0016 của SLACK-02B và 0017 của SLACK-03B; cho phép xếp chồng nhánh an toàn).*

### 2.2. Tệp Mã nguồn Sản phẩm (`apps/chat-api/src/`) (Backend Owned)
- **Tạo mới:** `apps/chat-api/src/services/slack/slack-signature.ts` (Bộ kiểm tra mật mã chữ ký HMAC-SHA256 v0, timingSafeEqual và cửa sổ timestamp 300s).
- **Tạo mới:** `apps/chat-api/src/db/repositories/slack-event-receipt-repo.ts` (Repository lưu trữ receipt bền vững, kiểm soát idempotency và atomic upsert trên PostgreSQL).
- **Tạo mới:** `apps/chat-api/src/services/slack/slack-ingress-service.ts` (Service điều phối tiếp nhận, phân loại challenge/lifecycle/ordinary event, tích hợp F4 và phát intent).
- **Tạo mới:** `apps/chat-api/src/routes/slack-events.ts` (Router Express 5.2.1 với middleware thu thập raw buffer và endpoint `POST /api/slack/events`).
- **Tạo mới:** `apps/chat-api/src/config/slack-ingress-env.ts` (Helper trích xuất và kiểm tra cấu hình signing secret, app ID từ môi trường).
- **Cập nhật:** `apps/chat-api/src/app.ts` (Mount router `slack-events.ts` **TRƯỚC** `express.json()`, tiêm dependencies).
- **Cập nhật:** `apps/chat-api/src/server.ts` (Khởi tạo `SlackEventReceiptRepo`, `SlackIngressService` và truyền cấu hình khi bootstrap).

### 2.3. Tệp Kiểm thử TDD (`apps/chat-api/tests/`) (Backend Owned)
- **Tạo mới:** `apps/chat-api/tests/services/slack-signature.test.ts` (Kiểm thử đơn vị chuyên sâu chữ ký HMAC v0, timing attack buffer length, lệch timestamp, non-integer).
- **Tạo mới:** `apps/chat-api/tests/db/slack-event-receipt-repo.test.ts` (Kiểm thử repository receipt trên PostgreSQL 16 thật qua `createMigratedSchema`: unique constraint, upsert idempotency, retry không trùng lặp, concurrency).
- **Tạo mới:** `apps/chat-api/tests/routes/slack-events-ingress.test.ts` (Kiểm thử tích hợp HTTP supertest cho route: mount trước express.json, raw body preservation, challenge 200, invalid signature 401, replay 400, app id mismatch 400, DB failure 500/503).
- **Tạo mới:** `apps/chat-api/tests/routes/slack-events-lifecycle.test.ts` (Kiểm thử F4 độc lập cờ: cờ tắt -> discard tin thường, commit purge/revoke intent cho lifecycle events).

---

## 3. Giao diện Kỹ thuật & Hợp đồng Dữ liệu (Typed Interfaces)

```ts
/** Cấu hình nạp từ biến môi trường máy chủ phục vụ xác thực Ingress */
export interface SlackIngressConfig {
  signingSecret: string;
  appId: string;
  maxBodyBytes?: number; // Mặc định: 1048576 (1 MB)
  clock?: () => number;  // Phục vụ kiểm thử giả lập thời gian determinism
}

/** Kết quả xác thực mật mã chữ ký */
export type SlackSignatureVerificationResult =
  | { ok: true; timestamp: number }
  | { ok: false; status: 400 | 401; error: string; code: 'INVALID_TIMESTAMP' | 'INVALID_SIGNATURE' | 'MALFORMED_HEADER' };

/** Cấu trúc tối thiểu của Slack Events API Request Body */
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

/** Dòng biên nhận bền vững trong PostgreSQL (Body-Free) */
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

/** Hợp đồng Consumer Queue Intent cho Giai đoạn 04B */
export interface SlackQueueIntentHook {
  onEventReceived(receipt: SlackEventReceiptRow): Promise<void>;
}

/** Hợp đồng Consumer Lifecycle Purge Hook cho Giai đoạn 03B/02B */
export interface SlackLifecyclePurgeHook {
  onTokensRevoked(payload: { teamId: string; revokedUserIds: string[] }): Promise<void>;
  onAppUninstalled(payload: { teamId: string; appId: string }): Promise<void>;
  onMessageTombstone(payload: { teamId: string; channelId: string; messageTs: string }): Promise<void>;
}

/** Tham chiếu chính sách F1 chuẩn tắc phục vụ xác thực DB evidence khi fanout/xử lý */
export interface SlackCanonicalPolicyReference {
  binding: {
    atiUserId: string;
    connectionId: string;
    workspaceId: string;
    slackUserId: string;
    identityVersion: number;
  };
  purpose: 'manual_lookup' | 'triage' | 'planning' | 'digest' | 'storage';
  requestedRetentionDays: number;
  providerProfileId: string;
  configFingerprint: string;
  policyVersion: string;
  consentRevision: string;   // Chuỗi số thập phân chuẩn tắc, ví dụ '1', '2'
  providerRevision: string;  // Chuỗi số thập phân chuẩn tắc
}
```

---

## 4. Đặc tả Cơ sở Dữ liệu (`db/v3/NNNN_slack_event_receipts.sql`)

```sql
-- Migration đề xuất NNNN: Bảng biên nhận sự kiện Slack (Body-Free Receipt Store)
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

CREATE INDEX IF NOT EXISTS idx_slack_event_receipts_status_created
  ON slack_event_receipts (status, created_at);

-- Bảng ghi nhận intent vòng đời bền vững (Durable Lifecycle Intents) khi cờ tắt/pause
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

CREATE INDEX IF NOT EXISTS idx_slack_lifecycle_intents_pending
  ON slack_lifecycle_intents (status, created_at)
  WHERE status = 'pending';
```

---

## 5. Tiêu chí Nghiệm thu Cụ thể (Acceptance Criteria)

- [ ] **AC1 (Mounting Order & Raw Buffer Integrity):** Route `/api/slack/events` được kích hoạt trước `express.json()`. Body stream được thu thập thành raw buffer nguyên vẹn byte-for-byte; request vượt quá 1 MB bị từ chối bằng HTTP 413.
- [ ] **AC2 (Xác thực Chữ ký HMAC & Timing-Safe):** Chữ ký sai hoặc thiếu header -> 401 Unauthorized; timestamp lệch > 300s hoặc không phải số nguyên -> 400 Bad Request; so sánh chữ ký bằng `timingSafeEqual` sau khi kiểm tra độ dài buffer digest không gây crash.
- [ ] **AC3 (Xác thực App ID & Thử thách URL):** App ID không khớp -> 400 Bad Request; `type: url_verification` hợp lệ -> trả về HTTP 200 `{ challenge: ... }` tức thì mà không ghi receipt vào database.
- [ ] **AC4 (Cam kết Bền vững Receipt & Ngân sách 3 Giây):** Sự kiện cần xử lý chỉ trả lời HTTP 200 SAU KHI receipt đã được commit an toàn vào PostgreSQL. Khi DB gặp sự cố hoặc pool kiệt quệ -> trả về HTTP 500/503 để Slack retry; tuyệt đối không fake 200.
- [ ] **AC5 (Idempotency & Chống Trùng lặp Thực tế):** Hai request gửi đến đồng thời hoặc tuần tự với cùng `(slack_app_id, event_id)` trên PostgreSQL thật được xử lý an toàn: request đầu tiên commit receipt, request thứ hai phát hiện xung đột và trả về 200 ngay lập tức mà không sinh duplicate queue intent.
- [ ] **AC6 (Bảo toàn Kiến trúc Body-Free Receipt):** Bảng `slack_event_receipts` tuyệt đối không chứa trường lưu trữ body tin nhắn thô. Thỏa mãn 100% yêu cầu F1 về việc không lưu trữ nội dung Slack khi chưa có consent tổ chức.
- [ ] **AC7 (Vòng đời Độc lập Cờ F4):** Khi `MYSLACK_AUTOMATION_ENABLED=off` hoặc workspace đang pause:
  - Tin nhắn thường nhận HTTP 200 và discard body ngay trong memory (không ghi receipt/job).
  - Sự kiện `tokens_revoked`, `app_uninstalled`, `message_deleted` được commit intent bền vững trước khi trả về HTTP 200.
  - `tokens_revoked` chỉ thu hồi chính xác kết nối của các `user_id` bị ảnh hưởng, bảo toàn các thành viên khác trong workspace.
- [ ] **AC8 (Bảo vệ Log & Bí mật):** Không có access token, signing secret, hay nội dung tin nhắn nào xuất hiện trong log console, exception message hay API response.

---

## 6. Lệnh Kiểm tra và Cổng Bằng chứng (Command & Evidence Gates)

> Sử dụng PostgreSQL 16 thật thông qua helper `createMigratedSchema` và HTTP supertest tích hợp. Tuyệt đối không dùng boolean mock.

```powershell
# 1. Chạy unit test kiểm tra mật mã chữ ký HMAC-SHA256, timingSafeEqual và freshness window
npm test -w @wap/chat-api -- tests/services/slack-signature.test.ts

# 2. Chạy database test kiểm tra repository receipt, concurrency, idempotency trên PostgreSQL 16
npm test -w @wap/chat-api -- tests/db/slack-event-receipt-repo.test.ts

# 3. Chạy integration HTTP route test kiểm tra mounting, challenge, invalid sig, replay, DB error
npm test -w @wap/chat-api -- tests/routes/slack-events-ingress.test.ts

# 4. Chạy integration test kiểm tra F4 lifecycle độc lập cờ tính năng
npm test -w @wap/chat-api -- tests/routes/slack-events-lifecycle.test.ts

# 5. Kiểm tra toàn diện TypeScript và chuẩn quy ước dự án
npm run typecheck:v3
git diff --check b757ae08 HEAD
```

---

## 7. Kết quả Thực thi (Dành cho Agent Thi công)

*(Phần này được cập nhật bởi Backend Implementer sau khi hoàn thành chu trình TDD RED → GREEN, cung cấp đầy đủ commit hash, log test thực tế và số liệu CI).*

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

Card này bóc tách và định nghĩa trọn vẹn ranh giới kỹ thuật của **Giai đoạn 04A** từ task cha SLACK-04: thiết lập điểm tiếp nhận sự kiện webhook HTTPS ký số (`POST /api/slack/events`), thu thập buffer raw body trước khi phân tích JSON, xác minh chữ ký HMAC-SHA256 phiên bản `v0` cùng cửa sổ độ tươi timestamp, phản hồi thử thách `url_verification` tức thì, thiết lập rào cản vô hiệu hóa F3 trước ACK, và đảm bảo cam kết bền vững giao dịch biên nhận (atomic durable receipt commit) trước khi trả lời ACK HTTP 200 trong vòng ngân sách 3 giây của Slack.

### 1.1. Các Nguyên tắc Bất biến (Core Technical Invariants)

1. **Thu thập Raw Buffer & Thứ tự Mount Middleware:**
   - Route `POST /api/slack/events` **BẮT BUỘC ĐƯỢC MOUNT TRƯỚC `app.use(express.json())`** trong `apps/chat-api/src/app.ts`.
   - Sử dụng middleware thu thập raw body có giới hạn dung lượng cứng (bounded payload limit, mặc định trần 1 MB = 1.048.576 bytes).
   - Middleware đọc stream phải cấu hình timeout rõ ràng (mặc định 5.000 ms) và lắng nghe sự kiện stream bị hủy (`req.on('aborted')`, `req.on('error')`).
   - Xử lý HTTP 413 chuẩn tắc: Khi `Content-Length` hoặc số byte stream thực tế vượt quá 1 MB, middleware lập tức ngưng đọc stream, unpipe, gửi phản hồi HTTP 413 `Payload Too Large` `{ error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' }`, và chỉ đóng/hủy kết nối socket SAU KHI phản hồi 413 đã hoàn tất gửi đi (`res.on('finish')`), tuyệt đối không destroy socket trước khi gửi phản hồi khiến client mất mã trạng thái.
   - Buffer nguyên bản chính xác (`req.rawBody = Buffer.concat(...)`) được lưu giữ để tính toán chữ ký. Tuyệt đối không parse JSON, không log payload, và không ghi DB trước khi chữ ký được xác thực thành công.

2. **Xác thực Chữ ký Kỹ thuật số Không Roundtrip & Cửa sổ Timestamp Bounded:**
   - Thu thập 2 HTTP headers: `X-Slack-Signature` và `X-Slack-Request-Timestamp`.
   - **Xác thực Định dạng Timestamp Bounded:** `X-Slack-Request-Timestamp` bắt buộc phải khớp chính xác biểu thức chính quy số nguyên không dấu: `/^\d{1,10}$/`. Bất kỳ ký tự khoảng trắng ở đầu/cuối (`' 1730214000 '`), dấu cộng (`+1730214000`), số thập phân (`1730214000.5`), ký tự xuống dòng hoặc chuỗi không phải chữ số đều bị từ chối bằng HTTP 400 `Bad Request` (`INVALID_TIMESTAMP`).
   - **Cửa sổ Độ tươi (Freshness Window):** `|Math.floor(Date.now() / 1000) - Number(timestampHeader)| <= 300` giây (5 phút). Lệch quá 300s trong quá khứ hoặc tương lai ném mã lỗi HTTP 400 `Bad Request` (`INVALID_TIMESTAMP`).
   - **Header Chữ ký:** Bắt buộc bắt đầu bằng tiền tố `v0=` và có đúng 64 ký tự hex digest (tổng độ dài chính xác 67 ký tự: `^v0=[0-9a-f]{64}$`). Sai định dạng hoặc thiếu ném HTTP 401 `Unauthorized` (`INVALID_SIGNATURE`).
   - **Băm Trực tiếp Buffer Tuyệt đối Không Roundtrip UTF-8:**
     Chữ ký HMAC-SHA256 phải được băm trực tiếp từ chuỗi tiền tố với header gốc kết hợp buffer nhị phân nguyên bản, không bao giờ gọi `.toString('utf8')` trước khi băm nhằm bảo vệ tính toàn vẹn khi payload chứa byte non-ASCII hoặc chuỗi byte nhị phân đặc biệt:
     ```ts
     const hmac = crypto.createHmac('sha256', signingSecret);
     hmac.update(`v0:${timestampHeader}:`);
     hmac.update(rawBody);
     const expectedDigest = 'v0=' + hmac.digest('hex');
     ```
   - **Bảo vệ chống Timing Attack:** So sánh chữ ký bằng `crypto.timingSafeEqual` sau khi đã đối soát độ dài buffer (`Buffer.byteLength(expectedDigest) === Buffer.byteLength(headerSignature)`), loại bỏ hoàn toàn ngoại lệ `RangeError`. Chữ ký sai ném HTTP 401 `Unauthorized` (`INVALID_SIGNATURE`).
   - **Fail-Closed khi Thiếu Cấu hình:** Nếu máy chủ chưa cấu hình `SLACK_SIGNING_SECRET` hoặc `MYSLACK_APP_ID`, endpoint trả về HTTP 500/503 `CONFIG_MISSING`, không bao giờ bypass kiểm tra an ninh.

3. **Thử thách URL Verification Không Cần App ID & Ràng buộc Sự kiện Thường:**
   - Cú pháp JSON payload (`JSON.parse(...)`) chỉ được thực thi **SAU KHI** chữ ký đã vượt qua kiểm tra mật mã. JSON malformed ném HTTP 400 `Bad Request` (`MALFORMED_JSON`).
   - **Nhánh `url_verification` chuẩn tắc theo Slack Docs:** Theo tài liệu chính thức của Slack ([URL Verification Event](https://docs.slack.dev/reference/events/url_verification/)), payload thử thách chỉ bao gồm `{ token, challenge, type }` và KHÔNG bắt buộc có `api_app_id`.
     - Chấp nhận `payload.type === 'url_verification'` với `challenge` là chuỗi không rỗng, độ dài hợp lệ (1..256 ký tự).
     - Nếu payload thử thách CÓ truyền `api_app_id`, nó phải khớp với `MYSLACK_APP_ID` đã cấu hình (sai thì từ chối HTTP 400 `APP_ID_MISMATCH`). Nếu KHÔNG truyền `api_app_id`, chấp nhận và phản hồi ngay lập tức JSON `{ challenge: payload.challenge }` với HTTP 200.
     - Tuyệt đối không ghi database receipt, không gọi hàng đợi, không tạo job cho sự kiện thử thách.
   - **Nhánh Sự kiện Thường (`event_callback`):**
     - BẮT BUỘC có trường `api_app_id` và phải khớp với `MYSLACK_APP_ID` đã cấu hình (thiếu hoặc sai -> HTTP 400 `APP_ID_MISMATCH` hoặc `APP_ID_REQUIRED`).
     - BẮT BUỘC có trường `team_id` không rỗng. **TUYỆT ĐỐI KHÔNG DÙNG `authorizations[0].team_id` LÀM FALLBACK**, vì trong các kênh chia sẻ liên workspace (Slack Connect), danh sách authorizations có thể thuộc tổ chức khác.
     - BẮT BUỘC có `event_id` và `event` hợp lệ.

4. **Kiến trúc Biên nhận Không chứa Nội dung (Body-Free Receipt) & Giải quyết Xung đột F1 vs ACK 3s:**
   - *Vấn đề xung đột:* Đặc tả F1 (Mục 4.4 & 9.1) nghiêm cấm lưu trữ nội dung Slack vào database khi chưa có chấp thuận của tổ chức (organization consent). Tuy nhiên, Slack Events API đòi hỏi phải trả lời ACK 200 trong vòng 3 giây, trong khi việc phân giải quyền fanout và kiểm tra consent diễn ra bất đồng bộ.
   - *Giải pháp kiến trúc:* Tầng Ingress **TUYỆT ĐỐI KHÔNG** lưu trữ văn bản tin nhắn thô (`text`), blocks, files hoặc attachments vào bảng receipt!
   - Bảng `slack_event_receipts` chỉ lưu trữ các định danh định tuyến bền vững tối thiểu (Minimal Durable Routing Identifiers):
     `id, slack_app_id, event_id, team_id, event_type, event_ts, event_context, channel_id, message_ts, status, created_at, processed_at`.
   - Không tồn tại cột `raw_payload` hay `body_json` không giới hạn trong bảng receipt. Việc đọc nội dung phục vụ xử lý nghiệp vụ sẽ do worker thực hiện bất đồng bộ bằng user token đã được xác thực chấp thuận tổ chức (F1 authorized retrieval) khi cần thiết.
   - Biên nhận lưu trữ có thời hạn hữu hạn (bounded retention trần 7 ngày), được dọn dẹp định kỳ bởi scheduled vacuum / maintenance.

5. **Cam kết Bền vững Nguyên tử (Atomic Durable ACK) & Xử lý Trùng lặp:**
   - Tuyệt đối không áp dụng mô hình phân mảnh "commit receipt -> gọi hook ngoài transaction -> ghi intent sau".
   - Toàn bộ trạng thái tiếp nhận receipt và intent liên quan (queue intent hoặc lifecycle intent) **BẮT BUỘC ĐƯỢC COMMIT TRONG CÙNG MỘT TRANSACTION DATABASE DUY NHẤT** (`BEGIN ... COMMIT`).
   - Bản thân bản ghi trong `slack_event_receipts` với trạng thái `status: 'pending_fanout' | 'pending_lifecycle'` là trạng thái bền vững có thẩm quyền (Authoritative Durable State). Worker nền của 04B và luồng khôi phục khi khởi động (startup recovery) sẽ quét tìm các bản ghi pending bằng `SELECT ... FOR UPDATE SKIP LOCKED`. In-process hook chỉ đóng vai trò thông báo đánh thức (nonauthoritative wakeup notification).
   - Nếu database bị lỗi hoặc rollback -> endpoint **BẮT BUỘC TRẢ VỀ HTTP 500 HOẶC 503**, không bao giờ gửi ACK 200 giả mạo khi trạng thái chưa được ghi nhận bền vững.
   - Ràng buộc duy nhất `UNIQUE (slack_app_id, event_id)` trên PostgreSQL thật đảm bảo xử lý đồng thời (concurrency) an toàn: các lượt retry cùng `event_id` được xử lý qua `ON CONFLICT DO NOTHING`, trả về HTTP 200 ngay lập tức mà không nhân bản queue intent.
   - Thiết kế nhắm tới ngân sách 3 giây của Slack thông qua việc giới hạn tầng Ingress ở các thao tác mật mã in-memory và 1 transaction DB cục bộ duy nhất, chuyển toàn bộ lời gọi mạng (fanout, model, purge) sang worker bất đồng bộ. Số đo độ trễ thực tế sẽ được đo lường cụ thể trong quá trình chạy kiểm thử, không tự tạo số liệu giả định.

6. **Phân loại Chi tiết Sự kiện Vòng đời & Rào cản Vô hiệu hóa F3 Trước ACK:**
   - Ingress endpoint và luồng vòng đời vẫn sẵn sàng hoạt động khi `MYSLACK_AUTOMATION_ENABLED=off` hoặc các kết nối cá nhân đang tạm dừng (pause).
   - **Xử lý Bốn Loại Sự kiện Vòng đời Chuẩn tắc:**
     1. `tokens_revoked` ([Slack Docs](https://docs.slack.dev/reference/events/tokens_revoked/)):
        - Trích xuất mảng `event.tokens.oauth` chứa danh sách User IDs bị thu hồi.
        - **CẢNH BÁO:** Mảng `event.tokens.bot` chứa Bot IDs, TUYỆT ĐỐI KHÔNG dùng để thu hồi kết nối cá nhân của người dùng!
        - Thiết lập rào cản vô hiệu hóa F3: Cập nhật ngay trong transaction trước ACK:
          `UPDATE slack_connections SET status = 'revoked', identity_version = identity_version + 1 WHERE workspace_id = $1 AND actor_id = ANY($2) AND status = 'active' AND connected_at <= $3`.
        - Bảo vệ chống Replay: Ràng buộc `connected_at <= event_ts` đảm bảo một sự kiện revoke cũ/bị phát lại không thể thu hồi nhầm một thế hệ kết nối mới vừa được kết nối lại sau thời điểm phát sự kiện!
     2. `app_uninstalled` ([Slack Docs](https://docs.slack.dev/reference/events/app_uninstalled/)):
        - Thu hồi toàn bộ kết nối active trong workspace: `UPDATE slack_connections SET status = 'revoked', identity_version = identity_version + 1 WHERE workspace_id = $1 AND app_id = $2 AND status = 'active'`.
     3. `message_deleted` ([Slack Docs](https://docs.slack.dev/reference/events/message/message_deleted/)):
        - Trích xuất `channel_id = event.channel`, `message_ts = event.deleted_ts || event.previous_message?.ts`, `event_ts = event.event_ts`.
        - Ghi rào cản tombstone bền vững vào `slack_lifecycle_intents` với khóa duy nhất `UNIQUE (team_id, intent_type, channel_id, message_ts)`.
     4. `message_changed` ([Slack Docs](https://docs.slack.dev/reference/events/message/message_changed/)):
        - Trích xuất `channel_id = event.channel`, `message_ts = event.message?.ts || event.previous_message?.ts`, `edit_ts = event.message?.edited?.ts || event.event_ts`.
        - Ghi intent cập nhật tombstone / stale marker vào `slack_lifecycle_intents`. TUYỆT ĐỐI KHÔNG lưu văn bản tin nhắn sửa đổi vào receipt hay intent!
   - **Bảo vệ Đọc Tức thì F3 (Immediate Read Barrier):**
     Mọi yêu cầu đọc dữ liệu nguồn hoặc đưa vào mô hình từ `03B/03C` phải lập tức quan sát thấy rào cản vô hiệu hóa (kiểm tra `identity_version` mismatch hoặc bản ghi tombstone tồn tại), chặn truy cập ngay cả khi luồng dọn dẹp vật lý (cascade purge runner) đang trong hàng đợi thực thi lại.
   - Payload của intent vòng đời được định nghĩa bằng cấu trúc union gõ kiểu nghiêm ngặt (Typed Bounded Lifecycle Payload), không dùng JSON tự do để ngăn chặn dữ liệu không kiểm soát lọt vào database.

7. **Quyền Sở hữu Trạng thái Tạm dừng (Pause Ownership) & Ngăn chặn Backfill Trái phép:**
   - Trạng thái tạm dừng (`pause`) và chế độ hoạt động (`mode`) là thuộc tính cấu hình riêng biệt của từng cặp `(ATI user, workspace)`, **KHÔNG PHẢI THUỘC TÍNH TOÀN WORKSPACE** (`isWorkspacePaused(teamId)` là sai kiến trúc).
   - Tầng Ingress (04A) chỉ kiểm tra cờ máy chủ toàn cục `MYSLACK_AUTOMATION_ENABLED`:
     - Nếu cờ automation toàn cục tắt -> discard tin nhắn thường trong memory (không ghi receipt/job), nhưng vẫn commit đầy đủ các sự kiện vòng đời.
     - Nếu cờ automation toàn cục bật -> commit Body-Free Receipt với trạng thái `pending_fanout`.
   - Việc kiểm tra trạng thái pause của từng cá nhân, kiểm tra chấp thuận F1 của tổ chức, và mốc thời gian xử lý (`processing_start_watermark`) sẽ do worker phân phối quyền ở Giai đoạn 04B thực thi. Sự kiện có `event_ts` xảy ra trước mốc bật quyền/mốc tạm dừng của người dùng sẽ bị loại bỏ, không bao giờ được quét bù (backfill) trái phép.

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
- **Tạo mới:** `apps/chat-api/src/services/slack/slack-signature.ts` (Bộ kiểm tra mật mã chữ ký HMAC-SHA256 v0 không roundtrip UTF-8, timingSafeEqual và cửa sổ timestamp bounded `/^\d{1,10}$/`).
- **Tạo mới:** `apps/chat-api/src/db/repositories/slack-event-receipt-repo.ts` (Repository lưu trữ receipt và lifecycle intent nguyên tử trong 1 transaction, kiểm soát idempotency và atomic upsert trên PostgreSQL).
- **Tạo mới:** `apps/chat-api/src/services/slack/slack-ingress-service.ts` (Service điều phối tiếp nhận, phân loại challenge/lifecycle/ordinary event, tích hợp F4 và phát intent).
- **Tạo mới:** `apps/chat-api/src/routes/slack-events.ts` (Router Express 5.2.1 với middleware raw buffer bounded, timeout/aborted-stream handling, phản hồi 413 không phá socket sớm và endpoint `POST /api/slack/events`).
- **Tạo mới:** `apps/chat-api/src/config/slack-ingress-env.ts` (Helper trích xuất và kiểm tra cấu hình signing secret, app ID từ môi trường).
- **Cập nhật:** `apps/chat-api/src/app.ts` (Mount router `slack-events.ts` **TRƯỚC** `express.json()`, tiêm dependencies).
- **Cập nhật:** `apps/chat-api/src/server.ts` (Khởi tạo `SlackEventReceiptRepo`, `SlackIngressService` và truyền cấu hình khi bootstrap).

### 2.3. Tệp Kiểm thử TDD (`apps/chat-api/tests/`) (Backend Owned)
- **Tạo mới:** `apps/chat-api/tests/services/slack-signature.test.ts` (Kiểm thử đơn vị chuyên sâu chữ ký HMAC v0, timing attack buffer length, lệch timestamp, non-integer, whitespace timestamp, non-ASCII/invalid-UTF8 bytes).
- **Tạo mới:** `apps/chat-api/tests/db/slack-event-receipt-repo.test.ts` (Kiểm thử repository receipt trên PostgreSQL 16 thật qua `createMigratedSchema`: transaction nguyên tử receipt+intent, unique constraint, upsert idempotency, retry không trùng lặp, concurrency).
- **Tạo mới:** `apps/chat-api/tests/routes/slack-events-ingress.test.ts` (Kiểm thử tích hợp HTTP supertest cho route: mount trước express.json, raw body preservation, challenge chuẩn Slack không có app_id, challenge có app_id đúng/sai, event_callback thiếu app_id/team_id, invalid signature 401, replay 400, 413 stream timeout, DB failure 500/503).
- **Tạo mới:** `apps/chat-api/tests/routes/slack-events-lifecycle.test.ts` (Kiểm thử F4 lifecycle độc lập cờ: cờ tắt -> discard tin thường, commit purge/revoke intent nguyên tử cho 4 loại lifecycle events, rào cản F3, bảo vệ replay epoch).

---

## 3. Giao diện Kỹ thuật & Hợp đồng Dữ liệu (Typed Interfaces)

```ts
/** Cấu hình nạp từ biến môi trường máy chủ phục vụ xác thực Ingress */
export interface SlackIngressConfig {
  signingSecret: string;
  appId: string;
  maxBodyBytes?: number; // Mặc định: 1048576 (1 MB)
  streamTimeoutMs?: number; // Mặc định: 5000 ms
  clock?: () => number;  // Phục vụ kiểm thử giả lập thời gian determinism
}

/** Tham số đầu vào hàm xác thực mật mã chữ ký */
export interface SlackSignatureInput {
  signatureHeader: string | undefined;
  timestampHeader: string | undefined;
  rawBody: Buffer;
  signingSecret: string;
  nowMs?: number;
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
  status: 'pending_fanout' | 'pending_lifecycle' | 'discarded' | 'processed' | 'failed';
  discard_reason: string | null;
  created_at: Date;
  processed_at: Date | null;
}

/** Cấu trúc dữ liệu có kiểu định danh rõ ràng cho intent vòng đời */
export type SlackLifecycleIntentPayload =
  | { intentType: 'tokens_revoked'; teamId: string; revokedUserIds: string[]; eventTs: string }
  | { intentType: 'app_uninstalled'; teamId: string; appId: string; eventTs: string }
  | { intentType: 'message_deleted'; teamId: string; channelId: string; messageTs: string; deletedTs: string; eventTs: string }
  | { intentType: 'message_changed'; teamId: string; channelId: string; messageTs: string; editTs: string; eventTs: string };

/** Dòng intent vòng đời trong PostgreSQL */
export interface SlackLifecycleIntentRow {
  id: string;
  receipt_id: string;
  team_id: string;
  intent_type: 'tokens_revoked' | 'app_uninstalled' | 'message_deleted' | 'message_changed';
  payload: SlackLifecycleIntentPayload;
  status: 'pending' | 'applied' | 'failed';
  created_at: Date;
  applied_at: Date | null;
}

/** Input ghi nhận receipt và intent nguyên tử */
export interface RecordReceiptAtomicInput {
  slackAppId: string;
  eventId: string;
  teamId: string;
  eventType: string;
  eventTs: string;
  eventContext?: string | null;
  channelId?: string | null;
  messageTs?: string | null;
  status: 'pending_fanout' | 'pending_lifecycle' | 'discarded';
  discardReason?: string | null;
  lifecycleIntent?: SlackLifecycleIntentPayload;
  epochCheckTs?: Date; // Dùng cho rào cản revoke F3 chống replay
}

/** Hợp đồng Consumer Queue Intent cho Giai đoạn 04B */
export interface SlackQueueIntentHook {
  onEventReceived(receipt: SlackEventReceiptRow): Promise<void>;
}

/** Hợp đồng Consumer Lifecycle Purge Hook cho Giai đoạn 03B/02B */
export interface SlackLifecyclePurgeHook {
  onLifecycleStaged(intent: SlackLifecycleIntentRow): Promise<void>;
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

-- Bảng ghi nhận intent vòng đời bền vững (Durable Lifecycle Intents)
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
```

---

## 5. Tiêu chí Nghiệm thu Cụ thể (Acceptance Criteria)

- [ ] **AC1 (Mounting Order, Stream Handling & Raw Buffer Integrity):** Route `/api/slack/events` được kích hoạt trước `express.json()`. Body stream được thu thập thành raw buffer nguyên vẹn byte-for-byte; request vượt quá 1 MB bị từ chối bằng HTTP 413 `Payload Too Large` mà không phá vỡ kết nối socket trước khi gửi phản hồi.
- [ ] **AC2 (Xác thực Chữ ký HMAC Không Roundtrip & Bounded Timestamp):** Chữ ký sai hoặc thiếu header -> 401 Unauthorized; timestamp lệch > 300s, chứa khoảng trắng hoặc không phải số nguyên -> 400 Bad Request; băm trực tiếp buffer byte thô không qua UTF-8 stringification (hỗ trợ an toàn non-ASCII và byte lạ); so sánh chữ ký bằng `timingSafeEqual` sau khi kiểm tra độ dài digest buffer không gây crash.
- [ ] **AC3 (Xác thực Thử thách URL & Ràng buộc Sự kiện Thường):** Thử thách `url_verification` chuẩn Slack không chứa `api_app_id` được chấp nhận và phản hồi HTTP 200 `{ challenge }` tức thì không ghi DB; nếu thử thách có truyền `api_app_id` sai thì từ chối HTTP 400; sự kiện `event_callback` bắt buộc có `api_app_id` khớp cấu hình và `team_id` hợp lệ (không fallback sang authorizations[0]).
- [ ] **AC4 (Cam kết Bền vững Nguyên tử & Ngân sách 3 Giây):** Sự kiện cần xử lý chỉ trả lời HTTP 200 SAU KHI receipt và intent liên quan đã được commit thành công trong cùng một transaction PostgreSQL. Khi DB gặp sự cố hoặc pool kiệt quệ -> trả về HTTP 500/503 để Slack retry; tuyệt đối không fake 200.
- [ ] **AC5 (Idempotency & Chống Trùng lặp Thực tế):** Hai request gửi đến đồng thời hoặc tuần tự với cùng `(slack_app_id, event_id)` trên PostgreSQL thật được xử lý an toàn: request đầu tiên commit receipt, request thứ hai phát hiện xung đột và trả về 200 ngay lập tức mà không nhân bản queue intent.
- [ ] **AC6 (Bảo toàn Kiến trúc Body-Free Receipt):** Bảng `slack_event_receipts` tuyệt đối không chứa trường lưu trữ body tin nhắn thô. Thỏa mãn 100% yêu cầu F1 về việc không lưu trữ nội dung Slack khi chưa có consent tổ chức.
- [ ] **AC7 (Vòng đời Độc lập Cờ F4 & Rào cản F3):** Khi `MYSLACK_AUTOMATION_ENABLED=off`:
  - Tin nhắn thường nhận HTTP 200 và discard body ngay trong memory (không ghi receipt/job).
  - Cả 4 loại sự kiện vòng đời (`tokens_revoked`, `app_uninstalled`, `message_deleted`, `message_changed`) được commit nguyên tử vào database trước khi trả về HTTP 200.
  - `tokens_revoked` chỉ thu hồi chính xác kết nối của các `user_id` trong `tokens.oauth` (bỏ qua `tokens.bot`), có kiểm tra epoch `connected_at <= event_ts` để bảo vệ kết nối mới, đồng thời thiết lập rào cản đọc F3 ngay lập tức.
- [ ] **AC8 (Bảo vệ Log & Bí mật):** Không có access token, signing secret, hay nội dung tin nhắn nào xuất hiện trong log console, exception message hay API response.

---

## 6. Lệnh Kiểm tra và Cổng Bằng chứng (Command & Evidence Gates)

> Sử dụng PostgreSQL 16 thật thông qua helper `createMigratedSchema` và HTTP supertest tích hợp. Tuyệt đối không dùng boolean mock.

```powershell
# 1. Chạy unit test kiểm tra mật mã chữ ký HMAC-SHA256, timingSafeEqual, whitespace timestamp, non-ASCII
npm test -w @wap/chat-api -- tests/services/slack-signature.test.ts

# 2. Chạy database test kiểm tra repository receipt nguyên tử, concurrency, idempotency trên PostgreSQL 16
npm test -w @wap/chat-api -- tests/db/slack-event-receipt-repo.test.ts

# 3. Chạy integration HTTP route test kiểm tra mounting, challenge chuẩn, missing app_id/team_id, invalid sig, replay, 413, DB error
npm test -w @wap/chat-api -- tests/routes/slack-events-ingress.test.ts

# 4. Chạy integration test kiểm tra F4 lifecycle độc lập cờ tính năng, 4 loại sự kiện, rào cản F3, epoch check
npm test -w @wap/chat-api -- tests/routes/slack-events-lifecycle.test.ts

# 5. Kiểm tra toàn diện TypeScript và chuẩn quy ước dự án
npm run typecheck:v3
git diff --check b757ae08 HEAD
```

---

## 7. Kết quả Thực thi (Dành cho Agent Thi công)

*(Phần này được cập nhật bởi Backend Implementer sau khi hoàn thành chu trình TDD RED → GREEN, cung cấp đầy đủ commit hash, log test thực tế và số liệu CI).*

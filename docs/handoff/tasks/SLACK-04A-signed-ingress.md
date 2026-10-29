# SLACK-04A · Ingress Ký số, Xác thực Thử thách & Cam kết Bền vững ACK

**Trạng thái:** DỰ THẢO KẾ HOẠCH (Chờ Reviewer & Lead duyệt; chưa thực thi runtime code).
**Nhánh triển khai đề xuất:** `feat/slack-04a-signed-ingress` · **Nhánh tài liệu kế hoạch hiện tại:** `docs/slack-04a-ingress-plan`.
**Nền đối chiếu đã thẩm định (Staging base):** `b757ae081751168fdcbcfdddf73713d4a1d9109d` (bao gồm PR #187 contracts 02A, PR #190 callback isolation fix, PR #185 inventory 354 methods, PR #188 macro delivery roadmap).
**Vai trò sở hữu module:** Backend Engineer (sở hữu duy nhất `apps/chat-api/`, `db/v3/` và các scripts/fixtures liên quan; không sửa chéo `packages/tool-schemas`, `packages/tool-adapters`, `packages/executor`, `apps/chat-web`).
**Task cha:** [SLACK-04 · Ingress Ký số, Phân phối Quyền và An toàn Thực thi](SLACK-04-ingress-lifecycle-and-execution-safety.md).
**Kế hoạch kỹ thuật chi tiết:** [Kế hoạch Triển khai SLACK-04A](../../superpowers/plans/2026-10-29-slack-04a-signed-ingress.md).
**Đặc tả chuẩn tắc:** [Slack cá nhân và trợ lý công việc trong ATI](../../superpowers/specs/2026-10-28-slack-personal-oauth-design.md) (Mục 4.4, 5, 8, 9.1, 9.2, 10).
**Hợp đồng tích hợp liên quan:** 03A PR #194 `bc8d6b69`, 03B1 plan `c6118cdd`, Integration `7c6c65d8`.

> **LƯU Ý ĐIỀU KIỆN TIÊN QUYẾT (Prerequisite Boundary):**
> Việc lập kế hoạch SLACK-04A được thực hiện song song trên nhánh phân lập. Tuy nhiên, **TUYỆT ĐỐI KHÔNG thi công mã nguồn runtime SLACK-04A** cho tới khi:
> 1. SLACK-02B (Backend OAuth & Consent F1) và SLACK-03A (Source Schema contracts) được reviewer độc lập nghiệm thu và hợp nhất vào base staging;
> 2. SLACK-03C (Bộ adapter đọc cốt lõi `conversations`, `chat`, `users`) hoàn tất để cung cấp client đọc.
> Không yêu cầu merge vào nhánh `main` để tiến hành xếp chồng các nhánh đã qua review.

---

## 1. Mục tiêu và Phạm vi Kỹ thuật Bounded 04A

Card này bóc tách và định nghĩa trọn vẹn ranh giới kỹ thuật của **Giai đoạn 04A** từ task cha SLACK-04: thiết lập điểm tiếp nhận sự kiện webhook HTTPS ký số (`POST /api/slack/events`), thu thập buffer raw body trước khi phân tích JSON, băm mật mã trực tiếp trên byte thô không roundtrip UTF-8, xác minh chữ ký HMAC-SHA256 phiên bản `v0` cùng cửa sổ độ tươi timestamp bounded `<= 300s`, phản hồi thử thách `url_verification` chuẩn Slack tức thì, áp dụng mô hình Body-Free Receipt kết hợp hợp đồng watermark 6 chiều ngăn chặn backfill F1, phân định rõ ràng 3 trường hợp interval epoch `[t, t+1)` bảo toàn credential khi ambiguity, phối hợp rào cản vô hiệu hóa đọc F3 nguyên tử qua giao diện của 03B1 (`stageInTransaction` từ `SlackTransactionBoundInvalidationService`) trước ACK khớp schema database hiện hành (`status = 'disconnected'`), và đảm bảo cam kết bền vững giao dịch biên nhận (atomic durable receipt commit) trước khi trả về ACK HTTP 200 trong vòng ngân sách 3 giây của Slack.

### 1.1. Các Nguyên tắc Bất biến (Core Technical Invariants)

1. **Thu thập Raw Buffer & Thứ tự Mount Middleware:**
   - Route `POST /api/slack/events` **BẮT BUỘC ĐƯỢC MOUNT TRƯỚC `app.use(express.json())`** trong `apps/chat-api/src/app.ts`.
   - Middleware thu thập raw body có giới hạn dung lượng cứng (trần 1 MB = 1.048.576 bytes).
   - Middleware stream có timeout 5.000 ms và lắng nghe sự kiện stream bị hủy (`req.on('aborted')`, `req.on('error')`).
   - Xử lý HTTP 413 chuẩn tắc: Khi `Content-Length` hoặc số byte stream vượt quá 1 MB, gửi phản hồi HTTP 413 `Payload Too Large` `{ error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' }`, và chỉ đóng kết nối sau khi phản hồi đã hoàn tất gửi đi (`res.on('finish')`), không destroy socket sớm gây mất mã trạng thái của client.
   - Buffer nguyên bản (`req.rawBody = Buffer.concat(...)`) được bảo toàn để tính toán chữ ký. Tuyệt đối không parse JSON, không log payload, và không ghi DB trước khi chữ ký được xác thực thành công.

2. **Xác thực Chữ ký Kỹ thuật số Không Roundtrip & Cửa sổ Timestamp Bounded:**
   - Thu thập 2 HTTP headers: `X-Slack-Signature` và `X-Slack-Request-Timestamp`.
   - **Xác thực Định dạng Timestamp Bounded:** `X-Slack-Request-Timestamp` bắt buộc khớp regex `/^\d{1,10}$/`. Bất kỳ ký tự khoảng trắng ở đầu/cuối, dấu cộng, số thập phân, ký tự xuống dòng đều bị từ chối bằng HTTP 400 `Bad Request` (`INVALID_TIMESTAMP`).
   - **Cửa sổ Độ tươi (Freshness Window):** `|Math.floor(Date.now() / 1000) - Number(timestampHeader)| <= 300` giây (5 phút). Lệch quá 300s ném HTTP 400 `Bad Request` (`INVALID_TIMESTAMP`).
   - **Header Chữ ký:** Bắt buộc có dạng `^v0=[0-9a-f]{64}$` (tổng độ dài chính xác 67 ký tự).
   - **Băm Trực tiếp Buffer Tuyệt đối Không Roundtrip UTF-8:**
     ```ts
     const hmac = crypto.createHmac('sha256', signingSecret);
     hmac.update(`v0:${timestampHeader}:`);
     hmac.update(rawBody);
     const expectedDigest = 'v0=' + hmac.digest('hex');
     ```
   - **Bảo vệ chống Timing Attack:** So sánh chữ ký bằng `crypto.timingSafeEqual` sau khi đã đối soát độ dài buffer (`Buffer.byteLength(expectedDigest) === Buffer.byteLength(headerSignature)`), loại bỏ hoàn toàn ngoại lệ `RangeError`. Chữ ký sai ném HTTP 401 `Unauthorized` (`INVALID_SIGNATURE`).
   - **Fail-Closed khi Thiếu Cấu hình:** Nếu thiếu `SLACK_SIGNING_SECRET` hoặc `MYSLACK_APP_ID`, endpoint trả về HTTP 500/503 `CONFIG_MISSING`.

3. **Thử thách URL Verification Không Cần App ID & Ràng buộc Sự kiện Thường:**
   - Cú pháp JSON payload (`JSON.parse(...)`) chỉ thực thi **SAU KHI** chữ ký đã hợp lệ.
   - **Nhánh `url_verification` chuẩn tắc theo Slack Docs:** Chấp nhận payload `{ token, challenge, type }` không bắt buộc có `api_app_id`. Nếu có truyền `api_app_id` thì phải khớp cấu hình (sai ném 400 `APP_ID_MISMATCH`). Phản hồi ngay lập tức `{ challenge: payload.challenge }` với HTTP 200, không ghi DB receipt.
   - **Nhánh Sự kiện Thường (`event_callback`):**
     - BẮT BUỘC có `api_app_id` khớp cấu hình.
     - BẮT BUỘC có `team_id` không rỗng. **TUYỆT ĐỐI KHÔNG DÙNG `authorizations[0].team_id` LÀM FALLBACK** (ngăn chặn sai lệch trong shared channels / Slack Connect).
     - BẮT BUỘC có `event_id` và `event` hợp lệ.

4. **Kiến trúc Biên nhận Không chứa Nội dung & Hợp đồng Watermark 6 Chiều F1:**
   - *Ranh giới Body-Free Receipt:* Bảng `slack_event_receipts` chỉ lưu trữ định danh tối thiểu: `id, slack_app_id, event_id, team_id, event_type, source_event_ts, source_event_time, event_context, channel_id, message_ts, status, created_at, processed_at`. Tuyệt đối không lưu văn bản tin nhắn thô (`text` / `blocks`).
   - *Bảo đảm F1 Toàn diện thông qua Hợp đồng Watermark 6 Chiều:* Tự thân Body-Free Receipt không đủ để tuyên bố thỏa mãn F1. Hệ thống bắt buộc kết hợp với hợp đồng watermark 6 chiều:
     - Trường `source_event_time` trong receipt là bất biến (immutable), parse nghiêm ngặt từ timestamp sự kiện Slack bằng regex `/^\d{1,10}(\.\d{1,6})?$/`. **TUYỆT ĐỐI KHÔNG DÙNG `parseFloat` chấp nhận suffix junk, TUYỆT ĐỐI KHÔNG DÙNG `Date.now()` LÀM NGUỒN THẨM QUYỀN**. Nếu thiếu hoặc sai định dạng -> fail-closed: `status = 'discarded'`, `discard_reason = 'malformed_timestamp'`.
     - Khi worker phân phối quyền ở 04B xử lý receipt, nó bắt buộc đối soát:
       `source_event_time >= MAX(processing_start_watermark, consent_grant_watermark, identity_epoch_watermark, provider_attestation_watermark, config_revision_watermark, resume_watermark)`.
     - Nghiêm cấm pre-consent, pre-enable, pre-resume hay quét bù (backfilling) sự kiện quá khứ qua fresh resolve.
     - Vòng đời F4 xử lý độc lập, không đòi hỏi automation hay model để thiết lập rào cản.
     - Scheduled cleanup dọn dẹp receipt định kỳ sau 7 ngày: `DELETE FROM slack_event_receipts WHERE created_at < now() - INTERVAL '7 days'`.

5. **Cam kết Bền vững Nguyên tử (Atomic Durable ACK) & Bounded Wakeup:**
   - Trạng thái tiếp nhận receipt, intent vòng đời và rào cản F3 **BẮT BUỘC COMMIT TRONG CÙNG 1 TRANSACTION DATABASE DUY NHẤT** (`BEGIN ... COMMIT`) trước khi trả về HTTP 200.
   - Bản ghi `slack_event_receipts` với trạng thái `pending_fanout` hoặc `pending_lifecycle` là trạng thái thẩm quyền bền vững. Khi server crash/restart, worker 04B sẽ quét tìm các bản ghi pending bằng `SELECT ... FOR UPDATE SKIP LOCKED`.
   - In-process consumer hook CHỈ LÀ THÔNG BÁO ĐÁNH THỨC (nonauthoritative bounded wakeup). Bắt buộc thực thi dạng best-effort fire-and-forget (`.catch(() => {})`), **TUYỆT ĐỐI KHÔNG await consumer hook sau khi transaction đã commit** nhằm loại bỏ nguy cơ treo hoặc trả về HTTP 500 sai sau commit.
   - Nếu database bị lỗi hoặc rollback -> endpoint **BẮT BUỘC TRẢ VỀ HTTP 500 HOẶC 503**, không bao giờ gửi ACK 200 giả mạo khi trạng thái chưa được ghi nhận bền vững.
   - Ràng buộc duy nhất `UNIQUE (slack_app_id, event_id)` trên PostgreSQL thật đảm bảo xử lý đồng thời (concurrency) an toàn: retry cùng `event_id` được xử lý qua `ON CONFLICT DO NOTHING`, trả về HTTP 200 ngay lập tức mà không nhân bản queue intent.

6. **Thẩm quyền Thu hồi, Rào cản Tạm thời Trước Probe (Conservative Final Design) & Lock Concurrency:**
   - Ingress endpoint và luồng vòng đời sẵn sàng hoạt động khi `MYSLACK_AUTOMATION_ENABLED=off` hoặc các kết nối cá nhân đang tạm dừng (pause).
   - **Thẩm quyền Thu hồi Thực tế từ Slack:**
     Tài liệu chính thức của Slack ([tokens_revoked](https://docs.slack.dev/reference/events/tokens_revoked/)) chỉ cung cấp danh sách User IDs (`event.tokens.oauth: string[]`) và epoch seconds `event_time`. Payload HOÀN TOÀN KHÔNG có token ID hay grant generation ID.
     Do đó, điều kiện `connected_at < event_time` không phải thẩm quyền xác định credential hiện tại bị thu hồi (kịch bản: token cũ bị thu hồi SAU KHI grant mới đã được tạo). Timestamp chỉ là gợi ý thứ tự, không phải căn cứ thu hồi thế hệ hiện tại.
   - **Thiết kế Thận trọng Cuối cùng (Conservative Final Design):**
     1. Dưới cùng owner advisory lock (`withOwner(userId)`):
        - Bắt generation hiện tại (`identity_version`) và fingerprint private credential;
        - Commit một rào cản đọc tạm thời (provisional generation-scoped read block) vào `slack_invalidation_barriers` qua giao diện 03B1 `stageInTransaction(client, input)` trước ACK 200;
        - **BẢO TỒN PRIVATE CONFIG TRONG `slack_connections`** (chuyển `status = 'reconnect_required'`, chặn toàn bộ content query; TUYỆT ĐỐI KHÔNG set `config = NULL` làm mất token trước khi probe);
     2. Gửi HTTP 200 ACK cho Slack ngay sau khi transaction bền vững đã commit;
     3. Sau ACK, worker chạy probe metadata-only `auth.test` có CAS guard trên `identity_version` với captured credential:
        - *Xác nhận invalid/revoked:* Ngắt kết nối dứt khoát (`status = 'disconnected'`, `config = NULL`, tăng `identity_version`, reset `refresh_in_flight`), thực thi purge thế hệ cũ chính xác qua 03B1;
        - *Xác nhận valid (cùng actor & workspace):* Thu hồi thuộc về grant cũ; grant mới vẫn hợp lệ! Gỡ bỏ DUY NHẤT rào cản tạm thời này, không purge snapshot mới, giữ nguyên trạng thái active (trừ khi đã có disconnect thủ công hoặc barrier khác can thiệp);
        - *Lỗi mạng/timeout/rate-limit (unknown):* Giữ nguyên fail-closed ở trạng thái `reconnect_required`.
   - **Đồng bộ Khóa Advisory Lock với TokenManager:**
     `SlackTokenManager` giữ `withOwner(userId)` (`pg_advisory_lock`) qua lượt refresh mạng và lưu `UPDATE slack_connections SET config... WHERE id` không có CAS. Mọi mutation vòng đời BẮT BUỘC phối hợp cùng owner advisory lock (`withOwner(userId)`) và khóa dòng, đồng thời lập kế hoạch tích hợp CAS có giới hạn (`WHERE id = $1 AND identity_version = $2`) để tuần tự hóa với khoảng thời gian refresh token mạng.
   - **Rào cản Đọc F3 Thống nhất Qua Giao diện 03B1 (Loại bỏ Bảng Tombstone Riêng Biệt):**
     Loại bỏ hoàn toàn đề xuất bảng `slack_source_tombstones` riêng của 04A vì thiếu provenance nguồn và gây xung đột cạnh tranh với 03B1. Ingress phối hợp trực tiếp với 03B1 thông qua giao diện transaction-bound `stageInTransaction(client, input)` thuộc `SlackTransactionBoundInvalidationService`:
     - `tokens_revoked`: Bắt generation, commit provisional barrier qua `stageInTransaction` nhắm vào generation CŨ.
     - `app_uninstalled`: Ghi intent `authorization_disconnect` với lý do `app_reinstalled` hoặc `connection_disconnected` nhắm vào toàn bộ binding/epoch CŨ trong workspace. **TUYỆT ĐỐI KHÔNG DÙNG TOMBSTONE TOÀN CỤC `app:<id>` VỚI `channel='*'`** vì thiếu generation fencing và sẽ chặn vĩnh viễn việc cài đặt lại ứng dụng sau này!
     - `message_deleted`: Ghi rào cản `resource_lifecycle` (`tombstoneReason: 'source_deleted'`), rào cản tài nguyên vĩnh viễn, ngăn chặn resurrection khi có sự kiện edit đến muộn.
     - `message_changed`: Ghi rào cản `resource_lifecycle` (`tombstoneReason: 'source_edited'`), vô hiệu hóa đơn điệu các revision cũ (`revision < editTs`), bảo toàn revision mới.
   - **Kiểm tra Hợp lệ Payload Vòng đời:** Các trường của sự kiện vòng đời phải được kiểm tra chặt chẽ. Nếu malformed, fail-closed ngay lập tức, tuyệt đối không để lọt vào luồng xử lý automation.

7. **Quyền Sở hữu Trạng thái Tạm dừng (Pause Ownership):**
   - Trạng thái tạm dừng (`pause`) là cấu hình riêng của từng người dùng trong từng workspace, không áp dụng mức toàn workspace.
   - Tầng Ingress chỉ kiểm tra cờ máy chủ toàn cục `MYSLACK_AUTOMATION_ENABLED`: cờ tắt -> discard tin thường trong memory (không ghi receipt/job), nhưng vẫn commit đầy đủ sự kiện vòng đời. Cờ bật -> commit Body-Free Receipt với trạng thái `pending_fanout`.
   - Worker 04B chịu trách nhiệm kiểm tra pause cá nhân, consent F1 và watermark khi phân phối quyền.

8. **Ranh giới Phân phối Quyền 04B & An toàn Thực thi 04C:**
   - 04A chỉ định nghĩa interface yêu cầu cho hàng đợi (`SlackQueueIntentHook`) và purge runner (`SlackLifecyclePurgeHook`), không triển khai chi tiết worker fanout.
   - `apps.event.authorizations.list` là hạ tầng nội bộ app token (`authorizations:read`), giữ nguyên trạng thái `excluded` trong inventory. Outbox ledger, Echo Guard và trạng thái ngắt mạng `UNKNOWN` bảo lưu cho 04C.

---

## 2. Ranh giới Phân quyền Module & Tệp Sở hữu (Module Ownership)

Toàn bộ công việc thuộc sở hữu duy nhất của **Backend Engineer**:

### 2.1. Tệp Cơ sở Dữ liệu & Migration (Backend Owned)
- **Tạo mới:** `db/v3/[proposed: NNNN_slack_event_receipts.sql]`
  *(Tạo bảng `slack_event_receipts` và `slack_lifecycle_intents`; rào cản đọc F3 sử dụng bảng `slack_invalidation_barriers` của 03B1 trong cùng transaction).*

### 2.2. Tệp Mã nguồn Sản phẩm (`apps/chat-api/src/`) (Backend Owned)
- **Tạo mới:** `apps/chat-api/src/services/slack/slack-signature.ts` (Mật mã HMAC-SHA256 v0 trên raw buffer, timingSafeEqual, timestamp bounded regex `/^\d{1,10}$/`).
- **Tạo mới:** `apps/chat-api/src/db/repositories/slack-event-receipt-repo.ts` (Repository lưu trữ receipt, lifecycle intent và phối hợp commit rào cản F3 qua 03B1 nguyên tử trong 1 transaction PG).
- **Tạo mới:** `apps/chat-api/src/services/slack/slack-ingress-service.ts` (Service điều phối tiếp nhận, challenge chuẩn, F4 lifecycle, coarse-time interval resolver `[t, t+1)`, bounded wakeup).
- **Tạo mới:** `apps/chat-api/src/routes/slack-events.ts` (Router Express 5.2.1 với middleware raw buffer bounded, timeout 5s, phản hồi 413 an toàn và endpoint `POST /api/slack/events`).
- **Tạo mới:** `apps/chat-api/src/config/slack-ingress-env.ts` (Helper đọc signing secret, app ID từ môi trường).
- **Cập nhật:** `apps/chat-api/src/app.ts` (Mount router `slack-events.ts` **TRƯỚC** `express.json()`, tiêm dependencies).
- **Cập nhật:** `apps/chat-api/src/server.ts` (Khởi tạo repo và service ingress trong server bootstrap).

### 2.3. Tệp Kiểm thử TDD (`apps/chat-api/tests/`) (Backend Owned)
- **Tạo mới:** `apps/chat-api/tests/services/slack-signature.test.ts` (Unit test HMAC v0 raw buffer, timing attack buffer length, lệch timestamp, non-integer, whitespace, non-ASCII/invalid UTF-8 bytes).
- **Tạo mới:** `apps/chat-api/tests/db/slack-event-receipt-repo.test.ts` (Integration test repo trên PG 16 thật: atomic commit receipt+intent+03B1 barrier, unique constraint, idempotency, interval epoch handling `[t, t+1)`).
- **Tạo mới:** `apps/chat-api/tests/routes/slack-events-ingress.test.ts` (HTTP integration test: mount trước express.json, raw body streaming, challenge chuẩn không app_id, challenge có app_id đúng/sai, event_callback thiếu app_id/team_id, 401 sig, 400 replay, 413 stream, DB failure 500/503).
- **Tạo mới:** `apps/chat-api/tests/routes/slack-events-lifecycle.test.ts` (Integration test F4 lifecycle: cờ tắt/bật, 4 loại sự kiện, coarse-time interval `[t, t+1)` bảo toàn token khi ambiguity, rào cản F3 03B1, ngăn chặn resurrection khi delete/edit out-of-order).

---

## 3. Giao diện Kỹ thuật & Hợp đồng Dữ liệu (Typed Interfaces)

```ts
export interface SlackIngressConfig {
  signingSecret: string;
  appId: string;
  maxBodyBytes?: number; // Mặc định: 1048576 (1 MB)
  streamTimeoutMs?: number; // Mặc định: 5000 ms
  clock?: () => number;
}

export interface SlackSignatureInput {
  signatureHeader: string | undefined;
  timestampHeader: string | undefined;
  rawBody: Buffer;
  signingSecret: string;
  nowMs?: number;
}

export type SlackSignatureVerificationResult =
  | { ok: true; timestamp: number }
  | { ok: false; status: 400 | 401; error: string; code: 'INVALID_TIMESTAMP' | 'INVALID_SIGNATURE' | 'MALFORMED_HEADER' };

export interface SlackEventEnvelope {
  token?: string;
  team_id?: string;
  api_app_id?: string;
  type: 'url_verification' | 'event_callback' | 'app_rate_limited';
  challenge?: string;
  event_id?: string;
  event_time?: number; // Integer seconds Unix epoch từ Slack
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
  | { intentType: 'token_revocation_validation'; binding: import('@wap/tool-schemas').SlackBinding; credentialFingerprint: string; barrierId: string; sourceEventTime: Date }
  | { intentType: 'app_uninstall_validation'; binding: import('@wap/tool-schemas').SlackBinding; credentialFingerprint: string; barrierId: string; sourceEventTime: Date }
  | { intentType: 'message_deleted'; workspaceId: string; channelId: string; messageTs: string; deletedTs: string; sourceEventTime: Date }
  | { intentType: 'message_changed'; workspaceId: string; channelId: string; messageTs: string; editTs: string; sourceEventTime: Date };

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

/** Rào cản Bền vững Phân định theo Kiểu (Discriminated Durable Barrier) */
export type SlackDurableBarrier =
  | { barrierType: 'connection'; binding: import('@wap/tool-schemas').SlackBinding; provisional?: boolean; reason: string }
  | { barrierType: 'channel'; binding: import('@wap/tool-schemas').SlackBinding; channelId: string; reason: string }
  | { barrierType: 'epoch'; epoch: import('@wap/tool-schemas').SlackPolicyEpoch; reason: string }
  | { barrierType: 'resource'; workspaceId: string; resourceType: import('@wap/tool-schemas').SlackResourceType; resourceId: string; minValidRevision?: string; reason: string };

/** Hợp đồng Đầu vào Phối hợp Rào cản Vô hiệu hóa Đọc 03B1 (Thống nhất) */
export interface SlackInvalidationEffect {
  effectKey: string; // NONNULL unique effect key (ví dụ 'provisional:' + connectionId)
  barrier: SlackDurableBarrier;
  purgeTarget?: import('@wap/tool-schemas').SlackPurgeTarget; // Tùy chọn: bỏ qua khi chỉ cần rào cản tạm thời trước probe
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

/** Hợp đồng Consumer Queue Intent cho Giai đoạn 04B */
export interface SlackQueueIntentHook {
  onEventReceived(receipt: SlackEventReceiptRow): Promise<void>;
}

/** Hợp đồng Consumer Lifecycle Purge Hook cho Giai đoạn 03B/02B (Wakeup Only) */
export interface SlackLifecyclePurgeHook {
  onLifecycleStaged(intent: { id: string; teamId: string; payload: SlackLifecycleIntentPayload }): Promise<void>;
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

## 4. Đặc tả Cơ sở Dữ liệu (`db/v3/NNNN_slack_event_receipts.sql`)

```sql
-- Migration đề xuất NNNN: Bảng biên nhận sự kiện Slack (Body-Free Receipt Store)
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

-- Lưu ý: Rào cản đọc F3 và tombstones được commit trực tiếp vào bảng slack_invalidation_barriers
-- của 03B1 trong cùng transaction; không tạo thêm bảng tombstone cạnh tranh ở 04A.
```

---

## 5. Tiêu chí Nghiệm thu Cụ thể (Acceptance Criteria)

- [ ] **AC1 (Mounting Order, Stream Handling & Raw Buffer Integrity):** Route `/api/slack/events` kích hoạt trước `express.json()`. Body stream thu thập thành raw buffer nguyên vẹn byte-for-byte; request quá 1 MB bị từ chối bằng HTTP 413 `Payload Too Large` mà không phá vỡ kết nối socket trước khi gửi phản hồi.
- [ ] **AC2 (Xác thực Chữ ký HMAC Không Roundtrip & Bounded Timestamp):** Chữ ký sai hoặc thiếu header -> 401; timestamp lệch > 300s, chứa khoảng trắng hoặc không phải số nguyên -> 400 regex `/^\d{1,10}$/`; băm trực tiếp buffer byte thô không qua UTF-8 stringification (hỗ trợ an toàn non-ASCII và byte lạ); so sánh bằng `timingSafeEqual` sau khi kiểm tra độ dài 67 bytes không gây crash.
- [ ] **AC3 (Xác thực Thử thách URL & Ràng buộc Sự kiện Thường):** Thử thách `url_verification` chuẩn Slack không chứa `api_app_id` được chấp nhận và phản hồi HTTP 200 `{ challenge }` tức thì không ghi DB; nếu có truyền `api_app_id` sai thì từ chối HTTP 400; sự kiện `event_callback` bắt buộc có `api_app_id` khớp cấu hình và `team_id` hợp lệ (không fallback sang authorizations[0]).
- [ ] **AC4 (Cam kết Bền vững Nguyên tử & Bounded Wakeup):** Sự kiện cần xử lý chỉ trả lời HTTP 200 SAU KHI receipt, intent và rào cản F3 đã commit thành công trong cùng transaction PostgreSQL. Hook in-memory chỉ là wakeup bounded, không await sau commit làm chậm/fail HTTP 200. Lỗi DB trả về HTTP 500/503 để Slack retry; tuyệt đối không fake 200.
- [ ] **AC5 (Idempotency & Chống Trùng lặp Thực tế):** Xử lý đồng thời trên PostgreSQL thật an toàn qua `UNIQUE (slack_app_id, event_id)`: request đầu commit receipt, retry trả về 200 ngay mà không nhân bản queue intent.
- [ ] **AC6 (Bảo toàn Body-Free Receipt & Hợp đồng Watermark 6 Chiều F1):** Bảng `slack_event_receipts` không chứa trường lưu body tin nhắn. Lưu `source_event_time` bất biến parse nghiêm ngặt bằng `/^\d{1,10}(\.\d{1,6})?$/` (không dùng `parseFloat` nhận suffix junk). Worker 04B áp dụng watermark 6 chiều chặn hoàn toàn việc backfill sự kiện quá khứ.
- [ ] **AC7 (Vòng đời F4, Provisional Barrier & Lock Concurrency với TokenManager):** Khi `MYSLACK_AUTOMATION_ENABLED=off`:
  - Tin nhắn thường nhận HTTP 200 và discard body ngay trong memory (không ghi receipt/job).
  - Cả 4 loại sự kiện vòng đời (`tokens_revoked`, `app_uninstalled`, `message_deleted`, `message_changed`) được commit nguyên tử vào database trước khi trả về HTTP 200.
  - `tokens_revoked`: Dưới `withOwner(userId)` bắt generation, commit provisional barrier qua 03B1 `stageInTransaction`, giữ private `config` dưới `reconnect_required`, sau ACK probe `auth.test` có CAS guard; xác nhận revoked -> disconnect dứt khoát + purge; xác nhận valid (kịch bản old token revoke after newer grant) -> gỡ provisional barrier mà không ngắt kết nối grant mới.
  - Phối hợp rào cản F3 trực tiếp qua 03B1 `stageInTransaction`: `app_uninstalled` và `tokens_revoked` nhắm đúng binding/epoch cũ (không dùng `app:*` toàn workspace chặn reinstall); `message_deleted` tombstone vĩnh viễn; `message_changed` vô hiệu hóa đơn điệu revision cũ, bảo toàn revision mới; ngăn chặn resurrection khi delete/edit out-of-order.
  - Lock synchronization với `SlackTokenManager`: Mọi mutation trạng thái kết nối serialize dưới cùng owner advisory lock (`withOwner(userId)`) và CAS guard.
- [ ] **AC8 (Bảo vệ Log & Bí mật):** Không có access token, signing secret, hay nội dung tin nhắn nào xuất hiện trong log console, exception message hay API response.

---

## 6. Lệnh Kiểm tra và Cổng Bằng chứng (Command & Evidence Gates)

> Lưu ý: Toàn bộ kiểm thử dưới đây được đánh dấu **NOT_RUN** trong phiên lập kế hoạch tài liệu (docs-only planning). Mã nguồn runtime sẽ chỉ được thi công sau khi các hợp đồng phụ thuộc 03C read, 03A, 02B được nghiệm thu độc lập.

```powershell
# 1. Chạy unit test kiểm tra mật mã chữ ký HMAC-SHA256, timingSafeEqual, bounded timestamp regex (NOT_RUN - Docs Only)
npm test -w @wap/chat-api -- tests/services/slack-signature.test.ts

# 2. Chạy database test kiểm tra repository receipt nguyên tử, rào cản F3 qua 03B1 stageInTransaction, idempotency (NOT_RUN - Docs Only)
npm test -w @wap/chat-api -- tests/db/slack-event-receipt-repo.test.ts

# 3. Chạy integration HTTP route test kiểm tra mounting, challenge chuẩn, missing app/team ID, 413 stream, 500 on DB error (NOT_RUN - Docs Only)
npm test -w @wap/chat-api -- tests/routes/slack-events-ingress.test.ts

# 4. Chạy integration test kiểm tra F4 lifecycle: provisional barrier, old revoke after newer grant, TokenManager lock race, 03B1 barrier (NOT_RUN - Docs Only)
npm test -w @wap/chat-api -- tests/routes/slack-events-lifecycle.test.ts

# 5. Kiểm tra toàn diện TypeScript và chuẩn quy ước dự án
npm run typecheck:v3
git diff --check b757ae08 HEAD
```

---

## 7. Kết quả Thực thi (Dành cho Agent Thi công)

- **Phiên hiệu chỉnh tài liệu (Docs Correction):** Hoàn thành rà soát và khắc phục triệt để các mâu thuẫn kỹ thuật theo hướng dẫn thẩm định của coordinator:
  1. Áp dụng thiết kế thận trọng (conservative final design): official `tokens_revoked` chỉ cung cấp user IDs (không có grant generation ID); không đoán định thế hệ grant từ timestamp/userID. Dưới `withOwner(userId)`, bắt generation hiện tại, commit provisional read block qua 03B1 `stageInTransaction` trước ACK và giữ private `config` dưới `reconnect_required`; sau ACK probe `auth.test` có CAS guard; xác thực chính xác kịch bản old token revoke after newer grant.
  2. Đồng bộ khóa owner advisory lock (`withOwner(userId)`) của `SlackTokenManager` với các mutation trạng thái vòng đời, loại bỏ race condition trong khoảng thời gian refresh token mạng.
  3. Loại bỏ bảng `slack_source_tombstones` cạnh tranh và tombstone toàn cục `app:*`; thống nhất cơ chế rào cản đọc F3 qua giao diện 03B1 `stageInTransaction` với target semantics chính xác theo binding/epoch cũ.
  4. Mở rộng hợp đồng watermark 6 chiều cho F1, parse timestamp nghiêm ngặt bằng `/^\d{1,10}(\.\d{1,6})?$/` loại bỏ suffix junk.
  5. Quy định hook in-process là bounded best-effort wakeup không block HTTP 200 response sau commit, fail-closed khi payload vòng đời malformed.
- **Trạng thái Mã nguồn & Kiểm thử:** Không có mã nguồn runtime nào được tạo hoặc sửa đổi. Toàn bộ kiểm thử runtime được giữ nguyên trạng thái `NOT_RUN` tuân thủ kỷ luật ranh giới phase.

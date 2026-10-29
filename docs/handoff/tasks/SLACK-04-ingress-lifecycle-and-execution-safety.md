# SLACK-04 · Ingress Ký số, Phân phối Quyền và An toàn Thực thi

**Trạng thái:** DỰ THẢO KẾ HOẠCH (Chờ Reviewer & Nhóm trưởng duyệt; chưa thực thi code).
**Nhánh dự kiến:** `feat/slack-04-ingress-lifecycle-and-execution-safety`.
**Nền đối chiếu:** `fc12e3fb` (sau merge SLACK-01 #183).
**Phụ thuộc:**
- **SLACK-01** (Foundation contracts & HTTP fixture) — ĐÃ HOÀN TẤT (`fc12e3fb`).
- **SLACK-02** (OAuth, multi-workspace connection repository) — Yêu cầu interface `getSlackConnection()`.
- **SLACK-03C** (Nhóm phương thức `conversations` + `chat` hoàn tất) — ĐỦ ĐIỀU KIỆN BẮT ĐẦU (Không cần chờ toàn bộ API của 03D/03E).
**Đặc tả chuẩn tắc:** [Slack cá nhân và trợ lý công việc](../../superpowers/specs/2026-10-28-slack-personal-oauth-design.md) (Mục 5, 8, 9.1, 9.2).
**Kế hoạch chi tiết:** [Slack Remaining Delivery Plan](../../superpowers/plans/2026-10-29-slack-remaining-delivery.md).

---

## 1. Mục tiêu và Phạm vi Nghiệp vụ

Card này xây dựng hạ tầng tiếp nhận sự kiện thời gian thực từ Slack Events API qua webhook HTTPS ký số, giải quyết bài toán phân phối quyền (Authorizations Fanout) qua app-level token, đảm bảo an toàn thực thi tuyệt đối (chống lặp vô tận bằng Echo Guard, trạng thái UNKNOWN không retry mù), và duy trì vòng đời dữ liệu độc lập với cờ tính năng (F4).

### Ranh giới phạm vi:
1. **Khởi động sớm:** SLACK-04 được triển khai ngay sau khi nhóm phương thức cốt lõi đầu tiên (03C) hoàn tất; không phải chờ đợi các nhóm phương thức phụ của 03D/03E.
2. **Ký số & Raw Body:** Xác thực chữ ký `X-Slack-Signature` và timestamp freshness (< 300s) trực tiếp trên raw buffer trong bộ nhớ trước khi phân tích cú pháp JSON.
3. **Độc lập cờ tính năng & Tạm dừng (F4 Invariant):**
   - Khi `MYSLACK_AUTOMATION_ENABLED=off` hoặc workspace đang tạm dừng (pause): Ký số vẫn bắt buộc; tin nhắn thường được xác thực rồi ACK và bỏ qua ngay trong bộ nhớ (không lưu body, không tạo job AI); nhưng các sự kiện vòng đời (`tokens_revoked`, `app_uninstalled`, `message_deleted`, `message_changed`) VẪN ĐƯỢC XỬ LÝ để cập nhật trạng thái kết nối và kích hoạt purge dữ liệu nguồn!
   - Khi `MYSLACK_ENABLED=off` nhưng app vẫn cài trên Slack: Ingress ký số và xử lý vòng đời/purge vẫn chạy bình thường.
4. **Phân phối quyền chính xác (Authorizations Fanout):** Không coi người gửi tin là chủ ATI; không chỉ lấy phần tử đầu của `authorizations`. Dùng app-level token với `apps.event.authorizations.list` để lấy toàn bộ danh sách cài đặt được phép thấy tin, rồi map sang kết nối ATI tương ứng. DM của User A tuyệt đối không hiển thị cho User B.
5. **Echo Guard & Phân biệt người thật:** ATI thao tác bằng user token nên tin gửi đi sẽ được Events API gửi ngược về. Dùng sổ cái outbox (`client_msg_id`, `message_ts`, `operation_id`) để chặn đệ quy; TUYỆT ĐỐI KHÔNG lọc bỏ toàn bộ tin của user token (để tránh mất tin nhắn người dùng tự gõ trực tiếp trong Slack).
6. **UNKNOWN không retry mù:** Khi thao tác ghi gặp timeout (`AbortSignal`) hoặc đứt kết nối mạng, bước chuyển sang trạng thái `UNKNOWN`. Hệ thống không tự động retry ghi lại, bắt buộc đối soát qua lịch sử trước khi tiếp tục.

---

## 2. Phân chia Module và Quyền sở hữu (Module Ownership)

- **Backend Engineer:** Sở hữu `apps/chat-api/src/routes/slack-events.ts`, `apps/chat-api/src/services/slack/slack-ingress-service.ts`, `apps/chat-api/src/services/slack/slack-echo-guard.ts`, `apps/chat-api/src/services/slack/slack-authorizations-resolver.ts`, `packages/executor/src/myslack/myslack-outbox.ts`, `db/v3/0015_slack_events_and_outbox.sql`.
- **Shared:** Root `package.json` (nếu cần bổ sung script kiểm tra ingress loopback).

---

## 3. Lộ trình Phân rã Bounded PRs

### Giai đoạn 04A: Signed Ingress Route, Challenge & Raw Body Verification (PR 1)
- **Files:**
  - Create: `apps/chat-api/src/routes/slack-events.ts`
  - Create: `apps/chat-api/src/services/slack/slack-ingress-service.ts`
  - Tests: `apps/chat-api/tests/slack/slack-events-signature.test.ts`
- **Nội dung:**
  - Route `POST /api/slack/events`.
  - Đọc `rawBody` buffer; tính `v0=HMAC_SHA256(signing_secret, "v0:" + timestamp + ":" + rawBody)`.
  - Chống replay: Từ chối nếu `Math.abs(Date.now()/1000 - timestamp) > 300`.
  - Phản hồi `url_verification` challenge ngay lập tức mà không ghi DB hay tạo job.
  - Phản hồi ACK `{ ok: true }` trong vòng 3 giây cho mọi sự kiện hợp lệ.

### Giai đoạn 04B: Authorizations Fanout, Durable Queue & F4 Lifecycle (PR 2)
- **Files:**
  - Create: `db/v3/0015_slack_events_and_outbox.sql`
  - Create: `apps/chat-api/src/services/slack/slack-authorizations-resolver.ts`
  - Create: `apps/chat-api/src/services/slack/slack-event-queue.ts`
  - Tests: `apps/chat-api/tests/slack/slack-authorizations-fanout.test.ts`, `slack-ingress-lifecycle-f4.test.ts`
- **Nội dung:**
  - Migration 0015: Bảng `slack_event_receipts` có unique index trên `(slack_app_id, event_id)`; bảng `slack_triage_jobs` lưu công việc chờ xử lý với khóa `(receipt_id, connection_id, identity_version)`.
  - Phân giải quyền: Gọi `apps.event.authorizations.list` (khi `event_context` có mặt và bị cắt trang) bằng app-level token; map Slack user ID sang active connection trong DB.
  - Xử lý nhánh F4: Khi cờ automation tắt hoặc workspace pause:
    - Tin nhắn thường: ACK và discard payload khỏi memory; không ghi `slack_sources` hay tạo `slack_triage_jobs`.
    - Sự kiện `tokens_revoked` / `app_uninstalled`: Ghi nhận tức thì, cập nhật `service_credentials.status = 'revoked'`, tăng `identity_version` và kích hoạt `SlackPurgeRunner`.
    - Sự kiện `message_deleted` / `message_changed`: Ghi tombstone nguồn cũ và kích hoạt purge.

### Giai đoạn 04C: Execution Safety, Echo Guard & Trạng thái UNKNOWN (PR 3)
- **Files:**
  - Create: `packages/executor/src/myslack/myslack-outbox.ts`
  - Create: `apps/chat-api/src/services/slack/slack-echo-guard.ts`
  - Modify: `packages/executor/src/step-executor.ts`
  - Tests: `apps/chat-api/tests/slack/slack-echo-guard.test.ts`, `packages/executor/tests/myslack-unknown-safety.test.ts`
- **Nội dung:**
  - Bảng `slack_outbox_ledger`: Lưu `(workspace_id, channel_id, client_msg_id, message_ts, operation_id, sent_at)`.
  - Khi executor chuẩn bị gọi write: Ghi trước bản ghi ledger với `client_msg_id` duy nhất và timestamp.
  - Khi ingress nhận `message.channels`: Đối chiếu với ledger (cửa sổ 60s). Nếu khớp `client_msg_id` hoặc timestamp -> xác định là echo của ATI -> bỏ qua, không tạo proposal.
  - Kiểm tra tin nhắn người dùng thật: Nếu cùng tác giả nhưng không có trong ledger -> XỬ LÝ BÌNH THƯỜNG (không chặn).
  - Trạng thái `UNKNOWN`: Giả lập server Slack trễ sau commit; client nhận timeout qua `AbortSignal`. Executor chuyển step sang `UNKNOWN`, dừng workflow, KHÔNG retry write. Bắt buộc hàm reconciliation kiểm tra sự tồn tại của message trước khi quyết định bước tiếp theo.

---

## 4. Tiêu chí Nghiệm thu Cụ thể (Acceptance Criteria)

- [ ] **AC1 (Chữ ký & Replay):** Chữ ký sai hoặc thiếu header -> 401 Unauthorized; timestamp lệch quá 300 giây -> 400 Bad Request; chữ ký đúng -> 200 OK.
- [ ] **AC2 (F4 Độc lập Cờ Tính năng):** Khi `MYSLACK_AUTOMATION_ENABLED=off`:
  - Tin nhắn mới nhận HTTP 200, nhưng DB không có bản ghi body nguồn hoặc triage job.
  - Sự kiện `tokens_revoked` nhận HTTP 200, DB cập nhật trạng thái `revoked`, tăng `identity_version`, và kích hoạt purge nguồn cũ thành công.
- [ ] **AC3 (Authorizations Fanout & Cô lập DM):** Một tin nhắn trong kênh chung có 2 user cài app -> tạo đúng 2 triage jobs riêng biệt cho 2 connection. Một tin nhắn trong DM riêng giữa User A và Colleague -> chỉ tạo job cho User A; User B trong cùng workspace không nhận được job nào.
- [ ] **AC4 (Echo Guard Phân biệt Đúng):**
  - Tin nhắn do ATI gửi tự động có `client_msg_id` trong ledger -> bị Echo Guard chặn, không tạo vòng lặp đề xuất.
  - Tin nhắn do chính người dùng gõ tay trên ứng dụng Slack -> Echo Guard cho phép đi tiếp vào hàng đợi xử lý.
- [ ] **AC5 (Deduplication Webhook):** Slack gửi retry cùng một `event_id` -> trả lời HTTP 200 ngay lập tức, không tạo bản ghi job trùng lặp trong DB.
- [ ] **AC6 (An toàn UNKNOWN):** Thao tác ghi bị ngắt mạng sau commit không được tự động phát lại; bước dừng ở `UNKNOWN` với thông báo yêu cầu đối soát.

---

## 5. Lệnh Kiểm tra và Cổng Bằng chứng (Command & Evidence Gates)

1. **Kiểm tra Ký số & Raw Body Ingress:**
   ```powershell
   # [Create] test signature verification và timestamp window
   node --test apps/chat-api/tests/slack/slack-events-signature.test.mjs
   ```
2. **Kiểm tra Authorizations Fanout & F4 Lifecycle:**
   ```powershell
   # [Create] test fanout với PG16 thật và Fake Slack authorizations endpoint
   node --test apps/chat-api/tests/slack/slack-authorizations-fanout.test.mjs
   node --test apps/chat-api/tests/slack/slack-ingress-lifecycle-f4.test.mjs
   ```
3. **Kiểm tra Echo Guard & UNKNOWN Safety:**
   ```powershell
   # [Create] test echo suppression và UNKNOWN no-retry
   node --test apps/chat-api/tests/slack/slack-echo-guard.test.mjs
   node --test packages/executor/tests/myslack-unknown-safety.test.mjs
   ```
4. **Kiểm tra Toàn diện Suite:**
   ```powershell
   npm run test:slack:foundation
   npm run typecheck:v3
   npm run check
   ```

---

## 6. Kết quả (Dành cho Agent Thi công)

*(Phần này để trống cho agent thi công ghi lại kết quả RED→GREEN, commit hashes, test logs và evidence).*

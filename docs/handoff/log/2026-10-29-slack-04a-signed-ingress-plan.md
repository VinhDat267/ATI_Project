# 29/10/2026 · Lập Kế hoạch Chi tiết SLACK-04A — Ingress Ký số, Thử thách & Cam kết Bền vững ACK

**Tác giả:** Backend Planning Owner (Antigravity `gemini-3.8-flash-high`).
**Ủy quyền:** Điều phối viên trưởng / Reviewer (Coordinator) chỉ định lập kế hoạch kỹ thuật chi tiết, độc lập cho SLACK-04A trong môi trường worktree phân lập.
**Nhánh làm việc:** `docs/slack-04a-ingress-plan` (chuyển đổi an toàn từ worktree `docs-slack-04a-ingress-plan`).
**Nền đối chiếu đã thẩm định (Staging base):** `b757ae081751168fdcbcfdddf73713d4a1d9109d` (bao gồm PR #190 callback isolation fix, PR #187 contracts 02A, PR #185 inventory 354 methods, PR #188 macro delivery roadmap).
**Phạm vi phiên:** **CHỈ TÀI LIỆU KẾ HOẠCH (Documentation Planning Only)**. Tạo mới đúng 3 tệp tài liệu kế hoạch được phân quyền sở hữu. Tuyệt đối không can thiệp mã nguồn sản phẩm, không sửa `CURRENT-STATE.md`, `ROADMAP.md`, các task card khác hay inventory. Không gọi mô hình thật, không cài ứng dụng Slack live, không bật cờ và không merge PR vào `main`.

---

## 1. Tóm tắt Quyết định Kỹ thuật & Ranh giới Bounded 04A

Phiên lập kế hoạch đã giải quyết toàn diện 6 nhóm yêu cầu kỹ thuật nghiêm ngặt do Điều phối viên trưởng đặt ra cho SLACK-04A:

### 1. Thu thập Raw Buffer & Thứ tự Mount Middleware
- **Thứ tự Mount trong Express:** Route `POST /api/slack/events` bắt buộc được gắn trong `apps/chat-api/src/app.ts` **TRƯỚC** khi gọi `app.use(express.json())`.
- **Bảo toàn Buffer Nguyên bản:** Middleware thu thập dữ liệu nhị phân nguyên bản (`Buffer`) trực tiếp từ incoming request stream với trần dung lượng cứng 1 MB. Nếu request vượt quá 1 MB -> trả về ngay lập tức HTTP 413 `Payload Too Large`.
- **Bảo mật Trước Xác thực:** Tuyệt đối không parse JSON, không log body và không lưu database trước khi chữ ký mật mã được kiểm chứng thành công.

### 2. Mật mã HMAC-SHA256 v0, Timing-Safe & Cửa sổ Freshness 300s
- **Công thức chuẩn tắc:** `v0=HMAC_SHA256(signing_secret, "v0:" + timestamp + ":" + rawBody)`.
- **Chống Replay:** Header `X-Slack-Request-Timestamp` bắt buộc là số nguyên hợp lệ và thỏa mãn `|Math.floor(Date.now() / 1000) - timestamp| <= 300` giây (5 phút). Lệch quá 300s hoặc sai định dạng ném mã lỗi HTTP 400 `Bad Request` (`INVALID_TIMESTAMP`).
- **Chống Timing Attack An toàn:** So sánh chữ ký bằng `crypto.timingSafeEqual` bắt buộc phải kiểm tra `Buffer.byteLength(expected) === Buffer.byteLength(received)` trước nhằm triệt tiêu hoàn toàn nguy cơ ném lỗi `RangeError`.
- **Fail-Closed khi Thiếu Cấu hình:** Thiếu `SLACK_SIGNING_SECRET` hoặc `MYSLACK_APP_ID` lập tức trả về HTTP 500/503 mà không bao giờ bỏ qua lớp bảo vệ chữ ký.

### 3. Phản hồi URL Verification Challenge Tức thì
- Chỉ sau khi chữ ký mật mã hợp lệ, JSON payload mới được phân tích cú pháp.
- Đối với `type: 'url_verification'`, hệ thống trích xuất `payload.challenge` và phản hồi HTTP 200 `{ challenge }` tức thì. Tuyệt đối không ghi database receipt, không gọi hàng đợi, và không tạo background job cho sự kiện thử thách này.

### 4. Kiến trúc Body-Free Receipt: Giải quyết Mâu thuẫn F1 Consent vs Ngân sách ACK 3 Giây
- **Vấn đề cốt lõi:** Yêu cầu F1 (Mục 4.4 đặc tả v3) nghiêm cấm lưu trữ nội dung hội thoại Slack vào database khi chưa có chấp thuận của tổ chức (organization consent). Tuy nhiên, Slack Events API đòi hỏi phải trả lời ACK 200 trong vòng 3 giây, trong khi việc fanout phân giải quyền và đối soát consent diễn ra bất đồng bộ.
- **Giải pháp kiến trúc:** Bảng `slack_event_receipts` áp dụng mô hình **Biên nhận Không chứa Nội dung (Body-Free Receipt)**. Bảng chỉ lưu các định danh định tuyến tối thiểu (`slack_app_id`, `event_id`, `team_id`, `event_type`, `event_ts`, `event_context`, `channel_id`, `message_ts`). Không tồn tại cột `text` hay `body_json` thô không giới hạn.
- **Authorized Deferred Retrieval:** Worker ở Giai đoạn 04B khi nhận intent sẽ đối soát bằng chứng chấp thuận F1 từ DB (`SlackCanonicalPolicyReference`), chỉ khi có quyền mới thực hiện đọc nội dung bằng user token của người được phân phối quyền.

### 5. Cam kết Bền vững (Durable Commit ACK) & Concurrency Idempotency
- Đối với các sự kiện cần xử lý, HTTP 200 `{ ok: true }` **CHỈ ĐƯỢC GỬI SAU KHI** receipt đã được commit thành công vào PostgreSQL.
- Database gặp sự cố (mất kết nối, deadlock, đầy disk) -> bắt buộc trả về HTTP 500/503 để Slack retry tự nhiên; tuyệt đối không fake 200.
- Khóa duy nhất `UNIQUE (slack_app_id, event_id)` trên PostgreSQL thật đảm bảo xử lý đồng thời (concurrency) an toàn: các lượt retry cùng `event_id` được xử lý qua `ON CONFLICT DO NOTHING`, trả về HTTP 200 ngay lập tức mà không nhân bản queue intent.

### 6. Độc lập Cờ Tính năng & Vòng đời F4 (Flag-Independent Lifecycle)
- Ingress endpoint và luồng vòng đời vẫn sẵn sàng hoạt động khi `MYSLACK_ENABLED=off`, `MYSLACK_AUTOMATION_ENABLED=off` hoặc workspace đang tạm dừng (pause).
- Khi cờ tắt/pause:
  - Tin nhắn thường: Xác thực chữ ký hợp lệ -> trả về HTTP 200 và discard body ngay trong memory; không ghi receipt hay job chờ quyền trong tương lai.
  - Sự kiện vòng đời (`tokens_revoked`, `app_uninstalled`, `message_deleted`, `message_changed`): BẮT BUỘC ghi nhận intent bền vững trước khi trả về HTTP 200.
  - Sự kiện `tokens_revoked` chỉ thu hồi chính xác các `user_id` bị ảnh hưởng, tăng `identity_version` cho đúng kết nối đó; không thu hồi tràn lan toàn bộ người dùng trong workspace.

### 7. Phân rã Hạ tầng 04B & An toàn Thực thi 04C
- Phương thức Slack `apps.event.authorizations.list` được ghi nhận chuẩn xác là **Hạ tầng Nội bộ (Internal Infrastructure)** cần app-level token (`authorizations:read`) truyền qua header `Authorization: Bearer <app_token>`, phục vụ phân phối quyền ngầm. Đây hoàn toàn không phải công cụ nghiệp vụ cho người dùng cuối; trạng thái kiểm kê trong method inventory giữ nguyên `excluded`.
- Mọi cơ chế outbox ledger, Echo Guard chặn lặp tin ATI và trạng thái ngắt mạng `UNKNOWN` được bảo lưu nguyên vẹn cho Giai đoạn 04C; không cho phép kích hoạt bất kỳ phương thức ghi nào trước khi giao thức an toàn 04C được nghiệm thu.

---

## 2. Bằng chứng Tự Kiểm tra Base-to-Head (Evidence Checks)

| Hạng mục kiểm tra | Lệnh thực hiện | Kết quả thực tế |
|---|---|---|
| Cú pháp Whitespace / Diff | `git diff --check b757ae08 HEAD` | Sạch sẽ, 0 lỗi whitespace, exit code 0 |
| Trạng thái Working Tree | `git status --porcelain` | Sạch sẽ, đúng 3 tệp tài liệu kế hoạch |
| Ranh giới Module | `git diff --name-only b757ae08 HEAD` | 100% thuộc `docs/` |
| Bảo vệ Mã nguồn & Trạng thái | Kiểm tra `apps/`, `packages/`, `CURRENT-STATE.md`, `ROADMAP.md` | Không có bất kỳ thay đổi nào |

---

## 3. Danh sách Tệp Tạo mới

1. [`docs/handoff/tasks/SLACK-04A-signed-ingress.md`](../tasks/SLACK-04A-signed-ingress.md): Task card kỹ thuật bounded cho SLACK-04A với đầy đủ tiêu chí nghiệm thu AC1–AC8 và cổng kiểm tra Vitest/PG16.
2. [`docs/superpowers/plans/2026-10-29-slack-04a-signed-ingress.md`](../../superpowers/plans/2026-10-29-slack-04a-signed-ingress.md): Kế hoạch triển khai TDD RED→GREEN 6 task chi tiết từ migration DB, crypto verifier, ingress service, Express route mounting, DI wiring tới integration suite.
3. [`docs/handoff/log/2026-10-29-slack-04a-signed-ingress-plan.md`](2026-10-29-slack-04a-signed-ingress-plan.md): Handoff log ghi nhận toàn bộ quyết định kiến trúc và bằng chứng tự kiểm tra của phiên làm việc.

---

## 4. Bàn giao và Bước tiếp theo

1. Toàn bộ 3 tệp tài liệu đã được chuẩn bị đầy đủ và tuân thủ tuyệt đối ranh giới module của dự án.
2. Tiến hành commit chính xác 3 tệp tài liệu bằng conventional commit và thực hiện push thông thường lên nhánh `docs/slack-04a-ingress-plan`.
3. Mở Draft PR nhắm vào nhánh đích `integration/slack-personal-20261029`.
4. Kiểm tra hòm thư điều phối qua `orca orchestration check`.
5. Gửi thông báo `worker_done` kèm báo cáo tóm tắt 3 câu, Task ID `task_dc06416faca0` và Dispatch ID `ctx_e91a35f6e92d`, sau đó chuyển sang trạng thái nhàn rỗi (idle) chờ Lead / Reviewer độc lập thẩm định kế hoạch.

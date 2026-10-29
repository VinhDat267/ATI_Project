# 29/10/2026 · Lập Kế hoạch Chi tiết SLACK-04A — Ingress Ký số, Thử thách & Cam kết Bền vững ACK

**Tác giả:** Backend Planning Owner (Antigravity `gemini-3.8-flash-high`).
**Ủy quyền:** Điều phối viên trưởng / Reviewer (Coordinator) chỉ định lập và hiệu chỉnh kế hoạch kỹ thuật chi tiết, độc lập cho SLACK-04A trong môi trường worktree phân lập (PR #195, Task ID `task_8ac72658af5d`, Dispatch ID `ctx_2f967703f46f`).
**Nhánh làm việc:** `docs/slack-04a-ingress-plan` (chuyển đổi an toàn từ worktree `docs-slack-04a-ingress-plan`).
**Nền đối chiếu đã thẩm định (Staging base):** `b757ae081751168fdcbcfdddf73713d4a1d9109d` (bao gồm PR #190 callback isolation fix, PR #187 contracts 02A, PR #185 inventory 354 methods, PR #188 macro delivery roadmap).
**Phạm vi phiên:** **CHỈ TÀI LIỆU KẾ HOẠCH (Documentation Planning Only)**. Cập nhật và tinh chỉnh đúng 3 tệp tài liệu kế hoạch thuộc quyền sở hữu. Tuyệt đối không can thiệp mã nguồn sản phẩm, không sửa `CURRENT-STATE.md`, `ROADMAP.md`, các task card khác hay inventory. Không gọi mô hình thật, không cài ứng dụng Slack live, không bật cờ và không merge PR vào `main`.

---

## 1. Tóm tắt Hiệu chỉnh Theo 7 Điểm Thẩm định của Coordinator

Phiên làm việc đã xử lý triệt để 7 nhóm lỗi kỹ thuật và sự không nhất quán giữa mã giả định và mô tả văn bản:

### 1. Băm Trực tiếp Byte Thô, Timestamp Bounded & Xử lý Stream 413 An toàn
- **Khắc phục lỗi UTF-8 Roundtrip:** Chuyển đổi mã băm từ `rawBody.toString('utf8')` sang băm trực tiếp trên buffer byte thô: `createHmac('sha256', secret).update('v0:' + timestampHeader + ':').update(rawBody).digest('hex')`. Bảo vệ an toàn tuyệt đối các payload chứa ký tự non-ASCII hoặc chuỗi byte nhị phân đặc biệt không bị thay đổi mã băm bởi unicode decode.
- **Xác thực Timestamp Bounded:** Sử dụng regex chặt chẽ `/^\d{1,10}$/` để loại bỏ mọi timestamp chứa khoảng trắng (`' 1730214000 '`), dấu cộng (`'+1730214000'`), số thập phân (`'1730214000.5'`) hoặc ký tự lạ; từ chối bằng HTTP 400 `Bad Request` (`INVALID_TIMESTAMP`).
- **Xử lý Stream Timeout & HTTP 413:** Bổ sung timeout đọc stream 5.000 ms và lắng nghe sự kiện hủy kết nối (`aborted`). Khi stream vượt quá 1 MB, middleware gửi phản hồi HTTP 413 `Payload Too Large` và chỉ đóng kết nối sau khi phản hồi đã hoàn tất gửi đi (`res.on('finish')`), không destroy socket sớm gây mất mã trạng thái của client.

### 2. URL Verification Challenge Chuẩn Slack Docs & Ràng buộc Sự kiện Thường
- **Chuẩn hóa URL Verification Challenge:** Theo tài liệu chính thức [Slack URL Verification](https://docs.slack.dev/reference/events/url_verification/), payload thử thách chứa `{ token, challenge, type }` mà không bắt buộc có `api_app_id`. Kế hoạch chấp nhận challenge hợp lệ không có `api_app_id` và phản hồi HTTP 200 `{ challenge }` tức thì; nếu có truyền `api_app_id` thì bắt buộc phải khớp cấu hình.
- **Ràng buộc Sự kiện Nghiệp vụ (`event_callback`):** Bắt buộc có `api_app_id` khớp cấu hình và `team_id` hợp lệ. Loại bỏ hoàn toàn cơ chế fallback nguy hiểm sang `authorizations[0]` (có thể gây sai lệch tổ chức trong các kênh Slack Connect).

### 3. Cam kết Bền vững Nguyên tử (Atomic Durable ACK)
- **Loại bỏ Mô hình Phân mảnh:** Thay thế hoàn toàn quy trình "commit receipt -> gọi hook -> ghi intent sau" (dễ gây mất intent nếu crash giữa chừng hoặc tạo duplicate 200 fast-path) bằng API nguyên tử duy nhất: `recordReceiptAtomic(input)` chạy trong một transaction PostgreSQL duy nhất (`BEGIN ... COMMIT`).
- **Receipt là Trạng thái Thẩm quyền Bền vững:** Bản ghi `slack_event_receipts` với trạng thái `status: 'pending_fanout' | 'pending_lifecycle'` là trạng thái lưu vết có thẩm quyền. Khôi phục sau crash (startup recovery) và queue worker ở 04B sẽ quét tìm trạng thái pending qua `SKIP LOCKED`. Hook in-memory chỉ là gợi ý đánh thức (wakeup notification hint).
- **Ràng buộc Duy nhất Cho Intent:** Bảng `slack_lifecycle_intents` bổ sung ràng buộc duy nhất `UNIQUE (receipt_id, intent_type)` để chống nhân bản intent.

### 4. Phân loại Đầy đủ 4 Loại Sự kiện Vòng đời & Typed Payload
- **Phân biệt User Token vs Bot Token:** Sự kiện `tokens_revoked` chỉ trích xuất User IDs từ `tokens.oauth`. Tuyệt đối không dùng `tokens.bot` để thu hồi kết nối người dùng cá nhân.
- **Xử lý `message_deleted` & `message_changed`:** Ghi nhận chính xác định danh `(channel_id, message_ts, event_ts, edit_ts)`, không lưu trữ văn bản tin nhắn sửa đổi vào receipt hay intent.
- **Typed Bounded Lifecycle Payload:** Thay thế `payload_json jsonb` không ràng buộc bằng cấu trúc union gõ kiểu nghiêm ngặt `SlackLifecycleIntentPayload`, ngăn chặn việc lưu trữ payload tự do.

### 5. Rào cản Đọc Tức thì F3 & Bảo vệ Replay Epoch
- **Rào cản Đọc F3 Trước ACK:** Cập nhật trạng thái kết nối `status = 'revoked'` và tăng `identity_version` ngay trong transaction trước khi gửi ACK 200. Các truy vấn đọc nguồn từ 03B/03C và planner lập tức nhìn thấy rào cản vô hiệu hóa và chặn truy cập ngay cả khi luồng purge vật lý đang chờ thực thi lại.
- **Bảo vệ Replay Epoch:** Thêm điều kiện `connected_at <= event_ts` khi thu hồi token để đảm bảo một sự kiện revoke cũ hoặc bị phát lại không thể thu hồi nhầm một thế hệ kết nối mới vừa được kết nối lại sau thời điểm phát sự kiện.

### 6. Quyền Sở hữu Trạng thái Tạm dừng (Pause Ownership)
- **Loại bỏ `isWorkspacePaused(teamId)`:** Trạng thái tạm dừng (`pause`) là cấu hình riêng của từng người dùng trong từng workspace, không áp dụng mức toàn workspace. Việc tạm dừng của User A không được ảnh hưởng tới User B trong cùng workspace.
- **Ranh giới Ingress vs Fanout:** Ingress (04A) chỉ kiểm tra cờ máy chủ toàn cục `MYSLACK_AUTOMATION_ENABLED`. Việc kiểm tra pause của từng cá nhân, chấp thuận F1 và `processing_start_watermark` do worker 04B thực thi ở thời điểm phân phối quyền, ngăn chặn triệt để việc quét bù (backfill) trái phép.

### 7. Loại bỏ Số đo Giả định & Giữ Đề xuất Migration NNNN
- Xóa bỏ hoàn toàn số đo giả định `<50ms`. Kế hoạch nêu rõ mục tiêu đáp ứng SLA 3 giây của Slack dựa trên thiết kế giới hạn Ingress ở các thao tác mật mã in-memory và 1 transaction DB duy nhất; số đo thực tế sẽ được kiểm thử và đo lường khi chạy benchmark.
- Giữ nguyên số thứ tự migration đề xuất là `NNNN_slack_event_receipts.sql` cho tới khi có quyết định cấp phát chính thức từ lead, không gán trước số thứ tự chưa phân bổ.

---

## 2. Bằng chứng Tự Kiểm tra Base-to-Head (Evidence Checks)

| Hạng mục kiểm tra | Lệnh thực hiện | Kết quả thực tế |
|---|---|---|
| Cú pháp Whitespace / Diff | `git diff --check b757ae08 HEAD` | Sạch sẽ, 0 lỗi whitespace, exit code 0 |
| Trạng thái Working Tree | `git status --porcelain` | Sạch sẽ, đúng 3 tệp tài liệu kế hoạch |
| Ranh giới Module | `git diff --name-only b757ae08 HEAD` | 100% thuộc `docs/` |
| Bảo vệ Mã nguồn & Trạng thái | Kiểm tra `apps/`, `packages/`, `CURRENT-STATE.md`, `ROADMAP.md` | Không có bất kỳ thay đổi nào |
| Tính toàn vẹn Liên kết Markdown | `Test-Path` trên toàn bộ relative paths | Tất cả liên kết hợp lệ (`True`) |

---

## 3. Danh sách Tệp Hiệu chỉnh

1. [`docs/handoff/tasks/SLACK-04A-signed-ingress.md`](../tasks/SLACK-04A-signed-ingress.md): Task card kỹ thuật bounded cho SLACK-04A cập nhật đầy đủ 7 điểm thẩm định, tiêu chí AC1–AC8 và cổng kiểm tra Vitest/PG16.
2. [`docs/superpowers/plans/2026-10-29-slack-04a-signed-ingress.md`](../../superpowers/plans/2026-10-29-slack-04a-signed-ingress.md): Kế hoạch triển khai TDD RED→GREEN 6 tasks chi tiết (migration DB đề xuất `NNNN`, crypto verifier không roundtrip UTF-8, ingress service nguyên tử, Express route stream-safe, DI wiring, integration suite).
3. [`docs/handoff/log/2026-10-29-slack-04a-signed-ingress-plan.md`](2026-10-29-slack-04a-signed-ingress-plan.md): Handoff log ghi nhận chi tiết việc khắc phục 7 điểm thẩm định và kết quả tự kiểm tra base-to-head.

---

## 4. Bàn giao và Bước tiếp theo

1. Toàn bộ 3 tệp tài liệu đã được đồng bộ hóa và giải quyết trọn vẹn mọi yêu cầu phản biện của Reviewer.
2. Commit các thay đổi bằng conventional commit và thực hiện push thông thường lên nhánh `docs/slack-04a-ingress-plan` trên GitHub để cập nhật nội dung PR #195.
3. Kiểm tra hòm thư điều phối qua `orca orchestration check`.
4. Gửi thông báo `worker_done` với Task ID `task_8ac72658af5d` và Dispatch ID `ctx_2f967703f46f`, sau đó chuyển sang trạng thái nhàn rỗi (idle) chờ thẩm định độc lập.

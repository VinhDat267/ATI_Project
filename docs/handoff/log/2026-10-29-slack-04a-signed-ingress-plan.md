# 29/10/2026 · Lập Kế hoạch Chi tiết SLACK-04A — Ingress Ký số, Thử thách & Cam kết Bền vững ACK

**Tác giả:** Backend Planning Owner (Antigravity `gemini-3.8-flash-high`).
**Ủy quyền:** Điều phối viên trưởng / Reviewer (Coordinator) chỉ định hiệu chỉnh dứt điểm các mâu thuẫn kỹ thuật cuối cùng cho SLACK-04A PR #195 (`task_4657a714dfd7` / `ctx_6e0e5e1be2ce`), tiếp nối các phiên lập kế hoạch trước đó (`ad85b7e2`, `55fdd0ca`, `ba805099`).
**Nhánh làm việc:** `docs/slack-04a-ingress-plan`.
**Nền đối chiếu đã thẩm định (Staging base):** `b757ae081751168fdcbcfdddf73713d4a1d9109d` (bao gồm PR #190 callback isolation fix, PR #187 contracts 02A, PR #185 inventory 354 methods, PR #188 macro delivery roadmap).
**Phạm vi phiên:** **CHỈ TÀI LIỆU KẾ HOẠCH (Documentation Planning Only)**. Cập nhật và tinh chỉnh đúng 3 tệp tài liệu kế hoạch thuộc quyền sở hữu (plan, task card, handoff log). Không can thiệp mã nguồn runtime sản phẩm, không sửa `CURRENT-STATE.md`, `ROADMAP.md`, các task card khác hay inventory. Không gọi mô hình thật, không cài ứng dụng Slack live, không bật cờ và không merge PR vào `main`. Giữ plan lean <= 420 lines (thực tế: 261 dòng).

---

## 1. Tóm tắt Xử lý Triệt để 5 Điểm Thẩm định Cuối cùng từ Reviewer trên `ad85b7e2`

### 1. Phân định Interval Epoch `[t, t+1)` & Rào cản Epoch Fencing
- **Khắc phục lỗi Millisecond lọt kiểm tra:** Trước đây, điều kiện `connected_at > to_timestamp(event_time)` vô tình thỏa mãn với các timestamp cùng giây có phần millisecond (`1730214000.354 > 1730214000.000`), dẫn đến việc bỏ qua các sự kiện revoke cùng giây.
- **Phân loại 3 ca loại trừ lẫn nhau trên integer-second `t = event_time`:**
  1. *Trước rõ ràng (`connected_at < to_timestamp(t)`):* Ngắt kết nối dứt khoát: `status = 'disconnected'`, `config = NULL`, tăng `identity_version`, reset `refresh_in_flight = false`.
  2. *Bất định cùng giây (`connected_at >= to_timestamp(t) AND connected_at < to_timestamp(t + 1)`):* Không ngắt kết nối và KHÔNG xóa config! Chuyển sang `status = 'reconnect_required'`, giữ encrypted token riêng tư trong `config` (chặn toàn bộ content query), tăng `identity_version`, reset `refresh_in_flight = false`, ghi intent ambiguity để worker probe bằng metadata-only `auth.test` có CAS guard chống race với reconnect/refresh mới.
  3. *Mới hơn rõ ràng (`connected_at >= to_timestamp(t + 1)`):* Bỏ qua, coi là sự kiện revoke cũ bị trễ (stale replay).
- **Thẩm quyền thời gian:** Auth event timestamps không phải `Date.now` authority. Mảng `tokens.oauth` mang các actor ID của người dùng, không phải token ID.

### 2. Bảo toàn Credential khi Ambiguity & Đồng bộ Ràng buộc Database 02B
- **Bảo toàn Credential:** Loại bỏ hoàn toàn lỗi thiết lập `config = NULL` khi ambiguity (hủy mất credential trước khi kịp gọi `auth.test`).
- **Phù hợp Schema 02B (`0014_slack_oauth_connections.sql`):** Ràng buộc `CHECK ((status = 'disconnected' AND config IS NULL) OR status <> 'disconnected')` hoàn toàn cho phép `config` tồn tại khi `status = 'reconnect_required'`.
- **Nguyên tắc xóa Config:** CHỈ xóa `config = NULL` khi ngắt kết nối dứt khoát (`connected_at < to_timestamp(t)`). Tôn trọng đầy đủ các trường thật của repo 02B: `refresh_in_flight`, `identity_version`, `status`. Tuyệt đối không đưa token vào receipt, intent hay DTO.

### 3. Loại bỏ Tombstone Cạnh tranh & Phối hợp Rào cản Đọc F3 qua 03B1
- **Loại bỏ Tombstone Toàn cục `app:*`:** Rào cản `channelId: '*', resourceId: 'app:' + appId` trước đây thiếu generation fencing, có thể gây chặn vĩnh viễn việc cài đặt lại ứng dụng trong tương lai.
- **Thống nhất Cơ chế Rào cản qua 03B1:** Loại bỏ hoàn toàn đề xuất bảng `slack_source_tombstones` riêng ở 04A. Ingress phối hợp trực tiếp với giao diện transaction-bound của 03B1: `commitLifecycleInvalidation(client, target, barrier)` trong cùng một transaction PostgreSQL trước khi gửi ACK 200:
  - `tokens_revoked` & `app_uninstalled`: Ghi intent `authorization_disconnect` nhắm vào các binding/epoch CŨ, không ảnh hưởng tới kết nối mới sau này.
  - `message_deleted`: Ghi rào cản `resource_lifecycle` (`tombstoneReason: 'source_deleted'`), rào cản tài nguyên vĩnh viễn, ngăn chặn resurrection khi có edit đến muộn.
  - `message_changed`: Ghi rào cản `resource_lifecycle` (`tombstoneReason: 'source_edited'`), vô hiệu hóa đơn điệu các revision cũ (`revision < editTs`), bảo toàn revision mới.

### 4. Mở rộng Hợp đồng Watermark 6 Chiều Cho Body-Free Receipt
- **Hợp đồng Watermark 6 Chiều:** Tự thân Body-Free Receipt không đủ để bảo đảm F1. Worker 04B bắt buộc đối soát `source_event_time` với đầy đủ 6 chiều watermark:
  `source_event_time >= MAX(processing_start_watermark, consent_grant_watermark, identity_epoch_watermark, provider_attestation_watermark, config_revision_watermark, resume_watermark)`.
- **Parse Timestamp Nghiêm ngặt:** Trích xuất `source_event_time` từ epoch Slack bằng regex `/^\d{1,10}(\.\d{1,6})?$/`. Nghiêm cấm `parseFloat` chấp nhận suffix junk (như `'1730214000abc'`). Timestamp không rõ ràng fail-closed ngay tại ranh giới.
- **Phân tách F4:** Vòng đời F4 xử lý độc lập, không đòi hỏi automation hay model để thiết lập rào cản.

### 5. Hook In-Process là Bounded Wakeup & Kiểm tra Hợp lệ Đầu vào
- **Khắc phục Lỗi Await Hook Sau Commit:** Không `await` consumer hook in-memory sau khi đã commit transaction, tránh nguy cơ treo hoặc trả về HTTP 500 sai sau commit. Hook chỉ là wakeup có giới hạn (best-effort fire-and-forget `.catch(() => {})`). Khi crash/restart, worker 04B quét lại các bản ghi pending bằng `SELECT ... FOR UPDATE SKIP LOCKED`.
- **Fail-Closed khi Malformed:** Các trường sự kiện vòng đời bắt buộc được kiểm tra kiểu dữ liệu nghiêm ngặt; nếu malformed, fail-closed từ chối ngay, tuyệt đối không để lọt vào luồng xử lý automation.

---

## 2. Kế hoạch Tinh gọn (Lean Plan <= 420 Lines)

- Kế hoạch `docs/superpowers/plans/2026-10-29-slack-04a-signed-ingress.md` được rút gọn từ 632 dòng xuống còn **261 dòng** (đạt yêu cầu <= 420 dòng).
- Loại bỏ toàn bộ các đoạn mã giả định (speculative service bodies / contradictory SQL) dài dòng, thay bằng các bất biến kỹ thuật chính xác, định nghĩa giao diện (interfaces) và danh mục kiểm thử rõ ràng.

---

## 3. Ma trận Kiểm thử và Trạng thái Nghiệm thu (Test Matrix & Evidence Gates)

Ma trận kiểm thử cho 04A được định nghĩa toàn diện và đánh dấu trạng thái **NOT_RUN** trong phiên lập kế hoạch tài liệu:
1. Fractional same-second (`connected_at = t + 0.354s`, `event_time = t`): Chuyển `reconnect_required`, giữ token trong `config`, ghi ambiguity intent.
2. Delayed old revoke (`event_time = t`, `connected_at = t + 2s`): Kết nối mới nguyên vẹn.
3. Delayed old grant (`connected_at = t - 5s`, `event_time = t`): Ngắt kết nối dứt khoát.
4. Concurrency race: Refresh token in-flight song song với revoke -> CAS guard trên `identity_version` abort refresh an toàn.
5. Out-of-order edit/delete: Delete trước edit -> tin nhắn đã xóa không bị hồi sinh.
6. Mọi cờ tính năng tắt (`MYSLACK_ENABLED=off`, `MYSLACK_AUTOMATION_ENABLED=off`): F4 lifecycle vẫn commit nguyên tử trước ACK.

---

## 4. Bằng chứng Tự Kiểm tra Base-to-Head

| Hạng mục kiểm tra | Lệnh thực hiện | Kết quả thực tế |
|---|---|---|
| Cú pháp Whitespace / Diff | `git diff --check b757ae08 HEAD` | Sạch sẽ, 0 lỗi whitespace, exit code 0 |
| Trạng thái Working Tree | `git status --porcelain` | Sạch sẽ, đúng 3 tệp tài liệu kế hoạch |
| Ranh giới Module | `git diff --name-only b757ae08 HEAD` | 100% thuộc `docs/` |
| Bảo vệ Mã nguồn Sản phẩm | Kiểm tra `apps/`, `packages/`, `db/` | Không có bất kỳ thay đổi runtime code nào |
| Số dòng Kế hoạch | `(Get-Content docs/.../plan.md).Length` | **261 dòng** (đạt yêu cầu <= 420 dòng) |
| Tính toàn vẹn Liên kết Markdown | `Test-Path` trên toàn bộ relative paths | Tất cả liên kết hợp lệ (`True`) |

---

## 5. Danh sách Tệp Sở hữu & Bàn giao

1. [`docs/superpowers/plans/2026-10-29-slack-04a-signed-ingress.md`](../../superpowers/plans/2026-10-29-slack-04a-signed-ingress.md) (261 dòng): Kế hoạch kỹ thuật tinh gọn, giải quyết triệt để 5 mâu thuẫn review.
2. [`docs/handoff/tasks/SLACK-04A-signed-ingress.md`](../tasks/SLACK-04A-signed-ingress.md): Task card kỹ thuật bounded cập nhật interval `[t, t+1)`, phối hợp 03B1 barrier, và watermark 6 chiều.
3. [`docs/handoff/log/2026-10-29-slack-04a-signed-ingress-plan.md`](2026-10-29-slack-04a-signed-ingress-plan.md): Handoff log ghi nhận chi tiết việc khắc phục 5 điểm review và tự kiểm tra.

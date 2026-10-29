# 29/10/2026 · Lập Kế hoạch Chi tiết SLACK-04A — Ingress Ký số, Thử thách & Cam kết Bền vững ACK

**Tác giả:** Backend Planning Owner (Antigravity `gemini-3.8-flash-high`).
**Ủy quyền:** Điều phối viên trưởng / Reviewer (Coordinator) chỉ định hiệu chỉnh dứt điểm các mâu thuẫn kỹ thuật cuối cùng cho SLACK-04A PR #195 (`task_4657a714dfd7` / `ctx_6e0e5e1be2ce`), tiếp nối các phiên lập kế hoạch trước đó (`ad85b7e2`, `55fdd0ca`, `ba805099`).
**Nhánh làm việc:** `docs/slack-04a-ingress-plan`.
**Nền đối chiếu đã thẩm định (Staging base):** `b757ae081751168fdcbcfdddf73713d4a1d9109d` (bao gồm PR #190 callback isolation fix, PR #187 contracts 02A, PR #185 inventory 354 methods, PR #188 macro delivery roadmap).
**Phạm vi phiên:** **CHỈ TÀI LIỆU KẾ HOẠCH (Documentation Planning Only)**. Cập nhật và tinh chỉnh đúng 3 tệp tài liệu kế hoạch thuộc quyền sở hữu (plan, task card, handoff log). Không can thiệp mã nguồn runtime sản phẩm, không sửa `CURRENT-STATE.md`, `ROADMAP.md`, các task card khác hay inventory. Không gọi mô hình thật, không cài ứng dụng Slack live, không bật cờ và không merge PR vào `main`. Giữ plan lean <= 420 lines (thực tế: 263 dòng).

---

## 1. Tóm tắt Xử lý Triệt để 5 Điểm Thẩm định Cuối cùng từ Reviewer trên `ad85b7e2`

### 1. Thẩm quyền Thu hồi, Rào cản Tạm thời Trước Probe (Conservative Final Design)
- **Official Slack Event Authority:** Tài liệu chính thức của Slack ([tokens_revoked](https://docs.slack.dev/reference/events/tokens_revoked/)) chỉ cung cấp danh sách User IDs (`tokens.oauth: string[]`) và epoch seconds `event_time`, HOÀN TOÀN KHÔNG có token ID hay grant generation ID.
- **Không đoán định thế hệ grant từ timestamp/userID:** `connected_at < event_time` không phải là thẩm quyền thu hồi thế hệ hiện tại (kịch bản: token cũ bị thu hồi sau khi grant mới đã tạo). Timestamp chỉ là gợi ý thứ tự luồng.
- **Quy trình Thận trọng (Conservative Final Design):**
  1. Dưới cùng owner advisory lock (`withOwner(userId)`), bắt generation hiện tại (`identity_version`) và fingerprint private credential;
  2. Commit một rào cản đọc tạm thời (provisional generation-scoped read block) qua giao diện 03B1 `stageInTransaction(client, input)` trước ACK 200, **BẢO LƯU PRIVATE CONFIG** trong database (không xóa `config`);
  3. Trả lời HTTP 200 ACK cho Slack sau khi transaction bền vững đã commit;
  4. Sau ACK, worker chạy probe metadata-only `auth.test` có CAS guard trên `identity_version` với captured credential:
     - *Xác nhận invalid/revoked:* Ngắt kết nối dứt khoát (`status = 'disconnected'`, `config = NULL`, tăng `identity_version`, reset `refresh_in_flight`), thực thi purge thế hệ cũ chính xác qua 03B1;
     - *Xác nhận valid (cùng actor & workspace):* Thu hồi thuộc về grant cũ; grant mới vẫn hợp lệ! Gỡ bỏ DUY NHẤT rào cản tạm thời này, không purge snapshot mới, giữ nguyên trạng thái active (trừ khi đã có disconnect thủ công hoặc barrier khác can thiệp);
     - *Lỗi mạng/timeout/rate-limit (unknown):* Giữ nguyên fail-closed ở trạng thái `reconnect_required`.

### 2. Đồng bộ Khóa Owner Advisory Lock với TokenManager
- **Cơ chế TokenManager Hiện tại:** `SlackTokenManager` (`token-manager.ts`) giữ `withOwner(userId)` (`pg_advisory_lock('ati-slack-owner', userId)`) qua lượt refresh mạng và lưu `UPDATE slack_connections SET config... WHERE id` không có CAS.
- **Loại trừ Race Condition:** Không ngộ nhận refresh CAS tự động abort và không bịa đặt cột `refresh_attempt_id`. Mọi mutation trạng thái kết nối BẮT BUỘC phối hợp cùng owner advisory lock (`withOwner(userId)`) của TokenManager và khóa dòng, đồng thời lập kế hoạch tích hợp CAS có giới hạn (`WHERE id = $1 AND identity_version = $2`) để tuần tự hóa với khoảng thời gian refresh token mạng.
- **Bảo toàn Credential:** Phù hợp với schema 02B `CHECK ((status = 'disconnected' AND config IS NULL) OR status <> 'disconnected')`, chỉ xóa `config = NULL` khi probe xác nhận revoke hoặc disconnect dứt khoát. Không đưa token vào receipt, intent hay DTO.

### 3. Loại bỏ Tombstone Cạnh tranh & Chấp nhận Giao diện Rào cản Đọc F3 từ 03B1
- **Loại bỏ Tombstone Toàn cục `app:*`:** Rào cản `channelId: '*', resourceId: 'app:' + appId` trước đây thiếu generation fencing, có thể gây chặn vĩnh viễn việc cài đặt lại ứng dụng trong tương lai.
- **Thống nhất Cơ chế Rào cản qua 03B1:** Loại bỏ hoàn toàn đề xuất bảng `slack_source_tombstones` riêng ở 04A. Ingress phối hợp trực tiếp với giao diện transaction-bound của 03B1 (`stageInTransaction` thuộc `SlackTransactionBoundInvalidationService`) trong cùng một transaction PostgreSQL trước khi gửi ACK 200:
  ```ts
  export interface StageLifecycleInvalidationInput {
    target: SlackPurgeTarget;
    eventId: string;
    sourceEventTs: string;
  }
  ```
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

- Kế hoạch `docs/superpowers/plans/2026-10-29-slack-04a-signed-ingress.md` được rút gọn từ 632 dòng xuống còn **263 dòng** (đạt yêu cầu <= 420 dòng).
- Loại bỏ toàn bộ các đoạn mã giả định (speculative service bodies / contradictory SQL) dài dòng, thay bằng các bất biến kỹ thuật chính xác, định nghĩa giao diện (interfaces) và danh mục kiểm thử rõ ràng.

---

## 3. Ma trận Kiểm thử và Trạng thái Nghiệm thu (Test Matrix & Evidence Gates)

Ma trận kiểm thử cho 04A được định nghĩa toàn diện và đánh dấu trạng thái **NOT_RUN** trong phiên lập kế hoạch tài liệu:
1. Kịch bản Old-token revoke AFTER newer grant (`Grant 1 -> Grant 2 -> Revoke Grant 1 delayed`): provisional barrier probe `auth.test` xác nhận Grant 2 valid, gỡ provisional barrier mà không ngắt kết nối Grant 2.
2. Revoke confirmed by probe: `auth.test` trả về invalid -> disconnect dứt khoát + tăng `identity_version` + purge exact old generation.
3. Fractional same-second (`connected_at = t + 0.354s`, `event_time = t`): provisional barrier + metadata probe có CAS guard.
4. Concurrency race với `SlackTokenManager`: Refresh in-flight dưới `withOwner(userId)` tuần tự hóa với webhook revocation, CAS guard ngăn chặn overwrite.
5. Out-of-order edit/delete: `message_deleted` trước `message_changed` -> tin nhắn đã xóa không bị hồi sinh.
6. Mọi cờ tính năng tắt (`MYSLACK_ENABLED=off`, `MYSLACK_AUTOMATION_ENABLED=off`): F4 lifecycle vẫn commit nguyên tử trước ACK.

---

## 4. Bằng chứng Tự Kiểm tra Base-to-Head

| Hạng mục kiểm tra | Lệnh thực hiện | Kết quả thực tế |
|---|---|---|
| Cú pháp Whitespace / Diff | `git diff --check b757ae08 HEAD` | Sạch sẽ, 0 lỗi whitespace, exit code 0 |
| Trạng thái Working Tree | `git status --porcelain` | Sạch sẽ, đúng 3 tệp tài liệu kế hoạch |
| Ranh giới Module | `git diff --name-only b757ae08 HEAD` | 100% thuộc `docs/` |
| Bảo vệ Mã nguồn Sản phẩm | Kiểm tra `apps/`, `packages/`, `db/` | Không có bất kỳ thay đổi runtime code nào |
| Số dòng Kế hoạch | `(Get-Content docs/.../plan.md).Length` | **263 dòng** (đạt yêu cầu <= 420 dòng) |
| Tính toàn vẹn Liên kết Markdown | `Test-Path` trên toàn bộ relative paths | Tất cả liên kết hợp lệ (`True`) |

---

## 5. Danh sách Tệp Sở hữu & Bàn giao

1. [`docs/superpowers/plans/2026-10-29-slack-04a-signed-ingress.md`](../../superpowers/plans/2026-10-29-slack-04a-signed-ingress.md) (263 dòng): Kế hoạch kỹ thuật tinh gọn, giải quyết triệt để 5 mâu thuẫn review.
2. [`docs/handoff/tasks/SLACK-04A-signed-ingress.md`](../tasks/SLACK-04A-signed-ingress.md): Task card kỹ thuật bounded cập nhật interval `[t, t+1)`, phối hợp 03B1 barrier, và watermark 6 chiều.
3. [`docs/handoff/log/2026-10-29-slack-04a-signed-ingress-plan.md`](2026-10-29-slack-04a-signed-ingress-plan.md): Handoff log ghi nhận chi tiết việc khắc phục 5 điểm review và tự kiểm tra.

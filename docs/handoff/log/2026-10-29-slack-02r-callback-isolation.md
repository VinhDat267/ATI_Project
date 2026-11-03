# 29/10/2026 · SLACK-02R — Sửa cách ly callback theo workspace & thứ tự state bền vững

**Tác giả:** Backend Owner (Antigravity gemini-3.8-flash-high).
**Ủy quyền:** Điều phối viên trưởng/reviewer chỉ định sau kết quả review độc lập nhánh `codex/slack-02-oauth` tại commit `ac448dd39fd8b9188c4ebc967cb735454bbc803d` (PR #184).
**Nhánh công việc:** `VinhDat267/fix-slack-callback-isolation` (base: `codex/slack-02-oauth`).
**Task card:** [`docs/handoff/tasks/SLACK-02R-callback-workspace-isolation.md`](../tasks/SLACK-02R-callback-workspace-isolation.md).

---

## 1. Bản chất sự cố P2 (Root Cause Analysis)

- Trong mã nguồn ban đầu của PR #184, tại `SlackConnectionRepo.save()`:
  Lệnh `DELETE FROM slack_oauth_states WHERE user_id=$1;` xóa sạch mọi state của người dùng sau khi một workspace kết nối thành công.
- Hậu quả: Nếu người dùng bắt đầu 2 luồng kết nối OAuth song song (cho 2 workspace khác nhau), luồng callback về sau sẽ bị mất state và thất bại (`saved: 1 / connections: 1`, mong đợi `connections: 2`).
- Nếu chỉ xóa state hiện tại (`DELETE ... WHERE id=$1`) mà không có cơ chế lưu vết thứ tự, luồng callback cũ hơn cho cùng một workspace có thể ghi đè token của luồng mới hơn đã lưu trước đó.

---

## 2. Giải pháp Kỹ thuật & Thay đổi Mã nguồn

1. **Thêm migration `db/v3/0015_slack_callback_order.sql`:**
   - Tạo sequence `slack_oauth_state_seq` để cấp phát số thứ tự tăng dần đơn điệu cho mỗi OAuth state (`order_seq bigint NOT NULL DEFAULT nextval('slack_oauth_state_seq')`).
   - Thêm cột `last_state_order bigint NOT NULL DEFAULT 0` vào bảng `slack_connections`.
   - Migration hoàn toàn idempotent với `IF NOT EXISTS`, an toàn khi chạy lại nhiều lần trên database đã có sẵn dữ liệu state/connection.
2. **Cập nhật `apps/chat-api/src/db/repositories/slack-connection-repo.ts`:**
   - Đọc `order_seq` của state đang xử lý trong transaction dưới advisory lock của user.
   - Khi INSERT/ON CONFLICT `(user_id, app_id, workspace_id)` DO UPDATE:
     Bổ sung điều kiện bảo vệ `WHERE excluded.last_state_order > slack_connections.last_state_order RETURNING *`.
     Nếu luồng cũ đến sau luồng mới cho cùng workspace, điều kiện WHERE không thỏa mãn -> không có row cập nhật -> rollback transaction và trả về `null`.
   - Xóa chính xác state đã lưu: `DELETE FROM slack_oauth_states WHERE id=$1 AND user_id=$2;`, bảo toàn tất cả các state khác của người dùng.
   - Giữ nguyên hợp đồng `disconnect` để đảm bảo an toàn tuyệt đối chống resurrection; ghi nhận việc tối ưu xóa state theo từng workspace cho thiết kế tương lai.

---

## 3. Bằng chứng Kiểm thử (RED → GREEN)

| Mục kiểm tra | Kết quả thực tế | Ghi chú |
|---|---|---|
| Regression PG ban đầu | RED: `AssertionError: expected null to be truthy` tại `save()` luồng 2 | Tái hiện đúng lỗi gốc (1/2 kết nối) |
| Regression HTTP Route ban đầu | RED: `AssertionError: expected 400 to be 200` tại callback 2 | Callback 2 bị 400 vì state bị xóa |
| 5 suite Slack backend sau sửa | **27/27 tests PASS**, exit code 0 | 22 tests gốc + 5 tests mới |
| 6 ca hành vi bắt buộc | **PASS 100%**: CAS per state, 2 workspace độc lập (cả thuận và nghịch thứ tự), bảo vệ stale cùng workspace, chống resurrection, reconnect tăng version, chống hijack danh tính | Chạy trên PostgreSQL thật |
| Migration 0015 lặp lại | **PASS**: Đọc trực tiếp file SQL gốc, chạy 2 lần liên tiếp khi đã có sẵn pending state và saved connection thật; pending state hoàn tất bình thường sau migration | Khắc phục theo phản hồi live review |
| HTTP Route song song | **PASS**: Dùng chung browser cookie phiên và gọi `Promise.all` đồng thời 2 callback, provider mock phân giải theo code/token | Khắc phục theo phản hồi live review |
| Full typecheck (`npm run typecheck`) | **EXIT 0**: Sạch toàn bộ TypeScript cả api và web | Không có lỗi compile |
| Full check Implementer (`npm run check`) | **EXIT 0**: 2.588 test v3 + 406 eval + 1 launcher + 66 Node fixtures | Chạy trực tiếp tại worktree này trên DB cô lập cổng 55534. Đính chính số liệu v3 thực tế là 2.588 (thay vì 2.583 kế thừa từ PR 184 chưa cộng 5 test mới) |
| Full check Reviewer độc lập (Lead) | **EXIT 0**: 2.588 test v3 (116+443+381+42+720+886) + 406 eval + 1 launcher + 66 Node fixtures | Lần 1 exit 1 do DB review cổng 55533 thiếu bảng public (`fullcheck.log`). Sau khi migrate (`migrate.log`), lần 2 rerun đạt EXIT 0 (`fullcheck-rerun.log`) |

---

## 4. Nguồn gốc Thực thi & Môi trường (Provenance Details)

- **Thư mục thực thi:** `C:\Users\VinhDat\orca\workspaces\ATI_Project\fix-slack-callback-isolation` (worktree hiện tại, không dùng `--prefix` sang checkout khác).
- **Target DB Implementer:** `postgresql://ati_v3:<sanitized>@127.0.0.1:55534/ati_v3` (container độc lập cổng 55534 tạo riêng, đã dọn sau khi kiểm tra xong).
- **Target DB Reviewer:** `postgresql://ati_v3:<sanitized>@127.0.0.1:55533/ati_v3` (container `ati-slack-review-184-20261029-postgres-1` của reviewer, được giữ nguyên).
- **Phân nhóm test v3 thực tế:**
  - `@wap/tool-schemas`: 12 files, 116 tests
  - `@wap/tool-adapters`: 18 files, 443 tests
  - `@wap/planner`: 27 files, 381 tests
  - `@wap/executor`: 5 files, 42 tests
  - `@wap/chat-api`: 101 files, 720 tests (22 test Slack cũ + 5 test Slack mới)
  - `@wap/chat-web`: 80 files, 886 tests
  - Tổng cộng: **243 test files, 2.588 tests v3 PASS**.

---

## 5. Ranh giới & Bàn giao

- Giữ nguyên toàn bộ mã frontend, schemas, adapters, config; không bật cờ `MYSLACK_ENABLED` hoặc gọi live API.
- Container PostgreSQL chung của reviewer (`ati-slack-review-184-20261029-postgres-1` trên cổng 55533) được bảo toàn nguyên trạng, không bị restart hay xóa schema.
- Nhánh `VinhDat267/fix-slack-callback-isolation` được tạo để mở Draft PR vào `codex/slack-02-oauth`, giữ cho diff tối giản và minh bạch, sẵn sàng cho reviewer độc lập đánh giá.

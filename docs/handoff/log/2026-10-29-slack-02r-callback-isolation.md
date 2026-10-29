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
| Full test suite (`npm run check`) | **EXIT 0**: 2.583 test v3 + 406 eval + 1 launcher + 66 Node fixtures | Không hồi quy bất kỳ module nào |

---

## 4. Ranh giới & Bàn giao

- Giữ nguyên toàn bộ mã frontend, schemas, adapters, config; không bật cờ `MYSLACK_ENABLED` hoặc gọi live API.
- Container PostgreSQL chung của reviewer (`ati-slack-review-184-20261029-postgres-1` trên cổng 55533) được bảo toàn nguyên trạng, không bị restart hay chạy đè migrations prod.
- Nhánh `VinhDat267/fix-slack-callback-isolation` được tạo để mở Draft PR vào `codex/slack-02-oauth`, giữ cho diff tối giản và minh bạch, sẵn sàng cho reviewer độc lập đánh giá.

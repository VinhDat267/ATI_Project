# 17/10/2026 · W4-04 · Sửa theo review độc lập #151

**Người viết:** reviewer (bên thi công) · **Nhánh:** `test/w4-04-frontend-latency` · [Review](https://github.com/VinhDat267/ATI_Project/pull/151): chưa đạt, 2 P2.

## Đã sửa

- **P2 – hết grace vẫn báo hoàn tất, bỏ lại kế hoạch đến muộn.**
  - Mỗi lượt có thêm trường `resolved`: hội thoại đã có phản hồi lưu trong PostgreSQL và không còn kế hoạch `pending`/`approved`/`executing` (`isSettled`).
  - Sau câu cuối, `runLatencyBatch` chờ chung tối đa `finalWaitMs` (`LIVE_APP_FINAL_WAIT_MS`, mặc định 120 s) cho các phản hồi còn thiếu, bấm Hủy, rồi đọc lại từng hội thoại. Bản cũ chỉ hủy những gì đã có lúc kiểm.
  - `summarizeLatency` trả `unresolved` (mã lượt và mã hội thoại). Tóm tắt ghi "Lượt chưa xác minh xong".
  - `latency.e2e.ts` ghi `complete: true` chỉ khi không còn lượt chưa xác minh, không còn kế hoạch mở và không có dòng `execution_steps`. Nếu không, lượt chạy fail sau khi đã ghi `batch.json` kèm danh sách `unresolved`.
- **P2 – percentile bỏ các lượt timeout nhưng ghi là "Toàn bộ".**
  - Lượt không thấy phản hồi được tính là chậm hơn ngưỡng chờ (`Infinity`) trong mọi percentile, cả bảng theo số dịch vụ. Khi percentile rơi vào các lượt này, tóm tắt in "> N s".
  - Tóm tắt thêm dòng "Có phản hồi: x/y".

## Kiểm thử

- PostgreSQL 16 tmpfs riêng ở 55533, sandbox, tài khoản CI, không dùng DB của `.env`.
- RED trên mã cũ:
  - đơn vị: 3 fail / 22 pass;
  - hai test browser mới: 2 fail.

  Hai test browser dùng trigger `BEFORE INSERT ON plans` với `pg_sleep(6)`, chỉ áp cho hội thoại có chuỗi đánh dấu, để kế hoạch đến sau cả grace và vòng kiểm cuối. Trigger bị xoá trong `finally`.
- GREEN:
  - đơn vị và PostgreSQL 26/26;
  - browser default (`W4-04:`) 4/4: chạy hết danh sách; kế hoạch đến muộn trong grace; kế hoạch đến sau vòng kiểm cuối làm lượt `resolved: false` và được liệt kê, rồi được hủy khi dọn; vòng chờ cuối hủy được kế hoạch đến sau grace;
  - browser clarification 1/1.
- Typecheck chặt 5 file: exit 0.
- Đột biến: 13 cũ và 6 mới, **19/19 bị bắt**, mỗi lần khôi phục và kiểm SHA-256.
  - Lượt đầu chỉ bắt 17/19: M1 (lượt không tự hủy kế hoạch) và M2 (lượt không chờ kế hoạch đến muộn) lọt, vì vòng kiểm cuối che mất trạng thái của từng lượt.
  - Test browser nay kiểm trạng thái ngay sau mỗi lượt qua `onTurn`: kế hoạch đã `rejected` trước câu tiếp theo, và lượt hết giờ tự chờ được kế hoạch đến muộn. Chạy lại M1, M2: đều bị bắt.
- `npm run check` (worktree, database tạm 55533, sandbox, không có `.env`): exit 0, **1.953 v3 + 199 eval** (173 + 26).

# 25/10/2026 · SCHED-01 · Sửa sau review độc lập lần 1 (#167)

**Người viết:** reviewer (bên thi công). **Nhánh:** `feat/sched-01-schedule-backend`, sửa trên head `3a9e4b1`. Review độc lập lần 1 tại `3a9e4b1`: **chưa đạt**, 2 P2. Log thi công: [SCHED-01](2026-10-25-reviewer-SCHED-01-schedule-backend.md).

## Hai lỗi của review

1. **P2: deadlock giữa xác nhận và nút tạm dừng.** Xác nhận khoá hội thoại rồi mới khoá lịch. `setStatus` thì khoá lịch trước, rồi `recordState` → `createMessage` khoá hội thoại. Bộ hẹn giờ cũng khoá lịch trước rồi ghi tin trạng thái vào hội thoại của lịch. Reviewer tái hiện được `40P01` và route trả 500.
2. **P2: bật lại lịch đã xong vượt giới hạn 10 lịch.** `update` chuyển lịch `completed` về `active`, nhưng phần kiểm giới hạn chỉ có ở `create`. Reviewer tái hiện được số lịch mở tăng từ 10 lên 11.

Cả hai đều đúng như mô tả. Bên thi công đọc lại mã và tái hiện bằng test RED bên dưới.

## Sửa

- **Thứ tự khoá chung**, ghi ở `ScheduleRepo.ownedSchedule` và đặc tả mục 6.5:
  1. hội thoại của lịch;
  2. lịch;
  3. chủ lịch (`users`);
  4. lượt;
  5. hội thoại của lượt.

  Đường nào cũng có thể bỏ qua một bậc, nhưng không quay ngược lên.
  - `ownedSchedule(…, lock = true)` khoá hội thoại trước (đọc `conv_id` trước, vì giá trị này không bao giờ đổi), rồi mới khoá lịch. Nút tạm dừng, chạy tiếp, hủy, "Chạy lượt này ngay" và "Lập lại kế hoạch" đều đi qua hàm này.
  - Nhịp của bộ hẹn giờ khoá cả hai dòng trong một câu: `JOIN conversations c … FOR UPDATE OF c, s SKIP LOCKED`. Một trong hai dòng đang bị giữ thì nhịp bỏ qua lịch đó, nên nhịp không bao giờ phải chờ khoá. Nhịp sau (30 s) xét lại.
  - Bước lưu kết quả của lượt bắt đầu từ dòng lịch và chỉ ghi vào hội thoại của lượt, nên không cần đổi. SCHED-02 nối `persist` thật; task card SCHED-02 thêm một dòng về thứ tự này.
- **Giới hạn khi bật lại.** Phần kiểm giới hạn tách thành `ensureRoom` (khoá `users`, đếm `active`/`paused`). `create` gọi hàm này như trước. `update` gọi khi lịch chuyển từ trạng thái không tính hạn mức sang trạng thái có tính. Lịch đang mở thì cập nhật như cũ, không kiểm lại.

## RED → GREEN

PostgreSQL 16 tmpfs riêng ở 56533, sandbox, không dùng `.env` hay DB dev. Log ở `.codex/sched01/review-*.log` của worktree (không commit).

| Test | RED trên `3a9e4b1` | GREEN |
|---|---|---|
| `schedule-locks.test.ts` · pauses and confirms the same schedule at the same time without a deadlock | `expected error: deadlock detected … to be an instance of ScheduleConflict` | đạt |
| `schedule-locks.test.ts` · never waits for the conversation of a due schedule another transaction holds | `expected 'blocked' to be 'done'` | đạt |
| `schedule-routes.test.ts` · refuses to turn a finished schedule back on when ten others are open | `expected 200 to be 409` | đạt |

Ca deadlock không giả lập khoá. Một kết nối thứ ba giữ dòng lịch, để lượt tạm dừng xếp hàng trước, rồi lượt xác nhận xếp sau. Test chờ tới khi PostgreSQL báo cả hai đang chờ khoá (`pg_stat_activity`, mỗi bên một `application_name`), rồi mới thả. Trên mã cũ, PostgreSQL phát hiện chu trình và huỷ lượt xác nhận (`40P01`). Trên mã mới, lượt tạm dừng xong trước, và lượt xác nhận nhận 409 `STALE_PROPOSAL` vì đề xuất viết cho phiên bản 1.

Sau GREEN, thêm hai ca để chặn đột biến:
- trong ca giới hạn: cập nhật một lịch đang mở khi đã có 10 lịch vẫn đạt (chặn bản sửa quá chặt);
- `schedule-locks.test.ts` · counts a schedule turned back on and a new one under the same owner lock: với `maxSchedules: 2`, lượt bật lại và lượt tạo mới cùng chờ dòng `users`. Khi thả thì đúng một lượt qua, lượt còn lại nhận `LIMIT_REACHED`.

Các test lịch: **52/52** (`next-occurrence`, `schedule-runner`, `schedule-locks`, `schedule-routes`).

## Đột biến

Script `.codex/sched01/mutate-review.mjs`, cùng cách làm với lượt thi công: sửa một chỗ, chạy test liên quan, khôi phục, so SHA-256. **7/7 bị bắt.**

| # | Đột biến | Test bắt |
|---|---|---|
| R1 | khoá lịch mà không khoá hội thoại trước | pauses and confirms … without a deadlock |
| R2 | nhịp chỉ khoá lịch (`FOR UPDATE OF s`) | never waits for the conversation … |
| R3 | bật lại không kiểm giới hạn | refuses to turn a finished schedule back on … và counts a schedule turned back on … |
| R4 | kiểm giới hạn cả khi lịch đang mở | refuses to turn a finished schedule back on … (bước cập nhật lịch đang mở) |
| R5 | bỏ khoá dòng `users` | counts a schedule turned back on … |
| M1 | bỏ `SKIP LOCKED` (câu mới) | never waits for a schedule … và never waits for the conversation … |
| M10 | bỏ cả khoá dòng lẫn `ON CONFLICT` (câu mới) | never waits for a schedule another process holds |

M1 và M10 là hai đột biến cũ, áp lại trên câu `SELECT` mới.

## Script tái hiện của reviewer

Bên thi công chép `probe.mts` của reviewer sang `.codex/sched01/probe-review.mts`, sửa ba chỗ:
- phần giới hạn mong đợi lỗi `LIMIT_REACHED`;
- phần deadlock thêm một cổng chờ. Script gốc giữ lượt xác nhận cho tới khi lượt tạm dừng đã khoá lịch. Sau bản sửa, lượt tạm dừng không thể khoá lịch khi chưa có hội thoại, nên giữ nguyên cổng cũ thì script treo ở JS. Cổng mới thả lượt xác nhận khi lượt tạm dừng gửi câu khoá hội thoại;
- điều kiện cuối đảo lại: báo lỗi nếu vẫn còn `40P01`.

Kết quả, exit 0:

```text
QUOTA {"refused":"LIMIT_REACHED","openSchedules":10,"expectedMaximum":10}
DEADLOCK [{"action":"confirm","status":"fulfilled"},{"action":"pause","status":"rejected","code":"STALE_VERSION","message":"Lịch vừa thay đổi ở nơi khác. Đã tải lại."}]
```

`STALE_VERSION` là 409 đúng: lượt tạm dừng gửi phiên bản 1, còn lượt xác nhận đã đưa lịch lên phiên bản 2.

## Kiểm toàn bộ

- `npm run check` (`DATABASE_URL` của DB tạm, `RUNTIME_MODE=sandbox`, sau `db:migrate:v3`): **exit 0** ngay lượt đầu, 63 + 408 + 291 + 42 + **532** + 773 = **2.109 v3** + **394 eval**. `chat-api` tăng 4 test, đúng bằng số test mới (1 ca giới hạn ở route, 3 ca khoá). Typecheck, build, quét bản build, launcher và test node của script đều đạt.
- `npm run test:browser:v3` trên DB tạm dựng lại sạch ở 56533, cổng riêng (API 3999, web 5199), cờ tắt như CI: **exit 0** ngay lượt đầu, **120 pass/1 skip có chủ đích, 13 nhóm** (default 93).

## Tài liệu

- Đặc tả, đánh dấu "(SCHED-01, review #167)": mục 6.3 bước 1 (nhịp khoá cả hội thoại), mục 6.5 (bật lại cần chỗ như `create`; thứ tự khoá).
- SCHED-02: thêm một dòng về thứ tự khoá cho `persist`.
- Task card SCHED-01: thêm mục sửa sau review vào phần Kết quả.

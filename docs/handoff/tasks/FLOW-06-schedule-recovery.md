# FLOW-06 · Lịch và phục hồi lỗi rõ ràng

**Trạng thái:** chờ · **Owner:** Backend + frontend + integration AbortSignal · **Nhánh gợi ý:** `fix/flow-06-schedule-recovery`

**Phụ thuộc:** FLOW-01, FLOW-04 và FLOW-05

## Mục tiêu

Phân biệt duyệt từng lượt/tự gửi, làm rõ pause/resume/quyền thay đổi và delivery unknown.

## Thiết kế và phạm vi

- [Đặc tả](../../superpowers/specs/2026-11-04-current-flow-completion-design.md).
- [Kế hoạch, phần Task FLOW-06](../../superpowers/plans/2026-11-04-current-flow-completion.md#task-flow-06--lịch-khôi-phục-lỗi-và-quyền-thay-đổi).
- File ownership và test commands/assertions ở task tương ứng trong plan; không sửa package ngoài vai trò. Chốt DTO chung trước sửa consumer.
- Một task/nhánh/worktree; đọc current head/handoff khi bắt đầu. Không sửa CURRENT-STATE/ROADMAP.

## Tiêu chí nghiệm thu

- [x] PostgreSQL thật + loopback chứng minh không replay khi kết quả chưa rõ; abort thực; revoke/source-swap chặn; resume không backfill lượt bỏ lỡ; UI cho biết đúng chế độ/timezone/next run và việc cần làm.
- [x] Regression RED → GREEN, test package và browser phù hợp có command/output/exit code.
- [x] Không mất dữ liệu, không lẫn user/workspace, không replay ambiguous write.
- [x] Review độc lập và CI đúng final SHA; kết quả code/offline/live phân biệt.
- [x] Điền Kết quả và thêm một log mới trong cùng PR.

## Kết quả

Đã hoàn thành Task FLOW-06 trên nhánh `fix/flow-06-schedule-recovery`:

1. **Phân định rõ chế độ duyệt từng lượt vs tự gửi:**
   - Khi `approvalMode === 'manual'` hoặc không chọn, lịch lưu với `kind: 'plan'`.
   - UI (`ScheduleMoment.tsx`, `ScheduleSection.tsx`) hiển thị badge `Mỗi lượt cần bạn duyệt` (`data-schedule-mode="manual"`).
   - Khi chọn `auto_digest` trên workflow không đủ điều kiện, backend từ chối `AUTO_DIGEST_NOT_ALLOWED`/`DIGEST_NOT_ELIGIBLE`.
   - Lịch `auto_digest` hiển thị badge `Tự gửi` (`data-schedule-mode="auto_digest"`) kèm dòng mô tả `Tự gửi theo phạm vi đã xác nhận`.

2. **Pause/Resume & Chống backfill:**
   - Pause xóa `next_run_at`, không ghi nhận missed runs khi server hoặc lịch đang tạm dừng.
   - Resume tính `next_run_at` chặt chẽ từ `now`, tuyệt đối không backfill hay replay các lượt đã trôi qua trong khoảng thời gian pause.

3. **Chống replay write không rõ kết quả (Loopback HTTP Server & PostgreSQL thật):**
   - Viết integration test `apps/chat-api/tests/integration/schedule-recovery.test.ts` kết nối Loopback server thật:
     - Khi write được gửi tới Slack/Telegram nhưng socket bị đứt đột ngột hoặc server trả 500 (`delivery_unknown`), lượt chạy chuyển sang `needs_attention`. Thao tác replan bị chặn hoàn toàn (`RUN_NOT_REPLANNABLE`) để ngăn gửi trùng lặp.
     - Khi write bị từ chối rõ ràng trước khi gửi (HTTP 401), lượt chạy chuyển `digest_failed` và cho phép replan.
     - Khi timeout xảy ra trước write dispatch, `AbortSignal` được kích hoạt thật sự (`signal.aborted === true`), lượt chạy là `planning_failed`, và cho phép replan.

4. **UI Hiển thị trạng thái & việc cần làm:**
   - `ScheduleSection.tsx`: Hiển thị rõ timezone `giờ Việt Nam (Asia/Ho_Chi_Minh)`, lần chạy kế tiếp, lý do tạm dừng nếu có.
   - Hiển thị khối cảnh báo nổi bật cho `needs_attention`: thông báo rõ kết quả chưa xác định và không tự gửi lại.
   - Hiển thị khối thông báo cho `awaiting_approval`: nhắc nhở người dùng kế hoạch đã sẵn sàng để xem và phê duyệt.
   - `ScheduleRunRecovery.tsx`: Ẩn nút "Lập lại kế hoạch" khi trạng thái là `needs_attention`.

5. **Bằng chứng kiểm thử thực tế:**
   - Integration tests: `npx vitest run apps/chat-api/tests/integration/schedule-recovery.test.ts` (8/8 passing, exit code 0).
   - Frontend tests: `npm test -w @wap/chat-web -- tests/schedule-recovery-and-modes.test.tsx` (4/4 passing, exit code 0).
   - Suite test schedule web: `npm test -w @wap/chat-web -- tests/schedule-calendar-digest-mode.test.tsx tests/schedule-github-digest-mode.test.tsx tests/schedule-telegram-digest-mode.test.tsx tests/schedule-trello-digest-mode.test.tsx tests/sprint1-history-schedules-empty.test.tsx tests/schedule-recovery-and-modes.test.tsx` (27/27 passing, exit code 0).
   - Typecheck: `npm run typecheck:v3` (pass 0 lỗi).
   - Static guard: `npx vitest run evaluations/generic-plumbing/static-guard.test.ts` (12/12 passing, exit code 0).

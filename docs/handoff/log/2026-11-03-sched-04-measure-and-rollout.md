# 2026-11-03 — SCHED-04: Bộ đo lịch chạy (`EVAL_SET=schedule`), thực nghiệm 9router và chuẩn hóa bật cờ `SCHEDULES_ENABLED=on`

- **Task:** `docs/handoff/tasks/SCHED-04-measure-and-live.md`
- **Nhánh:** `feat/sched-04-measure-and-rollout` (PR [#274](https://github.com/VinhDat267/ATI_Project/pull/274))

## 1. Công việc đã thực hiện

1. **Bộ đo `EVAL_SET=schedule` & Scorer (TDD):**
   - Tạo `evaluations/golden-v2/cases-schedule.json` gồm 16 câu theo đặc tả §9.2:
     - 6 câu tạo lịch (`sc_create01`–`06`: `once`, `daily`, `weekly` × tiếng Việt + tiếng Anh);
     - 4 câu không phải lịch (`sc_plan01`–`04`: sự kiện Calendar ×2, hạn chót của card Trello, gửi tin Slack ngay);
     - 3 câu hỏi lại (`sc_clar01`–`03`: thiếu giờ, chu kỳ hằng tháng chưa hỗ trợ, lịch chỉ đọc `read_only`);
     - 3 câu nhiều lượt có `turns` (`sc_turn01`–`03`: sửa giờ, sửa ngày trong tuần, tạm dừng lịch).
   - Mở rộng `evaluations/golden-v2/scorer.ts`: hỗ trợ `Category: 'schedule'`, chấm `expect.kind: 'schedule'`, `expect.action` và `expect.recurrence` (`type`, `time`, `date`, `days`).
   - Mở rộng `evaluations/golden-v2/run.ts`: hỗ trợ `EVAL_SET=schedule`, cờ `EVAL_SCHEDULES` / `SCHEDULES_ENABLED`, dựng lịch sử từ lượt `schedule_proposal` dưới dạng JSON của `proposal` và truyền `schedule: { services }` giống `ChatService`, ghi nhận `schedules` và `scheduledNonScheduleCases` trong báo cáo.
   - Viết `evaluations/golden-v2/scorer-schedule.test.ts` (5 tests, gồm cả kiểm tra `days` khác độ dài `[1, 3, 5]` và cùng độ dài lệch phần tử `[1, 2, 3, 4, 6]`, nhận `schedule` cho câu sự kiện Calendar, lệch `action`) và `evaluations/golden-v2/run-schedule.test.ts` (4 tests, gồm chạy khô `EVAL_DRY_RUN=1 EVAL_SET=schedule` exit 0).
   - Thực thi kiểm chứng 4 đột biến thực tế trên `evaluations/golden-v2/scorer.ts` theo `SCHED-common.md` §4:
     - **Mutation 1a** (`exp.days.every(...) -> true`): `scorer-schedule.test.ts` fail (`exit code 1`).
     - **Mutation 1b** (bỏ nhánh kiểm tra `recurrence.days`): `scorer-schedule.test.ts` fail (`exit code 1`).
     - **Mutation 2** (chấp nhận `kind === 'schedule'` cho `sc_plan01`): `scorer-schedule.test.ts` fail (`exit code 1`).
     - **Mutation 3** (bỏ nhánh kiểm tra `expect.action`): `scorer-schedule.test.ts` fail (`exit code 1`).
     - Sau hoàn nguyên `scorer.ts`: `scorer-schedule.test.ts` (5/5 PASS, `exit code 0`).
   - Commit đăng ký trước (preregistration commit `80621466706541559b4b2dec2878c5fa8c050bd3`, `2026-11-03T15:53:48Z`) trước lời gọi model đầu tiên (`2026-11-03T15:55:41Z`).

2. **Đo thực nghiệm qua 9router (`ag/gemini-3.8-flash` → `gemini-3.8-flash-n`, `PLANNER_SEARCH_MODE=llm`, concurrency 2):**
   - `EVAL_SET=schedule` ×3 (`schedule-llm-2026-11-03T15-55-41-605Z`): đạt **45/48 (93,8%)** strict pass (`45/45` trên các câu hoàn tất; 3 lần quá hạn 60 s ở cổng upstream), `0` câu không phải lịch thành `schedule`.
   - `EVAL_SET=core` ×1 khi bật cờ (`core-llm-answers-on-schedules-on-2026-11-03T16-08-05-437Z`): đạt **44/50 (88,0%)** (`44/44` trên các câu hoàn tất), `0` câu thành `schedule`, `0` câu hành động thành `answer`. Đối chứng cùng ngày tắt cờ (`core-llm-answers-on-2026-11-03T16-28-57-241Z`): đạt **45/50 (90,0%)** (`45/45` trên các câu hoàn tất). Chênh lệch `-1` câu (`≤ 2` câu).
   - `EVAL_SET=services` ×1 khi bật cờ (`services-llm-answers-on-schedules-on-2026-11-03T16-18-41-200Z`): đạt **34/44 (77,3%)** (`34/34` trên các câu ngoài `read_only` hoàn tất), `0` câu thành `schedule`, `0` câu hành động thành `answer`. Đối chứng cùng ngày tắt cờ (`services-llm-answers-on-2026-11-03T16-40-11-058Z`): đạt **32/44 (72,7%)** (`+2` câu khi bật cờ).
   - Quét toàn bộ 5 thư mục bằng chứng public: `0` rò rỉ prompt hay bí mật.
   - Tổng hợp báo cáo tại `docs/ai-evidence/V3-GOLDEN-V2/2026-11-03-SCHED-04-REPORT.md` và cập nhật `evaluations/README.md`.

3. **Chuẩn hóa bật cờ mặc định (`SCHEDULES_ENABLED=on`):**
   - Cập nhật `apps/chat-api/src/config/env.ts`: `SCHEDULES_ENABLED` mặc định `true` (chỉ tắt khi đặt `SCHEDULES_ENABLED=off`; khi khởi động không có PostgreSQL thì `createScheduleRuntime` vẫn trả `undefined` và tự động tắt lịch chạy an toàn).
   - Cập nhật `apps/chat-api/tests/config/schedules-env.test.ts` và `.env.example`.
   - Kiểm chứng hồi quy toàn diện (Planner, Backend API, DB-offline fallback, Startup Reconciliation, Frontend UI Vitest `sched-03-ui.test.tsx` 29/29 PASS, và Playwright E2E `SCHED-03:` trên PostgreSQL kiểm thử cục bộ `24/24 passed (1.3m)`, exit 0).

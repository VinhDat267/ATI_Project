# SCHED-04 · Lịch chạy: đo ý định, đo lại khi bật cờ, nghiệm thu thật, bật cờ

**Trạng thái:** chờ; bộ đo giao reviewer, nghiệm thu thật giao nhóm trưởng (`VinhDat267`) · **Nhánh gợi ý:** `eval/sched-04-measure` (bộ đo và số đo), `feat/sched-04-enable-flag` (PR bật cờ) · **Phụ thuộc:** bộ đo cần SCHED-02; phép đo, nghiệm thu và PR bật cờ cần SCHED-01 → 03 đã merge; 9router; tài nguyên thử Google Calendar và Slack `#ati-test` · **Mốc:** bộ đo merge trước 31/10; đo 01–02/11; nghiệm thu thật trước 03/11; PR bật cờ trước 04/11/2026
**Đặc tả:** mục 3, 9.2, 9.3, 10. **Quy tắc chung:** [SCHED-common](SCHED-common.md).

## Mục tiêu

Có số liệu để nhóm trưởng quyết bật lịch chạy cho buổi bảo vệ:
- model phân biệt được đặt lịch, tạo sự kiện Calendar, hạn của card và việc làm ngay;
- bật cờ không làm giảm kết quả của `core` và `services`;
- kịch bản demo chạy thật qua giao diện, mỗi lệnh ghi do nhóm trưởng duyệt.

## Việc cần làm

1. **Bộ đo** (`evaluations/golden-v2/`):
   - `cases-schedule.json`, 16 câu theo đặc tả mục 9.2: 6 tạo lịch (một lần, hằng ngày, hằng tuần; mỗi kiểu một câu tiếng Việt, một câu tiếng Anh), 4 không phải lịch (sự kiện Calendar ×2, hạn của card, việc làm ngay), 3 hỏi lại (thiếu giờ, hằng tháng, việc chỉ đọc), 3 nhiều lượt có `turns` (sửa giờ, sửa ngày, tạm dừng);
   - `run.ts`: `EVAL_SET=schedule` dùng catalog chung, bật `schedules` cho planner; với ca nhiều lượt, dựng lịch sử có tin `schedule_proposal` và truyền `schedule: { services }` như `ChatService`;
   - `scorer.ts`: `expect.kind`, `expect.action`, `expect.recurrence` (so `type`, `time`, `date`, `days`); câu không phải lịch chấm bằng các luật hiện có;
   - test của bộ đo chạy offline, có chạy khô;
   - **commit label trước mọi lời gọi model**, đẩy lên GitHub trước khi đo. Sửa label sau đó chỉ trong commit riêng có giải thích, trước lần đo sau.
2. **Đo** (máy nhóm trưởng, `ag/gemini-3.8-flash`, `PLANNER_SEARCH_MODE=llm`, concurrency 2):
   - `schedule` ×3;
   - `core` ×1 và `services` ×1 với `SCHEDULES_ENABLED=on` và đúng bộ cờ sẽ bật lúc bảo vệ (`GMAIL_ENABLED`, `PLANNER_READ_ANSWERS` theo quyết định của GMAIL-04);
   - một bộ thấp hơn số gần nhất khi cờ tắt quá 2 câu → chạy đối chứng cờ tắt cùng ngày, cùng source.
3. **Báo cáo** `docs/ai-evidence/V3-GOLDEN-V2/<ngày>-SCHED-04-REPORT.md`, theo khuôn báo cáo GMAIL-04 và W4-01: nguồn gốc từng lượt (commit, SHA-256 label và catalog, giờ UTC, model yêu cầu và model phục vụ), kết quả theo nhóm câu, từng câu trượt và nguyên nhân, đối chiếu quy tắc bật cờ, giới hạn (label do người viết prompt viết, nên không độc lập).
4. **Nghiệm thu thật** (nhóm trưởng thao tác, reviewer ghi): đúng 5 bước ở đặc tả mục 9.3, trên PostgreSQL tạm riêng, không dùng DB dev. Bằng chứng ở `docs/ai-evidence/SCHEDULE-LIVE/` (không commit); log ghi SHA-256 của từng file.
5. **PR bật cờ:** `SCHEDULES_ENABLED` mặc định `on`; `.env.example`, `evaluations/README.md`, hướng dẫn chạy app ghi cờ mới. Máy không có PostgreSQL vẫn khởi động được (lịch tắt, như Gmail).

**Quy tắc quyết định** (đề xuất mặc định; nhóm trưởng quyết, ghi lý do trong log):
- bật khi: `schedule` ×3 đạt ít nhất 40/48; không câu nào của `core`/`services` thành `schedule`; `core`/`services` không thấp hơn số khi cờ tắt quá 2 câu, hoặc đối chứng cùng ngày cho thấy phần chênh không do cờ; năm bước nghiệm thu thật đều đạt;
- không đạt trước 03/11: giữ cờ tắt (mốc cắt ở đặc tả mục 10); báo cáo cuối kỳ ghi lịch chạy là phần đã làm nhưng chưa bật, kèm số đo đã có.

## Test tối thiểu

- Test offline cho `EVAL_SET=schedule`: tải và kiểm 16 câu; scorer đúng/sai cho từng loại `expect`; chạy khô exit 0.
- Đột biến scorer: bỏ so `days`; nhận `schedule` cho câu sự kiện Calendar; bỏ so `action`. Mỗi đột biến làm ít nhất một test fail.
- PR bật cờ: `npm run check` và `npm run test:browser:v3` exit 0; test giữ của SCHED-common mục 2 đổi sang kiểm "đặt `off` thì không đổi" thay vì "mặc định không đổi".

## Tiêu chí nghiệm thu

- [ ] Label commit trước lời gọi model đầu tiên (so giờ commit với giờ UTC của lượt đo đầu).
- [ ] Đủ ba lượt `schedule`, một lượt `core`, một lượt `services` với cờ bật; báo cáo đủ nguồn gốc; quét bản public không có bí mật hay prompt của câu.
- [ ] Năm bước nghiệm thu thật có bằng chứng; mọi lệnh ghi đúng kế hoạch nhóm trưởng duyệt.
- [ ] Quyết định bật cờ ghi trong log, kèm số liệu.

## Ngoài phạm vi

- Đo lại W4-01, W4-03, W4-04 khi bật cờ (ghi là giới hạn trong báo cáo).
- Bộ câu lịch do người ngoài viết.

## Kết quả (agent thi công điền)

- PR:
- Số đo, lệnh và exit code:
- Nghiệm thu thật:
- Quyết định bật cờ:

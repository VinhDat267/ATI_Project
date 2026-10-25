# SCHED-02 · Lịch chạy: planner, đề xuất và lập kế hoạch cho lượt

**Trạng thái:** chờ, giao reviewer · **Nhánh gợi ý:** `feat/sched-02-schedule-planner` · **Phụ thuộc:** SCHED-01 đã merge · **Mốc:** merge trước 30/10/2026
**Đặc tả:** mục 5, 6.4, 6.5 (phần lưu đề xuất), 6.7, 8, 9.1. **Quy tắc chung:** [SCHED-common](SCHED-common.md), đọc trước.

## Mục tiêu

Khi `SCHEDULES_ENABLED=on`, sau task này:
- câu "Mỗi sáng 8 giờ, gửi lịch họp hôm nay lên Slack #ati-test" cho ra tin đề xuất lịch, và xác nhận được qua route của SCHED-01;
- câu sửa, tạm dừng, chạy tiếp, hủy trong hội thoại đã có lịch cho ra đề xuất tương ứng;
- tới giờ, bộ hẹn giờ lập được kế hoạch thật cho lượt, qua đúng đường lập kế hoạch hiện có;
- sandbox có kịch bản `schedule` cho test browser của SCHED-03.

Khi cờ tắt, hoặc khi lập kế hoạch cho một lượt, prompt giống từng byte với prompt khi cờ tắt.

## Việc cần làm

1. **Planner** (`packages/planner`):
   - `AIPlannerOptions.schedules?: boolean` (mặc định `false`);
   - `ProcessMessageInput` thêm `schedule?: { services: string[] }` và `scheduledRun?: boolean`;
   - prompt bật mục lịch khi `schedules && !scheduledRun`: `buildSystemPrompt(tools, dateContext, { ...options, schedules: true })` nối `scheduleRules()` từ `prompts/schedule-rules.ts` (đặc tả mục 5.2, viết tiếng Anh như phần còn lại của prompt, kèm một ví dụ JSON `create` và một ví dụ `update`);
   - khi có `input.schedule`, gộp `schedule.services` vào `route.services` (đặc tả mục 5.3), ở cả `processMessage` (`regex`) và `planWithSearch` (`llm`);
   - JSON có `kind: "schedule"` đi qua `validateSchedule`, các kind khác giữ nguyên đường cũ. Không qua thì thử lại một lần với câu lỗi, như kế hoạch;
   - `AIPlanner.routeSchedule(request: string): { services: string[]; unavailable: Array<{ id: string; name: string }> }`, dùng `routeIntent` với catalog và registry của planner.
2. **Validator** `packages/planner/src/schedule-validator.ts`: `validateSchedule(raw: string, options: { enabled: boolean; now: Date; timeZone: string; hasSchedule: boolean }): ValidationResult`, đúng đặc tả mục 5.3. Thành công trả `ScheduleResponse` đã chuẩn hoá (`days` sắp xếp tăng, chuỗi đã `trim`). Áp `INJECTION_PATTERNS` như `validatePlan`.
3. **`ChatService`** (`apps/chat-api/src/services/chat-service.ts`):
   - option mới `schedules?: { repo: ScheduleRepo; timeZone: string; now?: () => Date }`; không có thì hành vi như cũ;
   - trước khi gọi planner, đọc lịch của hội thoại; có thì truyền `schedule: { services }`;
   - phản hồi `schedule`:
     - `create`/`update`: `routeSchedule(request)`; có `unavailable` → lưu và phát từ chối như hiện nay (`unavailableServices`), không lưu đề xuất. Không có dịch vụ nào → từ chối như `unroutable`;
     - `pause`/`resume`/`cancel`: `services` lấy từ lịch hiện tại;
     - lưu tin `assistant` có `ScheduleProposalMetadata`: `scheduleId`, `baseVersion`, `previous` từ lịch hiện tại (null khi tạo mới); `nextRuns` = `nextRuns(...)` của SCHED-01 cho `create`/`update`/`resume`, rỗng cho `pause`/`cancel`. Nội dung tin là `summary`;
     - phát SSE `schedule_proposal` với `{ conversationId, messageId, metadata }`;
   - lịch sử gửi lại model: `schedule_proposal` → `JSON.stringify(proposal)`; `schedule_state` → nội dung chữ; `schedule_run` → nội dung chữ (vai `user`).
4. **Lập kế hoạch cho lượt:** `ChatService.planScheduledRun(run: RunToPlan, convId: string, signal: AbortSignal): Promise<PreparedRun>` (kiểu của SCHED-01):
   - gọi planner với `scheduledRun: true`, `actor: { userId: run.userId }`, `userMessage` theo đặc tả mục 5.5, `history: []`, `signal`;
   - dùng **chung** phần xử lý kết quả với `executePlannerPipeline`: bỏ `connections` của model, `bindConnections`, `resourceLabels`, mã băm, hạn 30 phút, tin `plan`/`clarification`/`refusal`/`answer`, SSE. Tách phần đó thành bước "chuẩn bị" (không ghi DB) và bước "ghi" nhận `pg.PoolClient`;
   - `PlanRepo.createPlan` và `MessageRepo.createMessage` nhận thêm `client?: pg.PoolClient` tuỳ chọn; không có thì giữ transaction như cũ;
   - `persist(client)` trả `planned` khi có kế hoạch, ngược lại `needs_attention`; `afterCommit()` phát đúng các sự kiện SSE mà đường chat thường phát;
   - giữ thứ tự khoá ở đặc tả mục 6.5 (thêm sau review #167). `persist` chạy trong transaction đã giữ dòng lịch, nên chỉ được ghi vào hội thoại của lượt, không ghi vào hội thoại của lịch. Đường xác nhận đề xuất giữ nguyên thứ tự: hội thoại, rồi lịch, rồi `users`.
5. **`server.ts`:** tạo `AIPlanner` với `schedules: env.SCHEDULES_ENABLED`; truyền `schedules` cho `ChatService`; thay `planRun` tạm của SCHED-01 bằng `chatService.planScheduledRun`.
6. **Sandbox** `SANDBOX_SCENARIO=schedule` (`apps/chat-api/src/sandbox/scenarios.ts`), theo khuôn kịch bản `gmail`: chọn phản hồi theo tin cuối của người dùng, không theo hàng đợi chung:
   - chứa `(Lượt chạy theo lịch` → kế hoạch Calendar → Slack của kịch bản `calendar_slack`;
   - bắt đầu bằng `Đổi sang` → `update`, `recurrence: { type: 'weekly', time: '08:30', days: [1, 2, 3, 4, 5] }`;
   - bắt đầu bằng `Tạm dừng` → `pause`; `Chạy tiếp` → `resume`; `Hủy lịch` → `cancel`;
   - còn lại → `create`, `name: 'Lịch họp hằng ngày'`, `request: 'Gửi lịch họp hôm nay lên Slack #ati-test'`, `recurrence: { type: 'daily', time: '08:00' }`.

   Kịch bản không tự bật cờ: cờ tắt thì kịch bản `schedule` chạy như sandbox mặc định. Runner browser bật cờ cho nhóm `schedule` (SCHED-03).

## Test tối thiểu

- **Prompt:**
  - `prompt_unchanged_when_schedules_off`: SHA-256 của prompt ở `regex` và `llm`, cả `PLANNER_READ_ANSWERS` tắt và bật, bằng giá trị chụp từ `main` trước task;
  - `scheduled_run_uses_flag_off_prompt`: `schedules: true, scheduledRun: true` → cùng SHA-256 như cờ tắt;
  - cờ bật có `scheduleRules()` đúng một lần.
- **Validator** (bảng ca): `25:00`, `8:00`, `08:60` sai; `once` trước `now` 30 giây sai, sau 2 phút đúng, sau 366 ngày sai; `weekly` rỗng, trùng, có 0 hoặc 8 sai; `[5, 1]` thành `[1, 5]`; `create` khi `hasSchedule` sai; `update`/`pause` khi không có lịch sai; tên 81 ký tự, `request` rỗng sai; chuỗi khớp `INJECTION_PATTERNS` sai; `enabled: false` từ chối mọi `schedule`.
- **Planner** (provider ghi lại lần gọi):
  - JSON `schedule` sai lần đầu, đúng lần hai → trả `schedule`, đúng 2 lần gọi;
  - `pause_without_service_keyword_reaches_model`: "Tạm dừng lịch này" với `schedule: { services: ['calendar', 'slack'] }` → 1 lần gọi model, không trả `unroutable`; cùng câu không có `schedule` → hành vi cũ;
  - `scheduledRun` mà model trả `schedule` → bị từ chối ở cả hai lần thử, ném lỗi như kế hoạch sai.
- **`ChatService`** (PostgreSQL thật, provider giả):
  - đề xuất `create` có đủ `ScheduleProposalMetadata`; `nextRuns` 3 giá trị tăng dần; xác nhận qua route SCHED-01 thành công;
  - đề xuất `update` có `previous` và `baseVersion` của lịch hiện tại;
  - dịch vụ chưa cấu hình → tin từ chối có `unavailableServices`, không có tin đề xuất;
  - lịch sử gửi model chứa JSON của đề xuất trước;
  - `same_result_on_chat_and_run_paths`: cùng một đầu ra của provider, đường chat và `planScheduledRun` lưu kế hoạch có `plan_json`, `resource_labels`, mã băm giống nhau.
- **Lượt chạy** (với `ScheduleRunner` thật của SCHED-01):
  - nhịp tới hạn → kế hoạch `pending` trong hội thoại mới, lượt `planned`, SSE `plan_preview` phát sau COMMIT;
  - sửa lịch trong lúc provider đang chờ → lượt `discarded`, không có dòng `plans`;
  - provider ném lỗi quá hạn → `planning_failed`, tin `planning_error` trong hội thoại của lượt;
  - kế hoạch Gmail khi chủ lịch chưa kết nối Gmail (cờ Gmail bật) → từ chối, lượt `needs_attention`.
- **Sandbox:** HTTP thật, kịch bản `schedule`: tạo, xác nhận, "Đổi sang 8 giờ 30…", xác nhận, `run-now` → kế hoạch Calendar → Slack chờ duyệt.

## Đột biến

Cờ tắt vẫn nối mục lịch vào prompt; bỏ qua `scheduledRun`; không gộp dịch vụ của lịch vào router; validator nhận `once` đã qua; nhận `create` khi đã có lịch; lấy dịch vụ do model khai; ghi kế hoạch của lượt trước khi kiểm `version`; lịch sử bỏ JSON của đề xuất; `afterCommit` chạy trước COMMIT. Ghi kết quả từng đột biến vào log.

## Tiêu chí nghiệm thu

- [ ] RED trước GREEN; đột biến đều bị bắt.
- [ ] `npm run check` exit 0; `npm run test:browser:v3` exit 0 không sửa assertion cũ.
- [ ] SCHED-common mục 2 giữ đúng khi cờ tắt.
- [ ] Không gọi model hay dịch vụ thật.

## Ngoài phạm vi

- Giao diện, nhóm browser `schedule` (SCHED-03).
- Bộ đo ý định với model thật (SCHED-04).

## Kết quả (agent thi công điền)

- PR:
- RED/GREEN, đột biến, lệnh kiểm và exit code:
- Điều chưa làm hoặc khác với task card:

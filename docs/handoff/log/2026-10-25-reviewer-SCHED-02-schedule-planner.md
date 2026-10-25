# 25/10/2026 · SCHED-02 · Lịch chạy: planner, đề xuất và lập kế hoạch cho lượt

**Người viết:** reviewer (bên thi công). Nhóm trưởng giao ngày 25/10 (chia đôi: reviewer làm backend và planner). **Nhánh:** `feat/sched-02-schedule-planner`, tách từ `feat/sched-01-schedule-backend` tại `2480261`, vì SCHED-01 (#167) chưa merge. Task: [SCHED-02](../tasks/SCHED-02-schedule-planner.md). Đặc tả: [lịch chạy](../../superpowers/specs/2026-10-24-scheduled-workflows-design.md).

## Đã làm

- **Planner** (`packages/planner`):
  - `AIPlannerOptions.schedules`;
  - `ProcessMessageInput.schedule` và `scheduledRun`;
  - `routeSchedule(request)`; `unroutable` được export.

  Mục prompt `prompts/schedule-rules.ts` chỉ được nối vào khi `schedules && !scheduledRun`. Khi có lịch, dịch vụ của lịch được gộp vào kết quả router (mục 5.3). JSON `kind: "schedule"` đi qua `validateSchedule` ở cả `regex` và `llm`, có thử lại một lần như kế hoạch. Khi cờ tắt, mã chạy đúng đường cũ.
- **Validator** `schedule-validator.ts`: đúng mục 5.3. Độ dài đếm như `char_length` của PostgreSQL. Bỏ mọi trường lạ, và với `pause`/`resume`/`cancel` chỉ giữ `action`, `summary`. `INJECTION_PATTERNS` được export từ `validator.ts`.
- **`ChatService`:**
  - kiểu `ChatPlanner` (`processMessage`, `routeSchedule`) thay cho `AIPlanner`;
  - option `schedules`;
  - đọc lịch của hội thoại và truyền `schedule` cho planner;
  - đề xuất `create`/`update` lấy dịch vụ bằng `routeSchedule`. Dịch vụ chưa cấu hình thì từ chối như `unroutable` và không lưu đề xuất;
  - `pause`/`resume`/`cancel` lấy dịch vụ của lịch;
  - lịch sử gửi lại JSON của đề xuất;
  - phần xử lý kết quả tách thành `prepareResponse` (chưa ghi gì), `write(client?)` và `announce()`. Đường chat và `planScheduledRun` dùng chung phần này.
- **`PlanRepo.createPlan`** nhận client tuỳ chọn. Không có client thì giữ transaction như cũ, gọi đúng như trước.
- **`schedule-runner.ts`**: `runMessage()` dựng câu của lượt, dùng chung với `planScheduledRun`.
- **`server.ts`:**
  - `plannerFor(actor)` dựng planner theo catalog của từng người;
  - đối tượng planner có thêm `routeSchedule`;
  - `schedules: Boolean(schedules)`;
  - `planRun` thật là `chatService.planScheduledRun`;
  - `ChatService` nhận `schedules`.
- **Sandbox** `SANDBOX_SCENARIO=schedule`, đúng task card. Kịch bản này luôn chạy planner ở chế độ `llm` (`runtimePlannerSearchMode`), như `gmail`.

## Khác hoặc thêm so với đặc tả và task card

Đã ghi vào đặc tả, đánh dấu "(SCHED-02)":
- **Lý do gộp dịch vụ ở mục 5.3 không đúng với router hiện tại.** Câu không có từ khoá ("Tạm dừng lịch này") được router trả mọi dịch vụ chung đã cấu hình, không phải `unroutable`. Vì vậy ca `pause_without_service_keyword_reaches_model` đạt cả trước khi sửa. Đột biến "không gộp" được bắt bằng ca có router chọn hẹp hơn lịch ("Chuyển lịch này sang gửi lên Telegram"). Khi câu nêu một dịch vụ chưa cấu hình, planner không gộp và vẫn từ chối.
- **Mục prompt nối vào cuối prompt.** Các quy tắc đánh số giữ nguyên. Mục mới ghi quy tắc 0 không áp dụng cho câu về chính lịch.
- **Chế độ `regex` vẫn tra tên trước model** (ví dụ `#ati-test`), như với mọi câu.
- **`routeSchedule` được gọi ở `ChatService`** qua đối tượng planner của server, vì catalog khác nhau theo người.
- **Metadata và SSE của đề xuất có `replyToMessageId`/`requestId`**, như các loại tin khác. JSON gửi lại model theo thứ tự khoá của JSONB.
- **Đường lượt chạy:**
  - các tin do `persist` ghi có chung `created_at`;
  - `agent_state: planning` và `gather_progress` phát ngay trong lúc lập kế hoạch;
  - tin của kế hoạch có `replyToMessageId` là tin `schedule_run`.
- **Kịch bản sandbox `schedule` luôn chạy ở chế độ `llm`.**

## RED → GREEN

PostgreSQL 16 tmpfs riêng ở 56533, sandbox, không dùng `.env` hay DB dev. Log thô ở `.codex/sched02/` của worktree (không commit).

| Nhóm test | RED | GREEN |
|---|---|---|
| `schedule-validator.test.ts` (39) | không tìm thấy module | 39/39 |
| `schedules.test.ts` của planner (23) | 11 fail đúng lý do (`Cannot find module schedule-rules`, `Invalid kind 'schedule'`, `routeSchedule is not a function`); 12 đạt: 8 ca SHA giữ prompt cũ, 4 ca giữ hành vi cũ | 23/23 |
| `chat-service-schedules.test.ts` (6) | 5 ca đầu fail: không có tin đề xuất nào được lưu | 6/6 |
| `scheduled-run-planning.test.ts` (4) | không có RED (xem dưới) | 4/4, chạy lặp 5 lần đều đạt |
| `schedule-sandbox.test.ts` (2) | ca HTTP fail: hết giờ chờ đề xuất đầu tiên, server chưa nối | 2/2 |

- **Mốc SHA-256 của prompt** được chụp trên mã chưa sửa: `.codex/sched02/capture-prompts.mts`, kết quả trong `prompt-baseline.log`. Tại đó `packages/planner` và `prompts/` giống hệt `main` `7bb752d` (`git diff 7bb752d -- packages/planner prompts` rỗng).
- **`planScheduledRun` được viết trước nhóm ca đi qua `ScheduleRunner`.** Ca `same_result_on_chat_and_run_paths` được viết trước, nhưng lúc RED nó dừng sớm hơn, ở bước tạo lịch. Vì vậy hành vi của nhóm này chỉ được kiểm bằng đột biến S8, S10, S15, S16.
- **Ba chỗ sửa test sau lần GREEN đầu, không đổi mã sản phẩm:**
  - JSON đề xuất trong lịch sử đổi thứ tự khoá (JSONB), nên test so object;
  - tin trong một transaction có chung `created_at`, nên test tìm tin theo loại;
  - `gather_progress` có trong chuỗi sự kiện, nên test lọc nó ra.
- **Một test cũ fail khi chạy toàn bộ `chat-api`:** `conversation-routes.test.ts` kiểm đúng danh sách đối số của `createMessage`, mà bản đầu truyền thêm `undefined` ở vị trí client. Mã được sửa để không truyền client khi không có; test cũ giữ nguyên.

## Đột biến

Script `.codex/sched02/mutate.mjs`: áp mọi điểm của một đột biến, chạy test liên quan, khôi phục, so SHA-256. **18/18 bị bắt**, gồm đủ 9 đột biến của task card (S1–S10, trong đó "bỏ qua `scheduledRun`" tách thành S2 và S3).

| # | Đột biến | Test bắt |
|---|---|---|
| S1 | cờ tắt vẫn nối mục lịch vào prompt | 8 ca SHA (`prompt_unchanged_when_schedules_off`, `scheduled_run_uses_flag_off_prompt`) |
| S2 | bỏ qua `scheduledRun` ở prompt | 4 ca `scheduled_run_uses_flag_off_prompt` |
| S3 | bỏ qua `scheduledRun` ở validator | refuses a schedule while planning a scheduled run (2) |
| S4 | không gộp dịch vụ của lịch vào router | routes to the services of the conversation schedule too (2) |
| S5 | validator nhận `once` đã qua | needs a one-off time at least a minute ahead… |
| S6 | nhận `create` khi đã có lịch | refuses a second schedule in a conversation that has one… |
| S7 | lấy dịch vụ do model khai (validator giữ `services`, `ChatService` dùng nó) | saves a new schedule proposal… |
| S8 | ghi kế hoạch của lượt trước khi kiểm `version` | discards the plan when the schedule changes… |
| S9 | lịch sử bỏ JSON của đề xuất | proposes an update against the current schedule… |
| S10 | `afterCommit` chạy trước COMMIT | plans a due run… (thứ tự `COMMIT` → `plan_preview` quan sát trên client thật của runner) |
| S11 | lấy dịch vụ của lịch cũ khi sửa | proposes an update… |
| S12 | không cho planner biết lịch của hội thoại | proposes an update…, takes the services of pause and resume… |
| S13 | lượt chạy không bật `scheduledRun` | same_result_on_chat_and_run_paths |
| S14 | `resume` tính lần chạy từ đề xuất | takes the services of pause and resume… |
| S15 | ghi kế hoạch của lượt bằng transaction riêng | writes nothing of a run outside the transaction…, same_result… |
| S16 | ghi tin của lượt bằng transaction riêng | writes nothing of a run outside the transaction…, same_result… |
| S17 | bỏ kiểm dịch vụ chưa cấu hình | refuses a schedule whose task needs a service that is not configured… |
| S18 | sandbox `schedule` dùng `regex` | proposes, confirms, changes and runs a schedule… (HTTP) |

## Kiểm toàn bộ

- `npm run check` (`DATABASE_URL` của DB tạm, `RUNTIME_MODE=sandbox`, sau `db:migrate:v3`): **exit 0** ngay lượt đầu, 63 + 408 + **353** + 42 + **544** + 773 = **2.183 v3** + **394 eval**. So với SCHED-01: planner thêm 62 test, `chat-api` thêm 12. Typecheck, build, quét bản build, launcher và test node của script đều đạt. Bộ eval offline (gồm routing 116 câu) không đổi.
- `npm run test:browser:v3` trên DB tạm dựng lại sạch ở 56533, cổng riêng (API 3999, web 5199), cờ tắt như CI: **exit 0** ngay lượt đầu, **120 pass/1 skip có chủ đích, 13 nhóm** (default 93). PR không đổi `apps/chat-web`.

## Chưa làm

- Giao diện và nhóm browser `schedule` (SCHED-03, `longnguyen005`).
- Bộ đo ý định với model thật (SCHED-04). Prompt lịch chưa được đo với model thật.
- Không gọi model hay dịch vụ thật.
- Ở sandbox, nếu planner chính ném lỗi thì runtime vẫn rơi về kế hoạch Trello soạn sẵn, như trước, kể cả với lượt chạy. Live không rơi về.

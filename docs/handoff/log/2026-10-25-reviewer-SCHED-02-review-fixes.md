# 25/10/2026 · SCHED-02 · Sửa sau review độc lập lần 1 (#168)

**Người viết:** reviewer (bên thi công). **Nhánh:** `feat/sched-02-schedule-planner`, sửa trên head `e390a5f`. Review độc lập lần 1 tại `e390a5f`: **chưa đạt**, 3 P2 và 1 P3. Cùng lượt đó, #167 tại `2480261` **đạt**. Log thi công: [SCHED-02](2026-10-25-reviewer-SCHED-02-schedule-planner.md).

## Bốn lỗi của review và cách sửa

Cả bốn đều đúng như mô tả. Bên thi công tái hiện mỗi lỗi bằng một test RED trước khi sửa.

1. **P2: lượt lỗi hoặc quá hạn để trang kẹt ở "đang lập kế hoạch".**
   - `planScheduledRun` phát `agent_state: planning`, nhưng khi lập kế hoạch lỗi, quá hạn hoặc lượt bị bỏ, bộ hẹn giờ chỉ ghi DB. Tin lỗi cũng không có `replyToMessageId`.
   - **Sửa:** tin `planning_error`/`schedule_discarded` của lượt có `replyToMessageId` là tin `schedule_run`. Sau COMMIT, bộ hẹn giờ phát SSE `error` `{ conversationId, message, replyToMessageId }`. Đối soát lúc khởi động cũng gắn `replyToMessageId`.
   - Phần phát sự kiện của bộ hẹn giờ được gom vào `send()`, chỉ gọi sau COMMIT.
   - SCHED-03 được ghi thêm: coi `schedule_discarded` là tin kết thúc khi nạp lịch sử.
2. **P2: không hủy hay tạm dừng được lịch bằng hội thoại khi dịch vụ cũ mất cấu hình.**
   - Ở chế độ `llm`, router đọc mọi câu người dùng, gồm cả câu đã tạo lịch. Calendar bị gỡ cấu hình thì "Hủy lịch này" bị từ chối trước khi tới model.
   - **Sửa:** trong hội thoại có lịch, chỉ dịch vụ chưa cấu hình mà **câu hiện tại** nêu mới làm từ chối trước model. Dịch vụ cần cho `create`/`update` vẫn được kiểm bằng `routeSchedule(request)`.
3. **P2: validator và bộ hẹn giờ đặt giờ lặp (giờ mùa hè) khác nhau.**
   - Validator tự đổi múi giờ và chọn lần thứ hai của 02:30 tại Berlin ngày 25/10/2026. Bộ hẹn giờ chọn lần đầu.
   - **Sửa:** chuyển `next-occurrence.ts` sang `packages/planner/src/schedules/`, export từ `@wap/planner`. Validator kiểm `once` bằng chính `nextOccurrence`. File trong `apps/chat-api` chỉ còn export lại, nên test SCHED-01 không đổi.
4. **P3: tạo đề xuất vẫn tra danh mục tài nguyên (prefetch).**
   - **Sửa một phần:** không prefetch trong hội thoại đã có lịch. Lượt chạy vẫn prefetch.
   - **Không sửa:** câu tạo lịch đầu tiên vẫn prefetch. Lý do: planner chưa biết model sẽ trả lịch hay kế hoạch, và bỏ prefetch cho mọi câu khi cờ bật sẽ làm chậm mọi kế hoạch thường, kể cả các bộ đo `core`/`services` của SCHED-04. Đã ghi là giới hạn ở đặc tả mục 5.1.

Đặc tả mục 5.1, 5.3, 6.2 và 6.4 có ghi chú "(SCHED-02, review #168)".

## RED → GREEN

PostgreSQL 16 tmpfs riêng ở 56533. Log ở `.codex/sched02/review1-red.log` và `review1-green.log`.

| Test | RED trên `e390a5f` | GREEN |
|---|---|---|
| `scheduled-run-planning` · discards the plan… (thêm kiểm `replyToMessageId`, SSE `error` sau COMMIT) | `expected undefined to be '<id tin schedule_run>'` | đạt |
| `scheduled-run-planning` · fails a run whose planning outlives its limit… (`AbortSignal` thật, `planTimeoutMs` 50) | tin lỗi không có `replyToMessageId` | đạt |
| `schedule-runner` · marks runs that were planning as interrupted… (thêm kiểm `replyToMessageId`) | tin lỗi không có `replyToMessageId` | đạt |
| planner · manages a schedule whose task needs a service that is no longer configured (`llm`) | `expected { kind: 'refusal' … } to deeply equal { kind: 'schedule' … }` | đạt (`regex` đạt cả trước khi sửa, vì router của `regex` chỉ đọc câu hiện tại) |
| `chat-service-schedules` · cancels through the chat a schedule whose task needs a service that is no longer configured | `expected 'refusal' to be 'schedule_proposal'` | đạt |
| validator · places a repeated or skipped local time where the scheduler runs it | `expected { valid: true … } to match object { valid: false, layer: 'semantic' }` | đạt |
| planner · does not list the workspace before a turn about an existing schedule, but does for a run | `expected [ 'trello.search_boards', … ] to deeply equal []` | đạt |

## Đột biến

Script `.codex/sched02/mutate.mjs`. **26/26 bị bắt**: 18 đột biến S của lượt thi công chạy lại trên mã mới, cộng 8 đột biến T mới. S4 được viết lại theo hàm `route` mới.

| # | Đột biến | Test bắt |
|---|---|---|
| T1 | lượt lỗi hoặc bị bỏ không phát sự kiện kết thúc | discards the plan…, fails a run whose planning outlives its limit… |
| T2 | phát sự kiện kết thúc trước COMMIT | như trên (thứ tự `COMMIT` → `error`) |
| T3 | tin kết thúc không trả lời tin đầu của lượt | như trên |
| T4 | đối soát khởi động không trả lời tin đầu | marks runs that were planning as interrupted… |
| T5 | dịch vụ trong lịch sử chặn quản lý lịch | manages a schedule whose task needs a service… (`llm`) |
| T6 | bỏ kiểm dịch vụ câu hiện tại nêu | manages a schedule… (phần "Gửi thêm lên Telegram"), still refuses a request that names a service… |
| T7 | giờ lặp lấy lần thứ hai (trong hàm dùng chung) | places a repeated or skipped local time… |
| T8 | vẫn tra danh mục khi quản lý lịch | does not list the workspace before a turn about an existing schedule… |

## Kiểm toàn bộ

- `npm run check` (`DATABASE_URL` của DB tạm, sau `db:migrate:v3`): **exit 0** ngay lượt đầu, 63 + 408 + **357** + 42 + **545** + 773 = **2.188 v3** + **394 eval**.
  - Planner thêm 4 test: hủy lịch khi dịch vụ cũ mất cấu hình (2 chế độ), không tra danh mục, và giờ mùa hè.
  - `chat-api` thêm 1 test (hủy lịch qua `ChatService`). Ca timeout cũ được thay bằng ca dùng `AbortSignal` thật, nên số test không đổi ở chỗ đó.
- `npm run test:browser:v3` trên DB tạm dựng lại sạch ở 56533, cổng riêng (API 3999, web 5199), cờ tắt như CI: **exit 0** ngay lượt đầu, **120 pass/1 skip có chủ đích, 13 nhóm**.

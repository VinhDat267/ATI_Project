# SCHED-01 · Lịch chạy: lưu trữ, bộ hẹn giờ và API

**Trạng thái:** chờ, giao reviewer · **Nhánh gợi ý:** `feat/sched-01-schedule-backend` · **Phụ thuộc:** không · **Mốc:** merge trong 26/10–29/10/2026
**Đặc tả:** mục 4, 6.1–6.6, 8, 9.1. **Quy tắc chung:** [SCHED-common](SCHED-common.md), đọc trước.

## Mục tiêu

Khi `SCHEDULES_ENABLED=on` và có PostgreSQL, sau task này:
- lịch và lượt chạy được lưu bền, theo đúng đặc tả mục 6.1;
- bộ hẹn giờ nhận lượt đến hạn không trùng, ghi lượt lỡ, đối soát khi khởi động lại;
- API xác nhận đề xuất, đổi trạng thái, liệt kê, đếm lượt chờ duyệt, chạy ngay, lập lại kế hoạch.

Task này **chưa** nối planner. Bộ hẹn giờ nhận một hàm lập kế hoạch tiêm vào (`planRun`); `server.ts` của task này truyền hàm ghi lượt `planning_failed` với câu "Chưa nối planner". SCHED-02 thay bằng hàm thật. Khi cờ tắt, hệ thống không đổi (SCHED-common mục 2).

## Việc cần làm

1. **Kiểu dữ liệu** (`packages/tool-schemas/src/types.ts`): toàn bộ kiểu ở đặc tả mục 4, export từ `index.ts`. `PlannerResponse` thêm `ScheduleResponse`. Sửa mọi chỗ `switch` theo `kind` để typecheck đạt; ở những chỗ chưa xử lý được, `kind: 'schedule'` đi nhánh lỗi hiện có.
2. **Cấu hình** (`apps/chat-api/src/config/env.ts`): `SCHEDULES_ENABLED` `on`/`off`, mặc định `off`, giá trị khác là lỗi cấu hình. Thêm vào `.env.example` với giá trị trống. `GET /api/health` có `schedulesEnabled: true` chỉ khi cờ bật **và** có PostgreSQL.
3. **Migration** `db/v3/0010_schedules.sql` đúng đặc tả mục 6.1, chạy được trên DB đã có dữ liệu 0001–0009.
4. **Tính giờ hẹn** (`services/schedules/next-occurrence.ts`):
   - `nextOccurrence(recurrence: ScheduleRecurrence, after: Date, timeZone: string): Date | null`;
   - `nextRuns(recurrence: ScheduleRecurrence, after: Date, timeZone: string, count = 3): Date[]`.

   Chỉ dùng `Intl` của Node, không thêm thư viện. Câu hiển thị thời gian do web làm (SCHED-03).
5. **Repository** (`db/repositories/schedule-repo.ts`) và **trạng thái suy ra** (`services/schedules/run-state.ts`): đọc lịch, lượt, kế hoạch mới nhất của hội thoại lượt; tính `ScheduleRunState` theo bảng đặc tả mục 6.1 bằng SQL (một truy vấn cho danh sách, không N+1). `ScheduleView.lastRun` là lượt mới nhất theo `created_at`. SCHED-02 dùng `ScheduleRepo.getByConversation(convId: string): Promise<ScheduleView | null>` (lịch ở mọi trạng thái của hội thoại tạo lịch).
6. **Dịch vụ lịch** (`services/schedules/schedule-service.ts`), mọi hàm nhận `now: Date`:
   - `confirmProposal({ userId, convId, messageId, now }): Promise<{ schedule: ScheduleView; stateMessageId: string }>`. Đúng đặc tả mục 6.5: khoá, kiểm đề xuất mới nhất, `baseVersion`, giới hạn 10 lịch, giờ hẹn đã qua; ghi tin `schedule_state` trong cùng transaction;
   - `setStatus({ userId, scheduleId, action: 'pause' | 'resume' | 'cancel', version, now })`, cùng kiểu trả về;
   - `list(userId, now)`, `listRuns(userId, scheduleId, limit, now)`, `pendingCount(userId, now)`;
   - `startRun({ userId, scheduleId, trigger: 'manual', now })` và `startRun({ userId, runId, trigger: 'replan', now })`: tạo lượt `planning`, trả `ScheduleRunView`, rồi giao cho `ScheduleRunner.planNow(runId)` chạy nền;
   - lỗi điều kiện ném `ScheduleConflict` có `code` theo đặc tả mục 6.5, 6.6; route đổi thành 409 `{ error: { code, message } }`.
7. **Bộ hẹn giờ** (`services/schedules/schedule-runner.ts`):

   ```ts
   export interface RunToPlan { runId: string; scheduleId: string; scheduleVersion: number; userId: string;
     name: string; request: string; dueAt: Date; trigger: 'scheduled' | 'manual' | 'replan' }
   export interface PreparedRun {
     /** Ghi kết quả bằng client của transaction đang khoá dòng schedules. */
     persist(client: pg.PoolClient): Promise<{ state: 'planned'; planId: string } | { state: 'needs_attention' }>;
     /** Phát SSE sau COMMIT. */
     afterCommit(): void;
   }
   export type PlanRun = (run: RunToPlan, convId: string, signal: AbortSignal) => Promise<PreparedRun>;
   export class ScheduleRunner {
     constructor(options: { pool: pg.Pool; planRun: PlanRun; timeZone: string; now?: () => Date; tickMs?: number; planTimeoutMs?: number });
     start(): void; stop(): Promise<void>;
     tick(): Promise<void>;                 // một nhịp, đặc tả mục 6.3
     planNow(runId: string): Promise<void>; // dùng cho run-now/replan
   }
   ```

   - `tickMs` mặc định 30.000, `planTimeoutMs` 180.000; timer `unref()`; `stop()` chờ lượt đang lập kế hoạch hoặc huỷ nó bằng `AbortSignal`;
   - các bước 1–4 của mỗi nhịp, bỏ qua lịch đang có lượt `planning`, tự tạm dừng sau 3 lượt `expired`, chủ lịch không `active` → `blocked`, như đặc tả mục 6.3;
   - lập kế hoạch cho một lượt như đặc tả mục 6.4: bộ hẹn giờ tạo hội thoại của lượt (tiêu đề theo mục 6.1) và tin `schedule_run` (`ScheduleRunMessageMetadata`), gọi `planRun`, rồi một transaction khoá dòng `schedules`, kiểm `version` và trạng thái, gọi `persist(client)` hoặc ghi `discarded`. `planRun` ném lỗi hoặc quá hạn → `planning_failed`, ghi tin `planning_error` vào hội thoại của lượt;
   - lập kế hoạch tuần tự: tối đa một lượt đang gọi `planRun` trên toàn tiến trình.
8. **Đối soát khởi động** (`services/startup-reconciliation.ts` hoặc file mới gọi ngay sau `reconcileInterruptedExecutions`), chỉ khi cờ bật: lượt `planning` → `interrupted` với câu ở đặc tả mục 6.3. Không gọi `planRun`.
9. **Route** (`routes/schedule-routes.ts`): bảng đặc tả mục 6.6. Chỉ mount khi cờ bật và có PostgreSQL. ID không phải UUID hoặc của người khác → 404. Phát SSE `schedule_updated` (payload `ScheduleStateMetadata`) trên hội thoại tạo lịch sau mỗi lần đổi.
10. **`server.ts`:** khởi động `ScheduleRunner` sau đối soát, dừng khi tắt server. `planRun` tạm như mục "Mục tiêu".

## Test tối thiểu

Tất cả trên PostgreSQL thật, đồng hồ tiêm được.

- **`nextOccurrence`** (unit): 23:59 sang ngày sau; Chủ nhật → thứ Hai với `weekly [1]`; 31/12 → 01/01; `after` đúng bằng giờ hẹn trả lần sau; `once` đã qua trả `null`; `nextRuns` trả 3 giờ tăng dần; một múi giờ có giờ mùa hè (`Europe/Berlin`, 29/03/2026 02:30) theo quy tắc đặc tả mục 6.2.
- **Migration:** hai CHECK của mục 6.1 chặn dữ liệu sai; khoá duy nhất `schedule_runs_slot` và `schedule_runs_one_planning`; dữ liệu 0001–0009 giữ nguyên.
- **Nhịp:**
  - `tick_twice_concurrently_creates_one_run_per_slot`: hai `ScheduleRunner` trên hai pool riêng, cùng `now`, `Promise.all([a.tick(), b.tick()])` → đúng một lượt cho mỗi giờ hẹn;
  - `late_by_more_than_10_minutes_records_one_missed_run`: lịch hằng ngày 08:00 giờ Việt Nam, `next_run_at` = 22/10 08:00, `now` = 25/10 08:11 → một lượt `missed`, `due_at` = 22/10 08:00, `missed_count = 4` (22, 23, 24, 25/10), `next_run_at` = 26/10 08:00, `planRun` không được gọi;
  - `late_by_under_10_minutes_still_plans`: `now` = giờ hẹn + 9 phút 59 giây → lượt `planning`;
  - `once_schedule_completes_after_its_run`;
  - `skips_schedule_with_run_in_progress`;
  - `owner_disabled_blocks_and_pauses`;
  - `three_expired_runs_pause_the_schedule`: ba lượt `planned` có kế hoạch `pending` đã quá hạn → nhịp sau không thêm lượt, lịch `paused` với lý do "3 lượt liền không được duyệt".
- **Lập kế hoạch một lượt:**
  - `planRun` giả trả `PreparedRun` ghi kế hoạch bằng `client` → lượt `planned`, `plan_id` đúng, `afterCommit` gọi đúng một lần sau COMMIT;
  - `version_changed_during_planning_discards_result`: trong lúc `planRun` đang chờ (Promise giữ bằng deferred), gọi `setStatus(pause)` → lượt `discarded`, không có dòng `plans`, `persist` không được gọi;
  - `plan_timeout_marks_planning_failed`: `planRun` chỉ kết thúc khi `signal` bị huỷ, `planTimeoutMs` nhỏ → `planning_failed`; kiểm `signal.aborted === true`.
- **Đối soát:** lượt `planning` sẵn trong DB, khởi động → `interrupted`; `planRun` không được gọi.
- **Xác nhận** (route HTTP thật, tin đề xuất chèn thẳng vào `messages` với `ScheduleProposalMetadata`):
  - tạo, sửa, tạm dừng, chạy tiếp, hủy đều đúng `version` và `next_run_at`; `resume` không tạo lượt cho giờ hẹn đã qua;
  - `confirm_older_proposal_returns_409`: hai đề xuất, xác nhận đề xuất cũ → 409 `STALE_PROPOSAL`, không đổi gì;
  - `confirm_same_proposal_twice_concurrently_applies_once`;
  - lịch thứ 11 → `LIMIT_REACHED`; `create` khi hội thoại đã có lịch → `CONVERSATION_HAS_SCHEDULE`; `once` đã qua → `SCHEDULE_IN_PAST`; nút với `version` cũ → `STALE_VERSION`.
- **Chạy ngay, lập lại kế hoạch:** đang có lượt `planning` → `RUN_IN_PROGRESS`; lịch `cancelled` → `SCHEDULE_CLOSED`; `replan` lượt `awaiting_approval` → 409.
- **Hai người A và B:** B gọi mọi route với ID của A → 404, không đổi dữ liệu.
- **`pending-count`** đếm đúng `awaiting_approval`, không đếm kế hoạch quá hạn.
- **Cờ tắt:** route 404; `ScheduleRunner` không được tạo; đối soát lịch không chạy; `/api/health` không có `schedulesEnabled`.

## Đột biến

Bỏ `SKIP LOCKED`; bỏ khoá duy nhất `schedule_runs_slot`; bỏ so `baseVersion`; bỏ kiểm `version` trước `persist`; tính lượt lỡ như lượt thường; `resume` tạo lượt cho giờ hẹn đã qua; bỏ kiểm chủ lịch ở route; đếm kế hoạch quá hạn vào `pending-count`; cờ tắt vẫn mount route. Ghi kết quả từng đột biến vào log.

## Tiêu chí nghiệm thu

- [ ] RED trước GREEN cho từng nhóm test trên; đột biến đều bị bắt.
- [ ] `npm run check` exit 0; `npm run test:browser:v3` exit 0 không sửa assertion cũ.
- [ ] SCHED-common mục 2 giữ đúng khi cờ tắt.
- [ ] Không gọi model hay dịch vụ thật.

## Ngoài phạm vi

- Planner, prompt, `ChatService`, kịch bản sandbox `schedule` (SCHED-02).
- Giao diện (SCHED-03).

## Kết quả (agent thi công điền)

- PR:
- RED/GREEN, đột biến, lệnh kiểm và exit code:
- Điều chưa làm hoặc khác với task card:

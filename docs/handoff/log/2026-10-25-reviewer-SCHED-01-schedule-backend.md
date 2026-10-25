# 25/10/2026 · SCHED-01 · Lịch chạy: lưu trữ, bộ hẹn giờ và API

**Người viết:** reviewer (bên thi công). Nhóm trưởng giao ngày 25/10 ("bắt đầu SCHED-01 đi"). **Nhánh:** `feat/sched-01-schedule-backend`, base `7bb752d` (sau #166). Task: [SCHED-01](../tasks/SCHED-01-schedule-backend.md). Đặc tả: [lịch chạy](../../superpowers/specs/2026-10-24-scheduled-workflows-design.md).

## Đã làm

- **Kiểu dữ liệu** (`packages/tool-schemas/src/types.ts`): đủ các kiểu ở đặc tả mục 4. `PlannerResponse` thêm `ScheduleResponse`; typecheck không cần sửa chỗ nào khác.
- **Cờ** `SCHEDULES_ENABLED` (`env.ts`, `.env.example`): `on`/`off`, mặc định `off`, giá trị khác là lỗi cấu hình.
- **Migration** `db/v3/0010_schedules.sql`: chạy lại được như các migration khác (`IF NOT EXISTS`, ràng buộc có tên).
- **`services/schedules/`:**
  - `next-occurrence.ts`: `nextOccurrence`, `nextRuns`, `localLabel`; chỉ dùng `Intl`;
  - `run-state.ts`: trạng thái suy ra theo kế hoạch mới nhất của hội thoại lượt;
  - `schedule-service.ts`: xác nhận đề xuất, nút, danh sách, đếm, chạy ngay, lập lại kế hoạch;
  - `schedule-runner.ts`: nhịp, lập kế hoạch tuần tự, đối soát khởi động.
- **`schedule-repo.ts`, `routes/schedule-routes.ts`, `config/schedules-runtime.ts`.** `MessageRepo.createMessage` nhận thêm `db` tuỳ chọn, để ghi tin trong transaction của người gọi.
- **`app.ts`, `server.ts`:** chỉ khi cờ bật và có PostgreSQL thì mới đối soát, mount route, có `schedulesEnabled` ở `/api/health`, và khởi động bộ hẹn giờ sau `listen`. `planRun` tạm ném "Chưa nối planner", nên lượt nào cũng `planning_failed` mà không gọi model.

## Khác hoặc thêm so với đặc tả và task card

Đã ghi vào đặc tả, đánh dấu "(SCHED-01)":
- **Xác nhận lặp không đổi gì.** Thêm cột `schedules.last_proposal_id`. Xác nhận lại đúng đề xuất đã áp dụng trả 200 và không ghi tin trạng thái, thay vì 409. Lý do: bấm hai lần hoặc hai tab cùng bấm không nên báo lỗi. `pause` một lịch đang tạm dừng (và các trường hợp tương tự) cũng 200, không đổi gì.
- **Mã `RUN_NOT_REPLANNABLE`** cho `replan` một lượt không cần lập lại; đặc tả chưa đặt mã. Đã thêm câu vào bảng 409 của SCHED-03.
- **Dạng lỗi** `{ error: { code, message } }` cho 404, 400, 409, 500; `message` là câu tiếng Việt của bảng SCHED-03. `run-now`, `replan` trả 201.
- **Bộ hẹn giờ cũng ghi tin `schedule_state`** khi tự tạm dừng (chủ lịch bị khoá, 3 lượt quá hạn) và khi lịch một lần chuyển `completed`.
- **Kiểm tra lượt có cũ không** chỉ dựa vào `version` (và lịch `cancelled`). Đặc tả có câu "không còn `active`", nhưng lịch một lần chuyển `completed` ngay trong nhịp tạo lượt, nên điều kiện đó sẽ bỏ nhầm lượt duy nhất của nó. Mọi thay đổi do chủ lịch làm đều tăng `version`.
- **`stop()` khi đang lập kế hoạch** chuyển lượt sang `interrupted` ("Máy chủ dừng khi đang lập kế hoạch."). `server.ts` hiện không có bước tắt có trật tự, nên `stop()` chỉ dùng trong test; timer đã `unref()`.
- **Câu lỗi lưu ở lượt** không chép lỗi gốc của provider: "Không lập được kế hoạch lúc này. Hãy thử lại." hoặc "Lập kế hoạch quá thời gian cho phép."
- **Router lịch** chỉ kiểm phiên với đường dẫn của lịch (`isSchedulePath`). Bản đầu mount `authMiddleware` cho cả `/api`, làm request `/api/conversations/*` bị kiểm phiên hai lần khi cờ bật; reviewer tự phát hiện khi soát mã.
- **SCHED-03** (card của task khác, sửa vì là lỗi lập kế hoạch): ví dụ "thứ Bảy 25/10/2026" và "thứ Hai 27/10" sai thứ (25/10/2026 là Chủ nhật, 27/10 là thứ Ba). Nay là "thứ Bảy 31/10/2026" và "thứ Hai 26/10".

## RED → GREEN

PostgreSQL 16 tmpfs riêng ở 56533, sandbox, không dùng `.env` hay DB dev. Log thô ở `.codex/sched01/` của worktree (không commit).

| Nhóm test | RED | GREEN |
|---|---|---|
| `next-occurrence.test.ts` (12) | không tìm thấy module | 12/12 |
| `schedule-migration.test.ts` (7) | `expected [...] to include '0010_schedules.sql'` | 7/7 |
| `schedules-env.test.ts` (6) | 6/6 fail (`SCHEDULES_ENABLED` là `undefined`, không ném lỗi) | 6/6 |
| `schedule-routes.test.ts` (18) | không tìm thấy `schedule-service` | 18/18 |
| `schedule-runner.test.ts` (17) | không tìm thấy `schedule-runner` | lượt đầu 16/17 (các ca dùng chung schema; thêm dọn bảng trước mỗi ca), rồi 17/17 |
| `schedules-runtime.test.ts` (2) | không tìm thấy module | 2/2 |
| ca kiểm phiên chỉ cho đường dẫn lịch | `expected 1 to be +0` | 19/19 cả file |

Bốn nhóm có RED là "không tìm thấy module", tức tính năng chưa có, chứ chưa phải lỗi ở mức hành vi. Phần hành vi được kiểm bằng đột biến dưới đây.

## Đột biến

Script `.codex/sched01/mutate.mjs`: sửa đúng một chỗ, chạy test liên quan, khôi phục, so SHA-256. **13/13 bị bắt**, cộng M14.

| # | Đột biến | Test bắt |
|---|---|---|
| M1 | bỏ `SKIP LOCKED` | never waits for a schedule another process holds |
| M2 | khoá `schedule_runs_slot` thành index thường | records each scheduled time once |
| M3 | bỏ so `baseVersion` | refuses a proposal written against an older version |
| M4 | bỏ kiểm `version` trước `persist` | discards the result when the schedule changed |
| M5 | tính lượt lỡ như lượt thường | records the times missed … as one run |
| M6 | `resume` tính từ lúc tạm dừng | applies update, pause, resume and cancel |
| M7 | bỏ kiểm chủ lịch | answers 404 to another member |
| M8 | đếm kế hoạch quá hạn vào `pending-count` | lists schedules … counts runs waiting |
| M9 | cờ tắt vẫn tạo lịch | creates nothing when the flag is off |
| M10 | bỏ cả khoá dòng lẫn `ON CONFLICT` | never waits … (và tạo trùng) |
| M11 | bỏ "xác nhận lặp không đổi gì" | applies the same proposal once |
| M12 | `afterCommit` trước COMMIT | calls afterCommit only after … committed |
| M13 | quá hạn không huỷ `signal` | fails a run whose planning takes longer than the limit |
| M14 | router lịch kiểm phiên cho cả `/api` | checks the session only for schedule paths (RED ở bảng trên) |

- **M12 lọt ở lượt đầu.** Test cũ kiểm bằng một truy vấn bất đồng bộ từ kết nối khác, và truy vấn đó có thể chạy sau COMMIT nên vẫn thấy kế hoạch. Đã thay bằng test quan sát thứ tự `persist` → `COMMIT` → `afterCommit` trên client thật của runner; chạy lại thì M12 bị bắt.
- **M1:** riêng việc bỏ `SKIP LOCKED` không tạo lượt trùng. PostgreSQL kiểm lại điều kiện sau khi chờ khoá, nên nhịp thứ hai chỉ phải chờ. Test vì vậy kiểm đúng tính chất mà `SKIP LOCKED` bảo đảm: nhịp không chờ dòng mà tiến trình khác đang giữ.

## Kiểm toàn bộ

- `npm run check` (`DATABASE_URL` của DB tạm, `RUNTIME_MODE=sandbox`):
  - lượt 1, trước ca M14: **exit 0**, 63 + 408 + 291 + 42 + 527 + 773 = 2.104 v3 + 394 eval;
  - **lượt cuối**, trên code của PR: **exit 0**, 63 + 408 + 291 + 42 + **528** + 773 = **2.105 v3** + **394 eval**. Typecheck, build, quét bản build, launcher và test node của script đều đạt.
- Lượt `chat-api` đầu tiên có 22 ca fail vì DB tạm chưa chạy migration trong schema `public` (CI luôn chạy `db:migrate:v3` trước). Sau khi migrate: 527/527.
- **Browser E2E** (`npm run test:browser:v3`) chạy trên DB tạm 56533 và cổng riêng (API 3999, web 5199), để không đụng app của buổi thử W4-03. Cờ tắt, như CI.
  - Lượt 1: exit 1. Nhóm default 92 pass, 1 fail, 1 skip; runner dừng ở nhóm đầu. Ca fail là `FE-12: the bar fits without overlap…` (`fe-12-nav.spec.ts:103`): một lần tải trang trong vòng lặp nhiều trang × nhiều khổ không thấy `[data-main-nav]` sau 10 giây, trong khi các trang và khổ trước nó đã chụp ảnh xong. SCHED-01 không đổi `apps/chat-web`, và khi cờ tắt thì server không chạy thêm mã nào. Lỗi cùng loại với các ca chập chờn ở CURRENT-STATE mục 5. Log ở `.codex/sched01/browser-1.log`.
  - Lượt 2, trên DB dựng lại sạch: **exit 0**, **120 pass/1 skip có chủ đích, 13 nhóm** (default 93), ca FE-12 đạt.
- **Chạy thử server thật** (`.codex/sched01/smoke.mjs`), cổng 3999, sandbox, cờ bật:
  - `/api/health` có `schedulesEnabled: true`;
  - xác nhận đề xuất → `active`, 3 lần chạy tới; xác nhận lại → 200, phiên bản vẫn 1;
  - "Chạy lượt này ngay" → 201 `planning`, rồi `planning_failed` vì planner chưa nối. Hội thoại `Lịch: Lịch họp hằng ngày · 25/10 14:05` có tin `schedule_run` và `planning_error`;
  - `pending-count` 0; nút với phiên bản sai → 409 `STALE_VERSION`; ID không tồn tại → 404 `NOT_FOUND`.

## Chưa làm

- Planner, `ChatService`, kịch bản sandbox `schedule` (SCHED-02); giao diện (SCHED-03).
- Không gọi model hay dịch vụ thật.
- Cùng giới hạn như W2-01: chỉ một API instance, bộ hẹn giờ không có lease.

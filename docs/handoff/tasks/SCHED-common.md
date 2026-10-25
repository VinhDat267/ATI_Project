# SCHED-common · Quy tắc chung cho lịch chạy workflow

**Đặc tả:** [`2026-10-24-scheduled-workflows-design.md`](../../superpowers/specs/2026-10-24-scheduled-workflows-design.md), đã duyệt 25/10/2026. Mọi task SCHED đọc đặc tả và file này trước.

## 1. Thứ tự và phụ thuộc

| Task | Người làm | Phụ thuộc | Merge trước |
|---|---|---|---|
| [SCHED-01](SCHED-01-schedule-backend.md) backend | reviewer | không | 29/10 |
| [SCHED-02](SCHED-02-schedule-planner.md) planner và nối `ChatService` | reviewer | SCHED-01 | 30/10 |
| [SCHED-03](SCHED-03-schedule-ui.md) giao diện | `longnguyen005` | bắt đầu ngay; merge sau SCHED-02 | 01/11 |
| [SCHED-04](SCHED-04-measure-and-live.md) đo, nghiệm thu thật, bật cờ | reviewer, nhóm trưởng | SCHED-01 → 03 | 04/11 |

- Mã sản phẩm chỉ merge **từ 26/10**: ngày 23–25/10 là buổi thử W4-03.
- Mỗi PR có **review độc lập** riêng; bên thi công không tự review.
- Mốc cắt ở đặc tả mục 10. Bên thi công thấy không kịp mốc thì báo nhóm trưởng sớm, không cắt phạm vi trong im lặng.

## 2. Khi cờ tắt, hệ thống không đổi

`SCHEDULES_ENABLED` mặc định `off`. Mọi PR SCHED phải giữ, và có test giữ:
- prompt của planner giống từng byte (SHA-256) với `main` trước SCHED-02, ở cả `regex` và `llm`, cả khi `PLANNER_READ_ANSWERS` bật;
- `ALL_TOOLS` 33 tool, `SERVICE_REGISTRY` 8 dịch vụ; routing offline 116 câu không đổi;
- route lịch trả 404; `ScheduleRunner` không khởi động; `/api/health` không có `schedulesEnabled`;
- web không gọi API lịch và không hiện gì về lịch;
- `npm run check` và `npm run test:browser:v3` hiện có đạt **không sửa assertion cũ**.

## 3. Hợp đồng dùng chung

Kiểu dữ liệu ở **đặc tả mục 4** là hợp đồng giữa backend và giao diện. SCHED-01 thêm chúng vào `packages/tool-schemas/src/types.ts` và export từ `index.ts`. Muốn đổi một trường thì sửa đặc tả mục 4 trong cùng PR, và báo bên kia trong mô tả PR.

Route và mã lỗi 409 ở **đặc tả mục 6.5, 6.6**. Câu lỗi cho người dùng viết tiếng Việt, không lộ ID nội bộ hay stack.

Tên file và thư mục mới:

| Phần | Chỗ |
|---|---|
| Migration | `db/v3/0010_schedules.sql` |
| Repository | `apps/chat-api/src/db/repositories/schedule-repo.ts` |
| Tính giờ hẹn, bộ hẹn giờ, trạng thái suy ra | `apps/chat-api/src/services/schedules/` (`next-occurrence.ts`, `schedule-runner.ts`, `run-state.ts`) |
| Route | `apps/chat-api/src/routes/schedule-routes.ts` |
| Validator lịch | `packages/planner/src/schedule-validator.ts` |
| Mục prompt | `packages/planner/src/prompts/schedule-rules.ts` |
| Giao diện | `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx`, `apps/chat-web/src/pages/History/ScheduleSection.tsx` |

## 4. Kiểm thử

- **TDD:** viết test trước, chạy thấy fail đúng lý do, ghi RED vào log; rồi mới cài đặt.
- **PostgreSQL thật** cho mọi logic khoá, khoá duy nhất, CAS phiên bản, đối soát khởi động. Không mock repo trong các test này. Hai tiến trình đồng thời mô phỏng bằng hai kết nối `pg` riêng.
- **Đồng hồ tiêm được** (`now: () => Date`); không `sleep` để chờ giờ hẹn. Hết thời gian của model kiểm bằng `AbortSignal` thật.
- DB test dùng PostgreSQL tạm riêng (CURRENT-STATE mục 6). Trước khi chạy, kiểm `docker ps` xem ai giữ cổng 55533; không chạy test trên DB dev.
- **Đột biến:** mỗi task có danh sách riêng; ghi kết quả từng đột biến vào log.
- Không gọi model hay dịch vụ thật trong SCHED-01 → 03. Chỉ SCHED-04 gọi.

## 5. Bàn giao

Theo `AGENTS.md` mục 4: điền phần "Kết quả" của task card và thêm một file log trong cùng PR; không sửa `CURRENT-STATE.md` và `ROADMAP.md`. Mô tả PR theo `.github/pull_request_template.md`, có output test thật và commit hash, không có dòng "Generated with…".

# CALENDAR-REM-A · Calendar Digest Consumer Accuracy (`CALENDAR-AUDIT-01`) & Half-Open Window Bounds (`CALENDAR-AUDIT-05`)

**Trạng thái:** Đã hoàn thành · **Nhánh:** `VinhDat267/calendar-rem-v2-digest-argon` · **Baseline SHA:** `2eed8d1d4309e833088d6f1d3fa774189049e283`

## 1. Mục tiêu & Phạm vi

Khắc phục triệt để hai lỗi đã xác nhận trong báo cáo kiểm toán Google Calendar v3 (`calendar-audit-evidence-20261110`) thuộc phạm vi **Worker A** (`CONTRACTS.md` v1 & `specs/A-digest.md`):

- **`CALENDAR-AUDIT-01` (`HIGH` — Digest Consumer Accuracy & Coverage):**
  - `createCalendarDigestExecutor` và `formatCalendarDigestMessage` tại [`apps/chat-api/src/services/schedules/calendar-digest-runner.ts`](../../../apps/chat-api/src/services/schedules/calendar-digest-runner.ts) trước đây đọc tối đa `limit: 20` sự kiện mỗi lịch nhưng luôn tuyên bố `"Tổng số sự kiện: N trên M lịch"` và `"• ✅ Không có xung đột giờ họp"` ngay cả khi lịch còn trang chưa đọc (`nextPageToken`), vượt giới hạn hiển thị 20 sự kiện, hoặc thiếu metadata độ phủ (`coverage`).
  - Triển khai tiêu thụ contract `coverage?: { complete: boolean, returned: number, totalAvailable: number | null, reason?: string }` từ `mycalendar.list_events` theo nguyên tắc bảo thủ: thiếu hoặc sai định dạng `coverage` luôn bị coi là `UNKNOWN` (không bao giờ coi là `complete`).
  - Chỉ kết luận `"• ✅ Không có xung đột giờ họp"` và chỉ cho phép gọi `summarizeDigest` khi **tất cả** lịch được kiểm tra đều có `status === 'complete'` và tổng số sự kiện hợp nhất không vượt quá trần hiển thị 20 sự kiện (`enrichedEvents.length <= 20`). Không chỉnh sửa `apps/chat-api/src/server.ts`.
  - Khi cắt danh sách hiển thị theo trần 20 sự kiện hoặc giới hạn `3900` ký tự, luôn cắt theo ranh giới dòng sự kiện hoàn chỉnh (không cắt cụt giữa dòng) và hiển thị trung thực số lượng `hiển thị D/O` kèm số sự kiện trùng giờ bị lược bớt ngoài danh sách hiển thị.
  - Khi phản hồi từ adapter bị lỗi giữa chừng (lịch thứ 2 lỗi sau khi lịch thứ 1 thành công) hoặc `res.events` không phải mảng hợp lệ, dừng an toàn với trạng thái `digest_failed` trước khi ghi `delivery_started_at`.
- **`CALENDAR-AUDIT-05` (`MEDIUM` — Digest Window Off-By-One & DST Midnight):**
  - `buildDayWindow` trước đây lấy offset múi giờ tại thời điểm `dueAt` gắn vào `00:00:00` và trừ `1_000` ms ở `timeMax` (`23:59:59`), làm mất sự kiện bắt đầu trong giây cuối ngày (`23:59:59`–`00:00:00` khi Google Calendar lọc theo khoảng nửa mở `[timeMin, timeMax)`) và sai lệch 1 giờ tại ranh giới `00:00:00` trong ngày chuyển đổi DST (`America/New_York`, `Europe/Berlin`).
  - Chuyển sang giải nghiệm chính xác thời điểm UTC của nửa đêm địa phương `00:00:00` tại múi giờ được cấu hình (`resolveLocalMidnightInstant`) và trả về khoảng nửa mở `[00:00:00, nextDay 00:00:00)` không trừ `1_000` ms trên mọi chu kỳ 24h/48h, cuối tháng, cuối năm, năm nhuận và ngày chuyển đổi DST.

## 2. Ranh giới Sở hữu File (Ownership)

Chỉ chỉnh sửa các file thuộc quyền sở hữu của Worker A:
- [`apps/chat-api/src/services/schedules/calendar-digest-runner.ts`](../../../apps/chat-api/src/services/schedules/calendar-digest-runner.ts)
- [`apps/chat-api/tests/services/calendar-digest-runner.test.ts`](../../../apps/chat-api/tests/services/calendar-digest-runner.test.ts)
- [`apps/chat-api/tests/services/calendar-rem-a-digest-accuracy.test.ts`](../../../apps/chat-api/tests/services/calendar-rem-a-digest-accuracy.test.ts)
- [`docs/handoff/tasks/CALENDAR-REM-A-digest-accuracy.md`](CALENDAR-REM-A-digest-accuracy.md)
- [`docs/handoff/log/2026-11-10-calendar-rem-a-digest-accuracy.md`](../log/2026-11-10-calendar-rem-a-digest-accuracy.md)

Không chạm vào `apps/chat-api/src/server.ts`, `schedule-runner.ts`, `schedule-service.ts`, `packages/tool-schemas`, `packages/tool-adapters`, `docs/handoff/CURRENT-STATE.md`, hay `docs/handoff/ROADMAP.md`.

## 3. Bằng chứng TDD (`RED` → `GREEN`)

### 3.1. Pha `RED` trên Baseline `2eed8d1d4309e833088d6f1d3fa774189049e283`
- **Lệnh chạy:**
  ```powershell
  $env:DATABASE_URL='postgresql://cal_rem_a:cal_rem_a_fixture_only@127.0.0.1:56651/cal_rem_a'
  npm test -w @wap/chat-api -- tests/services/calendar-rem-a-digest-accuracy.test.ts --maxWorkers=1
  ```
- **Kết quả:** `10 tests | 10 failed` (`exit code 1`). Log lưu tại `C:\Users\VinhDat\orca\workspaces\ATI_Project\calendar-remediation-v2-evidence-20261110\workers\A\logs\red-baseline.log`.
  - Chứng minh lỗi `CALENDAR-AUDIT-01`: bản tin trên baseline in `• ✅ Không có xung đột giờ họp` và gọi AI summary ngay cả khi lịch còn trang 2 chứa sự kiện trùng giờ, khi `coverage.complete = false`, khi thiếu `coverage`, hoặc khi tổng sự kiện đa lịch `> 20` bị cắt hiển thị; đồng thời cắt cụt dòng sự kiện tại ký tự `3900` và không báo lỗi khi `events: null`.
  - Chứng minh lỗi `CALENDAR-AUDIT-05`: `buildDayWindow` gửi `timeMax = 2026-11-16T23:59:59+07:00` làm rơi sự kiện `23:59:59`, và gửi sai offset `2026-03-08T00:00:00-04:00` (thay vì `-05:00`) trong ngày DST spring-forward tại `America/New_York`.

### 3.2. Pha `GREEN` & Kiểm thử Hồi quy Lân cận
- **Lệnh chạy bộ kiểm thử Calendar Digest (`GREEN`):**
  ```powershell
  $env:DATABASE_URL='postgresql://cal_rem_a:cal_rem_a_fixture_only@127.0.0.1:56651/cal_rem_a'
  npm test -w @wap/chat-api -- tests/services/calendar-rem-a-digest-accuracy.test.ts tests/services/calendar-digest-runner.test.ts tests/services/calendar-digest-delivery-safety.test.ts --maxWorkers=1
  ```
  - **Kết quả:** **PASS (`3` test files, `32` tests passed, `exit code 0`)**. Log lưu tại `C:\Users\VinhDat\orca\workspaces\ATI_Project\calendar-remediation-v2-evidence-20261110\workers\A\logs\green-rem-a.log`.
- **Lệnh chạy bộ kiểm thử hồi quy lịch trình lân cận:**
  ```powershell
  $env:DATABASE_URL='postgresql://cal_rem_a:cal_rem_a_fixture_only@127.0.0.1:56651/cal_rem_a'
  npm test -w @wap/chat-api -- tests/services/calendar-digest-approval.test.ts tests/services/schedule-calendar-digest.test.ts tests/services/schedules/schedule-locks.test.ts tests/services/schedules/schedule-runner.test.ts tests/services/schedules/next-occurrence.test.ts tests/integration/schedule-recovery.test.ts --maxWorkers=1
  ```
  - **Kết quả:** **PASS (`6` test files, `57` tests passed, `exit code 0`)**. Log lưu tại `C:\Users\VinhDat\orca\workspaces\ATI_Project\calendar-remediation-v2-evidence-20261110\workers\A\logs\adjacent-regressions.log`.
- **Lệnh kiểm tra kiểu TypeScript (`typecheck:v3`):**
  ```powershell
  npm run typecheck:v3
  ```
  - **Kết quả:** **PASS (`exit code 0`)**. Log lưu tại `C:\Users\VinhDat\orca\workspaces\ATI_Project\calendar-remediation-v2-evidence-20261110\workers\A\logs\typecheck.log`.

## 4. Kết quả

- Đã hoàn thành toàn bộ yêu cầu của Worker A (`CALENDAR-AUDIT-01` & `CALENDAR-AUDIT-05`) đúng theo `CONTRACTS.md` v1, giữ nguyên tính tương thích ngược của `CalendarDigestDelivery` DTO và cơ chế an toàn gửi (`delivery_started_at`, `CALENDAR_DELIVERY_UNKNOWN`, hủy lịch trước/sau khi gửi).
- Phụ thuộc tích hợp liên nhánh: khi nhánh của Worker B (producer `PersonalCalendarAdapter` / `CalendarAdapter` bổ sung `coverage` thực tế trên `list_events`) chưa được hợp nhất vào nhánh này, `PersonalCalendarAdapter` trên baseline `2eed8d1d4309e833088d6f1d3fa774189049e283` chưa đính kèm `coverage`, và `calendar-digest-runner.ts` xử lý an toàn theo trạng thái `UNKNOWN` (không tuyên bố đủ dữ liệu hay không có xung đột, đồng thời tắt AI summary). Khi kết hợp với nhánh của Worker B ở bước tích hợp của Coordinator, đường chạy đầy đủ sẽ nhận `coverage.complete = true | false` trực tiếp từ adapter.

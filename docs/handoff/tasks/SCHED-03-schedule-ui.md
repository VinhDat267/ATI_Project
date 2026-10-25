# SCHED-03 · Lịch chạy: giao diện

**Trạng thái:** chờ, giao `longnguyen005` · **Nhánh gợi ý:** `feat/sched-03-schedule-ui` · **Phụ thuộc:** bắt đầu được ngay, dựng trên kiểu dữ liệu ở đặc tả mục 4; test browser cần SCHED-01 và SCHED-02 đã merge · **Mốc:** merge trước 01/11/2026
**Đặc tả:** mục 3, 4, 6.5 (mã 409), 6.6, 7. **Quy tắc chung:** [SCHED-common](SCHED-common.md), đọc trước.

## Mục tiêu

Khi `SCHEDULES_ENABLED=on`, người dùng làm được kịch bản demo ở đặc tả mục 3 hoàn toàn qua giao diện:
- xác nhận, sửa, bỏ qua đề xuất lịch trong cockpit;
- thấy trạng thái lịch, tạm dừng, chạy tiếp, hủy, chạy ngay;
- thấy số lượt chờ duyệt trên tab Nhật ký, và danh sách lịch trong trang Nhật ký;
- mở hội thoại của một lượt, duyệt kế hoạch, lập lại kế hoạch khi đã quá hạn.

Khi cờ tắt (`health.schedulesEnabled` không có), giao diện không đổi và không gọi API lịch.

## Việc cần làm

1. **API client** (`services/api-client.ts`): một hàm cho mỗi route ở đặc tả mục 6.6, kiểu trả về lấy từ `@wap/tool-schemas`. Lỗi 409 trả `code` để màn hiện câu ở bảng dưới.
2. **Câu hiển thị thời gian** (`services/schedule-text.ts`), hàm thuần:
   - `describeRecurrence(r: ScheduleRecurrence): string`:
     - `daily` → `Hằng ngày, 08:00, giờ Việt Nam`;
     - `weekly` từ 3 ngày liền trở lên → `Thứ Hai đến thứ Sáu, 08:30, giờ Việt Nam`; ngày rời → `Thứ Hai, thứ Tư, 08:30, giờ Việt Nam`; đủ 7 ngày → `Mọi ngày trong tuần, 08:30, giờ Việt Nam`;
     - `once` → `Một lần, thứ Bảy 31/10/2026, 09:00, giờ Việt Nam`;
     - tên ngày: 1 `thứ Hai` … 6 `thứ Bảy`, 7 `Chủ nhật`; viết hoa chữ đầu câu;
   - `formatRunTime(iso: string): string` → `08:30 thứ Hai 26/10`, theo `Asia/Ho_Chi_Minh`.
3. **Khoảnh khắc `schedule`** (`services/cockpit-moment.ts`, `pages/Cockpit/ScheduleMoment.tsx`): chọn khi tin mới nhất của hội thoại có `metadata.type` là `schedule_proposal` hoặc `schedule_state`.
   - **Đề xuất** `create`/`update`: tên lịch (`h1`), `describeRecurrence`, việc sẽ làm (`request`), dịch vụ theo `servicePalette`, "Lần chạy tới:" với ba `formatRunTime`, và đúng câu "Tới giờ, ATI lập kế hoạch mới và chờ bạn duyệt. Chưa có gì được ghi lên công cụ nào.";
   - `update`: mỗi trường đổi so với `previous` hiện giá trị cũ gạch ngang và giá trị mới;
   - `pause`/`resume`/`cancel`: một câu ("Tạm dừng lịch "…"?", "Chạy tiếp lịch "…"?", "Hủy lịch "…"? Lịch đã hủy không bật lại được.");
   - nút **Xác nhận**, **Sửa** (focus ô nhập), **Bỏ qua** (ẩn thẻ trong phiên, không gọi API);
   - **Trạng thái** (`schedule_state`): "Đang bật · lần chạy tới …" hoặc "Đã tạm dừng: <pauseReason>" hoặc "Đã hủy" hoặc "Đã chạy xong"; nút Tạm dừng/Chạy tiếp, **Chạy lượt này ngay**, Hủy lịch (hộp xác nhận theo `useDialogFocus`). "Chạy lượt này ngay" thành công thì mở hội thoại của lượt.
4. **Hội thoại của lượt:** tin `schedule_run` hiện là `Lịch "<name>" tự gửi lúc <HH:mm dd/MM>` ở chỗ của `RequestEcho` ("Bạn nhờ"), không hiện như người dùng tự gõ. Khi lượt ở trạng thái `expired`, `planning_failed` hoặc `interrupted` (đọc qua `GET /api/schedules/:id/runs`), hiện nút **Lập lại kế hoạch** (gọi `replan`, rồi mở hội thoại của lượt mới).
5. **SSE** (`hooks/use-sse.ts`, `store/chat-store.ts`): nhận `schedule_proposal` và `schedule_updated`, cập nhật tin của hội thoại đang mở; sự kiện của hội thoại khác bị bỏ như các sự kiện hiện có.
6. **Trang Nhật ký** (`pages/History/ScheduleSection.tsx`, gắn trong `HistoryPage.tsx` trên danh sách hội thoại): tiêu đề mục "Lịch chạy"; mỗi lịch một hàng gồm tên, `describeRecurrence`, trạng thái, lần chạy tới, kết quả lần trước (nhãn ở bảng dưới, link tới hội thoại của lượt); mở hàng thấy 10 lượt gần nhất; nút như mục 3. Không có lịch thì không hiện mục.
7. **Thanh điều hướng** (`components/layout/MainNav.tsx`): tab Nhật ký có số lượt chờ duyệt khi `count > 0`; tên truy cập `Nhật ký, 1 lượt chờ duyệt`. Gọi `pending-count` khi tải, mỗi 30 giây, và khi tab trình duyệt được focus; dừng khi đăng xuất. Dưới 900 px (không có tab), số hiện cạnh mục Nhật ký trong menu avatar.
8. **Runner browser** (`scripts/test-v3-browser.mjs`): nhóm `schedule`, grep `SCHED-03:`, đặt `SCHEDULES_ENABLED=on`; mọi nhóm khác đặt `off`. Ca `SCHED-03 off:` vào nhóm default.

**Câu cho trạng thái lượt** (`ScheduleRunState`):

| Trạng thái | Câu |
|---|---|
| `planning` | Đang lập kế hoạch |
| `awaiting_approval` | Chờ bạn duyệt |
| `approved` | theo `planStatus`: Đang chạy, Đã xong, Xong một phần, Có lỗi, Đã dừng |
| `expired` | Hết hạn duyệt |
| `rejected` | Bạn đã hủy kế hoạch |
| `needs_attention` | Cần bạn xem |
| `planning_failed` | Không lập được kế hoạch |
| `interrupted` | Bị gián đoạn |
| `discarded` | Đã bỏ vì lịch thay đổi |
| `missed` | Đã lỡ (`missedCount > 1`: Đã lỡ N lượt) |
| `blocked` | Bị chặn |

**Câu cho mã 409:**

| `code` | Câu |
|---|---|
| `STALE_PROPOSAL` | Đề xuất này đã cũ. Hãy xem đề xuất mới nhất. |
| `LIMIT_REACHED` | Bạn đã có 10 lịch. Hãy hủy bớt một lịch rồi thử lại. |
| `CONVERSATION_HAS_SCHEDULE` | Hội thoại này đã có lịch. Hãy mở hội thoại mới để tạo lịch khác. |
| `SCHEDULE_IN_PAST` | Giờ hẹn đã qua. Hãy nhắn giờ mới. |
| `SCHEDULE_CLOSED` | Lịch đã hủy hoặc đã chạy xong. |
| `STALE_VERSION` | Lịch vừa thay đổi ở nơi khác. Đã tải lại. |
| `RUN_IN_PROGRESS` | Lịch đang lập kế hoạch cho một lượt. Hãy chờ lượt đó xong. |
| `RUN_NOT_REPLANNABLE` | Lượt này không cần lập lại kế hoạch. |

Mọi lỗi của route lịch có dạng `{ error: { code, message } }`; `message` đã là câu ở bảng trên, nên web hiện được ngay (thêm ở SCHED-01).

Hình thức theo `docs/design/design-system.md` và các khoảnh khắc cockpit hiện có; bản mẫu không có màn lịch. Không thêm màu ngoài bảng, không thêm tab, không thêm route.

## Test tối thiểu

- **Unit:**
  - `describeRecurrence` và `formatRunTime` cho mọi dòng ở mục 2, gồm `weekly [1, 3]`, `[1..5]`, `[1..7]`, `[6, 7]`;
  - bộ chọn khoảnh khắc: `schedule_proposal` và `schedule_state` mới nhất → `schedule`; tin `plan` mới hơn → khoảnh khắc kế hoạch như cũ;
  - thẻ `update` hiện giá trị cũ và mới của đúng các trường đổi;
  - mỗi mã 409 hiện đúng câu; xác nhận không gửi lần hai khi đang chờ phản hồi;
  - cờ tắt: không gọi `pending-count`, không có mục Lịch chạy.
- **Browser** (nhóm `schedule`, sandbox kịch bản `schedule`, 1440 và 375, sáng và tối):
  - `SCHED-03: create, edit and confirm a schedule from chat`: gõ câu tạo → thẻ → Xác nhận → trạng thái "Đang bật"; gõ "Đổi sang 8 giờ 30, chỉ thứ Hai đến thứ Sáu" → phần đổi → Xác nhận;
  - `SCHED-03: run now, see the pending count, approve`: Chạy lượt này ngay → hội thoại của lượt có kế hoạch Calendar → Slack; tab Nhật ký hiện 1; duyệt → biên nhận; số về 0;
  - `SCHED-03: pause, resume and cancel from the history page`;
  - `SCHED-03: confirming an older proposal shows the stale message`;
  - không cuộn ngang ở 375 với tên lịch 80 ký tự và `request` 1.000 ký tự liền ký tự.
- **Nhóm default:** `SCHED-03 off:` không có số trên tab Nhật ký, không có mục Lịch chạy, không có request tới `/api/schedules`. Test FE-12 hiện có đạt không sửa assertion.

## Đột biến

Bỏ câu "Chưa có gì được ghi lên công cụ nào."; "Bỏ qua" gọi API; gọi `pending-count` khi cờ tắt; hiện tin `schedule_run` như người dùng tự gõ; không tải lại khi `STALE_VERSION`; tên truy cập của tab Nhật ký không có số. Ghi kết quả từng đột biến vào log.

## Tiêu chí nghiệm thu

- [ ] RED trước GREEN; đột biến đều bị bắt.
- [ ] `npm run check` exit 0; `npm run test:browser:v3` exit 0, gồm nhóm `schedule`, không sửa assertion cũ.
- [ ] Ảnh thẻ đề xuất (tạo và sửa), trạng thái lịch, mục Lịch chạy, tab có số ở 1440/375 sáng/tối; không commit ảnh, ghi đường dẫn trong log.
- [ ] SCHED-common mục 2 giữ đúng khi cờ tắt.

## Ngoài phạm vi

- Quản lý lịch bằng tên từ hội thoại khác; lọc Nhật ký theo lịch.
- Thông báo ngoài app.

## Kết quả (agent thi công điền)

- PR:
- RED/GREEN, đột biến, lệnh kiểm và exit code:
- Điều chưa làm hoặc khác với task card:

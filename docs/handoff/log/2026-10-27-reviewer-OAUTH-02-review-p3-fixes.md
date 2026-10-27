# 27/10/2026 · OAUTH-02 · Sửa 3 P3 của review độc lập (#176)

**Người viết:** reviewer. **Yêu cầu của nhóm trưởng:** "xử lý nốt #176". **Nhánh:** `feat/oauth-02-personal-calendar`, sửa trên head `5363d06` (đã gộp `main`). Review độc lập tại `a379dd5`: [Đạt sau khi sửa nhỏ, 3 P3](https://github.com/VinhDat267/ATI_Project/pull/176#issuecomment-6437340913).

Người sửa cũng là người viết review, nên phần sửa cần **một reviewer khác** kiểm lại.

## Ba P3 và cách sửa

1. **P3-1, đột biến M6 lọt:** `createMyCalendarConnectionLookup` trả `null` khi chưa chọn lịch (`scope_required`), nhưng lớp chặn này không có test. Ca `scope_required` có sẵn dùng `calendarId` viết thẳng, nên vẫn bị phép kiểm "lịch ngoài phạm vi" từ chối, kể cả khi lookup bị đột biến.
   - **Thêm test** (`mycalendar-services.test.ts`): kết nối `scope_required`, kế hoạch `list_calendars` → `create_event` với `calendarId: { $ref: 's1.output[0].id' }`. Kỳ vọng `bindConnections` trả đúng lời từ chối, lý do "chưa được kết nối hoặc chưa chọn lịch".
   - Mã đúng sẵn nên test đạt ngay. Hiệu lực được kiểm bằng đột biến: chạy lại M6 thì **bị bắt** (trước đó lọt, 60/60).
2. **P3-2, câu gợi ý của Gmail đổi khi cờ Calendar tắt:** `bindConnections` dùng câu chung "Hãy kết nối dịch vụ…" cho mọi trường hợp.
   - **RED:** test mới "keeps the Gmail-only refusal exactly as before MyCalendar" fail (`expected { kind: 'refusal', …(3) } to deeply equal …`).
   - **Sửa:** khi chỉ thiếu Gmail, giữ đúng câu trước PR "Hãy kết nối Gmail ở mục "Của riêng bạn"…". Thiếu Calendar riêng, hoặc thiếu cả hai, vẫn dùng câu chung.
   - **GREEN:** 18/18 test của file.
3. **P3-3, mã không dùng tới:**
   - xoá `readPlanMyCalendarConnection`, `planUsesMyCalendar`, `planUsesGmail`, `attachPlanConnections` (`connection-reference.ts`), cùng import không còn dùng;
   - xoá `isGmailEnabled`, `isMyCalendarEnabled`, `filterToolCatalogForRuntime`, `filterToolCatalogForGmail` (`gmail-tools-runtime.ts`), cùng import `ToolDefinition`;
   - xoá `sandbox/fake-results/mycalendar.ts` và trả `sandbox/index.ts` về đúng bản trước PR. Sandbox chuyển `mycalendar` sang adapter HTTP riêng, nên bộ giả trong bộ nhớ không đường nào chạy tới. Bản trả về cũng lấy lại câu lỗi Gmail cũ, "Gmail sandbox đã huỷ." / "Tool Gmail sandbox không hợp lệ.", mà PR đã đổi thành chữ thường theo tên dịch vụ;
   - ghi chú ở `runtimeMyCalendarAdapter` vì sao mọi chế độ dùng adapter HTTP. Bản đầu của ghi chú nói sai, xem mục "Kiểm lại" bên dưới.

   Trước khi xoá, đã `grep` toàn bộ `apps`, `packages`, `scripts`, `evaluations`: mỗi tên chỉ xuất hiện ở chính chỗ định nghĩa.

## Kiểm toàn bộ

PostgreSQL 16 tmpfs riêng ở 56533, dựng lại sạch trước mỗi lượt; API 3999, web 5199; sandbox; không dùng `.env` hay DB dev. Log ở `ATI_Project-review-pr176/.codex/review-176/p3-*.log`.
- `npm run check` (`VITEST_MAX_WORKERS=2`): **exit 0**; 65 + 425 + 378 + 42 + **616** + 860 = **2.386 v3** + **406 eval**. `chat-api` thêm 2 test; web 860 là con số sau khi gộp `main` (SCHED-03).
- `npm run test:browser:v3`: **exit 0 ngay lượt đầu**, **157 pass/1 skip có chủ đích, 15 nhóm**: default 95, `gmail` 10, `mycalendar` 7, `schedule` 22.
- `tsc` của `chat-api` exit 0 sau khi xoá mã thừa.

## Kiểm lại phần sửa

Một reviewer khác kiểm lại tại `e9f1dc3` ([bình luận](https://github.com/VinhDat267/ATI_Project/pull/176#issuecomment-6447099752)): **Đạt sau khi sửa nhỏ**. Ba P3 gốc đã đóng:
- ca `$ref` bắt được M6;
- câu gợi ý khớp `2888a9f`;
- mã đã xoá không còn nơi gọi, và `sandbox/index.ts` trùng từng byte với `2888a9f`.

Còn **một P3 mới** ở chính ghi chú vừa thêm. Ghi chú viết rằng ngoài live, `env.ts` chỉ nhận `MYCALENDAR_OAUTH` khi mọi endpoint trỏ tới máy chủ giả, nên sandbox "never Google". Điều đó sai: `env.ts` chỉ bắt buộc có đủ bốn biến `MYCALENDAR_*` override, và không kiểm URL là máy chủ giả. Đặt URL Google thật vào đó thì sandbox vẫn gọi Google. Reviewer chứng minh bằng một probe cấu hình, không gọi mạng.

Review độc lập lần 1 của #176 cũng nói quá như vậy ("sandbox không thể gọi Google").

**Sửa:** ghi chú nay chỉ nói đúng điều `env.ts` làm. Việc trỏ các biến này tới máy chủ giả cục bộ (`scripts/fake-google-gmail.mjs`, như runner browser đang làm) là trách nhiệm của bên cấu hình. Chỉ đổi chú thích, không đổi mã.

## Chưa làm

- `EVAL_SET=mycalendar` ×3 với model thật và nghiệm thu thật (P-LIVE) vẫn NOT_RUN; cờ giữ tắt.

# 02/11/2026 · CALENDAR-01 · Sửa audit Calendar digest F2/F3

Task: [CALENDAR-01](../tasks/CALENDAR-01-audit-fixes.md). Nhánh `fix/calendar-digest-audit`.

## Thay đổi

- F2: migration `0021_calendar_digest_delivery.sql` thêm `schedule_runs.delivery_started_at`. Executor ghi marker trước khi gọi adapter gửi. Mất phản hồi, lỗi 5xx/JSON hỏng hoặc abort sau marker được giữ ở `needs_attention`, không có replan. Startup reconciliation giữ nguyên sự không chắc chắn kể cả lịch đã đổi sang mode khác.
- Lỗi đọc/khởi tạo trước dispatch và phản hồi chắc chắn từ chối vẫn có thể thử lại. Receipt xác nhận gửi vẫn thắng cancellation đến sau. Marker không tự chứng minh gửi thành công; không tạo receipt giả. Đánh dấu trước adapter có thể yêu cầu kiểm tra cả khi preflight của adapter lỗi mà không chứng minh được chưa gửi.
- F3: candidate mới chứa config bất biến cùng preview. Confirm create/update đối chiếu cả tài khoản/kết nối, tập lịch và đích với trạng thái hiện tại; dùng lại config đã hiển thị thay vì âm thầm lấy scope mới. So sánh bỏ qua thứ tự tập lịch nhưng không thay thuật toán hash của lịch cũ. Token rotation trên cùng credential vẫn hợp lệ.
- Scope trở thành không đủ điều kiện sau một preview cho phép tự gửi cũng bị từ chối; không âm thầm đổi lịch đã duyệt sang mode thủ công. Đề xuất cũ thiếu snapshot cần đề xuất mới hoặc người dùng chọn thủ công.
- UI recovery/History hiển thị hướng dẫn kiểm tra kênh nhận cho `needs_attention`, không có nút lập lại kế hoạch. Browser regression dùng API thật ở desktop1440/mobile375; fixture seed trạng thái kết thúc, không giả vờ gửi provider thật.

## Provenance và review

- Base ban đầu `19b51f9e`, sau #246/#247. Implementation `4b0ee709`; reviewer đọc diff và chạy độc lập 34 API +7 UI PASS.
- Reviewer phát hiện P2 implicit update khi scope từ một thành nhiều kênh. Hai regression mới RED trước sửa, GREEN sau sửa; nhóm confirmation 14/14 PASS. Sửa ở `c8b516e1`.
- Đã đồng bộ `origin/main` sau merge #240 (`afc25bd3`) bằng merge commit `02012daa`. Không có conflict; diff PR chỉ chứa Calendar task.
- Review không tìm thêm finding ở dispatch ambiguity, abort/stop/restart, receipt/cancellation hoặc token/order. Không xem review ban đầu “Chưa đạt” là approval tự động: finding đã đóng bằng test tái hiện và full check sau sửa.

## Bằng chứng

- TDD ban đầu: approval9 FAIL; delivery5 FAIL/2 PASS; UI1 FAIL/6 PASS. Edge restart khi schedule đổi kind:1 FAIL/12 PASS, sau sửa GREEN. Không dùng fake boolean để chứng minh database concurrency.
- Regression trước review:22 API PASS trên PostgreSQL16 riêng, HTTP server loopback thật + Slack/Telegram adapters. Thêm2 confirmation cases sau review,14 confirmation/proposal PASS.
- Full check trước review:3.186 v3 +406 eval +99 Node/launcher PASS, exit0.
- Browser desktop/mobile:2/2 PASS, exit0; lỗi assertion đầu tiên dùng sai cấp DTO `.code` đã sửa thành `.error.code`. Đã xem screenshot375px, nội dung không tràn ngang.
- `npm run check` trên cây `02012daa`: **3.507 v3 +406 eval +99 Node/launcher PASS**, exit0. V3 =341 schemas +468 adapters +381 planner +42 executor +1.314 API +961 web. Typecheck, build, build security đều PASS.
- DB test riêng cuối dùng cổng56534: lượt đầu trên56673 dừng ở guard Jira mới (17files fail vì port,319cases skipped); chuyển sang container test riêng56534, chạy đủ162files/1.314API PASS, không skip. Không sửa guard của Jira.
- Browser chạy lại sau tích hợp #240: **2/2 PASS**, exit0 (`npm run test:browser:v3 -- sched-03-calendar-delivery.spec.ts`).
- Browser fixture từng import helper API làm compiler web kéo theo source adapters và báo unused imports; đã bỏ dependency đó, dùng hash của fixture terminal state. Typecheck và full check cuối PASS, không sửa adapters.

## Ranh giới

- **NOT_RUN:** OAuth Google thật, Slack/Telegram thật, model live, triển khai/migration trên DB runtime. Không đổi flags.
- Generic Telegram schedule classification và destination identity contract có sẵn ngoài task này. Giữ ranh giới đó vì bản sửa lưu snapshot cũ và kiểm tra scope runtime; review không chứng minh được mở rộng nguồn/đích từ hai điểm này.
- Chỉ thay đổi nhánh riêng; checkout gốc, local main và hai nhánh sprint khác không sửa. Không sửa `CURRENT-STATE.md` hoặc `ROADMAP.md`.
- PR được mở từ `fix/calendar-digest-audit` vào main; CI exact-head cần workflow SUCCESS trên GitHub trước merge. Chưa có yêu cầu merge Calendar.

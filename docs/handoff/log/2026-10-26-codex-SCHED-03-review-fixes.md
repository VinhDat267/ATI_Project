# 26/10/2026 · SCHED-03 · Sửa ba P3 theo review #171

**Nhánh:** `codex/feat-sched-03-ui`, checkout sạch tại `490c6ae` trước khi sửa. **PR:** [#171](https://github.com/VinhDat267/ATI_Project/pull/171). **Commit mã/test:** `a661344`. Task: [SCHED-03](../tasks/SCHED-03-schedule-ui.md). Người dùng yêu cầu thực hiện ba mục P3 trong [review độc lập](https://github.com/VinhDat267/ATI_Project/pull/171#issuecomment-6415384685). Reviewer cho phép chỉ chạy lại test phần sửa và hai probe, không cần review lại toàn bộ.

## Thay đổi

- `hooks/use-sse.ts`: tin `schedule_updated` lấy nội dung từ `scheduleLabel(schedule)`, nên ngăn hội thoại có chữ ngay khi nhận SSE, trước khi tải lại. Test đi qua `handleSSEEvent` và `ConversationDrawer` thật với bốn trạng thái active/paused/cancelled/completed.
- `services/conversation-messages.ts`: tách nguyên bước lọc `working_memory` rỗng và chuẩn hóa role/content/timestamp hiện có của `loadConversationHistory`. Cả loader cũ và `reloadScheduleConversation` dùng chung hàm này. Giữ guard chống GET cũ ghi đè SSE mới. Tin working_memory có nội dung vẫn được giữ.
- `tests/sched-03-ui.test.tsx`: thêm bảy ca, gồm hai ca ngăn hội thoại kiểm độc lập chữ nguồn và người gửi của `schedule_run`, cờ bật/tắt. Mục M4 trong log 25/10 chỉ bắt đột biến ở `RequestEcho`; các ca mới đóng khoảng trống `ConversationDrawer` mà reviewer phát hiện. Không sửa mã nguồn `ConversationDrawer` vì hành vi hiện tại đã đúng.
- `tests/browser/sched-03.spec.ts`: thêm probe mở ngăn hội thoại ngay sau xác nhận, tạm dừng, chạy tiếp, hủy; mở rộng bốn ca đề xuất cũ (1440/375, sáng/tối) để kiểm không có bong bóng rỗng, số tin và số timestamp khớp dữ liệu PostgreSQL sau 409. Giữ mọi assertion cũ.

## RED → GREEN

Lệnh: `npm run test -w @wap/chat-web -- tests/sched-03-ui.test.tsx tests/sched-03-state.test.ts`.

- Trước sửa: **exit 1, 5 fail/38 pass**. Bốn ca SSE chỉ có chữ ATI và timestamp, thiếu nội dung trạng thái; ca reload có thêm id `memory` rỗng. Hai ca nguồn lịch đạt trên mã gốc và được kiểm thêm bằng đột biến.
- Sau sửa: **exit 0, 43/43**. Tổng web tăng từ 809 lên 816.
- Lượt đầu trong sandbox chưa chạy assertion do `EPERM` khi Vitest đổi tên cache tạm; chạy lại ngoài sandbox mới có RED hành vi ở trên. Không tính lỗi môi trường là bằng chứng RED.

## Đột biến

Script `mutate.mjs` sửa từng điểm, chạy hai file test lịch, khôi phục nguyên byte và đối chiếu SHA-256. **5/5 bị bắt**, mỗi lượt exit 1 do assertion:

| Đột biến | Ca bắt |
|---|---|
| Bỏ nội dung trạng thái SSE | bốn trạng thái trong ngăn hội thoại |
| Reload gán thẳng messages từ server | id tin nội bộ rỗng vẫn còn |
| Bỏ chuẩn hóa created_at thành timestamp | timestamp của các tin reload không được phục hồi |
| Bỏ nhánh runOrigin trong ConversationDrawer | mất câu nguồn lịch khi cờ bật |
| Coi mọi role=user là người dùng tự gõ | nhãn người gửi thành Bạn thay vì ATI |

## Kiểm tra sau sửa

Tất cả lệnh dưới đây **exit 0**, không sửa assertion cũ:

- `npm run typecheck:v3`.
- `VITEST_MAX_WORKERS=4 npm run test -w @wap/chat-web`: **73 file, 816/816**, 47,01 s.
- `RUNTIME_MODE=sandbox npm run build:v3` và `node scripts/test-v3-web-build-security.mjs`: build đạt; quét loại credential sentinels và 7 UI claims đạt.
- Browser: `node node_modules/.cache/sched03-review/run-browser.mjs schedule` gọi Playwright config của repo với grep `SCHED-03:`: **22/22**, 1,8 phút, gồm hai probe reviewer yêu cầu.
- Browser cờ tắt: runner mode `off`, grep `SCHED-03 off:`: **1/1**, 6,1 s. Không có API lịch hoặc giao diện lịch.
- `git -c core.whitespace=cr-at-eol diff --check`: đạt.

Runner dùng PostgreSQL 16 Alpine tmpfs riêng `ati-sched03-review-pg`, loopback **56533**, migration 0001–0010; API **3999**, web **5199**, sandbox. Không đọc `.env` vào runner, không gọi model/dịch vụ thật, không dùng DB cá nhân. Runner đặt biến môi trường rõ ràng để các lệnh con không lấy runtime live từ `.env`.

Bằng chứng cục bộ được giữ tại **`.codex/sched03-review/`**: red/green, full web, build, browser schedule/off, từng đột biến và `mutations.json`, script runner. Bản chạy ban đầu ở `node_modules/.cache/sched03-review/`; ảnh của nhóm browser ở `node_modules/.cache/sched03/screenshots/`, được chép sang thư mục bằng chứng mới, không commit.

## Môi trường và giới hạn

- Docker Desktop ban đầu không chạy được do `docker-secrets-engine/engine.sock` là reparse point hỏng, cùng lỗi đã ghi ở phiên 25/10. Sau khi xác nhận Docker đã dừng và thư mục chỉ có socket 0 byte, giữ nguyên thư mục tại `C:/Users/Admin/AppData/Local/docker-secrets-engine-sched03-review-20261026`, rồi khởi động để Docker tạo lại IPC. Không xóa volume hay secrets.
- Không chạy lại full backend/eval/full browser cục bộ sau sửa, theo phạm vi reviewer cho phép; số liệu full check/full browser trước đó chỉ thuộc `490c6ae`. CI trên head mới chạy lại các gate đầy đủ, xem checks của PR; không coi CI cũ là chứng nhận cho head mới.
- Không sửa CURRENT-STATE/ROADMAP, backend, planner, catalog, prompt hoặc bật cờ. Không merge PR trong phiên này.

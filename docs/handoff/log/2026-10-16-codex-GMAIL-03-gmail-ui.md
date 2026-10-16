# 16/10/2026 · GMAIL-03 · Giao diện Gmail theo kết nối riêng

- Task: [GMAIL-03](../tasks/GMAIL-03-gmail-ui.md). Nhánh `codex/feat-gmail-03-ui`, base `96f9f09` sau merge #142. Commit tính năng `d9e16d811b0cb57f6cae856793bd9b7222db23f7`, phần sửa `4ae7eb129c8f17ece96eb21d72ff8072d4a5e8d6` trước rebase (màu Settings/callback và bỏ trạng thái chờ cũ). Nhánh PR: `codex/feat-gmail-03-ui` (URL bổ sung sau khi GitHub cấp số).
- Main nhận #145 trong lúc kiểm thử. Rebase lên `87b31e3`, hai commit tương ứng thành `c12b5b94c848b1e53f5b3f452c7e335252b26b96` và `b81ac3560c4c3c84d9bfea7fb9b521e2608fcb82`. #145 chỉ đổi bốn file handoff. `git diff --quiet 4ae7eb1 HEAD -- apps packages scripts db prompts evaluations package.json package-lock.json` exit 0: mã đã chạy check/browser không đổi byte. Lặp năm mutation sau rebase, vẫn bị bắt.
- Đọc CURRENT-STATE, README, ba log mới nhất, task/common, đặc tả Gmail và design system trước khi thi công. Checkout sạch; nhánh trước là ANS-01 đã merge, không chuyển nhánh có thay đổi của người khác.

## Phạm vi

- Settings: nhóm Của riêng bạn đứng trước hai nhóm dùng chung, dữ liệu từ `connection: personal`; mọi thành viên được kết nối/ngắt/kết nối lại, không nhập khoá hoặc phạm vi. Hiện email Gmail và ngày giờ Việt, quyền trước khi bấm, cảnh báo 7 ngày, lỗi/pending, xác nhận ngắt với Esc và trả focus. Deep link #gmail focus hàng riêng.
- Callback `/connections/gmail/callback` cần phiên ATI. Xoá toàn bộ query/hash trước POST; một promise dùng lại qua StrictMode. Không refresh/replay callback trên 401. Kết quả muộn sau unmount, logout, đổi người hoặc đổi phiên không điều hướng. Phân biệt các code lỗi theo common, không đưa lỗi upstream hay code/state lên màn. Thành công về settings#gmail với thông báo email Gmail, không thay phiên đăng nhập ATI.
- Cockpit: địa chỉ Gửi từ lấy từ connections đã duyệt, giữ qua SSE và snapshot reload. Preview Tới/Cc/Bcc, nguồn user/thread và tiêu đề luồng qua resourceLabels; cảnh báo địa chỉ từ luồng ở send_message/forward. Text thuần, xuống dòng và không tràn ngang. Gmail unknown của send/reply/forward có link authuser được encode tới Đã gửi; không thêm nút thử lại.
- Public: Privacy đúng ngay cả khi off, khi on nói rõ 9router/model bên thứ ba, dữ liệu giữ trong DB, không gửi nội dung tệp và hội thoại còn sau ngắt kết nối. Guide/Landing chỉ thêm Gmail và mẫu câu khi health báo gmailEnabled. Data gốc tám dịch vụ không bị mutate; mẫu câu đối chiếu đúng ALL_TOOLS khi off, cộng GMAIL_TOOLS khi on. Build scanner chặn câu phủ nhận đọc Gmail.
- Browser: nhóm gmail cùng Google HTTP giả ở tiến trình riêng, cổng 0; runner đặt off cho các nhóm cũ. Kịch bản Gmail chọn search/plan theo lịch sử từng hội thoại, tránh lần thử sau dùng hết chuỗi canned response chung. Test mới kiểm hai hội thoại xen kẽ; giữ test và assertion cũ.

## RED và GREEN

- `npm test -w @wap/chat-web -- tests/gmail-ui.test.tsx` trên giao diện cũ: **11 failed / 1 passed**, exit 1. Sau nối Settings/preview/refusal/privacy: **12/12**, exit 0.
- Test nguồn Gmail trong SSE/snapshot: **1 failed / 6 passed**, exit 1 (`connections` mất); thêm giữ connections ở cả hai chỗ, GREEN.
- Test chuyển từ drawer Slack đang mở sang #gmail: **1 failed / 17 passed**, exit 1 (focus quay về service-row-slack). Thêm lần focus sau cleanup của drawer chung, theo selected và hash của route; GREEN **18/18**, exit 0. Browser cũng chuyển Slack → Gmail bằng hash thật trước luồng OAuth ở cả bốn tổ hợp..
- Kiểm phản hồi start cũ sau đổi phiên: bổ sung assertion nút phải dùng lại được, RED **1 fail/17 pass**; finally chỉ bỏ spinner khi component còn tồn tại, vẫn giữ guard ở kết quả và redirect. Pending gate ngăn thao tác mới trước khi thao tác cũ kết thúc.
- Rà ảnh phát hiện token màu brand của trang Settings không đổi theo theme: chữ Gmail màu rgb(17,24,39) ở dark. Browser assertion màu thực tế trên 1440 dark RED **1 fail**, chuyển các class riêng của Settings/callback sang giá trị hex chuẩn được theme.css ánh xạ; GREEN nhóm Gmail **4/4**, gồm màu chữ dark rgb(241,245,249), nút nền rgb(255,87,1). Đã xem lại ảnh sau sửa.
- Callback test dùng HTTP cục bộ thật, đếm POST nhận ở server, giữ response thực rồi đổi phiên/unmount, đợi body HTTP thật hoàn tất trước kiểm không điều hướng; không suy ra late response từ một sleep. Kiểm query sạch tại thời điểm server nhận POST. 401 không refresh/replay.
- Unit UI khác dùng adapter API boundary; browser dùng backend và PostgreSQL thật. Không mock boolean làm bằng chứng DB/concurrency/timeout.

## Năm đột biến bắt buộc

Mỗi ca chạy riêng bằng Vitest workspace, khôi phục byte và SHA256 file nguồn trong finally. Nguồn đúng trở lại trước gate.

| Mutant | Output Vitest thật | Exit |
|---|---|---:|
| off | 1 failed | 17 passed (18) | 1 |
| admin-gate | 8 failed | 10 passed (18) | 1 |
| double-callback | 10 failed | 4 passed (14) | 1 |
| bcc | 4 failed | 14 passed (18) | 1 |
| warning | 2 failed | 16 passed (18) | 1 |

## Gate và ảnh

- PostgreSQL 16 tmpfs riêng `ati-gmail03-postgres`, nhãn task GMAIL-03, loopback 56533, max_connections=200. Migration 0001–0009 và admin provisioning exit 0; không dùng volume dev hoặc DB live. Sandbox, hai cờ mặc định off; nhóm gmail tự bật riêng.
- `npm run check` trên bản cuối exit **0**, **1.996 v3** = 63 schema + 408 adapter + 291 planner + 42 executor + 465 API + 727 web; **173 eval**. Typecheck/build/security scanner (7 mẫu), launcher 1/1 và env/OIDC 10/10 đều đạt. Trước đó cùng source có hai lượt exit 1, duy nhất test GMAIL-01 `orders disable...` tại gmail-connection-repo.test.ts:182, `expected 3997.0502 to be greater than 3997.1499` (0,0997 ms); 1 fail/1.995 pass. Đây là test so đồng hồ promise JS đã ghi trong CURRENT-STATE. Mã repo và test này không khác main. Lượt sau cùng lỗi promise: `expected 3806.7905 to be greater than 3806.8929` (0,1024 ms). Giữ `check-flaky-gmail01.log` và `check-flaky-gmail01-stale-progress.log`; không sửa test/mã ngoài phạm vi để làm gate đạt. Lượt chạy lại tuần tự đạt. Output cuối: `.cache/gmail-03/check-final.log`.
- Browser canonical lượt đầu exit 1 ở duy nhất FE-07 member kiểm Notion (`fe-07-settings.spec.ts:74`): 10 giây, #test-result-box còn trống; nhóm default **83 pass/1 fail/1 skip**, runner dừng trước nhóm tiếp theo. Giữ `browser-first-canonical.log` và error context. Không đổi assertion/timeout/retry. Đối chứng hai file Settings/useSettings từ origin/main bằng byte gốc rồi khôi phục; cùng test chạy riêng baseline **1/1 exit 0 (6,0 s)**, current **1/1 exit 0 (6,3 s)**. Đây không phải full checkout main; chưa chứng minh nguyên nhân lỗi lần đầu. Test này gọi Notion thật với token giả theo hành vi có sẵn, không gọi Google thật.
- `npm run test:browser:v3` tại `d9e16d8` exit **0**, **110 pass/1 skip**, 13 nhóm: default 84 pass/1 skip, auth02 2, auth04 6, clarification 2, partial_failure 2, sáu nhóm service 6, answer 4, gmail 4. Bao gồm chuyển hash thật Slack → Gmail sau đóng drawer. Sau đó `4ae7eb1` chỉ sửa màu/tiến trình của UI Gmail sau cờ: chạy lại nhóm Gmail đủ bốn tổ hợp, **4/4 exit 0**, có assertion màu mới và ảnh mới; không chạy lại toàn bộ canonical sau phần sửa màu này. CI cần xác nhận toàn bộ đúng head. Output `.cache/gmail-03/browser-final.log` và `style-green.log`.
- Ảnh 1440/375, sáng/tối, hàng chưa kết nối/đã kết nối/cần kết nối lại/pending, callback và preview. Thư mục ignore `docs/ai-evidence/GMAIL-LIVE/GMAIL-03-2026-10-16/`, có comparison.html đặt ảnh cạnh giá trị chuẩn từ docs/design/design-system.md và manifest SHA256. Không có bản mẫu HTML Gmail riêng; không commit ảnh.
- Build cuối main JS 896,85 kB / gzip 222,29 kB; cảnh báo chunk >500 kB đã có ở main. Không đổi giới hạn build.

## Bàn giao

- Không sửa CURRENT-STATE/ROADMAP, catalog/registry/scorer/golden, adapter/executor, migration hay mặc định hai cờ. Không đổi assertion, timeout, retry của bộ cũ.
- Không gọi model/9router, không OAuth Google thật, không gửi thư thật. Chỉ OAuth HTTP giả và hộp thư giả. Nghiệm thu Google thật và bật cờ thuộc GMAIL-04.
- Không tự chứng nhận review độc lập hoặc merge. Chờ reviewer theo REVIEW-CHECKLIST và CI đúng head.

# Lộ trình đến cuối kỳ

Nguồn: mục 5.2 của báo cáo giữa kỳ. Hạn cuối kỳ dự kiến 11/11/2026. Trạng thái: `xong`, `đang làm` (ghi nhánh), `chờ` (đã có task card), `chưa có task card` (cần Claude Code lập kế hoạch trước khi giao).

Mốc 02/10/2026 (kế hoạch vào `main` qua #25 tại `af82961`): nhóm chốt thêm năm service và mảng tài khoản (đăng ký, quên mật khẩu, Google, quản lý tài khoản) (Sheets, Calendar, Notion, Telegram, Jira); tuần 1–2 đã xong sớm nên tuần 3 bắt đầu ngay. Mốc 01/10/2026: `main` tại `1029e55` đã có W2-01 (#15/#16), W2-02 và W2-04 (#18/#20), W2-05 (#23). W2-03 vẫn chờ người dùng duyệt lệnh ghi thật.

| Tuần | Việc | Task card | Trạng thái |
|---|---|---|---|
| 1 (01–07/10) | Retry khi model timeout | — | xong (PR #13) |
| 1 | Kiểm tra thành viên đúng board | — | xong (PR #13) |
| 1 | Liệt kê bằng query rỗng thay vì đoán tên | — | xong (PR #13) |
| 1 | Ghi thời lượng từng step | — | xong (PR #13) |
| 1 | "Sửa qua Chat" hoạt động, plan preview không bị che | — | xong (PR #13) |
| 2 (08–14/10) | Đối soát các lần thực thi bị gián đoạn khi server khởi động lại | [W2-01](tasks/W2-01-reconcile-on-startup.md) | xong, đã vào `main` qua #15 (`35f454a`), thi công ở #16 |
| 2 | Tiếp tục hoặc dừng một plan sau khi đối soát | [W2-02](tasks/W2-02-resume-after-restart.md) | xong, #18 đã merge `main` tại `9c652c4` |
| 2 | Chạy thật các ca lỗi của service | [W2-03](tasks/W2-03-live-failure-cases.md) | chờ scope/plan live và người dùng duyệt lệnh ghi; chưa chạy live failure |
| 2 | Frontend: hiện trạng thái cần đối soát, sửa định dạng thời gian | [W2-04](tasks/W2-04-frontend-reconciliation-and-time.md) | xong, #20 merge vào #18 tại `c30604b`, đã vào `main` qua #18 |
| 2 | Chạy tiếp plan bị gián đoạn khi không có step chưa rõ kết quả; plan đã chạy xong thì thành `completed` (phát hiện khi audit tuần 2) | [W2-05](tasks/W2-05-continue-safe-plans.md) | xong, #23 tại `1029e55` |
| 3 (02–21/10) | Gỡ các chỗ viết cố định theo service: registry/transport/sandbox tách theo service, allowlist chung, bất biến từ khóa, bộ câu hồi quy định tuyến, kiểm tra tĩnh, test hợp đồng | [W3-00](tasks/W3-00-generic-service-plumbing.md) | xong, #29 tại `c7a38c0`; đã chốt ngoại lệ `rf06` |
| 3 | Giao diện cấu hình lấy nhãn/tên từ API, ô `multiline`, câu từ chối nêu tên service còn thiếu | [W3-00b](tasks/W3-00b-frontend-and-refusal-naming.md) | xong, #71 tại `1200a3f`; review độc lập đạt sau sửa P2 mất credential draft, CI head e60e4b3 xanh; check1.236+165/browser28; golden chưa đo lại |
| 3 | Google Sheets (gồm xác thực service account dùng chung cho Google) | [W3-01](tasks/W3-01-google-sheets.md) | xong, #30 tại `716f568`; chạy thật qua harness W3-07 #57, chưa qua frontend live |
| 3 | Google Calendar | [W3-02](tasks/W3-02-google-calendar.md) | xong, #31 tại `ab2c599`; chạy thật qua harness W3-07 #57, chưa qua frontend live |
| 3 | Notion | [W3-03](tasks/W3-03-notion.md) | xong, #32 tại `fca384d`; chạy thật W3-07 #49/#50, chưa qua frontend live |
| 3 | Telegram | [W3-04](tasks/W3-04-telegram.md) | xong, #33 tại `4a4553b`; chạy thật W3-07 #48, chưa qua frontend live |
| 3 | Jira Cloud | [W3-05](tasks/W3-05-jira.md) | xong, #34 tại `dc80de4`; chạy thật W3-07 #55, readback sau sửa W3-09 #63 đạt |
| 3 | Đánh giá planner với các service mới, đo lại bộ cũ, test định tuyến tất định | [W3-06](tasks/W3-06-new-services-eval.md) | đo xong, #35 tại `a75ac35`; numeric gate cả năm đạt, parity ff15 và latency chưa đạt; product acceptance incomplete |
| 3 | Chạy thật từng service mới và một workflow ≥ 4 service | [W3-07](tasks/W3-07-new-services-live.md) | xong 04/10: #48 Telegram, #49/#50 Notion, #51 workflow 4 service, #55 Jira, #57 Google; phát hiện → W3-09 |
| 3 | Giới hạn kích thước kết quả đọc (Sheets, Notion, Calendar, giới hạn chung trong planner), test 403 Calendar, phân loại lỗi token Google (từ audit W3 03/10) | [W3-08](tasks/W3-08-bounded-read-results.md) | xong: #39 và bản sửa #45 tại `81225de`; hai P2 đã sửa, review độc lập đạt, CI955+165/browser20 xanh; xem [bằng chứng](log/2026-10-03-codex-W3-08-review-fixes.md) |
| 3 | Jira: tìm kiếm với dấu gạch ngang, báo đúng lỗi token khi đọc (phát hiện khi chạy thật W3-07) | [W3-09](tasks/W3-09-jira-live-findings.md) | xong, #63 tại `f284b12`; review độc lập đạt, CI head971c3b2 xanh; token giả AUTH_ERROR và W3-07 → ATIT-4 đã kiểm thật chỉ đọc sau merge |
| 3 | Yêu cầu chỉ đọc hỏi lại ngay (không tra cứu, plan phải có bước ghi); đo thời gian từng lời gọi model; giảm p95 services (31,1 s) về dưới 15 s; đo lại golden một lần thay cho các lần còn nợ (phân tích W3-06 ngày 05/10) | [W3-10](tasks/W3-10-read-only-and-latency.md) | xong, #102 tại `d40d735` (09/10); read_only 18/18, golden core 150/150, freeform 52/54, services 129/132; **p95 services 20,1 s chưa đạt mục tiêu 15 s**, cần task latency riêng |
| 3 | Chạy thật năm service mới qua frontend (bước 2 của W3-07 chưa làm), cập nhật harness `live-app` theo giao diện sau AUTH/FE | [W3-11](tasks/W3-11-new-services-through-frontend.md) | **xong** #146 (`2960ab0`, 16/10); 5 service mới và workflow Jira → Notion → Telegram → Slack chạy thật qua giao diện, mỗi lệnh ghi duyệt đúng mã băm; review độc lập Đạt sau một lượt sửa P2 của harness |
| 3–4 (02–24/10) | Tài khoản: phiên đăng nhập lưu ở server, đăng xuất thu hồi token, trạng thái và vai trò tài khoản | [AUTH-01](tasks/AUTH-01-sessions-logout-roles.md) | xong, #41 tại `fbd993f`; review độc lập đạt, CI xanh |
| 3–4 | Gửi email qua Gmail SMTP, đăng ký, xác minh email, quên mật khẩu | [AUTH-02](tasks/AUTH-02-signup-email-password-reset.md) | xong, #52 tại `e578520`; P2 thời gian phản hồi → AUTH-02b |
| 3–4 | Trang quản trị người dùng: duyệt, khóa, phân quyền | [AUTH-03](tasks/AUTH-03-admin-user-management.md) | xong, #53 tại `46cc6e6` |
| 3–4 | Gửi email không chặn phản hồi (chống lộ tài khoản qua thời gian); live chạy được khi chưa có SMTP | [AUTH-02b](tasks/AUTH-02b-async-email-and-live-startup.md) | xong, #61 tại `445d1b3`; review độc lập73tests + HTTP/PG sender800ms đạt; SMTP thật chưa chạy trong review này; AUTH-06 #75 đã nghiệm thu |
| 3–4 | Đăng nhập và đăng ký bằng Google | [AUTH-04](tasks/AUTH-04-google-login.md) | xong, #66 tại `5cc07ca`; review độc lập đạt, CI headb4029e9 xanh; check1.188+165/browser27/repeat3; Google/SMTP thật đã nghiệm thu ở AUTH-06 #75 |
| 3–4 | Trang quản lý tài khoản: hồ sơ, đổi mật khẩu, phương thức đăng nhập, phiên đăng nhập | [AUTH-05](tasks/AUTH-05-account-page.md) | xong, #68 và bản sửa sau review #73 tại `198fe6d`; 2 P2/1 P3 đã sửa, review độc lập delta/runner đạt, CI head4e469a1 xanh; check1.245+165/browser32 qua11scenario; Google/SMTP thật đã nghiệm thu ở AUTH-06 #75 |
| 4 | Cấu hình Gmail SMTP, Google OAuth và kiểm tra chạy thật | [AUTH-06](tasks/AUTH-06-auth-live-setup.md) | xong05/10, #75 tại `bfd824f`; Gmail/Google thật đạt, review độc lập đạt, CI head df3b7e8 xanh; check1.245+165/browser32 qua11scenario |
| 3–4 (thêm 09/10) | Kiểm mật khẩu hiện tại khi gỡ Google, chống đổi hash/phiên trong lúc chờ khóa | [AUTH-07](tasks/AUTH-07-google-unlink-password.md) | xong, [#120](https://github.com/VinhDat267/ATI_Project/pull/120) tại `5c7bed4` (09/10); review độc lập đạt, CI đúng head `1792f12` xanh; backend cho FE-09; Google/SMTP live chưa chạy lại |
| 3 (02–14/10) | Frontend: đóng hộp thoại lỗi không còn dừng quy trình, bỏ mật khẩu admin khỏi bundle, trạng thái dịch vụ thật, báo chế độ sandbox, sửa số liệu chưa đo trên trang giới thiệu | [FE-01](tasks/FE-01-safety-and-honest-ui.md) | xong, #27 tại `9d262c6` |
| 3 | Frontend: điều hướng bằng URL, nút Back, mở lại hội thoại khi tải lại, tách `App.tsx`, tiêu đề và phân trang lịch sử | [FE-02](tasks/FE-02-routing-and-history.md) | xong, #42 tại `8b6c8e6`; review độc lập đạt, CI xanh sau retarget main |
| 3–4 | Frontend: plan hiện tên tài nguyên và nhãn Đọc/Ghi, kết quả dễ đọc có link, SSE tự refresh token, chuỗi tiếng Việt, hỗ trợ trình đọc màn hình | [FE-03](tasks/FE-03-readable-plan-and-results.md) | xong, #54 tại `9709a2d`; golden cần đo lại |
| 3–4 | Frontend: gửi tin ngay sau "Cuộc hội thoại mới" làm tin rơi vào hội thoại khác; test FE-03 lúc đạt lúc không trên CI | [FE-03b](tasks/FE-03b-new-conversation-send-race.md) | xong, #60 và sửa sau review #64 tại `965c8bc`; hai P2 đã sửa, review độc lập đạt, browser26/repeat40/CI xanh; P3 history nhánh lỗi còn mở |
| 3 (05/10) | Tài liệu: sửa năm href HTML hỏng sau khi xoá v1/v2, trỏ tới tag lưu trữ | [DOC-01](tasks/DOC-01-pr80-archive-links.md) | xong, #82 tại `841d9da`; năm link archive/bốn link local đạt, review độc lập đạt, CI PR head `36cef3b` xanh; không đổi mã hoặc nghiệm thu live |
| 3–5 (06–28/10) | Giao diện mới: token Agentic, font, chế độ tối, khung trang (thanh trên, menu người dùng, dải thử nghiệm), route mới | [FE-04](tasks/FE-04-design-tokens-and-shell.md) | xong, #88 tại `89d1999`; bốn P2 đã sửa, review độc lập đạt, CI head `e5894c3` xanh; check1.270+165/browser39 trước merge |
| 3–5 | API cho giao diện mới: từ chối kèm danh sách dịch vụ chưa kết nối, lưu riêng nơi được dùng | [UI-API-01](tasks/UI-API-01-structured-refusal-and-scope-save.md) | xong, #86 tại `210d3b6`; review độc lập đạt, CI head `f357279` xanh; check1.278+165/browser32 trước merge; model/provider live chưa chạy lại |
| 3–5 | Cockpit khoảnh khắc 1–6 (nhờ việc → tìm đúng chỗ → hỏi lại → duyệt → đang làm → biên nhận), ngăn hội thoại, ngăn lịch sử | [FE-05](tasks/FE-05-cockpit-core-moments.md) | xong, #90 tại `ee65cd0` (06/10, sớm hơn mốc 16/10); review độc lập đạt sau sửa 4 P2, CI PR và CI main xanh, check1.375+165/browser54; Claude Code chạy thử app thật đạt, 2 P3 chuyển vào FE-06, sau đó sang FE-05b. Buổi thử W4-03 chạy được trên giao diện mới |
| 3–5 (thêm 07/10) | Lớp nền của bản React trong app: CSS tương thích v3, bảng màu, token theo trang, `theme.css`, `usePrototypePage`, hợp nhất nút sáng/tối; trang 404 làm thử | [FE-04b](tasks/FE-04b-prototype-foundation.md) | xong, #98 tại `7df8eac` (07/10); Claude Code thi công, tự review, chưa có review độc lập; CI main xanh |
| 3–5 (thêm 06/10, đổi cách làm 07/10) | Cockpit = trang `app-stage` của bản React với dữ liệu thật: thanh trên gộp "Yêu cầu hiện tại", khoảnh khắc 1–6, ô nhắn thêm, hai ngăn; 2 P3 vị trí cuộn/focus | [FE-05b](tasks/FE-05b-cockpit-visual-parity.md) | xong: phần (a) #100 tại `8155c03` (07/10), phần (b) #103 tại `c7cf6e3` (08/10); review độc lập cả hai đạt. 5 P3 của #103 chuyển vào FE-06 |
| 3–5 | Cockpit khoảnh khắc 7–9 (lỗi, chưa rõ kết quả, khôi phục), màn từ chối/hỏi lại, lỗi chung | [FE-06](tasks/FE-06-cockpit-recovery-and-responses.md) | xong: phần (a) #107 tại `f796467` (08/10), dọn ở #111; phần (b) #116 tại `572da6d` (09/10, sớm hơn mốc 20/10), review độc lập đạt, 4 P3 ghi ở CURRENT-STATE mục 5; P3 thứ nhất (test chốt `hydrateResponse`) đóng ở #118 tại `d87c80e` (10/10), còn 3 P3 |
| 3–5 | Trang Kết nối dịch vụ thay `SettingsModal` | [FE-07](tasks/FE-07-service-connections-page.md) | xong, #108 tại `d5e7a9e` (08/10, sớm hơn mốc 20/10); review độc lập đạt sau khi Codex sửa 1 P2; 5 P3 đóng ở #110 (`c21afc0`), gồm quyền sửa theo `SERVICE_ADMIN_USER_IDS` qua `canConfigure` |
| 3–5 | Trang giới thiệu và các màn đăng nhập/đăng ký/xác minh/đặt lại | [FE-08](tasks/FE-08-landing-and-auth-screens.md) | xong, [#121](https://github.com/VinhDat267/ATI_Project/pull/121) tại `b4227de` (09/10, trước mốc 23/10); review độc lập đạt, CI head tích hợp `c4bc567` xanh: 1.622 v3 + 173 eval, 91 browser/11 nhóm; sửa phản hồi đăng nhập tại deep link |
| 3–5 | Trang Tài khoản, Quản lý người dùng, Lịch sử | [FE-09](tasks/FE-09-account-users-history.md) | xong, [#122](https://github.com/VinhDat267/ATI_Project/pull/122) tại `c4f2170` (09/10, trước mốc 27/10), sau AUTH-07/FE-08; review độc lập đạt, CI head tích hợp `202da918` xanh: 1.634 v3 + 173 eval, 97 browser/11 nhóm |
| 3–5 | Cẩm nang, Chính sách an toàn, 404, rà soát tương phản/trợ năng toàn app | [FE-10](tasks/FE-10-guide-privacy-and-audit.md) | xong #128 tại `e08e623` (10/10, `longnguyen005` thi công bằng Codex; review độc lập đạt sau một lượt sửa), trừ tiêu chí "Rà soát cuối" (chụp lại FE-05b → FE-09 cạnh bản mẫu): chưa làm, chờ người dùng quyết tách task hay bỏ |
| 3–5 (thêm 10/10) | Dọn lỗi frontend: đăng nhập lại về đúng trang đang mở, ID hội thoại sai định dạng trả 500 và câu báo mất mạng sai, các P3 còn mở của #116/#118/FE-03b, test chập chờn | [FE-11](tasks/FE-11-frontend-bugfixes.md) | xong, #129 tại `828c21a` (11/10), `longnguyen005` (Codex); review độc lập Claude Code đạt sau một lượt sửa. Phần A, B, C xong, kèm sửa lỗi focus hộp đăng nhập có sẵn từ FE-08; phần D tuỳ chọn (bundle, xoá `MissionControlLaunchpad`) chưa làm |
| 4–5 (thêm 19/10; merge trước 29/10, không merge 23–25/10) | Thanh điều hướng chung cho mọi trang sau khi đăng nhập, tab căn giữa; câu "Yêu cầu hiện tại" rời thanh, thành dòng "Bạn nhờ" trong nội dung cockpit. Lệch bản mẫu có chủ đích | [FE-12](tasks/FE-12-shared-nav-bar.md) | **xong** #162 (`6307962`, 20/10), kế hoạch #161 (`729577f`). Reviewer thi công theo yêu cầu nhóm trưởng; review độc lập lần 1 chưa đạt (1 P2, 1 P3), review lại Đạt. Mốc hiện tab đổi từ 768 sang 900 px |
| 3–5 (thêm 06/10) | Bản React của 12 bản mẫu trong `docs/design/prototypes/react/`, giữ design system bản mẫu, so từng phần tử/pixel với HTML gốc; chưa đưa vào app | [PROTO-01](tasks/PROTO-01-prototypes-to-react.md) | bước 1 (khung, công cụ so, 404, privacy) xong #93 tại `00e9c5f`; bước 2 (errors, responses, auth-action) xong #94 tại `852342c`; bước 3 (account, users, settings, history, guide) xong #95 tại `458c5ad`; bước 4 (index, app-stage) xong #96 tại `581addd`. Xong cả 4 bước; từ 07/10 là nguồn để đưa vào app (FE-04b → FE-10) |
| 4 (làm sớm, trước các phép đo) | Đường LLM dự phòng: chuyển thủ công sang một model Codex (`cx/`) trong 9router; probe chọn model, bộ đo tối thiểu, một lượt qua app, runbook | [W4-00](tasks/W4-00-llm-fallback-provider.md) | xong trong phạm vi task, [#133](https://github.com/VinhDat267/ATI_Project/pull/133) tại `6ee4109` (13/10); review độc lập Đạt, CI head `2d80355` xanh. Chọn `cx/gpt-6.1-sol`; core 48/50 PARTIAL do timeout/cancel, services 41/44 complete p95 9,408 s; preview 6,033 s rồi Hủy, DB 0 execution steps. Quota chưa rõ, chưa đóng gate latency core/ghi live/W3-11 |
| 4 (thêm 13/10, trước 20/10) | Validator từ chối tham chiếu bước viết thành chuỗi thô `${step.output…}` ngoài `$template` (executor gửi nguyên chuỗi đó lên dịch vụ); phát hiện khi review #133 | [W4-00b](tasks/W4-00b-raw-step-placeholders.md) | **xong** #137 (`ebc192d`, 14/10), `longnguyen005`; review độc lập đạt. Phép đo tham khảo với Luna do nhóm trưởng chạy, chưa chạy |
| 4 (thêm 13/10, trước 18/10) | Gmail phần 1: mỗi người tự kết nối Gmail (OAuth, token, migration 0009), planner/executor theo người dùng, cờ `GMAIL_ENABLED` tắt mặc định ([đặc tả](../superpowers/specs/2026-10-13-gmail-personal-connections-design.md), [quy tắc chung](tasks/GMAIL-common.md)) | [GMAIL-01](tasks/GMAIL-01-personal-connection.md) | **xong** #140 (`8973a9e`, 14/10); review độc lập lỗi 1–2 đạt, lỗi 3 chỉ kiểm phía thi công |
| 4 (thêm 13/10, trước 21/10) | Gmail phần 2: 10 tool, adapter thật và giả, chặn người nhận bịa, nội dung thư không vào prompt ngoài khối dữ liệu | [GMAIL-02](tasks/GMAIL-02-gmail-tools.md) | **xong** #143 (`7c260c1`, 16/10), nhóm trưởng; review độc lập Đạt sau một lượt sửa P2 (thiếu test chống gửi trùng); 2 P3 về adapter ở CURRENT-STATE mục 5 |
| 4 (thêm 13/10, trước 21/10) | Kiểu phản hồi "trả lời" cho câu chỉ đọc, mọi dịch vụ, sau cờ `PLANNER_READ_ANSWERS` tắt mặc định (thay chốt 05/10 khi cờ bật) | [ANS-01](tasks/ANS-01-read-answers.md) | **xong** #142 (`96f9f09`, 16/10), `longnguyen005`; review độc lập Đạt sau một lượt sửa (1 P2, 1 P3 thiếu test) và rebase lên `main` có #143 |
| 4 (thêm 13/10, trước 23/10) | Giao diện Gmail: nhóm "Của riêng bạn" ở `/settings`, callback, "Gửi từ" và nguồn người nhận ở xem trước, `/privacy`, `/guide`, Landing | [GMAIL-03](tasks/GMAIL-03-gmail-ui.md) | **xong** #147 (`6233637`, 18/10), `longnguyen005`; reviewer sửa theo review khi Long bận (P2 thẻ duyệt mô tả sai bước Gmail, 3 P3, rồi 1 P3 tiêu đề dài tràn ngang); review lại Đạt; cờ vẫn tắt |
| 4–5 (Google project trước 21/10; đo xong 18/10) | Đo riêng Gmail và kiểu "trả lời", nghiệm thu Google thật, PR bật hai cờ trước mốc chốt tính năng 29/10 | [GMAIL-04](tasks/GMAIL-04-measure-and-live.md) | đang làm, giao nhóm trưởng; có phần việc của con người. Bước 1 (Google Cloud project riêng cho Gmail) xong 16/10. **Bước 2–3 (bộ đo, label đăng ký trước) xong #154** (`32d71fd`, 18/10); reviewer thi công, review lại lần 2 Đạt. **Bước 4 (đo) xong #159** (`778f22f`, 18/10): `gmail` 59/60, injection 9/9; `answers` 27/30; kiểu trả lời bật `core` 50/50, không câu hành động nào của `core`/`services` thành câu trả lời; review lại Đạt. Còn: nghiệm thu Google thật qua giao diện, PR bật cờ trước 28/10 |
| 4 (22–28/10) | Bộ đánh giá độc lập ≥ 30 câu do thành viên khác viết | [W4-01](tasks/W4-01-independent-eval-set.md) | **đo xong #164** (`1df2d35`, 24/10); khung #150 (`98d880b`, 17/10). 32 câu của bốn thành viên, nhưng hai người đã xem prompt nên **không đạt tiêu chí độc lập**; kết quả tách theo nhóm người viết. Label `2cdaf90` đăng ký trước. `llm` ×3 **89/96** (nhóm đã xem prompt 47/48, nhóm chưa xem 42/48), `regex` ×3 **37/96**. Review lần 1 chưa đạt (1 P2 ở bộ chạy), review lại Đạt. Còn: nhóm trưởng xác nhận GUIDE; chưa có đối chứng bộ 50 câu cùng ngày |
| 4 | Đánh giá hội thoại nhiều lượt: sửa plan, trả lời câu hỏi làm rõ | [W4-02](tasks/W4-02-multi-turn-eval.md) | **xong**, 18/10: bộ đo #157 (`efaafb2`): `turns` → lịch sử như `chat-service`, 12 câu đăng ký trước (6 sửa, 3 trả lời câu hỏi lại, 3 yêu cầu mới). Phép đo #159 (`778f22f`): 3 lượt `ag/gemini-3.8-flash` đạt **36/36**, mỗi nhóm 100%. Reviewer thi công; mỗi PR review lại Đạt |
| 4 | Đo tỉ lệ plan dùng được với ≥ 20 lượt của người dùng thật | [W4-03](tasks/W4-03-usable-plan-study.md) | **khung xong** #149 (`fb38a4d`, 17/10): `PROTOCOL.md` (chỉ xem, không chạy thật; 10 tình huống), script báo cáo chỉ đọc; review độc lập Đạt sau một lượt sửa (2 P2, 1 P3). Chờ buổi thử 23–25/10 với ≥ 5 người × 4 lượt |
| 4 | Đo latency qua frontend với ≥ 20 lượt | [W4-04](tasks/W4-04-frontend-latency.md) | **xong**. Công cụ #151 (`ce59f4f`, 17/10): chế độ đo hàng loạt luôn bấm Hủy, 24 câu, tách thời gian server/frontend từ PostgreSQL; review độc lập Đạt sau một lượt sửa (2 P2). Phép đo live #159 (`778f22f`, 18/10): **23/24 dưới 15 s**, p50/p95/max 9,6/14,7/15,8 s, 0 bước thực thi. Đo trước mốc chốt catalog 20/10 theo yêu cầu nhóm trưởng; catalog đổi thì đo lại. Thời gian model chưa tách được khỏi planner |
| 4–5 (thêm 25/10; merge 26–29/10) | Lịch chạy workflow phần 1: kiểu dữ liệu chung, migration 0010, bộ hẹn giờ, API, cờ `SCHEDULES_ENABLED` tắt mặc định ([đặc tả](../superpowers/specs/2026-10-24-scheduled-workflows-design.md), [quy tắc chung](tasks/SCHED-common.md)) | [SCHED-01](tasks/SCHED-01-schedule-backend.md) | **xong** #167 (`95b1c46`, 25/10); review độc lập lần 2 **Đạt** sau khi sửa 2 P2 |
| 5 (thêm 25/10; trước 30/10) | Lịch chạy phần 2: planner trả kiểu `schedule`, lưu đề xuất, lập kế hoạch cho lượt qua đường chat hiện có, sandbox `schedule` | [SCHED-02](tasks/SCHED-02-schedule-planner.md) | **xong** #168 (`46b6a5b`, 25/10); review độc lập lần 3 **Đạt**; P3 prefetch ở câu tạo lịch đầu tiên được giữ làm giới hạn |
| 5 (thêm 25/10; trước 01/11) | Lịch chạy phần 3: giao diện (thẻ lịch trong cockpit, mục Lịch chạy ở Nhật ký, số lượt chờ duyệt trên tab Nhật ký) | [SCHED-03](tasks/SCHED-03-schedule-ui.md) | chờ, giao `longnguyen005`; bắt đầu ngay, merge sau SCHED-02 |
| 5 (thêm 25/10; trước 04/11) | Lịch chạy phần 4: bộ đo ý định, đo lại `core`/`services` khi bật cờ, nghiệm thu thật qua giao diện, PR bật cờ | [SCHED-04](tasks/SCHED-04-measure-and-live.md) | chờ; bộ đo giao reviewer, nghiệm thu giao nhóm trưởng |
| 5 (thêm 25/10; trước 29/10) | OAuth phần 1: kết nối Gmail ngay trong hội thoại, quay về đúng hội thoại và gửi lại yêu cầu ([đặc tả](../superpowers/specs/2026-10-25-oauth-connect-from-chat-design.md)) | [OAUTH-01](tasks/OAUTH-01-connect-from-chat.md) | **xong** #172 (`13430d9`, 26/10); review độc lập lần 3 **Đạt** sau hai lượt sửa (lần 1: 1 P2, 1 P3; lần 2: 1 P2). Còn: nghiệm thu với Google thật trong GMAIL-04. Việc sửa assertion cũ của `gmail-migration.test.ts` được nhóm trưởng xác nhận 26/10 |
| 5 (thêm 25/10; tuỳ chọn, mốc cắt 01/11) | OAuth phần 2: Google Calendar "của riêng bạn", dựng trên hạ tầng Gmail ([đặc tả](../superpowers/specs/2026-10-26-oauth-02-personal-calendar-design.md), viết sẵn 26/10) | [OAUTH-02](tasks/OAUTH-02-personal-calendar.md) | nhóm trưởng quyết làm hay bỏ ngày 29/10. **Mặc định bỏ** ([FINISH-PLAN](FINISH-PLAN.md) mục 4). OAuth cho Slack, GitHub, Notion, Jira, Trello không làm, ghi vào báo cáo là hướng phát triển |
| 5 (thêm 26/10; tuỳ chọn, trước 04/11) | Model suy nghĩ quá deadline 30 s: tăng deadline qua biến môi trường hoặc giảm thời gian suy nghĩ ở gateway, đo lại cùng ngày | [LAT-01](tasks/LAT-01-planning-deadline.md) | chờ quyết định của nhóm trưởng ngày 29/10; **mặc định không làm**, ghi giới hạn vào báo cáo |
| 5 (29/10–04/11) → dời 05–06/11 | Ngừng thêm tính năng **từ 04/11** (dời từ 29/10, chốt 24/10), tag `demo-2026-11-04`; môi trường demo dựng lại được theo runbook; diễn tập chuyển sang LLM dự phòng theo runbook W4-00; 3 kịch bản demo chạy 3 lần liên tiếp không lỗi | [DEMO-01](tasks/DEMO-01-demo-stability.md) | chờ; nhóm trưởng thao tác, agent viết runbook và ghi bằng chứng |
| 6 (05–11/11) | Báo cáo cuối kỳ (bắt đầu từ 27/10, song song với code) | [REPORT-01](tasks/REPORT-01-final-report.md) | chờ; nhóm trưởng và thành viên |
| 6 (05–08/11) | Slide bảo vệ | [SLIDES-01](tasks/SLIDES-01-defense-slides.md) | chờ |
| 6 (07/11) | Video demo dự phòng | [VIDEO-01](tasks/VIDEO-01-backup-demo-video.md) | chờ; sau DEMO-01 |
| 6 (09–10/11) | Diễn tập bảo vệ (hai lần), checklist ngày bảo vệ 11/11 | [REHEARSAL-01](tasks/REHEARSAL-01-defense-rehearsal.md) | chờ |

W2-01/W2-02 áp dụng cho một API instance, executor cũ đã dừng; lease/fencing nhiều replica chưa có. Minor `text_*` streaming của frontend được hoãn: chưa tìm thấy production emitter, reachability chưa chứng minh; cần xử lý timestamp/finalized message trước khi nối producer này. Số liệu hiện tại và giới hạn review/live xem [CURRENT-STATE](CURRENT-STATE.md).

Yêu cầu chung cho mọi task thêm service: [W3-service-common](tasks/W3-service-common.md).

Thứ tự và song song: W3-00 đã merge qua #29 tại `c7a38c0`; W3-01 Sheets qua #30 tại `716f568`, W3-02 Calendar qua #31 tại `ab2c599`, W3-03 Notion qua #32 tại `fca384d`; W3-04 Telegram qua #33 tại `4a4553b`; W3-05 Jira qua #34 tại `dc80de4`; W3-06 đo xong qua #35 tại `a75ac35` trên catalog đóng băng33tool/8service. Người dùng đã chốt rf06 clarification trước label commit/model calls. Core150/150, freeform51/54, services111/132; numeric tools/args đạt nhưng parity ff15, services p95 và read-only policy/enforcement còn mở; services p95 và read-only giao cho W3-10 (lập 05/10), ff15 vẫn mở. AUTH-01 đã merge qua #41 tại `fbd993f` và FE-02 qua #42 tại `8b6c8e6`; review độc lập đạt, CI xanh sau retarget main. AUTH-02/AUTH-03/FE-03, AUTH-02b và sửa FE-03b đã merge, review độc lập đạt; AUTH-04 đã merge qua #66 tại `5cc07ca`; AUTH-05 đã merge #68 và sửa sau review #73 tại `198fe6d` (review delta/runner đạt, CI head4e469a1 xanh), W3-00b đã merge #71 tại `1200a3f` sau review độc lập/sửa P2; AUTH-06 đã nghiệm thu Gmail/Google thật, merge #75 tại `bfd824f` ngày05/10. W3-07 đã chạy thật năm service và workflow4service sau duyệt đúng plan, chưa qua frontend live (→ W3-11); W3-09 đã sửa và kiểm lại đọc Jira thật sau merge. W4-02, W4-04 (phần công cụ) và khung của W4-01, W4-03 làm song song được với tuần 3.

**Mốc chốt catalog: 20/10/2026.** Service nào chưa merge đạt review trước mốc này thì không đưa vào phạm vi môn học (không đăng ký vào registry). W3-06 và các phép đo chính thức của tuần 4 (W4-01, W4-03, W4-04) chạy trên catalog đã chốt, để số liệu khớp với hệ thống đem đi bảo vệ.

**Mảng tài khoản** (chốt 02/10/2026: đăng ký mở nhưng admin duyệt; gửi email bằng Gmail SMTP; thêm đăng nhập Google). Yêu cầu chung: [AUTH-common](tasks/AUTH-common.md). AUTH-01 đã merge qua #41 tại `fbd993f`. AUTH-02, AUTH-03, AUTH-04, AUTH-05 có thể làm song song; frontend đã gỡ chặn bởi FE-02. Migration title dùng 0004, task AUTH tiếp theo chọn số chưa dùng theo AUTH-common. Đăng ký chỉ mặc định bật khi AUTH-02 và AUTH-03 đều đã merge. Mục tiêu: merge AUTH-01 → AUTH-05 trước 24/10, AUTH-06 trước 28/10.

**Mảng frontend** (review 02/10/2026): FE-01 và FE-02 đã merge. AUTH-02 → AUTH-05, W3-00b (#71) và FE-03 đã merge. FE-03 xong trước buổi thử W4-03; chưa thay đổi ưu tiên hay triển khai các task tiếp theo trong phiên merge này.

AUTH-06: người dùng đã cấu hình Gmail SMTP/Google client và hoàn thành các bước nghiệm thu thật, merge #75 ngày05/10. Phần việc của con người còn lại nên bắt đầu ngay: các thành viên viết câu hỏi (W4-01); hẹn người tham gia buổi thử (W4-03).

**Lập kế hoạch 05/10/2026** (sau AUTH-06; Claude Code). Ba task mới cho các rủi ro trước tuần 4:
- **W3-10:** 18/25 lượt services quá 15 s là yêu cầu chỉ đọc (3 lời gọi model rồi phần lớn từ chối). Đuôi chậm còn lại chưa phân biệt được model hay cổng, vì báo cáo không ghi lần thử lại bên trong và token.
- **W3-11:** năm service mới chưa từng chạy qua giao diện ở chế độ live; harness `live-app` có từ trước AUTH/FE-02/FE-03.
- **W4-00:** mọi phép đo và demo dùng `ag/gemini-3.8-flash` qua 9router ở máy nhóm trưởng. Nhiều tài khoản Gemini song song tránh được lỗi của từng tài khoản, nhưng không tránh được sự cố của chính 9router (03/10) hay sự cố chung của nguồn Gemini. Chưa có đường thay thế nào được kiểm với sản phẩm; Gemini API chính thức không đủ quota (thử 29–30/09).

Người dùng chốt ngày 05/10:
- yêu cầu chỉ đọc được hỏi lại ngay, plan phải có bước ghi, không thêm kiểu trả lời đọc dữ liệu;
- đường chính giữ Gemini qua 9router với nhiều tài khoản; dự phòng là model Codex (`cx/`) trong cùng 9router, chỉ đổi `LLM_MODEL`, chuyển thủ công; không dùng Gemini API chính thức.

Ba task làm song song được với nhau và với khung W4-01/W4-03, W4-02, công cụ W4-04. Thứ tự cần giữ:
- W3-10 merge trước 20/10, vì đổi prompt và cần đo lại golden;
- W3-11 xong trước buổi thử W4-03;
- W4-00 xong trước các phép đo chính thức tuần 4.

Nếu cổng ngừng trước khi W4-00 xong thì dừng mọi phép đo model, không đổi sang provider khác giữa chừng một campaign.

**Lập kế hoạch giao diện mới 05/10/2026** (Claude Code; vào `main` qua #84 tại `ab0817e`). Bản mẫu 12 trang làm bằng OpenDesign và review nhiều vòng trong ngày, lưu ở [`docs/design/prototypes/`](../design/prototypes/README.md). Đặc tả: [`2026-10-05-ui-redesign-agentic-design.md`](../superpowers/specs/2026-10-05-ui-redesign-agentic-design.md). Người dùng chốt ngày 05/10:
- theo design system "Agentic" (Primary `#FF5701`, Secondary `#F6F6F1`, thang chữ 14/16/18/24/32/40);
- chữ trên nút cam giữ **màu trắng** (3,2:1, ngoại lệ có chủ đích, đặc tả mục 3.2);
- chữ thường dùng Be Vietnam Pro, tiêu đề dùng Playfair Display;
- cỡ chữ tối thiểu 14px áp dụng khi làm app, không sửa bản mẫu.

**Cập nhật 20/10 (FE-12 xong):** kế hoạch vào `main` qua #161 (`729577f`), phần thi công qua #162 (`6307962`), trước mốc 29/10 và ngoài khoảng 23–25/10. Buổi thử W4-03 chạy trên giao diện đã có thanh mới.
- Review độc lập lần 1 tại `71bb895` chưa đạt (P2: màn đang thực thi tràn ngang khi câu yêu cầu liền ký tự; P3: tab lệch tâm ở 768–864 px trên cockpit của admin). Sửa ở `ffc8952`; review lại Đạt.
- Nhóm trưởng chốt hiện tab từ 900 px thay vì 768 px (CURRENT-STATE mục 7).
- FE-12 không đổi `packages/` hay `prompts/`, nên catalog ở mốc chốt 20/10 vẫn là 33 tool/8 dịch vụ, như lúc đo W4-04.

[Log merge](log/2026-10-20-reviewer-merge-161-162.md).

**Cập nhật 24/10 (W4-01 đo xong):** #164 (`1df2d35`) gồm commit đăng ký label, phần sửa bộ chạy, báo cáo và bằng chứng.
- **Bộ câu:** 32 câu của bốn thành viên. Hai người đã xem prompt, nên bộ câu không độc lập; kết quả tách theo nhóm người viết.
- **Kết quả:** `llm` ×3 89/96, `regex` ×3 37/96.
- **Quá hạn:** câu mà lời gọi model quá deadline 30 s được chấm trượt. Bốn lượt dở dang được giữ.
- **Lịch:** merge ngày 24/10 trong khoảng 23–25/10 theo yêu cầu nhóm trưởng; PR không đổi mã sản phẩm. Catalog vẫn 33 tool/8 dịch vụ.
- **Chờ nhóm trưởng quyết trước 29/10:** task độ trễ (model suy nghĩ quá 30 s), định tuyến `m4-07`, bước tra tên của `regex` (CURRENT-STATE mục 5).

[Log merge](log/2026-10-24-reviewer-merge-164.md).

**Cập nhật 25/10 (lịch chạy workflow):** ngày 24/10, nhóm trưởng quyết triển khai đề xuất "OAuth và tạo lịch workflow bằng AI" của `longnguyen005`, và **dời mốc ngừng thêm tính năng từ 29/10 sang 04/11**. Lịch chạy làm trước, OAuth làm sau. Đặc tả lịch chạy được duyệt ngày 25/10: [`2026-10-24-scheduled-workflows-design.md`](../superpowers/specs/2026-10-24-scheduled-workflows-design.md).
- **Phạm vi:** một lần, hằng ngày, hằng tuần; giờ Việt Nam; mỗi lượt lập kế hoạch mới và **chờ duyệt** như mọi kế hoạch khác; không có chế độ tự chạy.
- **Demo:** Google Calendar → Slack. GitHub → Slack ("issue mới từ lượt trước") không làm được với `github.search_issues` hiện tại, và sửa tool là đổi catalog đã chốt.
- **Chia việc:** reviewer làm SCHED-01, SCHED-02 và bộ đo của SCHED-04; `longnguyen005` làm SCHED-03; nhóm trưởng nghiệm thu thật.
- **Cờ `SCHEDULES_ENABLED`** tắt mặc định. Khi cờ tắt, prompt giữ nguyên từng byte, nên W4-01, W4-03, W4-04 vẫn đúng với hệ thống khi cờ tắt. Khi bật, SCHED-04 đo lại `core` và `services`.
- **Mốc cắt:** 01/11 SCHED-01 hoặc SCHED-02 chưa merge thì dừng OAuth; 03/11 nghiệm thu thật chưa đạt thì giữ cờ tắt.
- Phần ổn định demo của tuần 5 dời sang 05–06/11, nên tuần cuối còn ít thời gian hơn. Task card tuần 5 và tuần 6 lập sau.

**Cập nhật 25/10 (OAuth):** nhóm trưởng duyệt phạm vi OAuth hẹp và đặc tả [OAUTH-01](../superpowers/specs/2026-10-25-oauth-connect-from-chat-design.md).
- **OAUTH-01**, bắt buộc, reviewer thi công, merge trước 29/10: từ màn từ chối vì thiếu Gmail, người dùng kết nối Gmail, quay về đúng hội thoại và gửi lại yêu cầu. Kế hoạch vẫn chờ duyệt.
- **OAUTH-02**, tuỳ chọn: Google Calendar riêng của từng người. Nhóm trưởng quyết làm hay bỏ ngày 29/10; mốc cắt 01/11.
- **Không làm:** OAuth cho Slack, GitHub, Notion, Jira, Trello, cùng chế độ tự chạy. Các phần này ghi vào báo cáo môn học là hướng phát triển.
- **Điều kiện tiên quyết:** GMAIL-04 (nghiệm thu Google thật, PR bật cờ Gmail), do nhóm trưởng thao tác.

**Cập nhật 25/10 (merge lịch chạy):**
- SCHED-01 merge #167 (`95b1c46`) và SCHED-02 merge #168 (`46b6a5b`) tối 25/10. Nhóm trưởng cho merge sớm hơn mốc 26/10, vì toàn bộ nằm sau cờ tắt.
- Mốc cắt "01/11 SCHED-01 hoặc SCHED-02 chưa merge thì dừng OAuth" đã qua.
- Việc tiếp theo của lịch chạy:
  - SCHED-03 (`longnguyen005`, trước 01/11);
  - SCHED-04 sau SCHED-03 (bộ đo giao reviewer, nghiệm thu thật giao nhóm trưởng, PR bật cờ trước 04/11).

[Log](log/2026-10-25-reviewer-plan-schedules.md).

**Cập nhật 26/10 (kế hoạch hoàn thành):** nhóm trưởng yêu cầu một kế hoạch chi tiết cho phần còn lại, để vẫn làm theo được khi không còn reviewer cũ. Kết quả là [FINISH-PLAN](FINISH-PLAN.md):
- lịch từng ngày 26/10 → 11/11, mốc cứng và mốc cắt;
- các quyết định chờ nhóm trưởng, mỗi quyết định có mặc định;
- quy trình hai phiên agent: A-thi công và A-review. A-review thay vai reviewer, gồm cả việc ghi bàn giao sau merge;
- câu lệnh dán sẵn trong `PROMPTS.md`.

Task card mới:
- tuần 5: [DEMO-01](tasks/DEMO-01-demo-stability.md);
- tuần 6: [REPORT-01](tasks/REPORT-01-final-report.md), [SLIDES-01](tasks/SLIDES-01-defense-slides.md), [VIDEO-01](tasks/VIDEO-01-backup-demo-video.md), [REHEARSAL-01](tasks/REHEARSAL-01-defense-rehearsal.md);
- tuỳ chọn: [LAT-01](tasks/LAT-01-planning-deadline.md).

Phần việc của SCHED-04 trước đây giao reviewer (bộ đo, đo, báo cáo) nay giao A-thi công, và A-review review.

**Cập nhật 26/10 (merge #172, #173):**
- OAUTH-01 xong qua #172 (`13430d9`), merge tối 26/10, trước mốc 29/10. Gmail vẫn tắt mặc định.
- Kế hoạch hoàn thành và OAUTH-02 vào `main` qua #173 (`907a2f0`), cùng tối. Chỉ tài liệu.
- OAUTH-02 có ba điều kiện (đặc tả mục 1.1). Điều kiện thứ nhất, #172 đã merge, đã đạt. Hai điều kiện còn lại là cờ Gmail đã bật và SCHED-03 gần xong; nhóm trưởng quyết ngày 29/10.
- Việc tiếp theo: GMAIL-04 nghiệm thu Google thật, gồm cả luồng OAUTH-01, rồi PR bật cờ trước 28/10.

[Log merge](log/2026-10-26-reviewer-merge-172-173.md).

**Cập nhật 19/10 (FE-12):** nhóm trưởng chốt một thanh điều hướng chung cho mọi trang sau khi đăng nhập, kể cả cockpit, sau khi xem mockup ba phương án. Các tab căn giữa thanh. Câu "Yêu cầu hiện tại" chuyển vào nội dung cockpit, không thêm dòng thứ hai dưới thanh. Đây là chỗ lệch bản mẫu có chủ đích; đặc tả giao diện mục 1.1 điểm 10 và mục 4 đã ghi theo. Nhóm trưởng giao reviewer thi công [FE-12](tasks/FE-12-shared-nav-bar.md):
- merge trước mốc ngừng thêm tính năng 29/10;
- không merge trong 23–25/10.

[Log](log/2026-10-19-reviewer-plan-fe-12-nav.md).

**Cập nhật 18/10 (đo GMAIL-04, W4-02, W4-04):** ba phép đo bằng model thật vào `main` qua #159 (`778f22f`), sớm hơn lịch 21–22/10 theo yêu cầu nhóm trưởng:
- GMAIL-04: `gmail` 59/60 (injection 9/9), `answers` 27/30, `core` bật kiểu trả lời 50/50; không câu hành động nào của `services` thành câu trả lời;
- W4-02: 36/36;
- W4-04: 23/24 lượt dưới 15 s qua giao diện, p95 14,7 s.

Review độc lập lần 1 chưa đạt: báo cáo quy một câu trượt cho label, trong khi lỗi ở truy vấn của model. Review lại Đạt. Việc tiếp theo:
- GMAIL-04: nghiệm thu Google thật qua giao diện, rồi PR bật cờ trước 28/10;
- W4-01 từ 22/10; W4-03 ngày 23–25/10 với cờ tắt;
- task card cho khung giờ "cả ngày" của planner (CURRENT-STATE mục 5), khi nhóm trưởng đồng ý.

[Log merge](log/2026-10-18-reviewer-merge-159.md).

**Cập nhật 18/10 (W4-02, test GMAIL-01):** bộ đo hội thoại nhiều lượt vào `main` qua #157 (`efaafb2`). Có 12 câu, label đăng ký trước, chưa đo. Test GMAIL-01 hay fail ngẫu nhiên đã sửa qua #156 (`f0e24f0`): thứ tự được đọc trong PostgreSQL. Mỗi PR có review độc lập chưa đạt trước khi sửa, rồi review lại Đạt. Việc tiếp theo:
- đợt đo bằng model thật khoảng 21–22/10, khi nhóm trưởng đồng ý: GMAIL-04 (`gmail`, `answers`, `core`/`services` với kiểu trả lời bật) và W4-02 (`multiturn` ×3);
- các việc của W4-01, W4-03, W4-04 như bản 17/10.

[Log merge](log/2026-10-18-reviewer-merge-156-157.md).

**Cập nhật 18/10 (GMAIL-04, bộ đo):** bộ đo riêng cho Gmail và kiểu trả lời vào `main` qua #154 (`32d71fd`). Gồm 20 câu Gmail và 10 câu trả lời, label đăng ký trước, chưa có lời gọi model nào. Review độc lập hai lần chưa đạt (label chấm nhầm đạt khi chưa đọc thư, hoặc khi tra cứu không tìm thấy gì), lần 3 Đạt. Việc tiếp theo:
- đo bằng `ag/gemini-3.8-flash` khi nhóm trưởng đồng ý (khoảng 21–22/10): `gmail` ×3, `answers` ×3, `core` và `services` ×1 với kiểu trả lời bật;
- nghiệm thu Google thật qua giao diện, rồi PR bật cờ trước 28/10 theo quy tắc quyết định trong task card.

[Log merge](log/2026-10-18-reviewer-merge-154.md).

**Cập nhật 18/10 (GMAIL-03):** GMAIL-03 xong qua #147 (`6233637`); Gmail vẫn tắt mặc định. Khi cờ bật, mỗi người tự kết nối Gmail ở `/settings`, và màn duyệt cho thấy thư gửi từ đâu, tới ai, ghi vào luồng nào. Review độc lập lần 1 có 1 P2 và 3 P3; reviewer sửa thay `longnguyen005` theo yêu cầu nhóm trưởng; hai lượt review lại, lượt cuối Đạt. Việc tiếp theo:
- nhóm trưởng làm GMAIL-04: bộ đo, nghiệm thu Google thật, PR bật cờ (đo 26–28/10, bật cờ trước 28/10);
- W4-01, W4-03, W4-04 như bản 17/10 dưới đây; buổi thử 23–25/10 vẫn chạy với cờ tắt;
- sửa test GMAIL-01 chập chờn bằng PR nhỏ riêng (đã gặp 9 lần).

[Log merge](log/2026-10-18-reviewer-merge-147.md).

**Cập nhật 17/10 (W4-01, W4-03, W4-04):** phần khung và công cụ của ba task đo tuần 4 vào `main`: #149 (`fb38a4d`), #150 (`98d880b`), #151 (`ce59f4f`). Reviewer thi công theo yêu cầu nhóm trưởng. Mỗi PR có review độc lập lần 1 chưa đạt, sửa một lượt, review lại Đạt; CI xanh đúng head. Không đổi mã sản phẩm. Việc tiếp theo:
- nhóm trưởng cấp mã `member-N` và gửi `evaluations/golden-independent/GUIDE.md` cho người viết câu (từ 22/10);
- nhóm trưởng hẹn ≥ 5 người cho buổi thử W4-03 (23–25/10), theo `evaluations/usable-plan/PROTOCOL.md`;
- phép đo live W4-04 (24 câu, không ghi dịch vụ) sau mốc chốt catalog 20/10, khi nhóm trưởng đồng ý;
- `longnguyen005` sửa GMAIL-03 (#147) theo review; sửa test GMAIL-01 chập chờn bằng PR nhỏ riêng.

[Log merge](log/2026-10-17-reviewer-merge-149-150-151.md).

**Cập nhật 16/10 (W3-11):** W3-11 xong qua #146 (`2960ab0`), trước buổi thử W4-03. Năm service mới và một workflow 4 dịch vụ chạy thật qua giao diện ở chế độ live; không phát hiện lỗi sản phẩm. Việc tiếp theo:
- khung W4-03 (`PROTOCOL.md`, script tính tỉ lệ) phải vào `main` trước buổi thử 23–25/10;
- nhóm trưởng hẹn người tham gia W4-03 và người viết câu hỏi W4-01;
- `longnguyen005` làm GMAIL-03.

[Log merge](log/2026-10-16-reviewer-merge-146.md).

**Cập nhật 16/10 (ANS-01):** ANS-01 xong qua #142 (`96f9f09`), cờ `PLANNER_READ_ANSWERS` vẫn tắt mặc định. Review độc lập Đạt sau một lượt sửa thiếu test và rebase lên `main` có #143; trên bản tích hợp, 22/22 đột biến bị bắt, gồm 5 đột biến vào bảo đảm của GMAIL-02. Bước 1 của GMAIL-04 (Google Cloud project cho Gmail) xong cùng ngày. Việc tiếp theo:
- `longnguyen005` làm GMAIL-03 (trước 23/10);
- nhóm trưởng làm W3-11 (trước buổi thử 23/10), hẹn người tham gia W4-03, rồi làm bộ đo GMAIL-04;
- sửa test GMAIL-01 chập chờn bằng PR nhỏ riêng.

[Log merge](log/2026-10-16-reviewer-merge-142.md).

**Cập nhật 16/10 (GMAIL-02):** GMAIL-02 xong qua #143 (`7c260c1`). Gmail vẫn tắt mặc định; khi bật, 10 tool đi qua planner, executor và sandbox. Review độc lập Đạt sau một lượt sửa P2 (thiếu test chống gửi trùng). ANS-01 (#142) đã review, còn 1 P2 thiếu test; #142 cần rebase lên `main` vì xung đột với #143 ở `server.ts` và `sandbox/scenarios.ts`. Việc tiếp theo:
- `longnguyen005` sửa và rebase #142, rồi làm GMAIL-03;
- nhóm trưởng làm W3-11 (trước buổi thử 23/10) và tạo Google Cloud project cho Gmail (trước 21/10).

[Log merge](log/2026-10-16-reviewer-merge-143.md).

**Cập nhật 14/10 (GMAIL-01):** GMAIL-01 xong qua #140 (`8973a9e`), Gmail vẫn tắt mặc định và chưa vào planner. Review độc lập lần 1 có 3 P2; lỗi 1 và 2 đã sửa và review lại đạt; lỗi 3 đã sửa, chỉ có kiểm của bên thi công. Việc tiếp theo: GMAIL-02 (nhóm trưởng, trước 21/10), ANS-01 rồi GMAIL-03 (`longnguyen005`). [Log merge](log/2026-10-14-reviewer-merge-140.md).

**Cập nhật 14/10:** kế hoạch Gmail vào `main` qua #138 (`6185b2c`); W4-00b xong qua #137 (`ebc192d`), review độc lập đạt. Việc tiếp theo: `longnguyen005` làm ANS-01; nhóm trưởng làm GMAIL-01 (trước 18/10), W3-11, và tạo Google Cloud project cho Gmail trước 21/10. [Log merge](log/2026-10-14-reviewer-merge-137.md).

**Cập nhật 13/10 (Gmail):** nhóm trưởng thêm Gmail theo kết nối riêng của từng người và kiểu phản hồi "trả lời" cho câu chỉ đọc ([đặc tả](../superpowers/specs/2026-10-13-gmail-personal-connections-design.md)). Cả hai sau cờ tắt mặc định. Phép đo W4-01/W4-03/W4-04 và buổi thử 23–25/10 vẫn chạy trên 8 dịch vụ với cờ tắt; mốc chốt catalog 20/10 giữ cho 8 dịch vụ, vì Gmail không vào `ALL_TOOLS`. Gmail và kiểu "trả lời" có phép đo riêng (GMAIL-04) trước mốc chốt tính năng 29/10. Chia việc:
- nhóm trưởng: GMAIL-01, GMAIL-02, GMAIL-04 (gồm Google Cloud project riêng cho Gmail);
- `longnguyen005`: W4-00b, rồi ANS-01, rồi GMAIL-03.

Thứ tự cắt nếu trễ: bỏ `forward`, nhãn, thùng rác, tạo nhãn trước; rồi bỏ kiểu "trả lời" (để cờ tắt, hành vi như W3-10). Không bỏ phần 1 và các tool tìm, đọc, gửi, trả lời, nháp.

**Cập nhật 13/10:** W4-00 đã merge #133 (`6ee4109`); đường dự phòng thủ công `cx/gpt-6.1-sol` đã kiểm qua app live tới preview rồi Hủy. Core còn PARTIAL, quota chưa rõ và rủi ro cùng 9router/host vẫn còn; không coi đây là nghiệm thu W3-11 hoặc các phép đo tuần 4. Việc tiếp theo: W3-11 trước buổi thử W4-03; chuẩn bị khung W4-01/W4-03, W4-02 và công cụ W4-04 theo task card, hẹn thành viên viết câu hỏi và buổi thử thật. Không trộn model giữa một campaign. [Log merge](log/2026-10-13-codex-W4-00-merge.md).

**Cập nhật 11/10:** FE-11 đã merge #129, nên các task giao diện FE-04 → FE-11 đều đã xong (FE-10 trừ phần chụp lại cạnh bản mẫu). Việc tiếp theo theo thứ tự trên: W4-00 và W3-11 (song song), hẹn người cho W4-01 và buổi thử W4-03; tuần 5–6 chưa có task card.

**Cập nhật 10/10:** FE-10 đã merge #128, trừ phần chụp lại FE-05b → FE-09 cạnh bản mẫu. Ba việc chờ người dùng quyết: tách phần chụp lại đó thành task riêng hay bỏ; giữ hay trả màu logo Jira ở chế độ tối; giữ hay sửa chữ dưới 3:1. FE-11 lúc đó đang review ở #129.

**Cập nhật 09/10:** AUTH-07, FE-08 và FE-09 đã merge; FE-10 là task giao diện tiếp theo. [Log merge](log/2026-10-09-codex-merge-fe-08-fe-09.md) giữ giới hạn live, visual và lỗi FE-05 chưa rõ nguyên nhân.

Thứ tự: FE-04 và UI-API-01 song song → FE-05 → (từ 07/10) FE-04b → FE-05b → FE-06; FE-07 song song với FE-05b/FE-06 → FE-08 → FE-09 → FE-10. Nếu FE-05 chưa merge trước buổi thử W4-03 thì W4-03 chạy trên giao diện hiện tại và báo cáo ghi rõ; không đổi giao diện giữa một buổi đo. Phần tối thiểu để demo: FE-04, FE-04b, FE-05, FE-05b, FE-06, FE-07.

**Bổ sung 06/10/2026:** người dùng chốt bản mẫu là chuẩn về hình thức (đặc tả mục 1 và 1.1), vì FE-05 đúng hành vi nhưng khác bản mẫu nhiều về bố cục. Cách làm: chuyển markup bản mẫu sang JSX, đổi màu sang token và class Tailwind v3 sang v4, nối dữ liệu thật (đặc tả mục 1.2). Thêm FE-05b; FE-06 → FE-10 có thêm tiêu chí "giống bản mẫu" (ảnh đặt cạnh nhau ở 1440 và 375, sáng và tối). Xem [log](log/2026-10-06-claude-code-plan-visual-parity.md).

Thứ tự ưu tiên khi thiếu thời gian: không bỏ W3-00 (là bằng chứng cho tiêu chí mở rộng của đặc tả) và không bỏ phục hồi, an toàn ghi (tuần 2). Bỏ service theo thứ tự: Telegram, Jira (trùng nhóm với Slack, Trello), rồi Notion, Calendar, Sheets. Mảng tài khoản: không bỏ AUTH-01 (đặc tả §8.1 yêu cầu thu hồi được token). AUTH-02 và AUTH-03 đi cùng nhau; thiếu một trong hai thì giữ đăng ký tắt. Bỏ theo thứ tự: phần phiên đăng nhập của AUTH-05, rồi AUTH-04. Mảng frontend: không bỏ FE-01 (lỗi an toàn và nội dung sai sự thật). FE-02 và FE-03 có thể bỏ các phần nhỏ (phân trang, Shift+Enter, `h-dvh`), không bỏ: mở lại hội thoại khi tải lại, tên tài nguyên trong plan, SSE tự refresh. Task lập 05/10: không bỏ W4-00 (việc nhỏ; nếu nguồn Gemini hỏng mà chưa có đường thay thế đã kiểm thì mất số liệu tuần 4 và demo) và W3-11 (demo đi qua giao diện); W3-10 có thể bỏ mục 8 (xử lý đuôi chậm), không bỏ phần A (đo), phần B (chỉ đọc) và lần đo lại. Giao diện mới: bỏ theo thứ tự Cẩm nang/Chính sách của FE-10, trang Lịch sử của FE-09, trang giới thiệu của FE-08 (giữ trang hiện tại); không bỏ FE-04, FE-04b, FE-05 → FE-07.

**Bổ sung 07/10/2026** (Claude Code, review kế hoạch sau khi PROTO-01 xong; xem [log](log/2026-10-07-claude-code-plan-port-prototypes.md)). Người dùng chốt: **đưa thẳng bản React của bản mẫu vào app**, theo design system Agentic đúng như 12 bản mẫu thể hiện (kể cả chữ 10–12px, tiêu đề 42–52px, nền `#F8F8F6`, chế độ tối theo `theme.css`), bỏ các điều chỉnh riêng cho app của đặc tả (chữ tối thiểu 14px, nền `#F6F6F1`, token suy ra của FE-04); các yêu cầu trợ năng làm đổi hình thức (chữ ≥ 14px, vùng chạm 40×40, tương phản 4,5:1 cho chữ nhỏ) chỉ đo và ghi lại. Đặc tả mục 1, 1.1, 1.2 viết lại; thêm FE-04b (lớp nền); FE-05b → FE-10 đổi cách làm sang "chép trang của bản React rồi nối dữ liệu thật". Design system mà bản mẫu thật sự dùng ghi ở [`docs/design/design-system.md`](../design/design-system.md), rút từ 12 bản mẫu và đối chiếu với gói Agentic của Open Design.

Các điểm review khác:
- **W3-10 nằm trên đường găng** (đổi prompt, phải merge trước mốc chốt catalog 20/10, cần gọi model thật và đo lại golden) nhưng chưa có người nhận: nên giao ngay, song song FE-04b/FE-05b.
- **Việc của con người chưa có ngày:** W4-00 (người dùng xác nhận model `cx/` gọi được và còn quota), W4-01 (thành viên viết câu hỏi, sau 20/10), W4-03 (buổi thử ≥ 20 lượt), W2-03 (duyệt lệnh ghi thật, chờ từ tuần 2: nên chốt làm hay bỏ). Đề xuất buổi thử W4-03 ngày **23–25/10**: sau khi FE-06, W3-10, W3-11 xong; các task FE còn lại (FE-07 → FE-10) không sửa cockpit nên không đổi giao diện giữa buổi đo.
- Tuần 5 vẫn chưa có task card (môi trường demo, 3 kịch bản, diễn tập LLM dự phòng); người dùng chưa yêu cầu lập trong đợt này.
- Hai PR draft "Planora" (#47, #87) mở từ 03–05/10 theo hướng khác (frontend riêng, bảng màu kem/xanh rừng); người dùng tự xử lý, kế hoạch này không phụ thuộc chúng.

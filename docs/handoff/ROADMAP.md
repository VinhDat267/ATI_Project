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
| 3 | Giao diện cấu hình lấy nhãn/tên từ API, ô `multiline`, câu từ chối nêu tên service còn thiếu | [W3-00b](tasks/W3-00b-frontend-and-refusal-naming.md) | chờ; đã gỡ chặn W3-00 và FE-02, không chặn task service |
| 3 | Google Sheets (gồm xác thực service account dùng chung cho Google) | [W3-01](tasks/W3-01-google-sheets.md) | xong, #30 tại `716f568`; chạy thật qua harness W3-07 #57, chưa qua frontend live |
| 3 | Google Calendar | [W3-02](tasks/W3-02-google-calendar.md) | xong, #31 tại `ab2c599`; chạy thật qua harness W3-07 #57, chưa qua frontend live |
| 3 | Notion | [W3-03](tasks/W3-03-notion.md) | xong, #32 tại `fca384d`; chạy thật W3-07 #49/#50, chưa qua frontend live |
| 3 | Telegram | [W3-04](tasks/W3-04-telegram.md) | xong, #33 tại `4a4553b`; chạy thật W3-07 #48, chưa qua frontend live |
| 3 | Jira Cloud | [W3-05](tasks/W3-05-jira.md) | xong, #34 tại `dc80de4`; chạy thật W3-07 #55, readback sau sửa W3-09 #63 đạt |
| 3 | Đánh giá planner với các service mới, đo lại bộ cũ, test định tuyến tất định | [W3-06](tasks/W3-06-new-services-eval.md) | đo xong, #35 tại `a75ac35`; numeric gate cả năm đạt, parity ff15 và latency chưa đạt; product acceptance incomplete |
| 3 | Chạy thật từng service mới và một workflow ≥ 4 service | [W3-07](tasks/W3-07-new-services-live.md) | xong 04/10: #48 Telegram, #49/#50 Notion, #51 workflow 4 service, #55 Jira, #57 Google; phát hiện → W3-09 |
| 3 | Giới hạn kích thước kết quả đọc (Sheets, Notion, Calendar, giới hạn chung trong planner), test 403 Calendar, phân loại lỗi token Google (từ audit W3 03/10) | [W3-08](tasks/W3-08-bounded-read-results.md) | xong: #39 và bản sửa #45 tại `81225de`; hai P2 đã sửa, review độc lập đạt, CI955+165/browser20 xanh; xem [bằng chứng](log/2026-10-03-codex-W3-08-review-fixes.md) |
| 3 | Jira: tìm kiếm với dấu gạch ngang, báo đúng lỗi token khi đọc (phát hiện khi chạy thật W3-07) | [W3-09](tasks/W3-09-jira-live-findings.md) | xong, #63 tại `f284b12`; review độc lập đạt, CI head971c3b2 xanh; token giả AUTH_ERROR và W3-07 → ATIT-4 đã kiểm thật chỉ đọc sau merge |
| 3–4 (02–24/10) | Tài khoản: phiên đăng nhập lưu ở server, đăng xuất thu hồi token, trạng thái và vai trò tài khoản | [AUTH-01](tasks/AUTH-01-sessions-logout-roles.md) | xong, #41 tại `fbd993f`; review độc lập đạt, CI xanh |
| 3–4 | Gửi email qua Gmail SMTP, đăng ký, xác minh email, quên mật khẩu | [AUTH-02](tasks/AUTH-02-signup-email-password-reset.md) | xong, #52 tại `e578520`; P2 thời gian phản hồi → AUTH-02b |
| 3–4 | Trang quản trị người dùng: duyệt, khóa, phân quyền | [AUTH-03](tasks/AUTH-03-admin-user-management.md) | xong, #53 tại `46cc6e6` |
| 3–4 | Gửi email không chặn phản hồi (chống lộ tài khoản qua thời gian); live chạy được khi chưa có SMTP | [AUTH-02b](tasks/AUTH-02b-async-email-and-live-startup.md) | xong, #61 tại `445d1b3`; review độc lập73tests + HTTP/PG sender800ms đạt; SMTP thật chưa chạy |
| 3–4 | Đăng nhập và đăng ký bằng Google | [AUTH-04](tasks/AUTH-04-google-login.md) | chờ (sau AUTH-01) |
| 3–4 | Trang quản lý tài khoản: hồ sơ, đổi mật khẩu, phương thức đăng nhập, phiên đăng nhập | [AUTH-05](tasks/AUTH-05-account-page.md) | chờ (sau AUTH-01; liên kết Google sau AUTH-04) |
| 4 | Cấu hình Gmail SMTP, Google OAuth và kiểm tra chạy thật | [AUTH-06](tasks/AUTH-06-auth-live-setup.md) | chờ (sau AUTH-02, AUTH-04; người dùng chuẩn bị) |
| 3 (02–14/10) | Frontend: đóng hộp thoại lỗi không còn dừng quy trình, bỏ mật khẩu admin khỏi bundle, trạng thái dịch vụ thật, báo chế độ sandbox, sửa số liệu chưa đo trên trang giới thiệu | [FE-01](tasks/FE-01-safety-and-honest-ui.md) | xong, #27 tại `9d262c6` |
| 3 | Frontend: điều hướng bằng URL, nút Back, mở lại hội thoại khi tải lại, tách `App.tsx`, tiêu đề và phân trang lịch sử | [FE-02](tasks/FE-02-routing-and-history.md) | xong, #42 tại `8b6c8e6`; review độc lập đạt, CI xanh sau retarget main |
| 3–4 | Frontend: plan hiện tên tài nguyên và nhãn Đọc/Ghi, kết quả dễ đọc có link, SSE tự refresh token, chuỗi tiếng Việt, hỗ trợ trình đọc màn hình | [FE-03](tasks/FE-03-readable-plan-and-results.md) | xong, #54 tại `9709a2d`; golden cần đo lại |
| 3–4 | Frontend: gửi tin ngay sau "Cuộc hội thoại mới" làm tin rơi vào hội thoại khác; test FE-03 lúc đạt lúc không trên CI | [FE-03b](tasks/FE-03b-new-conversation-send-race.md) | xong, #60 và sửa sau review #64 tại `965c8bc`; hai P2 đã sửa, review độc lập đạt, browser26/repeat40/CI xanh; P3 history nhánh lỗi còn mở |
| 4 (22–28/10) | Bộ đánh giá độc lập ≥ 30 câu do thành viên khác viết | [W4-01](tasks/W4-01-independent-eval-set.md) | chờ (khung làm ngay được; câu hỏi do con người viết) |
| 4 | Đánh giá hội thoại nhiều lượt: sửa plan, trả lời câu hỏi làm rõ | [W4-02](tasks/W4-02-multi-turn-eval.md) | chờ |
| 4 | Đo tỉ lệ plan dùng được với ≥ 20 lượt của người dùng thật | [W4-03](tasks/W4-03-usable-plan-study.md) | chờ (script làm ngay được; buổi thử do con người) |
| 4 | Đo latency qua frontend với ≥ 20 lượt | [W4-04](tasks/W4-04-frontend-latency.md) | chờ |
| 5 (29/10–04/11) | Ngừng thêm tính năng; môi trường demo dựng lại được theo hướng dẫn; đường LLM dự phòng qua Gemini API chính thức; 3 kịch bản demo chạy 3 lần liên tiếp không lỗi | — | chưa có task card |
| 6 (05–11/11) | Báo cáo cuối kỳ, slide, video demo dự phòng, diễn tập bảo vệ | — | chưa có task card |

W2-01/W2-02 áp dụng cho một API instance, executor cũ đã dừng; lease/fencing nhiều replica chưa có. Minor `text_*` streaming của frontend được hoãn: chưa tìm thấy production emitter, reachability chưa chứng minh; cần xử lý timestamp/finalized message trước khi nối producer này. Số liệu hiện tại và giới hạn review/live xem [CURRENT-STATE](CURRENT-STATE.md).

Yêu cầu chung cho mọi task thêm service: [W3-service-common](tasks/W3-service-common.md).

Thứ tự và song song: W3-00 đã merge qua #29 tại `c7a38c0`; W3-01 Sheets qua #30 tại `716f568`, W3-02 Calendar qua #31 tại `ab2c599`, W3-03 Notion qua #32 tại `fca384d`; W3-04 Telegram qua #33 tại `4a4553b`; W3-05 Jira qua #34 tại `dc80de4`; W3-06 đo xong qua #35 tại `a75ac35` trên catalog đóng băng33tool/8service. Người dùng đã chốt rf06 clarification trước label commit/model calls. Core150/150, freeform51/54, services111/132; numeric tools/args đạt nhưng parity ff15, services p95 và read-only policy/enforcement còn mở, cần task sản phẩm riêng trước sửa/rerun. AUTH-01 đã merge qua #41 tại `fbd993f` và FE-02 qua #42 tại `8b6c8e6`; review độc lập đạt, CI xanh sau retarget main. AUTH-02/AUTH-03/FE-03, AUTH-02b và sửa FE-03b đã merge, review độc lập đạt; AUTH-04/AUTH-05 và phần UI của W3-00b đã gỡ chặn. W3-07 đã chạy thật năm service và workflow4service sau duyệt đúng plan, chưa qua frontend live; W3-09 đã sửa và kiểm lại đọc Jira thật sau merge. W4-02, W4-04 (phần công cụ) và khung của W4-01, W4-03 làm song song được với tuần 3.

**Mốc chốt catalog: 20/10/2026.** Service nào chưa merge đạt review trước mốc này thì không đưa vào phạm vi môn học (không đăng ký vào registry). W3-06 và các phép đo chính thức của tuần 4 (W4-01, W4-03, W4-04) chạy trên catalog đã chốt, để số liệu khớp với hệ thống đem đi bảo vệ.

**Mảng tài khoản** (chốt 02/10/2026: đăng ký mở nhưng admin duyệt; gửi email bằng Gmail SMTP; thêm đăng nhập Google). Yêu cầu chung: [AUTH-common](tasks/AUTH-common.md). AUTH-01 đã merge qua #41 tại `fbd993f`. AUTH-02, AUTH-03, AUTH-04, AUTH-05 có thể làm song song; frontend đã gỡ chặn bởi FE-02. Migration title dùng 0004, task AUTH tiếp theo chọn số chưa dùng theo AUTH-common. Đăng ký chỉ mặc định bật khi AUTH-02 và AUTH-03 đều đã merge. Mục tiêu: merge AUTH-01 → AUTH-05 trước 24/10, AUTH-06 trước 28/10.

**Mảng frontend** (review 02/10/2026): FE-01 và FE-02 đã merge. Phần giao diện của AUTH-02 → AUTH-05, W3-00b và FE-03 đã gỡ chặn. FE-03 xong trước buổi thử W4-03; chưa thay đổi ưu tiên hay triển khai các task tiếp theo trong phiên merge này.

Phần việc của con người nên bắt đầu ngay: tạo Gmail gửi thư và App Password, OAuth client của Google (AUTH-06); các thành viên viết câu hỏi (W4-01); hẹn người tham gia buổi thử (W4-03).

Thứ tự ưu tiên khi thiếu thời gian: không bỏ W3-00 (là bằng chứng cho tiêu chí mở rộng của đặc tả) và không bỏ phục hồi, an toàn ghi (tuần 2). Bỏ service theo thứ tự: Telegram, Jira (trùng nhóm với Slack, Trello), rồi Notion, Calendar, Sheets. Mảng tài khoản: không bỏ AUTH-01 (đặc tả §8.1 yêu cầu thu hồi được token). AUTH-02 và AUTH-03 đi cùng nhau; thiếu một trong hai thì giữ đăng ký tắt. Bỏ theo thứ tự: phần phiên đăng nhập của AUTH-05, rồi AUTH-04. Mảng frontend: không bỏ FE-01 (lỗi an toàn và nội dung sai sự thật). FE-02 và FE-03 có thể bỏ các phần nhỏ (phân trang, Shift+Enter, `h-dvh`), không bỏ: mở lại hội thoại khi tải lại, tên tài nguyên trong plan, SSE tự refresh.

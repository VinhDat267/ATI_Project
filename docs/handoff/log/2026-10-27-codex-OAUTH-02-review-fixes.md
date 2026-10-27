# 27/10/2026 · OAUTH-02 · Sửa sáu lỗi sau review

- **Yêu cầu:** nhóm trưởng yêu cầu sửa cả sáu phát hiện review của nhánh `feat/oauth-02-personal-calendar` tại `c774af3a`.
- **Task:** [OAUTH-02](../tasks/OAUTH-02-personal-calendar.md).
- **Commit label riêng:** `e9fc6d7a`; chưa có lời gọi model nào trước hoặc sau commit này trong phiên sửa.
- **Commit mã và regression tests:** `2be4696a9e22a50aa472ed3e9e96ffe1bc07d339`.
- **Kế hoạch sửa:** [2026-10-27-oauth-02-review-fixes.md](../../superpowers/plans/2026-10-27-oauth-02-review-fixes.md).

## Sáu lỗi đã sửa

1. **F1 — Thu hồi quyền OAuth độc lập:** sửa thiết kế và hướng dẫn từ hai client trong cùng project thành client Calendar ở Cloud project riêng. Live yêu cầu `MYCALENDAR_OAUTH_PROJECT_ID`, và `GMAIL_OAUTH_PROJECT_ID` khi Gmail có cấu hình (kể cả cờ Gmail tắt), chặn cùng project/cùng client. Fake Google thu hồi mọi access/refresh token theo `(Google account, project)`; test HTTP chứng minh cùng project bị thu hồi chéo, khác project và người dùng khác giữ quyền. Hai ca PostgreSQL + API disconnect dùng cùng tài khoản Google, kiểm cả dòng DB và refresh token của dịch vụ còn lại qua HTTP.
2. **F2 — Định tuyến:** nhận diện `my personal calendar`, `my private calendar`, `my Google Calendar`. Khi chưa có kết nối riêng, từ chối thay vì rơi về lịch nhóm. Câu nhắc rõ cả lịch cá nhân lẫn shared/team/group Calendar giữ cả hai dịch vụ; thiếu lịch chung thì từ chối đúng dịch vụ. Cờ tắt giữ registry/catalog cũ.
3. **F3 — Fixture bộ đo:** thêm miền tài nguyên `mycalendar`, hai lịch cá nhân, sự kiện và tiêu đề độc hại trong kết quả tra cứu. Bộ đo yêu cầu đọc thành công đúng sự kiện, kể cả khi model chọn refusal/clarification được chấp nhận; lỗi lookup hoặc mảng rỗng không được tính đạt. Scorer dùng điều kiện opt-in nên bộ cũ giữ chính sách.
4. **F4 — Label `mc04`:** đổi kỳ vọng thành clarification khi câu chỉ đọc gặp chính sách kế hoạch phải có bước ghi. Hai bản JSON giống nhau; label đã đăng ký trong commit riêng. Không đổi label sau kết quả model.
5. **F5 — Callback:** mỗi lần setup effect đều có cleanup trong StrictMode, vẫn chỉ đổi OAuth code một lần. Chặn bắt đầu lưu và điều hướng/thông báo muộn khi phiên đã mất hoặc component đã unmount.
6. **F6 — Biên nhận:** truyền `connections.mycalendar` từ kế hoạch/snapshot đã duyệt; hiển thị email của tài khoản đã thực thi cho cả lịch phụ và biên nhận dừng. Không thay bằng email kết nối hiện tại. Browser so sánh dòng tài khoản trên preview và receipt.

## RED → GREEN và kiểm độc lập

- F1: hai file mới có **7 fail / 2 pass** trước sửa; sau sửa, config + project HTTP + Gmail env **20/20 pass**. Bộ Gmail/MyCalendar HTTP + PostgreSQL liên quan **75/75 pass**; không sửa assertion Gmail cũ.
- F2–F4: **17 fail / 8 pass** trước sửa → **25/25 pass**. Bổ sung câu nhắc đồng thời hai loại lịch: **6 fail** → file routing/golden **19/19 pass**.
- F5–F6: regression mới **6 fail / 5 pass** → **11/11 pass**; whole web **817/817 pass**.
- Ba đột biến bổ sung (xoá keyword English cá nhân, bỏ fixture tools, bỏ chặn accepted-kind chưa lookup) đều bị bắt, exit 1; SHA-256 trước/sau khôi phục khớp.
- Chạy lại cả **8 mutation bắt buộc M1–M8** trên source `2be4696a`: fallback chung, mở catalog khi scope_required, bỏ allowlist adapter, bỏ credentialId, xoá cả Gmail khi ngắt Calendar, cờ off vẫn mở catalog, sendUpdates khác none, lỗi ghi sau dispatch không thành UNKNOWN. **8/8 bị bắt** bằng assertion fail, exit 1; mỗi file khôi phục khớp SHA-256 và diff mã so với commit rỗng. Lượt đầu công cụ phân loại nhầm lỗi assertion `.rejects` của M3 thành NOT_CAUGHT; đọc stack `__VITEST_REJECTS__`, sửa bộ phân loại và chạy lại đầy đủ tám mutation, không sửa test sản phẩm.
- Sau khôi phục, chạy lại cả ba file MyCalendar services, connection routes và personal adapter: **64/64 pass**, exit 0 (`green-after-mandatory-mutations.log`).
- Reviewer độc lập đọc diff `c774af3a..2be4696a`, chạy lại **85 focused tests**, exit 0, không còn phát hiện quan trọng. Reviewer không chạy lại toàn bộ PG/browser hoặc Google thật; các kết quả toàn bộ dưới đây do phiên sửa chạy.

## Kiểm tra toàn bộ

PostgreSQL 16 riêng, API/check ở `56534`, browser ở `56535`, migrate đủ 12 migration trước chạy. Không dùng DB của workspace khác.

`DATABASE_URL=...:56534/ati_v3 RUNTIME_MODE=sandbox npm run check`: **exit 0** trên source cuối `2be4696a`, gồm:

| Workspace / nhóm | Kết quả |
|---|---:|
| tool-schemas | 65 passed |
| tool-adapters | 425 passed |
| planner | 378 passed |
| executor | 42 passed |
| chat-api | 614 passed |
| chat-web | 817 passed |
| Tổng sáu workspace | **2.341 passed** |
| test:eval:v3 | **406 passed / 25 files** |
| typecheck:v3, build:v3 | exit 0 |
| Production build security | PASS: không có credential sentinels hoặc 7 UI claims bị cấm |
| Launcher | 1 passed |
| Local-env / fake-OIDC / Google browser fixture | 10 passed |

`DATABASE_URL=...:56535/ati_v3 RUNTIME_MODE=sandbox V3_LOCAL_DB_PORT=56535 PORT=3967 V3_WEB_PORT=5197 npm run test:browser:v3`: **exit 0, 134 passed / 1 skip có chủ đích, 14 nhóm**. Default 94 passed / 1 skipped, auth02 2, auth04 6, clarification 3, partial_failure 2, three_service 1, sheets_slack 1, calendar_slack 1, notion_slack 1, telegram_slack 1, jira_slack 1, answer 4, gmail 10, mycalendar 7. Nhóm mặc định đã chạy cả ca MYCALENDAR off. Cả browser/fixture chỉ dùng sandbox và Google giả.

Log thực tế nằm ở `.codex/oauth02-fixes/` (frontend/eval RED, GREEN, `mandatory-mutations.json`, `M1.json`–`M8.json`, mutation hashes) và `node_modules/.cache/oauth02-fixes-check-final.log`, `oauth02-fixes-browser-all.log`, `oauth02-f1-{red,green,integration}.log`. Đây là bằng chứng cục bộ, không commit log hay token. Lượt check đầu đạt trước bổ sung mixed English routing; đã chạy lại full check trên source cuối. Lượt eval riêng ban đầu thiếu DATABASE_URL/static-guard timeout không tính là regression; full check với DB riêng đã đạt.

## Giới hạn và việc tiếp theo

- Project ID trong env là khai báo, không phải Google xác thực client thuộc project đó. Nhóm trưởng phải đối chiếu trên Google Cloud và tạo/chuyển client Calendar sang project riêng trước P-LIVE. Nếu đã dùng chung project, không thử revoke grant đang cần giữ.
- **Google thật, model ×3, báo cáo live và CI: NOT_RUN.** Giữ `MYCALENDAR_ENABLED=off`; chưa đủ điều kiện mở PR bật cờ.
- Không sửa `CURRENT-STATE.md` hoặc `ROADMAP.md`. Bàn giao để review/PR; chưa push hoặc merge.

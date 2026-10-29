# 29/10/2026 · Codex · NOTION-01 OAuth/setup

**Yêu cầu:** chủ dự án yêu cầu Slack OAuth và Notion OAuth. Main chưa có kế hoạch Notion riêng, nên tạo card NOTION-01 và backlog NOTION-02 rõ ranh giới. Phương án đề xuất là kết nối cá nhân nhiều workspace, không thay internal integration chung. Người dùng sẽ giao reviewer hiện tại. Nền `fc12e3f`, worktree/nhánh riêng `codex/notion-oauth`; đọc CURRENT-STATE/README và ba log mới nhất trước làm, không sửa CURRENT-STATE/ROADMAP hoặc checkout khác.

## Phần đã triển khai

- Migration0015 và repo riêng (mẫu state/owner/generation đã kiểm ở Slack, không phụ thuộc mã Slack khi chạy độc lập). Token mã hóa, state hash gắn browser/session, callback một lần, logout/disconnect thắng callback không hồi sinh kết nối. Một owner nhiều workspace; SQL scope CAS tăng generation; refresh giữ generation.
- Public integration confidential OAuth bằng Basic auth, lấy workspace/owner từ token response, xác minh bot qua users/me. Không giả định bot là người dùng. API pin2026-03-11; search data_source→parent database, kết quả giới hạn20/hasMore; validate từng database với Notion trước chọn tối đa10. Các lỗi auth/network được tách, không trả provider body/token.
- Refresh sau token bị từ chối: owner advisory lock giữa process, checkpoint autocommit trước single-use request, cập nhật token nguyên tử. Crash/unknown không dùng lại refresh cũ. Kiểm metadata/revoke không gọi tool ghi nghiệp vụ.
- Settings/callback nhiều workspace, scope_required và danh sách được chọn, ngắt riêng, query scrub trước callback, StrictMode không replay. Capability GET services giữ cờ off không thêm request vào Settings cũ. UI ghi rõ chưa mở công cụ cá nhân; `toolsAvailable:false`. API/planner/catalog/shared token không tự bị chuyển sang OAuth.

## Bằng chứng và giới hạn

PostgreSQL16 tmpfs riêng `ati-oauth-test-20261029` trên127.0.0.1:56538; mỗi test file schema riêng. API3996/web5196 và Notion fixture Worker loopback. npmci offline302 packages đúng lock; không thêm dependency. Không Notion/Slack/model thật, không bí mật thật trong test/log.

- RED DB4fail do thiếu bảng (lượt đầu quên DATABASE_URL bị ECONNREFUSED không tính RED sản phẩm); client module missing; API4/4fail404 trước wiring.
- OAuth client4, repo4 ban đầu, env4, route4, rotation3 đều xanh qua HTTP/PostgreSQL. Bổ sung scope CAS race dùng2 câu UPDATE thật: chỉ1winner; repo5+rotation3=8/8. Mutation bỏ CAS làm test fail.
- UI: mẫu callback từ phần Slack đã kiểm, thêm test riêng query/StrictMode. Hồi quy lựa chọn nhiều lượt search RED thật vì mất ID trước đó; sửa giữ lựa chọn nếu cùng connection+generation, GREEN. UI2mới+7Settingscũ=9/9.
- Browser4/4,375/1440 sáng/tối, cấp quyền→hai workspace→chọn database→ngắt một; xem ảnh375dark, không overflow. Fixture có code/token state và revoke thực trong HTTP worker; không phải provider live.
- Full check ban đầu exit2 vì tùy chọn exact không thuộc ByRoleOptions trong test; bỏ tùy chọn, không nới assertion. Lượt sau exit0: **2.579v3 =116schema+443adapter+381planner+42executor+712API+885web;406eval;1launcher+66Node**, typecheck/build/security đạt. Lượt này trước thêm một test CAS, không dùng nó để khẳng định test mới đã nằm trong count.
- 4/4mutationcaught (từngexit1): scope-CAS,state-replay,reconnect-generation,unknown-refresh; mọi file khôi phục nguyên byte. Lượt script đầu sai target unknown-refresh chỉ chạy3mutation; sửa target và chạy lại đủ4, không tính target-missing là mutationcaught.

Logs/helper và ảnh tại node_modules/.cache/oauth, node_modules/.cache/v3-browser-results, bịignore. Trước bàn giao cần đối chiếu CI đúng head và reviewer độc lập. Chưa app Notion thật/model/rollout. Card NOTION-02 giữ rõ catalog/binding/planner/executor/nguồn/preview và đo/nghiệm thu workflow chưa làm; không tuyên bố OAuth setup là full integration.

## Tích hợp hai OAuth

Hai nhánh cùng chạm capability/Settings/server; chuẩn bị Notion trên base PR Slack #184 để giữ cả hai kết nối và tránh giao reviewer một bản xung đột đã biết. Kết quả check/browser cây chung sẽ được ghi ở checkpoint tiếp theo trong chính log này. Không merge main hoặc liên hệ reviewer thay người dùng.

Người dùng chưa có apps và HTTPS, đã yêu cầu hướng dẫn tạo và chuẩn bị HTTPS thử trên máy. Công việc môi trường sẽ dùng production build/DB riêng và công cụ tunnel chính thức có checksum; không xuất bản development server hoặc thay cấu hình thật trong repo.

# JIRA-01 · Kiểm chứng khả thi OAuth Jira

**Trạng thái:** đang triển khai tooling; native gate chưa đạt. **Ủy quyền:** chủ dự án duyệt thiết kế và yêu cầu triển khai 31/10/2026.
**Thiết kế:** [Jira cá nhân/workspace](../../superpowers/specs/2026-10-30-jira-personal-workspaces-design.md).
**Kế hoạch:** [OAuth feasibility](../../superpowers/plans/2026-10-31-jira-oauth-feasibility.md).
**Vai trò:** Integration; chỉ package tool-adapters và tài liệu của task. Chưa sửa API/web/planner/executor/database.

## Mục tiêu

Có bộ probe local dùng OAuth thật, kiểm chứng identity trước khi có quyền site, cấp thêm site, token rotation và quyền native. HTTP fixture chứng minh bộ probe chạy đúng, không thay bằng chứng Atlassian. Không tạo issue/comment trong task này.

## Phạm vi và nghiệm thu

- [ ] Client OAuth giới hạn endpoint, JSON token request, scope/identity/site parsing, timeout bằng AbortSignal và lỗi an toàn.
- [ ] Session state một lần, ràng buộc browser, thế hệ kết nối; refresh dùng token mới, không hồi sinh sau disconnect.
- [ ] CLI local 127.0.0.1:4187, cấu hình cục bộ ignored, hướng dẫn tạo app, report không có secret.
- [ ] RED/GREEN và HTTP/process tests; package suite xanh; review độc lập.
- [ ] Native identity-only bằng account chưa thuộc Jira site, có attestation của chủ tài khoản.
- [ ] Native existing-site và thêm site thứ hai; cấp scope và refresh được kiểm thật.
- [ ] Native quyền ADMINISTER và scope/read endpoints đủ bằng chứng; không lấy quyền hiển thị metadata làm bằng chứng write đã được thử.
- [ ] Facts và task/log ghi rõ DOCUMENTED/FIXTURE_VERIFIED/LIVE_OBSERVED/OPERATOR_ATTESTED/NOT_RUN.

## Cổng dừng

Nếu identity-only không đáp ứng onboarding, cần chủ dự án quyết ngoại lệ trước JIRA-02. Nếu chưa có app/credentials/consent/tài khoản phù hợp, hoàn tất tooling an toàn và ghi native NOT_RUN; không tự gán PASS hoặc vượt sang consumer.

## Kết quả

Đang thực hiện. Chủ dự án xác nhận chưa có app Atlassian và yêu cầu hướng dẫn tạo; đã cung cấp console, callback và scope. Không gửi secret qua chat. Chưa có native evidence; GitHub CLI hiện chưa đăng nhập nên chưa thể tạo PR.

# 01/11/2026 · JIRA-01 · Hai Jira site đồng thời

**Task:** [JIRA-01](../tasks/JIRA-01-oauth-feasibility.md). **Base:** `f2e1f85`. **Nhánh:** `codex/jira-01-oauth-feasibility`.

Chủ dự án hoàn tất tạo site thứ hai và tự Accept app trên site đó. Probe vẫn là process đã nhận grant site đầu tiên; không restart hoặc disconnect giữa hai consent. Native callback qua guard so sánh account ID và trả report `atlassian_live`, connected true, siteCount 2, adminSiteCount 2, scopes `offline_access read:jira-work read:me write:jira-work`; identity, jiraAuthorization, permissionsRead đều true. Client đã deduplicate cloudId nên đây là hai site khác nhau trong cùng resource set, không cộng hai số đếm lịch sử.

Lưu snapshot callback trước refresh. Thực hiện hai browser refresh submissions riêng biệt, tuần tự; mỗi lần có TOKEN_ROTATION_OBSERVED và connected true. Source yêu cầu token thay thế khác token trước và `/me` khớp account hiện tại. Hai report sau refresh giữ siteCount/adminSiteCount 2. Lưu ý: refresh chỉ recheck profile/token, số site giữ snapshot của consent, không phải phép đo resources mới ở mỗi refresh.

Artifact ignored `.artifacts/jira-probe/2026-11-01-two-sites-and-two-refreshes.json` chứa ba report safe, không có token/code/state, account ID hay site ID/name/URL. Không tạo issue/comment. Core multi-site OAuth đã có bằng chứng thật; gate tổng thể vẫn NOT_COMPLETE, còn xác nhận grant model trong console, wrong-account/non-admin native case và review/CI. Không triển khai JIRA-02–11 hoặc sửa CURRENT-STATE/ROADMAP.

Không sửa source trong lượt ghi nhận này nên không chạy lại suite; lần kiểm mã gần nhất tại `841a9ad` là 443 Vitest +32 Node, không gọi đó là CI hoặc review mới. Tiếp tục giữ process/browser hiện tại khi làm các ca provider còn lại.

Đã đọc Developer Console Overview, không mở secret: Authorization type OAuth 2.0 (3LO), Access type **Account-level**, Distribution **Not sharing**. Như vậy loại grant đã có bằng chứng console, không còn chỉ suy từ câu cảnh báo consent. Chủ dự án xác nhận có tài khoản Atlassian thứ hai; chưa biết email/quyền của tài khoản đó. Cần chuẩn bị Sharing và kiểm native wrong-account/non-admin trước khi đóng các ca còn lại; chưa đổi distribution hoặc quyền người dùng.

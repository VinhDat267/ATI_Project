# 01/11/2026 · JIRA-01 · Một Jira site và refresh thật

**Task:** [JIRA-01](../tasks/JIRA-01-oauth-feasibility.md). **Nhánh:** `codex/jira-01-oauth-feasibility`. **Base:** `841a9ad`.

## Kết quả quan sát

Chủ dự án xác nhận đã bấm Accept. Đọc lại tab callback sau reload thấy CALLBACK_OBSERVED, `provenance: atlassian_live`, `connected: true`, scopes `offline_access read:jira-work read:me write:jira-work`, `siteCount: 1`, `adminSiteCount: 1`, observations identity/jiraAuthorization/permissionsRead đều true. Đây là callback/code exchange, `/me`, một resource Jira và global ADMINISTER read thật, không phải chỉ xem màn consent.

Lưu snapshot trước refresh. Sau đó bấm nút refresh hai lần riêng biệt, tuần tự; sau mỗi lần browser có TOKEN_ROTATION_OBSERVED và kết nối vẫn true. Các guard trong session yêu cầu refresh token mới khác token trước và account ID từ `/me` khớp grant hiện tại. Hai snapshot sau refresh đều giữ Jira scopes/siteCount/permissions observations. Không suy ra số lượt từ một boolean: có hai browser submissions và hai kết quả đọc riêng.

Private artifact: `.artifacts/jira-probe/2026-11-01-one-site-and-two-refreshes.json`, ignored. Không có access/refresh token, code/state, account ID, site ID/name/URL hoặc raw provider body. Bằng chứng no-site identity và hai refresh identity trước restart vẫn ở artifact khác.

## Phạm vi và bước tiếp

- Không so sánh account ID xuyên qua lần restart CSP; grant Jira hiện tại là identity anchor của process mới. Giữ process/browser này để site thứ hai được kiểm với chính identity hiện tại.
- `adminSiteCount: 1` chỉ chứng minh ADMINISTER global read trả true trên một site. Không chứng minh quyền Create Issues/Add Comments hoặc vai trò admin trong ATI/Atlassian organization.
- Chưa có site thứ hai đồng thời; chưa ghi console grant model; wrong-account và non-admin case vẫn mở. Không tạo issue/comment.
- Đã mở Atlassian Administration để chuẩn bị hướng dẫn site thứ hai; chưa tạo site, đổi billing hay chấp nhận điều khoản.
- Gate **NOT_COMPLETE**; không triển khai JIRA-02–11. Source không đổi ở phiên nghiệm thu này nên không chạy lại suite đã xanh tại `841a9ad`; không tuyên bố CI/review mới hoặc sửa CURRENT-STATE/ROADMAP.

## Chuẩn bị site thứ hai

Atlassian Administration có luồng Thêm ứng dụng → Jira nhưng màn review mặc định Standard dùng thử 7 ngày và nút Đồng ý và thêm kèm điều khoản. Không xác nhận bước đó. Mở lại [luồng Jira Free chính thức](https://www.atlassian.com/try/cloud/signup?bundle=jirasoftware&edition=free&skipBundles=true), dùng tài khoản hiện có với phương thức Google mà Atlassian xác nhận đã dùng trước đây, rồi chọn `start a new site` theo [hướng dẫn cho người đã có Jira](https://support.atlassian.com/organization-administration/docs/get-started-with-an-atlassian-organization/). URL vẫn có `edition=free`.

Đã điền tên site thử nghiệm B trong form `Your site`; UI báo tên hợp lệ, Continue enabled. Chưa bấm Continue, chưa tạo site/subscription, chưa đổi billing hay chấp nhận điều khoản. Form được giữ ở tab setup để chủ dự án tiếp tục; probe hiện tại vẫn giữ grant một site. Artifact metadata/screenshot local không được commit. Đây là setup chờ operator, không phải bằng chứng hai site đã tồn tại hoặc chứng nhận plan sau provisioning.

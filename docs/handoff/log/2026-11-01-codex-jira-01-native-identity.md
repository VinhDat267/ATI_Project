# 01/11/2026 · JIRA-01 · Danh tính Atlassian và refresh thật

**Task:** [JIRA-01](../tasks/JIRA-01-oauth-feasibility.md). **Nhánh:** `codex/jira-01-oauth-feasibility`. **Base phiên:** `dfbfa93`.

## Quan sát native

Chủ dự án tự đăng nhập/cấp quyền ở Atlassian và báo “Đã kết nối”. Đọc trang probe live sau reload thấy `CALLBACK_OBSERVED`, `provenance: atlassian_live`, `connected: true`, scopes `offline_access read:me`, `observations.identity: true`. Không có Jira scopes trong consent này. `siteCount: 0` và `adminSiteCount: 0` không phải phép đo membership vì identity flow không gọi accessible-resources.

Lưu snapshot identity trước khi thay đổi observations. Sau đó thực hiện hai lần bấm nút refresh riêng biệt, tuần tự trên cùng browser/session. Sau mỗi lần, browser trở lại trang probe với `TOKEN_ROTATION_OBSERVED`, `connected: true`, `observations.tokenRotation: true`. Guard trong session chỉ ghi nhận thành công nếu response có refresh token mới khác token trước và `/me` vẫn khớp tài khoản. Report chỉ có boolean, không có bộ đếm: bằng chứng hai lượt gồm hai thao tác browser và hai snapshot thành công, không suy ra số lượt từ một boolean.

Private artifact ignored: `.artifacts/jira-probe/2026-11-01-identity-and-two-refreshes.json`, gồm snapshot ban đầu và hai snapshot sau refresh, không chứa token, code, state, account ID hay site ID/name. Kiểm `git check-ignore` xác nhận artifact không vào Git. Không lưu raw provider response hoặc callback URL vào báo cáo công khai.

## Xác nhận chủ tài khoản và bước tiếp

Sau khi quan sát native, chủ tài khoản trả lời rõ: “Đúng, tài khoản vừa dùng chưa tham gia Jira site nào”. Ghi điều kiện **OPERATOR_ATTESTED** cho đúng tài khoản đã consent và đúng thời điểm trước khi tạo test site. Kết hợp với native `/me`, case identity-before-site đã có đủ hai loại bằng chứng; không biến attestation thành quan sát tự động của provider.

Chủ dự án trả lời hiện chưa có site thử nghiệm. Bước tiếp theo là tạo Jira Free site đầu tiên với cùng tài khoản rồi thử consent Jira; sau đó thêm site thứ hai và kiểm hai site đồng thời. Chưa tạo site hoặc đổi consent Jira trong bằng chứng của log này. Trang [đăng ký Jira Free chính thức](https://www.atlassian.com/try/cloud/signup?bundle=jirasoftware&edition=free&skipBundles=true) và [cấp app access](https://support.atlassian.com/user-management/docs/give-users-access-to-products/) là hướng dẫn setup, không phải bằng chứng các site đã tồn tại.

## Điều còn thiếu

- Chưa ghi console grant model; chưa consent Jira scopes, existing site/second simultaneous site, ADMINISTER read, Jira-grant rotation, wrong-account/denial hoặc native write.
- Gate vẫn **NOT_COMPLETE**; không bắt đầu JIRA-02–11. Không đổi runtime API/web/planner/executor, schema hoặc flags trong phần nghiệm thu này.

## Kiểm tra và phạm vi

Đây là bằng chứng endpoint/browser thật, không phải fixture hoặc tuyên bố CI. Không sửa mã nên không chạy lại package suite; mốc kiểm mã gần nhất vẫn 443 Vitest +32 Node tại lần sửa browser 31/10. Chỉ cập nhật facts/card/log; không sửa CURRENT-STATE/ROADMAP hoặc nâng verdict review cũ.

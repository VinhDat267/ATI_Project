# 01/11/2026 · JIRA-01 · Host màn consent Jira

**Task:** [JIRA-01](../tasks/JIRA-01-oauth-feasibility.md). **Nhánh:** `codex/jira-01-oauth-feasibility`. **Base:** `a4da281`.

## Root cause và sửa

Chủ dự án gửi ảnh Jira site truy cập được, hỏi cách tiếp tục. Trang probe có identity/refresh evidence đã lưu. Bấm flow Jira tạo pending state thật nhưng browser vẫn ở trang local; reload thấy observations reset và connected false, xác nhận start đã xử lý. CSP form-action chỉ cho self, auth.atlassian.com và id.atlassian.com nên thiếu đích consent.

Một tab chẩn đoán dùng public OAuth authorization parameters và state không thuộc session chỉ để xem đích điều hướng; không bấm Accept, đóng ngay sau quan sát. Đích thật là `https://api.atlassian.com/oauth2/authorize/server/consent`. UI hiển thị đúng app development, một site cài đặt, Jira View/Update và User View me. Không lưu tenant URL, account ID, state/code/token hoặc raw callback URL vào tài liệu công khai.

Regression CSP kỳ vọng đúng host consent: **0 pass/1 fail** trước sửa. Thêm chính xác `https://api.atlassian.com` vào allowlist live, không wildcard; fixture chỉ loopback, API client endpoints, Origin/cookie/state guards và callback cleanup không đổi. Sau restart, native form đi tới consent thật: browser GREEN. Dừng đúng PID probe sau khi kiểm command line; API/web/database không bị restart bởi bản sửa này.

## Native denial và phiên mới

Restart bỏ memory grant/account binding của diagnostic runner. Bằng chứng no-site identity và hai refresh trước đó vẫn ở artifact riêng; không coi đó là grant đang hoạt động trong process mới. Một identity consent mới được Cancel: browser về root với CONSENT_DENIED, connected false, không trao đổi code thành kết nối. Đây là denial quan sát thật trong phiên mới vốn chưa có grant local; không khẳng định revoke grant cũ tại Atlassian.

Sau đó mở flow Jira thật với state thuộc session mới, thấy đúng site mà chủ dự án hiển thị và các quyền đã chốt. Đang chờ chủ dự án tự Accept vì đây là cấp quyền Jira mới. Chưa có callback Jira thành công, accessible-resources, ADMINISTER read hay refresh Jira. Các ca nhiều site phải tiếp tục trong cùng session mới để kiểm ràng buộc account; không tuyên bố so sánh account ID xuyên qua lần restart.

## Bằng chứng và giới hạn

- `RUNTIME_MODE=sandbox npm test -w @wap/tool-adapters`: **18 Vitest files /443 tests +32 Node tests PASS, exit 0**.
- `node --check` server và `git diff --check`: exit 0.
- Native browser: consent preview tới host thật, consent denial về report an toàn, mở được Jira consent bằng form sau sửa. Scope preview chưa là quyền đã cấp.
- Artifact an toàn mới nằm dưới `.artifacts/jira-probe/`, ignored; không chứa credentials hoặc danh tính/site cụ thể.
- Chưa review độc lập delta CSP này, chưa CI/push/PR/merge; giữ nguyên giới hạn review trước. Gate **NOT_COMPLETE**, không sửa CURRENT-STATE/ROADMAP hoặc triển khai JIRA-02–11.

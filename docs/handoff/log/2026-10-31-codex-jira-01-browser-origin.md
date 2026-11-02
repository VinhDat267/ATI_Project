# 31/10/2026 · JIRA-01 · Khởi động OAuth bằng trình duyệt

**Task:** [JIRA-01](../tasks/JIRA-01-oauth-feasibility.md). **Nhánh:** `codex/jira-01-oauth-feasibility`. **Base phiên:** `21d73f0`.

Chủ dự án xác nhận đã thay secret và lưu cấu hình local. `--check-config` hiện PASS, exit 0; không in giá trị, file vẫn ignored. Chủ dự án xác nhận có tài khoản Atlassian chưa thuộc Jira site và sẽ dùng cho lượt identity-only; chưa coi đó là bằng chứng tài khoản đã consent thành công.

## Hai lỗi thực tế và bằng chứng sửa

1. Browser submit form nhận `ORIGIN_MISMATCH`. Instrumentation tạm trong memory chỉ ghi loại Origin và boolean khớp localhost, quan sát `kind: null, matchesLocal: false`. Header `no-referrer` gây Origin null với native form POST theo [Fetch Standard](https://fetch.spec.whatwg.org/#append-a-request-origin-header). Test boundary mới kỳ vọng policy phù hợp với form: trước sửa 1 pass/1 fail. Trang GET `/` đổi sang `same-origin`; callback/redirect vẫn `no-referrer`, POST vẫn yêu cầu Origin chính xác, null/missing/foreign Origin đều bị chặn. Sau sửa instrumentation xác nhận POST Origin khớp và trả 303 tới auth host.
2. Browser vẫn ở trang local vì CSP form-action chỉ cho auth host, thiếu login host mà provider redirect tới. HTTP diagnostic không cookie/code dùng state không thuộc session, chỉ in status/hostname/path: 302 tới `id.atlassian.com/login`. Regression trước sửa 0 pass/1 fail. CSP live thêm đúng host này, không dùng wildcard; fixture vẫn chỉ loopback. Browser sau sửa hiển thị **Log in with Atlassian account**. Không ghi authorization URL/query, callback code, tài khoản hay secret vào tài liệu.

Các diagnostic wrapper chỉ tồn tại trong process, không sửa client/provider endpoints và đã dừng trước runner clean cuối. Runner clean vẫn chạy trên loopback để chủ dự án tự đăng nhập/consent; token chỉ ở memory. Không tạo issue/comment.

## Kiểm tra cuối

- `RUNTIME_MODE=sandbox npm test -w @wap/tool-adapters`: **18 Vitest files /443 tests +32 Node tests PASS, exit 0**.
- `node --check packages/tool-adapters/scripts/jira-probe/server.mjs` và `git diff --check`: exit 0.
- Browser: form failure trước sửa; Origin đúng sau sửa thứ nhất; đến màn đăng nhập thật sau sửa thứ hai. Đây là bằng chứng khởi động OAuth, không phải `/me`/refresh/multi-site acceptance.
- Delta này chưa review độc lập, chưa CI/push/PR/merge; không thay verdict review cũ. Không sửa CURRENT-STATE/ROADMAP, API/web/runtime, migration hoặc feature flags.

## Tiếp tục

Chủ dự án tự đăng nhập/cấp quyền trong cùng tab đang giữ cookie. State hết hạn sau 10 phút; nếu quá hạn, quay trang local và bắt đầu identity flow mới. Chưa quan sát token exchange, `/me`, quyền site hoặc rotation. Gate vẫn **NOT_COMPLETE**, không bắt đầu JIRA-02–11.

# 2026-10-04 · AUTH-02 · đăng ký, xác minh email và đặt lại mật khẩu

- Base: `32121818f75c2a7eacd50118d44b19de98ce5779`, worktree `C:/Users/VinhDat/.codex/worktrees/auth-02-signup-email/ATI_Project`, nhánh `vinhdat/feat-auth-02-signup-email`.
- Commit code: backend `99b539c5315c4ea4aead14a280cec87d3ed947cd`; frontend/browser + regression HTTP `9cefe3ecd249d721640309c660f9e5c8ae5c0115`.
- Phạm vi: chỉ AUTH-02. Không sửa v2, `CURRENT-STATE.md`, `ROADMAP.md`, credentials riêng hoặc DB người dùng. Không push/mở PR/merge trong phiên thi công. AUTH-03 và FE-03 làm trên worktree khác; root tích hợp shared files.

## Hành vi và interface

- Đăng ký tạo `pending`, chưa xác minh; trùng email trả cùng HTTP/body và gửi thông báo đến email đó. Xác minh giữ `pending`, gửi cho admin `active`. Quên mật khẩu không tiết lộ email tồn tại; reset hỗ trợ tài khoản chỉ Google và đánh dấu đã xác minh.
- `auth_tokens` chỉ giữ SHA-256; verification 24 giờ, reset 30 phút. Cấp token mới khóa hàng user, vô hiệu token trước cùng mục đích. Tiêu thụ token dùng SQL `used_at IS NULL AND expires_at > ...` trong transaction, cùng cập nhật user và thu hồi phiên khi reset.
- `SessionRepo.create(userId, userAgent, now?, expectedPasswordHash?)` dùng `FOR UPDATE`, kiểm lại status và hash password dưới khóa. Caller login truyền hash đã xác thực; `InvalidSessionUserError` trả 401 chung, không lộ hash. AUTH-03 dùng chung bảo vệ này khi disable tài khoản.
- `services/email/index.ts`: `EmailMessage { to, subject, text, html }`, `EmailSender.send(message): Promise<void>`, `SmtpEmailSender`, `OutboxEmailSender`, `createEmailSender`, `sendEmailSafely`, `approvalEmail(to,name)`. AUTH-03 inject `AppOptions.emailSender` và gửi approval sau transaction. Lỗi sender chỉ log thông báo chung, không log lỗi provider/link/token.
- `validateEnv` yêu cầu SMTP + web origin trong live; sandbox/CI dùng outbox. SMTP465 dùng TLS ngay từ đầu; các cổng khác bắt buộc STARTTLS. Các mẫu tiếng Việt có HTML escape và link được encode. Đăng ký mặc định **false** đến khi AUTH-03 cùng có mặt.
- Bốn view theo LoginView hiện có; thêm resend trong VerifyEmailView. Hỗ trợ route theo path và email link `/?view=...&token=...`. Token chỉ trong bộ nhớ route, xóa bằng `replaceState` trong layout effect, không lưu history state/localStorage. StrictMode tái dùng request xác minh; reset về login và xóa phiên cục bộ. `index.html` đặt referrer `no-referrer`.

## Bằng chứng

Container focused test riêng: `ati-auth02-focused-20261004`, id `7cb2ff83e0ab0649737bf388021307b2407fab8266dabe9d781eb4d7bfccf1ff`, label `ati.task=AUTH-02`, tmpfs `/var/lib/postgresql/data`, loopback **61110**. DB ban đầu `ati_auth02`; suite cũ yêu cầu tên `ati_v3`, nên tạo thêm `ati_v3` trong chính container đó, migrate 0001–0005. Không dùng 15433/55533 hoặc cổng API/web chung.

Bằng chứng chỉ lưu cục bộ: `C:/Users/VinhDat/.codex/visualizations/2026/10/04/auth02-auth03-fe03/AUTH02/`.

- RED: `auth02-red-api.log` 13 fail (missing endpoint/table); `auth02-red-config-corrected.log` 3 config fail sau khi sửa fixture encryption key sai độ dài; `auth02-red-email.log` và `auth02-red-html-link.log`; `auth02-red-web.log` 5 fail; `auth02-red-stale-login.log` repo tạo được phiên từ password cũ; `auth02-red-stale-http.log` caller login trước sửa trả 200 thay vì 401. Sau probe caller cũ, source hiện tại được khôi phục ngay.
- GREEN: `auth02-green-api.log` 20/20 backend/email; `auth02-green-backend-checkpoint.log` 69/69 auth + config; `auth02-green-stale-http.log` 1/1 regression HTTP; `auth02-green-web.log` 5/5 giao diện. Web workspace đầy đủ 189/189 pass trong cả hai lần chạy workspace.
- Typecheck API/web và `git diff --check`: exit 0 trên code cuối.
- Root chạy `npm run check` tại `99b539c`: exit 0, 983 v3 + 165 evaluation offline, typecheck/build/credential scan/launcher/env guards đạt. Không gán số liệu checkpoint này cho head frontend cuối.
- Lần rộng đầu dùng `npx vitest` ở root thiếu cấu hình jsdom workspace và public schema chưa migrate: không phải bằng chứng sản phẩm. Lần workspace đầu API216 pass/7skip, lỗi tên DB. Sau sửa setup DB, API218 pass/5fail; năm ca timeout: `auth-sessions` CLI provisioning; `memory-execution-snapshot` default/partial_failure; `startup-reconciliation` chờ reconciliation và giữ completed plan. Không bỏ qua hoặc sửa timeout; root chạy canonical tuần tự sau tích hợp cuối.

## Còn mở khi bàn giao

- Browser AUTH-02 **NOT_RUN** tại worktree này theo lịch cổng root. Đã thêm `auth-02-signup-reset.spec.ts` (2 ca), scenario `auth02` mở cờ riêng. Luồng chính đọc outbox thật, xác minh/pending, ưu tiên approve qua AUTH-03; standalone cho phép DB approval chỉ khi route chưa có (404). Kiểm reset/revoke hai phiên, mật khẩu cũ bị từ chối, token dùng lại bị từ chối và header referrer không tồn tại. Ca cờ đóng chỉ kiểm UI theo response config được chặn trong browser; API403 cờ đóng đã có test HTTP thật riêng.
- Canonical check trên head cuối, browser toàn bộ, review độc lập, CI, PR và merge **OPEN** do root thực hiện. Không gọi SMTP hoặc provider/service thật; không tuyên bố production readiness.
- Container focused chưa dọn tại bàn giao để reviewer có thể lặp lại probe; root được cung cấp chính xác identity/port để dọn sau verification nếu không còn cần.

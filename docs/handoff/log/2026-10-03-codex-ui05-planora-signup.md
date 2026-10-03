# UI-05 · Planora, trang công khai và đăng ký

Ngày03/10/2026 · nhánh `Frontend_UXUI` · base/HEAD `995f5f7`.
Thi công xong tại working tree, chưa commit/PR/push/deploy; chờ reviewer. Đây là phần tiếp theo chủ dự án yêu cầu, không tự đóng AUTH-01→06.

## Phạm vi đã thực hiện

- Tên hiển thị/avatar/logo/favicon/title/copy Planora. ATI chỉ credit môn học; không rename package/database/historical docs. Logo SVG P và nét định hướng dùng chung, không thư viện/ảnh sinh mới.
- LoginStory bỏ workflow/tab lặp homepage, thay illustration các lớp giấy, copy ngắn; giữ cream/forest/serif và form thật. Mobile ưu tiên form.
- PublicServices GitHub/Trello/Slack khớp catalog thực; vignette có nhãn VÍ DỤ, không connected/status giả. Navbar `#services` tách `#ecosystem`, CTA quản lý services qua auth, direct fragment sau React mount hoạt động. Hero360/float/thickness/marquee/how-story giữ nguyên.
- PublicFooter chung landing/login/signup/verify với wordmark, hai dòng editorial, links thật và course credit, desktop3cột/mobile1cột.
- Signup lazy + verify lazy; email/password/name/confirm, pending/errors/resend, password bị xóa sau success. Token email xóa khỏi URL; StrictMode không gọi verify hai lần. Auth switch giữ next/c/section và về đầu trang.
- API PostgreSQL thật: pending/unverified/member → verify24h → admin approve. Duplicate signup202 cùng body. PBKDF2 password; email/refresh token SHA256. SMTP TLS live/nodemailer và outbox sandbox/CI; live thiếu SMTP/HTTPS fail closed. `.env.example` đã bổ sung.
- Session UUID/access15m/opaque refresh7d; atomic rotation, grace30s, retained history phát hiện token replay sau nhiều vòng. Middleware đối chiếu active/verified/valid session; logout/logout-all thu hồi server. Client chờ ngắn bản cập nhật localStorage từ tab thắng, không xóa phiên tab đó khi nhận409 cạnh tranh. CLI provision admin active/verified, đổi password thu hồi phiên cũ; env admin IDs tương thích.
- Settings approval chỉ admin: danh sách20/page, tìm tên/email, loading/error/retry/empty, unverified không duyệt, xác nhận quyền dịch vụ chung; server UPDATE pending/verified là quyết định cuối. Stable modal callback giữ focus, lỗi duyệt không xóa danh sách.

## File của UI-05

- Frontend: `apps/chat-web/src/{App.tsx,types.ts,login.css,public-details.css,settings.css,services/api-client.ts}`, Brand/LandingPageView/LoginView/LoginStory/PublicFooter/PublicServices/SignupView/VerifyEmailView, views/AccountApproval/AccountSettingsView; các nhãn hiển thị trong workspace/services/message/error boundary; `index.html`, `public/favicon.svg`, DESIGN và tests tương ứng.
- Backend: auth/accounts/rate-limit/jwt, routes/auth/* và re-export auth-routes, email/sender, app/server/UserRepo/provision-user/services admin permission; migrations0004/0005; integration signup/auth boundaries và startup fixture dùng sid/active/verified.
- `apps/chat-api/package.json`, lock: chỉ nodemailer/@types (được AUTH-common cho phép). `.env.example`, `scripts/start-v3.test.mjs` title expectation đổi Planora. Task card và log này.
- Dirty changes hội thoại/sidebar/recovery/migration0003/logs UI-01→04 đã có từ các lượt trước, được giữ, không gộp mô tả thành phát sinh UI-05. Không sửa v2/CURRENT-STATE/ROADMAP.

## Bằng chứng

PostgreSQL local55533; integration tạo schema UUID riêng và teardown riêng, không dùng provider credentials.
Signup RED6fails → GREEN9/9; không test boolean hình thức. Verify/approve/refresh cạnh tranh chạy HTTP + query thật. Expired/wrong-purpose tokens không đổi account; replay sau grace và sau nhiều rotation thu hồi; logout-all/disabled gate/migration rerun được kiểm.

`npm run check` ngày03/10/2026 lúc23:13 exit0:

| Stage | Kết quả |
|---|---|
| typecheck API/web | exit0 |
| tool-schemas | 11 tests |
| tool-adapters | 53 tests |
| planner | 128 tests |
| executor | 25 tests |
| chat-api | 24 files / 165 tests |
| chat-web lúc full check | 37 files / 202 tests |
| evaluations offline | 5 files / 66 tests |
| production build | exit0, auth/settings/services split chunks |
| launcher + local-env safety | 1 + 3 tests |

Sau check toàn bộ, sửa client delayed cross-tab refresh và reset auth scroll đã quan sát trên browser: frontend cuối37files/203tests, typecheck/build exit0. Thay CSS email mobile tiếp tục build exit0. `git diff --check` exit0. Launcher ban đầu fail vì title ATI cũ; sửa assertion chính xác Planora, chạy lại đã pass. Vitest sandbox đầu bị EPERM spawn; chạy trong execution profile cho phép subprocess rồi đạt, không có mock thay cho kiểm thử.

Browser CUA, preview riêng5176/API3006, schema `ui_lifecycle_preview_20261003`:

- Desktop1440×900, mobile390×844 và auth320×740; DOM widths không tràn. Form mobile trước editorial; email dài trong approval đủ rộng.
- Verify fixture bằng URL outbox: success, token biến khỏi URL; đăng nhập fixture pending trả chờ duyệt, không workspace. Đăng nhập admin fixture hiện admin section; mở confirm, Escape đóng/trả focus; logout về landing. Không nhập password mới qua browser; signup submit kiểm bằng API integration/frontend tests. Không bấm cấp quyền cuối qua browser; integration duyệt thật fixture.
- Footer/services link mở đúng `#services` với top32px desktop; CTA giữ next=services. Footer keyboard focus/links hoạt động, không overflow. Existing hero/marquee/story được giữ; unit hooks/frontend regression pass. Reduced-motion CSS/hook tests, chưa browser media emulation/touch hardware thực hoặc browser E2E launcher đầy đủ.
- Không email thật, không API ghi GitHub/Trello/Slack, không sửa cấu hình dịch vụ. Outbox và fixtures chỉ preview schema.

Ảnh nằm ngoài repository:
`C:/Users/Admin/.codex/visualizations/2026/10/02/01a0faf0-f9b9-7432-89ab-cfec274816e2/ati-implementation/`

`planora-login-desktop.png`, `planora-signup-desktop.png`, `planora-signup-mobile.png`, `planora-login-320.png`, `planora-signup-320.png`, `planora-services-desktop.png`, `planora-footer-desktop.png`, `planora-verification-desktop.png`, `planora-pending-login.png`, `planora-approval-desktop.png`, `planora-approval-mobile.png`. Private fixture config/token/password không đưa vào repo/log/final.

## Cấu hình và giới hạn

- Apply migration0004/0005 trước API mới; access/refresh cũ không có DB session sẽ yêu cầu login lại. Provision admin bằng CLI hoặc SERVICE_ADMIN_USER_IDS của nhóm; không seed tài khoản mặc định.
- Sandbox PostgreSQL gửi vào email_outbox. Live cần SMTP_HOST/PORT/USER/PASSWORD, MAIL_FROM, APP_BASE_URL HTTPS. Gmail App Password cấu hình riêng; chưa kiểm email live thực. Preview URL5176 khác phiên cũ5175 và không tự chuyển môi trường thành live.
- Rate limits in-memory theo process, không chia sẻ replica/restart; chưa cleanup định kỳ token/session/history, chưa audit DB admin toàn bộ. Không tuyên bố production auth hoàn tất.
- Chưa Google/reset/self-service change password/edit profile/admin disable-enable-role. Logout-all có API, chưa nút riêng. New service Sheets/Calendar/Notion/Telegram/Jira vẫn roadmap; resource labels/pagination/rename/pin lịch sử vẫn FE backlog.
- Review riêng theo checklist và CI trước merge; không sửa trạng thái task AUTH chung hoặc CURRENT-STATE/ROADMAP.

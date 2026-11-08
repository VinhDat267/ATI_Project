# FLOW-07 — P2 thông báo Gmail API chưa bật

- Ngày: 06/11/2026, Asia/Bangkok. Task: [FLOW-07](../tasks/FLOW-07-live-acceptance.md).
- Nhánh: `fix/gmail-post-consent`; base `6e2d3bb9b922c83cc2554b12e198b867513d239d`.
- Phạm vi: sửa mất nguyên nhân lỗi Gmail profile ở backend và hướng dẫn xử lý trên callback UI. Giữ nguyên checkout có thay đổi của agent khác, không sửa CURRENT-STATE/ROADMAP hoặc cấu hình live.

## Hành vi

- `GmailOAuthError` giữ duy nhất reason allowlist `SERVICE_DISABLED`, chuẩn hóa từ HTTP 403 có Google ErrorInfo đúng type/domain hoặc legacy `accessNotConfigured`. Không giữ message, metadata, raw provider body hoặc secret.
- Callback Gmail chỉ đổi lỗi này ở bước profile thành HTTP 400 `GMAIL_API_DISABLED`; UI yêu cầu nhờ quản trị viên bật Gmail API trên Google Cloud, sau đó bắt đầu kết nối mới.
- Các lỗi 401/403 khác, 503, cấu trúc lỗi bất thường vẫn giữ hành vi chung. Không đổi `kind` hiện có của OAuth error; Calendar/Sheets/token manager tiếp tục tương thích.
- Cập nhật hợp đồng tại `GMAIL-common.md`. Không đổi state/session/browser binding/PKCE, lưu credential, thu hồi grant hoặc tự replay callback.

## Bằng chứng

- RED API: **4 FAIL / 32 PASS**; hai ca route vẫn trả `GMAIL_CONNECT_FAILED`, hai ca client không giữ reason. Fixture HTTP thật và PostgreSQL riêng.
- RED web: **1 FAIL / 23 PASS**; UI vẫn hiển thị thông báo kết nối chung.
- RED browser: bỏ riêng mapper mới rồi chạy Chromium desktop/mobile, **2 FAIL** đúng thông báo thiếu hướng dẫn admin; khôi phục mapper bằng byte gốc trong finally.
- GREEN API liên quan: **6 file / 89 PASS**, exit 0, gồm Gmail routes/errors/token manager, project revocation, MyCalendar routes và MySheets backend.
- GREEN web liên quan: **3 file / 51 PASS**, exit 0; callback mới có hướng về Settings, không gửi lại callback và không lộ code/state.
- `npm run typecheck:v3`: PASS, exit 0.
- GREEN Chromium Gmail: **12/12 PASS**, exit 0, gồm hai ca thông báo mới ở 1440/375 px và các luồng OAuth/preview/receipt/disconnect/return-to-chat hiện có. Ảnh mới đã được kiểm tra trực quan, không tràn ngang.
- Review độc lập: không có P1/P2/P3 mới trong phạm vi P2; API **44 PASS**, web **65 PASS**, matrix HTTP **17 PASS**, typecheck và diff check PASS. Countercheck đọc source baseline trong bộ nhớ xác nhận hai định dạng lỗi chưa được phân loại trước bản vá; không mutate file của checkout.
- Tổng kiểm tra `DATABASE_URL=<isolated PostgreSQL> VITEST_MAX_WORKERS=2 npm run check`: **PASS, exit 0**. Schemas **579**, adapters **636**, planner **547**, executor **55**, API **2.480**, web **1.188** test PASS; evaluations **500 PASS / 1 preflight chủ động SKIP**. Typecheck, build, web build security, adapter probe, launcher và Node checks đều PASS.
- Bộ web có stderr JSDOM chưa hỗ trợ điều hướng từ test Slack hiện có; không có test thất bại. Hành trình Gmail trên Chromium được xác nhận riêng ở trên.

## Giới hạn

- Các ca provider trong kiểm thử là HTTP fixture loopback; DB là PostgreSQL riêng. Browser lỗi mới dùng response fixture tại ranh giới API/UI, không được mô tả là real Google consent.
- P1 cấu hình API đã được người vận hành cho phép xử lý trên Console trong phiên trước; bằng chứng riêng không chứa credential giữ ở artifact cục bộ. **Consent Google thật sau thay đổi, workflow gửi thư/readback: NOT_RUN**.
- P1 project Google dùng chung và chính sách thu hồi grant vẫn OPEN, không thuộc bản vá P2. FLOW-07 vẫn OPEN.
- Artifact riêng: `.audit/gmail-post-consent/p2-*.log` và ảnh Chromium; không commit cấu hình live, thông tin tài khoản hoặc OAuth inputs thật.

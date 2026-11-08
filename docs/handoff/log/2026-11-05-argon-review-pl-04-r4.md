# Báo cáo Review Độc lập — PL-04 (Round 4: Refactor Business-First UX v2.0)

- **Reviewer:** Antigravity / Gemini 4 Argon (High); model ID `gemini-4-argon-high`
- **Ngày review:** 05/11/2026 (thực chạy 07/11/2026)
- **Task:** [PL-04 · Xác thực nâng cao và vòng đời tài khoản (Advanced Auth)](../tasks/PL-04-planora-auth-lifecycle.md)
- **UX Task:** `docs/handoff/tasks/PLANORA-UX-01-business-first-redesign.md`
- **PR_URL hoặc LOCAL_ONLY:** `LOCAL_ONLY`
- **Target Branch:** `longnguyen005/feat-planora-pl-04` (target tích hợp: `codex/planora-ui`)
- **Cumulative PL-04 Base SHA:** `6143de9ab0181abfbdc68a9867d2bb18e2c021e5` (sau khi merge PL-03 accepted base)
- **Round 4 Base SHA:** `1023889bfae5a223c653e040506b8ad1d79a4ae4`
- **Reviewed Head SHA:** `8520e0a9b0cb1e16f4e9c27209443edbdcadc187`
- **Worktree review:** `C:\Users\Admin\orca\workspaces\ATI_Project\review-planora-pl-04-r4` (branch `longnguyen005/review-planora-pl-04-r4`)

---

## 1. Xác minh Git, Head SHA & Phạm vi File

- `git rev-parse HEAD` và `git rev-parse longnguyen005/feat-planora-pl-04` đều khớp chính xác SHA 40 ký tự: `8520e0a9b0cb1e16f4e9c27209443edbdcadc187`.
- Diff của Round 4 (`1023889bfae5a223c653e040506b8ad1d79a4ae4..8520e0a9b0cb1e16f4e9c27209443edbdcadc187`) gồm 5 files (`+379 / -52`):
  1. `apps/chat-web/src/pages/AuthAction/AuthActionPage.tsx`
  2. `apps/chat-web/src/pages/AuthAction/page.css`
  3. `apps/chat-web/tests/planora-auth-lifecycle.test.tsx`
  4. `docs/handoff/tasks/PL-04-planora-auth-lifecycle.md`
  5. `docs/handoff/log/2026-11-07-gemini-pl-04-business-first-refactor.md`
- Diff tích lũy của PL-04 so với accepted base PL-03 (`6143de9ab0181abfbdc68a9867d2bb18e2c021e5..8520e0a9b0cb1e16f4e9c27209443edbdcadc187`) gồm 12 files trong đúng phạm vi cho phép (`apps/chat-web/`, `scripts/test-v3-browser.mjs`, `docs/handoff/`).
- Không có thay đổi trái phép sang `apps/chat-api`, `packages/*`, `db/v3`, `prompts`, `evaluations`, `CURRENT-STATE.md` hay `ROADMAP.md`.

---

## 2. Kiểm tra Trọng tâm theo Design Brief v2.0 (MẪU 1) & Business-First UX

### 2.1. Ngôn ngữ Công việc trên Toàn bộ 13 Trạng thái `AuthAction` (`AuthActionPage.tsx:318-1587`)
- **Chuyển ngữ tiếng Việt tự nhiên & sạch rác kỹ thuật (GATE-04):**
  - Toàn bộ 13 chế độ của `AuthActionMode` (`loading`, `verify-success`, `verify-expired`, `verify-used`, `reset-password`, `reset-success`, `google-pending`, `google-ready`, `google-error`, `blocked-pending`, `blocked-locked`, `blocked-attempts`, `email-not-verified`) đều được hiển thị bằng tiêu đề serif editorial, lời giải thích dễ hiểu và nút hành động (CTA) rõ bước tiếp theo:
    - `verify-success`: *"Email của bạn đã được xác minh"* — giải thích tiến trình 2 bước và CTA `Về trang chủ Planora` (`/`) / `Thử đăng nhập lại` (`/login`).
    - `verify-expired`: *"Link xác minh không còn hiệu lực"* — giải thích giới hạn hiệu lực 24 giờ và form yêu cầu gửi lại tới email cụ thể kèm nút `Gửi lại link xác minh mới`.
    - `email-not-verified`: *"Tài khoản đang chờ duyệt"* (`Bạn cần xác minh địa chỉ email`) — hiển thị địa chỉ email cần xác minh và form `Gửi lại link xác minh mới`.
    - `verify-used`: *"Link này đã được sử dụng"* — giải thích email đã được xác minh trước đó, trạng thái tài khoản và CTA `Đăng nhập hoặc về trang chủ`.
    - `reset-password`: *"Tạo mật khẩu mới"* — hiển thị tài khoản email, thước đo độ mạnh 4 mức, kiểm tra khớp mật khẩu và CTA `Cập nhật mật khẩu`.
    - `reset-success`: *"Mật khẩu đã được thay đổi"* — giải thích các thiết bị cũ đã được đăng xuất an toàn và CTA `Đăng nhập ngay`.
    - `google-pending` / `google-ready` / `google-error`: hiển thị rõ trạng thái chờ quản trị viên duyệt, đang vào không gian làm việc, hoặc lỗi kết nối Google kèm 3 lựa chọn hành động và CTA `Thử lại với Google` / `Đăng nhập bằng Email & Mật khẩu`.
    - `blocked-pending` / `blocked-locked` / `blocked-attempts`: giải thích rõ quy trình bảo vệ không gian làm việc (3 bước đánh số 1 - 2 - 3), lý do tạm khóa bởi quản trị viên (`Đăng nhập bằng tài khoản khác`), hoặc bộ đếm ngược tự mở khóa sau 5 lần nhập sai mật khẩu kèm lối tắt `Đặt lại mật khẩu mới qua email`.
  - Tuyệt đối không phơi bày mã enum `AuthActionMode`, tên tham số URL kỹ thuật (`oobCode`, `apiKey`), UUID, token hay thông báo *"liên kết đăng nhập / magic link"* hoặc *"Mở ứng dụng thư"* không tồn tại trong contract backend.
  - Cập nhật copy chân trang chuẩn Business-First (`AuthActionPage.tsx:1593-1595`): *"Planora — Nền tảng điều phối công việc liên dịch vụ · 2026 · Xác thực tài khoản và phân quyền quản trị"* (loại bỏ cụm *"luồng làm việc AI"*).

### 2.2. Vector Input Icons, Chữ ký Planora & Chuẩn Trợ năng (`AuthActionPage.tsx:71-124`, `page.css:244-276`)
- **Vector Input Icons tự host:**
  - Bổ sung `mailInputIcon` (`.planora-auth-input-icon`, `aria-hidden="true"`) và class `.has-icon-left` (`padding-left: 42px`) cho ô nhập `#resend-email-input` trong cả hai chế độ `verify-expired` (`AuthActionPage.tsx:467-481`) và `email-not-verified` (`AuthActionPage.tsx:591-605`).
  - Bổ sung `lockInputIcon` (`.planora-auth-input-icon`, `aria-hidden="true"`) và class `.has-icon-left` cho cả hai ô `#new-password-input` (`AuthActionPage.tsx:776-791`) và `#confirm-password-input` (`AuthActionPage.tsx:837-852`) trong chế độ `reset-password`, đồng thời giữ `paddingRight: 48` cho nút ẩn/hiện mật khẩu (`.planora-auth-password-toggle` rộng `44x44px`).
- **Chữ ký thương hiệu Planora (`.planora-auth-endnote`):**
  - Hiển thị nhất quán khối chữ ký `.planora-auth-endnote` (*"Một lời nhắn. Một khởi đầu nhẹ nhàng."*) kèm icon vector SVG (`aria-hidden="true"`) ở cuối cả 12 màn hình hành động/trạng thái xác thực (đồng bộ với form Đăng nhập / Đăng ký của PL-03).
- **Loại bỏ Emoji trần & Chuẩn hóa `aria-hidden="true"`:**
  - Xóa bỏ ký tự emoji đồng hồ cát `⏳` tại bước 2 trong màn hình `blocked-pending` (`AuthActionPage.tsx:1336-1338`), thay bằng huy hiệu số `2` đồng bộ chuỗi bước `1` - `2` - `3`.
  - Toàn bộ 35 thẻ `<svg>` trong `AuthActionPage.tsx` (gồm cả `#icon-eye-new`, `#icon-eye-confirm`, `spinner`, `mailInputIcon`, `lockInputIcon`, `signatureEndnote` và các icon trạng thái) đều được gắn `aria-hidden="true"` tường minh.

### 2.3. Tương phản WCAG AA (GATE-03) & Responsive / Containment (GATE-07)
- **Tương phản WCAG AA:**
  - Nút hành động chính `.planora-auth-submit` (`auth.css:458-459`) và huy hiệu `.planora-timeline-badge.done` (`page.css:128-129`) sử dụng `background-color: var(--planora-primary)` và `color: var(--planora-on-primary)` (`#fffdf7` trên `#3c5741` = **7.80:1** ở Light mode; `#132014` trên `#8fb68e` = **7.91:1** ở Dark mode — không dùng chữ trắng ở Dark mode).
- **Bảo toàn các bản sửa F1–F3 & R1 từ Vòng 1–3:**
  - Giữ nguyên containment `.user-email-placeholder.break-all` cho email hợp lệ dài 141 ký tự, tap target `>= 44x44px` trên 2 link footer (`.planora-auth-footer-link`), và Playwright strict locator scoped vào `.planora-auth-footer`.

### 2.4. Bảo toàn 100% Nghiệp vụ & Hợp đồng Kỹ thuật (`VerifyEmailView.tsx`, `ResetPasswordView.tsx`, `GoogleCallbackView.tsx`, `AuthGate.tsx`)
- **Xác thực Email (`VerifyEmailView.tsx`):** Gọi `apiClient.verifyEmail(token)` đúng 1 lần theo ref `verification.current`, lưu token + đặt `setActiveWorkspaceId('personal')` khi trả về phiên đăng nhập, hoặc chuyển sang `verify-expired` khi token thiếu/hết hạn.
- **Đặt lại mật khẩu (`ResetPasswordView.tsx`):** Kiểm tra độ dài `12..128` ký tự và khớp mật khẩu xác nhận trước khi gọi `apiClient.resetPassword(token, password)`; xóa token lưu trữ nếu cùng phiên chủ sở hữu và chuyển sang `reset-success`.
- **Google OAuth Callback (`GoogleCallbackView.tsx`):** Bảo toàn `completion.current ??= apiClient.completeGoogleAuth(callback.code, callback.state)` chống gọi kép trong React `StrictMode`; bảo toàn `ownsLiveSession()` + listener `subscribeAuthTokens` / `storage` chặn phản hồi trễ ghi đè lên phiên mới hoặc sau khi logout; điều hướng an toàn về `consumeAuthReturnTarget(data.user.id) ?? '/'` với `replace = true` (gỡ `code`/`state` khỏi URL).
- **Khóa đăng nhập tạm thời (`AuthGate.tsx:134-146` & `AuthActionPage.tsx:240-249, 299-310`):** Tính `deadline` từ header `Retry-After` của HTTP 429 và đếm ngược chính xác theo thời gian thực (`#blocked-timer-display`, `#blocked-timer-bar`).

---

## 3. Kết quả Chạy Lệnh Kiểm thử & Kiểm chứng Mutation

### 3.1. Bảng lệnh kiểm thử thực tế tại worktree review

| Lệnh kiểm thử | Exit Code | Kết quả | Chi tiết |
| :--- | :---: | :---: | :--- |
| `npm run typecheck:v3` | `0` | **PASS** | `tsc -p apps/chat-api/tsconfig.json --noEmit && tsc -p apps/chat-web/tsconfig.json --noEmit` (0 lỗi) |
| `npm test -w @wap/chat-web -- tests/planora-auth-lifecycle.test.tsx` | `0` | **PASS** | `1 passed (1)`, `28 passed (28)` (`488ms`) |
| `npm test -w @wap/chat-web -- tests/auth-google.test.tsx` | `0` | **PASS** | `1 passed (1)`, `43 passed (43)` (`6338ms`) |
| `npm test -w @wap/chat-web -- tests/auth-signup-reset.test.tsx` | `0` | **PASS** | `1 passed (1)`, `5 passed (5)` (`830ms`) |
| `npm test -w @wap/chat-web -- tests/auth-return-target.test.tsx` | `0` | **PASS** | `1 passed (1)`, `9 passed (9)` (`952ms`) |
| `npm test -w @wap/chat-web -- tests/fe-08-landing-auth.test.tsx` | `0` | **PASS** | `1 passed (1)`, `24 passed (24)` (`1669ms`) |
| `npm test -w @wap/chat-web -- --maxWorkers=4` | `0` | **PASS** | `99 passed (99)` test files, `1108 passed (1108)` tests (`52.48s`) |
| `npm run build:v3` | `0` | **PASS** | Vite production build thành công (`193 modules transformed`, `dist/assets/index-CZfQB8DY.css`, `dist/assets/index-CxY5qv2h.js`) |
| `node scripts/test-v3-web-build-security.mjs` | `0` | **PASS** | `PASS: production build excludes credential sentinels and 7 forbidden UI claims` |
| `node --check scripts/test-v3-browser.mjs` | `0` | **PASS** | Cú pháp runner trình duyệt hợp lệ |
| `node scripts/test-v3-browser.mjs planora-auth-lifecycle.spec.ts` | `NOT_RUN` | **NOT_RUN** | Không thay đổi cấu trúc khung hay hình học responsive so với HEAD `b9230b8b` đã kiểm chứng 22/22 Playwright `auth02` + 220/220 geometry cases ở Vòng 3; PostgreSQL 16 sandbox không chạy trong phiên review này |

### 3.2. Kiểm chứng Mutation / Regression thực tế (Chống Mock Ảo giác)

Thực hiện 4 phép đột biến (mutation) tạm thời trên `apps/chat-web/src/pages/AuthAction/AuthActionPage.tsx` trong worktree review `review-planora-pl-04-r4`:
1. **Mutation M1:** Thay công thức tính `remaining()` từ `deadline` bằng hằng số tĩnh `900` (`AuthActionPage.tsx:241`).
2. **Mutation M2:** Xóa `{signatureEndnote}` khỏi chế độ `verify-success` (`AuthActionPage.tsx:418`).
3. **Mutation M3:** Bỏ `{mailInputIcon}` và class `has-icon-left` khỏi ô `#resend-email-input` trong `verify-expired` (`AuthActionPage.tsx:468-478`).
4. **Mutation M4:** Đưa lại ký tự emoji trần `⏳` vào huy hiệu bước 2 trong `blocked-pending` (`AuthActionPage.tsx:1337`).

- **Kết quả chạy `npm test -w @wap/chat-web -- tests/planora-auth-lifecycle.test.tsx` khi có mutation (RED):**
  - **Exit code:** `1` (`1 failed (1)` test file, **`4 failed | 24 passed (28)`** tests):
    - `FAIL Countdown Timer in blocked-attempts mode > computes remaining seconds from deadline and updates display without prototype placeholder` (`Expected element to have text content: 01:13, Received: 15:00`)
    - `FAIL Business-First UX v2.0 > renders vector mail icon in input wrapper for verify-expired and email-not-verified modes` (`Expected the element to have class: has-icon-left, Received: planora-auth-input`)
    - `FAIL Business-First UX v2.0 > renders Planora signature endnote across views` (`Expected element to be in document, Received: null`)
    - `FAIL Business-First UX v2.0 > ensures zero raw emojis and step badges are clean numbers in blocked-pending` (`AssertionError: expected '...⏳2. Quản trị viên duyệt tài khoản...' not to contain '⏳'`)
- **Khôi phục code gốc & chạy lại (GREEN):**
  - Chạy `git checkout -- apps/chat-web/src/pages/AuthAction/AuthActionPage.tsx` (`git status -s` sạch hoàn toàn, `git diff --exit-code` = `0`) và chạy lại `npm test -w @wap/chat-web -- tests/planora-auth-lifecycle.test.tsx` -> **PASS 28/28 tests (exit code 0)**.

---

## 4. Ghi chú Nhỏ Không Chặn (Non-Blocking Notes)

- **[P3-N1] `apps/chat-web/src/pages/AuthAction/AuthActionPage.tsx:259, 369, 378, 1169`:** Ký tự текстовый `✓` trong thông báo khớp mật khẩu (`'✓ Mật khẩu khớp nhau'`) và huy hiệu hoàn thành được giữ nguyên để tương thích với các bài kiểm thử đơn vị hiện có (`planora-auth-lifecycle.test.tsx:191`). Không ảnh hưởng tới luồng nghiệp vụ hay độ tương phản WCAG AA.

---

## 5. Đánh giá Tổng hợp & Kết luận (Verdict)

- **Đánh giá Behavior & Technical:** **PASS**
- **Đánh giá UX Gate 05/11 (Business-First & Design Brief v2.0 MẪU 1):** **ĐẠT**
- **Findings (P1 / P2 / P3 cần sửa):** Không còn finding nào chặn nghiệm thu.
- **Overall Verdict:** **Đạt**

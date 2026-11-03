# Nhật ký thi công: Khắc phục Codex review findings F1-F8 cho PL-03

- **Ngày:** 03/11/2026
- **Người thực hiện:** Antigravity / Gemini worker
- **Nhiệm vụ:** [PL-03 · Landing, đăng nhập và đăng ký (Public & Auth)](../tasks/PL-03-planora-public-auth.md)
- **Worktree:** `feat-planora-pl-03`
- **Nhánh:** `longnguyen005/feat-planora-pl-03`
- **Reviewed Head SHA:** `9cce7c25072f97400262aa860fde1fe395671cd8`

---

## 1. Chi tiết 8 Findings từ Codex Review & Giải pháp Triệt để

### F1 (P2) · Mobile header navigation overflow trên 375px & 320px
- **Vấn đề:** Trên mobile viewport 375px và 320px, `.planora-landing-nav-inner` chứa Brand (~180px) cùng cụm điều hướng (ThemeToggle + Đăng nhập + Đăng ký = ~226px), tổng > 400px khiến nút "Đăng ký" bị tràn hoặc đẩy khỏi màn hình.
- **Khắc phục:**
  - Trong `apps/chat-web/src/pages/Landing/page.css`:
    - Tại `@media (max-width: 768px)`: giảm padding `10px 14px`, gap `8px`, ẩn subtitle thương hiệu `.planora-brand-sub { display: none; }` (giúp Brand thu gọn về ~80px), điều chỉnh nút `.planora-btn-sm` padding `6px 10px`, font-size `12px`.
    - Tại `@media (max-width: 360px)`: padding `8px 10px`, gap `4px`, font-size wordmark `18px`, nút `.planora-btn-sm` padding `6px 8px`, font-size `11px`.
  - Kiểm chứng: Toàn bộ thanh điều hướng nằm gọn trong viewport trên cả 375px và 320px, `scrollWidth <= window.innerWidth` đạt `true`, nút "Đăng ký" hiển thị đầy đủ và không bị clip.

### F2 (P2) · Nút Auto-Digest CTA nạp prompt kịch bản issue thay vì prompt digest
- **Vấn đề:** Nút "Dùng thử lịch Auto-Digest 8:00 sáng →" tại `LandingPage.tsx:1064` gọi `handleTryPlaybook` nạp prompt mẫu của GitHub issue thay vì `landingPlaybooks.digestPrompt`.
- **Khắc phục:**
  - Import `landingPlaybooks` từ `src/assets/landing-playbooks.json`.
  - Tạo hàm `handleTryDigest`: nạp `landingPlaybooks.digestPrompt` ("Mỗi sáng 08:00 từ Thứ 2 đến Thứ 6, tự động đọc lịch họp nhóm trên Google Calendar và bảng Sprint Q4 trên Google Sheets, tổng hợp báo cáo gửi vào kênh #bao-cao-sang trên Slack và nhóm Telegram.") vào `sessionStorage` dưới khóa `ati_prefill_prompt`, sau đó chuyển sang chế độ `signup`.
  - Gán `onClick={handleTryDigest}` cho `[data-testid="landing-try-digest-btn"]`.
  - Bổ sung browser test kiểm chứng trong `tests/browser/planora-public.spec.ts`.

### F3 (P2) · Mất live status của signup/forgot thành công và signup bị đóng
- **Vấn đề:** Khi đăng ký thành công, gửi link quên mật khẩu thành công, hoặc truy cập `/signup` khi `signupEnabled = false`, các vùng thông báo thiếu `role="status"` dẫn đến regression trợ năng trên các bộ test gốc `auth-02-signup-reset.spec.ts`.
- **Khắc phục:**
  - Trong `LandingPage.tsx`:
    - Với `authView === 'success'`: truyền `subtitle={<span id="success-desc" role="status">{success?.desc ?? 'Kiểm tra email để xác minh tài khoản.'}</span>}`.
    - Với `authView === 'forgot'`: thêm state `forgotSent`. Trong `handleForgotSubmit`, khi API trả về thành công thì `setForgotSent(true)`. Render hộp thông báo trong form quên mật khẩu:
      `<div id="forgot-feedback-box" role={forgotSent ? "status" : undefined} className={`${forgotSent ? '' : 'hidden '}planora-auth-success-box`}>Nếu email này có tài khoản, bạn sẽ nhận được link đặt lại mật khẩu.</div>`.
    - Với `signup` khi `!authConfig?.signupEnabled`: render `<p id="auth-signup-disabled-notice" role="status" className="planora-auth-disabled-notice">Đăng ký bằng email hiện đang đóng. Hãy liên hệ quản trị viên hoặc đăng nhập bằng tài khoản hiện có.</p>`.

### F4 (P2) · Ba nhóm nội dung landing thiếu toàn bộ CSS
- **Vấn đề:** Các class `.planora-principles-section`, `.planora-proof-grid`, `.planora-proof-card`, `.planora-proof-num`, `.planora-onboarding-section`, `.planora-onboarding-grid`, `.planora-onboarding-card`, `.planora-onboarding-badge`, `.planora-step-num`, `.planora-digest-section` trong `LandingPage.tsx` chưa có CSS declarations trong `page.css`.
- **Khắc phục:**
  - Viết đầy đủ CSS rules chuẩn hệ thống token Planora trong `page.css`: `max-width: 1200px`, padding responsive (80px 24px trên desktop, 56px 16px trên mobile, 20px 14px trên màn hình nhỏ 320px).
  - Lưới card 3 cột desktop, tự động chuyển 1 cột tại `@media (max-width: 1023.98px)`.
  - Đổ bóng, border kem/divider, hover transition nhẹ nhàng đúng phong cách thẩm mỹ Planora.

### F5 (P2) · Nền landing tối bị prototype ghi đè, không lấy token Planora
- **Vấn đề:** `src/prototype/theme.css:5` có selector `html.dark body { background-color: #0B1020 !important; }` ghi đè khiến nền landing dark mode hiển thị màu xanh navy của prototype thay vì token canvas xanh rừng `#171c18` của Planora.
- **Khắc phục:**
  - Trong `apps/chat-web/src/pages/Landing/page.css`:
    ```css
    html.dark[data-proto-page="index"] body,
    html.dark body.selection\:bg-\[\#FF5701\]\/20,
    html.dark[data-proto-page="index"] {
      background-color: var(--planora-canvas) !important;
      color: var(--planora-text) !important;
    }
    ```
  - Scope chặt chẽ theo `data-proto-page="index"`, đảm bảo landing áp dụng đúng token `--planora-canvas: #171c18` mà không ảnh hưởng các route prototype khác chưa port.

### F6 (P2) · Browser regression và gate chưa được chuyển sang reference Planora thật
- **Vấn đề:**
  - `LandingPage.tsx:1070` có một dummy div `style={{ display: 'none' }}` mang `data-testid="workflow-flow-canvas"` không hiển thị trực quan.
  - Heading Google auth là "Chuyển tới Google" thay vì "Đang chuyển sang trang đăng nhập của Google…".
  - Năm ca kiểm thử trong `tests/browser/fe-08-landing-auth.spec.ts` còn đòi hỏi five-moment orbital và selector Make cũ đã chủ động thay thế.
  - `scripts/test-v3-browser.mjs:15` thiếu `|PL-03:` trong default grep.
- **Khắc phục:**
  - Thay thế marker ẩn bằng preview trực quan `.planora-digest-flow-preview` mang `data-testid="workflow-flow-canvas"` và `data-flow-mode="schedule"` thể hiện quy trình 3 bước: `08:00 T2–T6 (Lịch hẹn)` → `Chỉ đọc (Calendar & Sheets)` → `Đã khóa (Slack & Telegram)`.
  - Cập nhật tiêu đề Google auth thành `'Đang chuyển sang trang đăng nhập của Google…'`.
  - Hiện đại hóa `fe-08-landing-auth.spec.ts`: chuyển sang assert 3 `.workflow-step-card`, scroll từng card, và kiểm tra `hero-float` tắt chuyển động khi `prefers-reduced-motion: reduce`.
  - Thêm `|PL-03:` vào default grep của `scripts/test-v3-browser.mjs:15`.

### F7 (P3) · Breakpoint auth 1024px mâu thuẫn spec bàn giao
- **Vấn đề:** CSS sử dụng `@media (max-width: 1024px)` khiến tại đúng màn hình 1024×768, panel split bị ẩn, trái với thiết kế yêu cầu desktop `>= 1024px` phải có split panel.
- **Khắc phục:**
  - Đổi `@media (max-width: 1024px)` thành `@media (max-width: 1023.98px)` trong cả `apps/chat-web/src/planora/styles/auth.css` và `apps/chat-web/src/pages/Landing/page.css`.
  - Xác nhận tại viewport 1024×768 panel split nghệ thuật giấy Planora luôn hiển thị đúng.

### F8 (P3) · Các control trong auth frame chưa đạt tap target 44px
- **Vấn đề:** Nút "Quên mật khẩu?" bị inline style `minHeight: 0; padding: 0` (chỉ cao ~16.5px); nút ThemeToggle chỉ 32×32px; Brand cao ~42.3px.
- **Khắc phục:**
  - Xóa bỏ inline style đè kích thước trên nút "Quên mật khẩu?", bổ sung class `.planora-auth-forgot-link` với `min-height: 44px; display: inline-flex; align-items: center; padding: 0 4px;`.
  - Thiết lập `.planora-auth-nav-actions .ati-theme-toggle`: width 44px, height 44px, min-width/height 44px.
  - Thiết lập `.planora-auth-close-btn`: width 44px, height 44px, min-width/height 44px.
  - Thiết lập `.planora-auth-top-nav .planora-brand`: min-height 44px.
  - Bổ sung assertions kiểm tra bounding box height/width >= 44px trong `planora-public.spec.ts`.

---

## 2. Bảng Bằng chứng Kiểm thử Thực tế

| Lệnh kiểm thử | Kết quả | Ghi chú |
|---|---|---|
| `npm run typecheck:v3` | **PASS (exit code 0)** | Chat API & Chat Web sạch 100% lỗi TypeScript |
| `npm run build:v3` | **PASS (exit code 0)** | Vite production build thành công (193 modules) |
| `npm test -w @wap/chat-web` | **PASS (98/98 files, 1075/1075 tests, exit code 0)** | Toàn bộ unit/integration test suites đều xanh |
| `git diff --check` | **PASS (exit code 0)** | Không có lỗi whitespace hay trailing spaces |

---

## 3. Danh sách File Sửa đổi

- `apps/chat-web/src/pages/Landing/LandingPage.tsx`
- `apps/chat-web/src/pages/Landing/page.css`
- `apps/chat-web/src/planora/styles/auth.css`
- `apps/chat-web/tests/browser/fe-08-landing-auth.spec.ts`
- `apps/chat-web/tests/browser/planora-public.spec.ts`
- `scripts/test-v3-browser.mjs`
- `docs/handoff/tasks/PL-03-planora-public-auth.md`
- `docs/handoff/log/2026-11-03-gemini-pl-03-review-fixes.md`

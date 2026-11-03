# PL-03 · Landing, đăng nhập và đăng ký (Public & Auth)

**Trạng thái:** sẵn sàng nhận · **Nhánh gợi ý:** `longnguyen005/feat-planora-pl-03` · **Phụ thuộc:** PL-01 và PL-02 đã hoàn tất và được Codex duyệt Đạt.  
**Base SHA:** `965150a9d80418d85354b7b3e8c6e8fff1fedd90` (trên integration branch `codex/planora-ui`).  
**Target branch:** `codex/planora-ui`.  
**Đặc tả:** [Planora migration design](../../superpowers/specs/2026-11-02-planora-migration-design.md) mục 4.2, 8.2 · **Kế hoạch:** [Planora migration plan](../../superpowers/plans/2026-11-02-planora-migration.md) mục PL-03.  
**Prompt thi công:** [PL-03.md](../planora-prompts/PL-03.md).  
**Quy ước chung:** [COMMON.md](../planora-prompts/COMMON.md).

---

## 1. Mục tiêu

Port giao diện Landing, Đăng nhập (Login), Đăng ký (Signup) và Auth Frame chuẩn Planora:
1. **Landing:** Khôi phục hero Planora, phong cách giấy/kem, minh họa quy trình (thay thế đồ họa orbital Make cũ bằng minh họa Planora 3 bước), giữ các ví dụ có gắn nhãn minh họa (`VÍ DỤ: MỘT YÊU CẦU, BA BƯỚC`) và các CTA tương ứng với capabilities hiện tại.
2. **Khung Auth (PlanoraAuthFrame):** Layout split/card thanh lịch theo nhận diện thương hiệu Planora, tích hợp thương hiệu Monogram, chuyển đổi theme Sáng/Tối.
3. **Đăng nhập & Đăng ký:** Giữ nguyên 100% controllers và luồng nghiệp vụ hiện tại:
   - Đăng nhập bằng Email/Password, hiện/ẩn mật khẩu, hiển thị lỗi rõ ràng, trạng thái loading/busy.
   - Nút đăng nhập Google có điều kiện (`googleEnabled`).
   - Hỗ trợ đầy đủ tham số redirect / return target (`returnTo`, `/c/:id`, v.v.).
   - Đăng ký tài khoản: xác thực độ dài/định dạng mật khẩu, kiểm tra cờ `signupEnabled`, hỗ trợ tạo hoặc gia nhập tổ chức khi đăng ký theo flow của main.
   - Giữ nguyên cơ chế bảo mật (CSRF/AuthGate) và không làm hồi quy bất kỳ route nào.

---

## 2. Ranh giới sở hữu & Phạm vi file

- **Tạo mới:**
  - `apps/chat-web/src/planora/layout/PlanoraAuthFrame.tsx`
  - `apps/chat-web/src/planora/styles/auth.css` (hoặc tích hợp vào layout styles)
  - `apps/chat-web/tests/browser/planora-public.spec.ts` (hoặc tích hợp vào suite browser)
- **Sửa đổi cho phép:**
  - `apps/chat-web/src/pages/Landing/LandingPage.tsx`
  - `apps/chat-web/src/pages/Landing/page.css`
  - `apps/chat-web/src/views/LandingView.tsx`
  - `apps/chat-web/src/views/LoginPage.tsx`
  - `apps/chat-web/src/views/SignupView.tsx`
  - `apps/chat-web/src/views/AuthFormFrame.tsx`
  - `apps/chat-web/src/components/GoogleAuthButton.tsx`
  - `apps/chat-web/tests/fe-08-landing-auth.test.tsx` (hoặc các test unit tương đương)
  - `apps/chat-web/tests/auth-02-signup-reset.test.tsx` (hoặc các test auth liên quan)
- **Ngoài phạm vi:**
  - `AuthAction` nâng cao (thuộc task PL-04).
  - Không sửa `apps/chat-api`, backend auth contracts, hay DB migrations.
  - Không thay đổi contracts của router hay AuthGate.

---

## 3. Interfaces & Yêu cầu kỹ thuật

- **`PlanoraAuthFrame` Interface:**
  ```tsx
  interface PlanoraAuthFrameProps {
    title: string;
    subtitle?: React.ReactNode;
    children: React.ReactNode;
    footer?: React.ReactNode;
    badge?: string;
  }
  ```
- **Responsive & Visual:**
  - Desktop (1440px): Bố cục phân tách cân đối, typography Planora serif/sans, card nền kem/dark rêu.
  - Mobile (375px & 320px): Co giãn mềm mại, không tràn màn hình ngang (`scrollWidth <= window.innerWidth`), các input và nút bấm tối thiểu 44px chuẩn tap target.
  - Hỗ trợ đầy đủ Dark Mode (`.dark` / `ati-theme`).
- **Nghiệp vụ bất biến:**
  - Đăng nhập thành công chuyển hướng đúng tới `returnTo` hoặc mặc định vào không gian làm việc (`/?view=workspace`).
  - Nếu `signupEnabled = false`, màn hình Signup hiển thị thông báo hướng dẫn liên hệ quản trị viên rõ ràng.
  - Khi có lỗi từ API (sai pass, tài khoản chờ duyệt, rate limit), hiển thị thông báo lỗi thân thiện.

---

## 4. Tiêu chí nghiệm thu

- [x] Giữ toàn bộ hành vi của `fe-08-landing-auth` và `auth-02-signup-reset`: tất cả các ca kiểm thử đăng nhập, đăng ký, validation mật khẩu, error message, Google auth đều PASS.
- [x] Màn hình Landing chuẩn Planora với hero, ví dụ quy trình 3 bước, CTA rõ ràng, điều hướng công khai (Cẩm nang, Chính sách an toàn, Đăng nhập).
- [x] Không gây tràn ngang trên các viewport từ 320px đến 1440px ở cả Light và Dark mode.
- [x] `npm run typecheck:v3` exit 0.
- [x] `npm run build:v3` exit 0.
- [x] `npm test -w @wap/chat-web` PASS 100%, không hồi quy bất kỳ test suite nào (98/98 files, 1075/1075 tests).
- [x] Có spec trình duyệt `tests/browser/planora-public.spec.ts` kiểm chứng trên các viewport (1440px, 1024px, 768px, 375px, 320px).
- [x] Gửi packet `READY_FOR_CODEX_REVIEW` cho Codex re-review độc lập.

---

## 5. Kết quả

- **Đã hoàn thành:**
  1. **Khôi phục Landing Page chuẩn Planora:**
     - Thiết kế giao diện giấy/kem ấm, font serif/sans chuẩn thương hiệu Planora.
     - 3D Interactive Hero Rotator (`.planora-hero-rotator`) với 14 lớp giấy đặc bo góc (`.hero-edge-layer`), chuyển động lướt float 4s mềm mại, drag/pointer gesture với rAF và physics inertia, hỗ trợ phím mũi tên trái/phải (`ArrowLeft`/`ArrowRight`), và tự động tắt chuyển động khi người dùng kích hoạt `prefers-reduced-motion`.
     - Minh họa quy trình 3 bước Planora ("VÍ DỤ: MỘT YÊU CẦU, BA BƯỚC", 3 `.workflow-step-card`) thay thế đồ họa orbital Make cũ: Step 1 (Yêu cầu), Step 2 (Kế hoạch), Step 3 (Kết quả).
     - Hero trust pills (`data-testid="landing-hero-trust-pills"`): OAuth 1-Click, Khóa phạm vi an toàn, Duyệt trước khi ghi.
     - Nút "Dùng thử kịch bản này" (`data-testid="landing-try-playbook-btn"`) lưu `ati_prefill_prompt` vào `sessionStorage`, chuyển hướng `/signup` và mở `#auth-modal`.
     - Dịch vụ tích hợp (`data-od-id="integrations-section"`): 8 huy hiệu OAuth 1-Click mặc định (GitHub, Trello, Slack, Google Calendar, Telegram, Jira, Notion, Sentry), cùng tích hợp có điều kiện theo runtime capability: Gmail (`runtime?.gmailEnabled`) với liên kết hướng dẫn `/guide?service=gmail`, và Google Sheets (`runtime?.mysheetsEnabled`) với liên kết hướng dẫn `/guide?service=mysheets`.
     - Kiến trúc an toàn 3 lớp (`data-od-id="principles-section"`): Lớp 1 (Khóa phạm vi tài nguyên), Lớp 2 (Xem trước nguyên văn & lưới dữ liệu), Lớp 3 (Biên nhận đối chiếu & Khôi phục an toàn).
     - Quy trình bắt đầu 3 bước (`data-od-id="onboarding-section"`): Step 1, Step 2 (với huy hiệu `onboarding-step2-oauth-badge`), Step 3.
     - Lịch chạy định kỳ & Auto-Digest sáng (`data-testid="landing-schedule-digest-section"`).
     - Chân trang (`data-od-id="footer"`): Nhận diện thương hiệu monogram Planora, "AI Workflow Automation Platform", và các liên kết công khai.
  2. **Khung xác thực phân tách Planora (`PlanoraAuthFrame`):**
     - Tạo mới `apps/chat-web/src/planora/layout/PlanoraAuthFrame.tsx` và `apps/chat-web/src/planora/styles/auth.css`.
     - Layout split desktop (>= 1024px) với panel nghệ thuật giấy Planora Monogram SVG trôi nổi; co giãn thành thẻ gọn gàng trên mobile (< 1024px).
     - Hỗ trợ đầy đủ chế độ Sáng và Tối (`.dark`, token `--planora-*`).
     - Tích hợp chuẩn giao diện `PlanoraAuthFrameProps` (`title`, `subtitle`, `children`, `footer`, `badge`, `onClose`, `showEditorial`, `tabs`).
     - Tái cấu trúc `AuthFormFrame.tsx` bao bọc `PlanoraAuthFrame`.
  3. **Bảo toàn 100% nghiệp vụ và điều khiển Auth:**
     - Đăng nhập email/mật khẩu, hiện/ẩn mật khẩu, bẫy CapsLock, thông báo lỗi tiếng Việt thân thiện, trạng thái loading/busy.
     - Nút đăng nhập Google có điều kiện (`authConfig?.googleEnabled`), định dạng chuẩn tap target min 44px (`apps/chat-web/src/components/GoogleAuthButton.tsx`).
     - Đăng ký tài khoản: kiểm tra độ dài 12-128 ký tự, tuân thủ cờ `signupEnabled`, hiển thị thông báo liên hệ quản trị viên khi đăng ký bị tắt.
     - Bảo toàn tham số `returnTo` và chuyển hướng an toàn.
     - Bẫy tiêu điểm (`focus trap`), phục hồi tiêu điểm cho phần tử mở modal khi đóng, phím Escape đóng modal và trả URL về `/`.
     - Gán `inert` và `aria-hidden` cho nội dung nền khi modal mở, bảo đảm quy tắc trợ năng 1 `<h1>` và 1 `<main>` trên toàn trang.
  4. **Bổ sung browser test spec:**
     - Tạo `apps/chat-web/tests/browser/planora-public.spec.ts` kiểm thử viewports (1440, 1024, 768, 375, 320), Light & Dark themes, không tràn ngang (`scrollWidth <= window.innerWidth`), tap targets >= 44px và reduced motion.

- **Kết quả kiểm thử & Xử lý Findings Review F1–F8:**
  - **F1 (P2) - Header mobile overflow trên 375px & 320px:** Đã tối ưu padding/gap `.planora-landing-nav-inner`, ẩn subtitle thương hiệu trên màn hình nhỏ (`.planora-brand-sub { display: none; }`), giảm kích thước nút điều hướng. Đo lường xác nhận không còn tràn ngang trên cả 375px và 320px.
  - **F2 (P2) - Auto-Digest CTA prefill prompt:** Tách biệt `handleTryDigest` nạp đúng `landingPlaybooks.digestPrompt` từ `src/assets/landing-playbooks.json:316` vào `ati_prefill_prompt` khi bấm nút "Dùng thử lịch Auto-Digest 8:00 sáng →", chuyển hướng `/signup`.
  - **F3 (P2) - Live status của signup/forgot thành công và signup đóng:** Khôi phục `role="status"` đúng ngữ nghĩa cho:
    - Signup thành công: `<span id="success-desc" role="status">` chứa "Kiểm tra email để xác minh tài khoản.".
    - Gửi forgot-password: `<div id="forgot-feedback-box" role={forgotSent ? "status" : undefined}>` chứa "Nếu email này có tài khoản, bạn sẽ nhận được link đặt lại mật khẩu.".
    - Khi đăng ký đóng: `<p id="auth-signup-disabled-notice" role="status">` chứa "Đăng ký bằng email hiện đang đóng. Hãy liên hệ quản trị viên hoặc đăng nhập bằng tài khoản hiện có.".
  - **F4 (P2) - Hoàn thiện CSS các section Landing:** Bổ sung toàn bộ declaration CSS chuẩn tokens Planora cho `.planora-principles-section`, `.planora-proof-grid`, `.planora-proof-card`, `.planora-proof-num`, `.planora-onboarding-section`, `.planora-onboarding-grid`, `.planora-onboarding-card`, `.planora-onboarding-badge`, `.planora-step-num`, `.planora-digest-section` cùng responsive breakpoints.
  - **F5 (P2) - Landing dark mode token Planora:** Ghi đè prototype theme bằng selector `html.dark[data-proto-page="index"] body` áp dụng đúng token `--planora-canvas: #171c18` thay vì xanh navy prototype `#0B1020`.
  - **F6 (P2) - Browser regression và test runner:**
    - Thay thế dummy marker `display:none` bằng visual preview `.planora-digest-flow-preview` hiển thị minh họa luồng Auto-Digest (08:00 T2–T6 → Lịch họp & Bảng tính → Kênh Slack/Telegram) mang thuộc tính `[data-testid="workflow-flow-canvas"][data-flow-mode="schedule"]`.
    - Cập nhật tiêu đề Google auth thành `'Đang chuyển sang trang đăng nhập của Google…'`.
    - Cập nhật assertions `fe-08-landing-auth.spec.ts` từ five moments Make cũ sang 3-step workflow Planora và kiểm tra reduced motion.
    - Thêm `|PL-03:` vào default grep của `scripts/test-v3-browser.mjs:15`.
  - **F7 (P3) - Breakpoint auth 1024px:** Điều chỉnh boundary thành `max-width: 1023.98px` trong `auth.css` và `page.css`, đảm bảo tại viewport 1024×768 panel split nghệ thuật giấy Planora luôn hiển thị đúng đặc tả.
  - **F8 (P3) - Tap target >= 44px trên mọi control:** Tăng kích thước vùng tương tác cho "Quên mật khẩu?" (`.planora-auth-forgot-link` min-height 44px), nút ThemeToggle (44×44px), nút đóng cửa sổ (44×44px), và nút Brand (min-height 44px). Bổ sung assertions kiểm chứng trong `planora-public.spec.ts`.
  - **R1 (P2) - Xử lý dứt điểm F1 header navbar mobile:** Tăng độ đặc hiệu CSS scoped với `.planora-landing-nav .planora-brand.planora-brand-md .planora-brand-word` (18px trên <=768px, 16px trên <=360px), biểu tượng SVG (22px / 20px), khoảng cách gap (6px / 4px), và padding (8px 12px / 6px 8px). Quy tắc này thắng hoàn toàn stylesheet order của `components.css`, đảm bảo `scrollWidth <= window.innerWidth` trên 375px và 320px không bị cắt hay tràn ngang.
  - **R2 (P2) - Sửa Playwright locator khớp element `<a>` thật:** Sửa selector trong `planora-public.spec.ts` từ `button` sang `[data-od-id="btn-header-signup"]` (khớp đúng thẻ `<a>` hiện có của nút Đăng ký), loại bỏ lỗi timeout trên cả 10 ca kiểm thử responsive.
  - **R3 (P3) - Vùng tương tác tap target >= 44px cho toàn bộ Landing CTAs:** Thiết lập `min-height: 44px` cho `[data-testid="landing-try-playbook-btn"]`, `[data-testid="landing-try-digest-btn"]`, nút Đăng nhập header và Đăng ký header; bổ sung kiểm chứng bounding box height >= 44px trong `planora-public.spec.ts`.

- **Kết quả kiểm thử:**
  - `npm run typecheck:v3`: PASS (exit code 0).
  - `npm run build:v3`: PASS (exit code 0).
  - `npm test -w @wap/chat-web`: PASS 98/98 files, 1075/1075 tests (exit code 0).
  - Regression suite liên quan:
    - `tests/fe-08-landing-auth.test.tsx`: 40/40 tests PASS.
    - `tests/auth-signup-reset.test.tsx`: 20/20 tests PASS.
    - `tests/auth-google.test.tsx`: 43/43 tests PASS.
    - `tests/landing-orbital-redesign.test.tsx`: 5/5 tests PASS.
    - `tests/fe-04b-prototype-foundation.test.tsx`: 6/6 tests PASS.
    - `tests/gmail-public.test.tsx`: 3/3 tests PASS.
    - `tests/gmail-review-fixes.test.tsx`: 18/18 tests PASS.
    - `tests/mysheets-ui.test.tsx`: 21/21 tests PASS.
    - `tests/components/login-view.test.tsx`: 10/10 tests PASS.
    - `tests/planora-shell.test.tsx`: 12/12 tests PASS.

- **Trạng thái:** `STATUS: READY_FOR_CODEX_REVIEW`.

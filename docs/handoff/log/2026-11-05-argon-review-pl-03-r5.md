# Báo cáo Review Độc lập — PL-03 (Round 5: Refactor Business-First UX v2.0)

- **Reviewer:** Antigravity / Gemini 4 Argon (High); model ID `gemini-4-argon-high`
- **Ngày review:** 05/11/2026 (thực chạy 07/11/2026)
- **Task:** [PL-03 · Landing, đăng nhập và đăng ký (Public & Auth)](../tasks/PL-03-planora-public-auth.md)
- **UX Task:** `docs/handoff/tasks/PLANORA-UX-01-business-first-redesign.md`
- **PR_URL hoặc LOCAL_ONLY:** `LOCAL_ONLY`
- **Target Branch:** `longnguyen005/feat-planora-pl-03` (target tích hợp: `codex/planora-ui`)
- **Cumulative PL-03 Base SHA:** `f19ceed319271a7ec3c0005f133d4747665dc18c` (sau khi merge PL-02 accepted base)
- **Round 5 Base SHA:** `1c8f7dc22654473b19ceae7cbc0392563b588b50`
- **Reviewed Head SHA:** `6143de9ab0181abfbdc68a9867d2bb18e2c021e5`
- **Worktree review:** `C:\Users\Admin\orca\workspaces\ATI_Project\review-planora-pl-03-r5` (branch `longnguyen005/review-planora-pl-03-r5`)

---

## 1. Xác minh Git, Head SHA & Phạm vi File

- `git rev-parse HEAD` và `git rev-parse longnguyen005/feat-planora-pl-03` đều khớp chính xác SHA 40 ký tự: `6143de9ab0181abfbdc68a9867d2bb18e2c021e5`.
- Diff của Round 5 (`1c8f7dc22654473b19ceae7cbc0392563b588b50..6143de9ab0181abfbdc68a9867d2bb18e2c021e5`) gồm 5 files (`+203 / -52`):
  1. `apps/chat-web/src/pages/Landing/LandingPage.tsx`
  2. `apps/chat-web/src/planora/layout/PlanoraAuthFrame.tsx`
  3. `apps/chat-web/src/planora/styles/auth.css`
  4. `docs/handoff/tasks/PL-03-planora-public-auth.md`
  5. `docs/handoff/log/2026-11-07-gemini-pl-03-business-first-refactor.md`
- Diff tích lũy toàn bộ PL-03 so với accepted base PL-02 (`f19ceed3..6143de9a`) gồm 18 files trong đúng phạm vi cho phép (`apps/chat-web/`, `scripts/test-v3-browser.mjs`, `docs/handoff/`).
- Không có thay đổi trái phép sang `apps/chat-api`, `packages/*`, `db/v3`, `prompts`, `evaluations`, `CURRENT-STATE.md` hay `ROADMAP.md`.

---

## 2. Kiểm tra Trọng tâm theo Design Brief v2.0 (MẪU 1) & Business-First UX

### 2.1. Hero Editorial & Copywriting Nghiệp vụ (`LandingPage.tsx:591-675`, `page.css:115-200`)
- **Typography & Tiêu đề Editorial (`LandingPage.tsx:599-604`):**
  - Tiêu đề `h1.planora-hero-heading` sử dụng font serif chuẩn Planora (`var(--planora-font-serif)`): *"Một lời nhắn. Công việc được kết nối."* kèm nhấn mạnh nghệ thuật `<em>được kết nối.</em>` màu xanh rừng `var(--planora-primary)` — khớp tham chiếu nhận diện `Frontend_UXUI@ef13c56:apps/chat-web/src/components/LandingPageView.tsx`.
  - Đoạn giới thiệu `p.planora-hero-copy` (`LandingPage.tsx:606-608`): *"Biến ý tưởng thành kế hoạch trên những công cụ bạn đã quen. Bạn kiểm tra, bạn quyết định — Planora phối hợp các bước còn lại trên GitHub, Trello, Slack, Google Calendar và Sheets."* — tập trung trực tiếp vào giá trị công việc và quyền quyết định của người dùng, loại bỏ khẩu hiệu kỹ thuật/engine.
  - Tiêu đề trang `meta.title` (`LandingPage.tsx:63`): *"Planora — Nền tảng điều phối công việc liên dịch vụ"*.
  - CTA cuối trang (`LandingPage.tsx:1106-1107`): *"Dành chỗ cho điều bạn muốn làm. / Bắt đầu trong không gian làm việc của bạn, duyệt trước khi tạo thay đổi."*

### 2.2. Kịch bản Thực tế & Minh họa Quy trình Có Gắn Nhãn Rõ Ràng (`LandingPage.tsx:678-850, 1028-1100`)
- **Kịch bản 1 — Điều phối công việc liên dịch vụ (`LandingPage.tsx:700-753, 774-850`):**
  - Gắn nhãn rõ ràng: `"WORKSPACE PLANORA · Ví dụ quy trình"` trên 3D Hero Rotator (`.planora-hero-rotator`) và `"VÍ DỤ: MỘT YÊU CẦU, BA BƯỚC THỰC THI"` tại section `#how`.
  - Minh họa 3 bước tuần tự (`.workflow-step-card`: `01 Yêu cầu` → `02 Kế hoạch` → `03 Kết quả`) thay thế hoàn toàn đồ họa Orbital Make cũ, kèm nút `"Dùng thử kịch bản này"` (`[data-testid="landing-try-playbook-btn"]`) lưu `ati_prefill_prompt` vào `sessionStorage` mà không tự động gửi request.
- **Kịch bản 2 — Lịch chạy định kỳ & Bản tin Auto-Digest mỗi sáng (`LandingPage.tsx:1028-1100`):**
  - Gắn nhãn `"TỰ ĐỘNG HÓA THEO LỊCH HẸN — Lịch Chạy Định Kỳ & Auto-Digest Mỗi Sáng"` (`[data-testid="landing-schedule-digest-section"]`).
  - Phân biệt rõ hai chế độ: *"Chờ duyệt từng lượt (Human-in-the-Loop)"* và *"Tự gửi bản tin Auto-Digest mỗi sáng"* (`08:00 T2–T6`: đọc dữ liệu từ `Calendar & Sheets` → gửi tóm tắt sang `Slack & Telegram` tại `"Lịch họp nhóm · Bảng Sprint Q4 → Kênh #bao-cao-sang"`), kèm nút `"Dùng thử lịch Auto-Digest 8:00 sáng →"` (`[data-testid="landing-try-digest-btn"]`) nạp `landingPlaybooks.digestPrompt`.

### 2.3. Khung Xác thực Editorial (`PlanoraAuthFrame.tsx`, `LandingPage.tsx:1150-1682`, `auth.css`)
- **Dọn dẹp markup dư thừa (`PlanoraAuthFrame.tsx:155`):**
  - Đã xóa thẻ bọc `<div className="planora-auth-tabs">` lồng nhau dư thừa trong `PlanoraAuthFrame.tsx:155`, render trực tiếp `{tabs}` (do `LandingPage.tsx:1191-1195` đã truyền `<div role="tablist" className="planora-auth-tabs">`), loại bỏ viền và padding kép quanh thanh tab Đăng nhập / Đăng ký.
- **Vector Input Icons & Chữ ký Planora (`LandingPage.tsx:1289-1640`, `auth.css:348-370`):**
  - Bổ sung vector SVG icons tự host (`aria-hidden="true"`, `.planora-auth-input-icon`, `.planora-auth-input.has-icon-left` với `padding-left: 42px; pointer-events: none`):
    - Icon `Mail` cho `#forgot-email`, `#email` (Đăng nhập), và `#signup-email` (Đăng ký).
    - Icon `LockKeyhole` cho `#password` (Đăng nhập) và `#signup-password` (Đăng ký).
    - Icon `UserRound` cho `#signup-name` (Họ tên khi Đăng ký).
  - Bổ sung endnote chữ ký thương hiệu Planora (`.planora-auth-endnote`): *"Một lời nhắn. Một khởi đầu nhẹ nhàng."* kèm icon hội thoại vector SVG (`aria-hidden="true"`) ở chân cả form Đăng nhập (`LandingPage.tsx:1489-1494`) và form Đăng ký (`LandingPage.tsx:1635-1640`).
  - Subtitle đăng ký (`LandingPage.tsx:1186`): *"Tạo tài khoản để bắt đầu kết nối quy trình làm việc cùng Planora."*

### 2.4. Bảo toàn 100% Nghiệp vụ, Controllers & Trợ năng WCAG AA
- **Controllers & Luồng xác thực:**
  - Bảo toàn đầy đủ đăng nhập Email/Mật khẩu (`LoginView.tsx` dịch lỗi `"Invalid email or password"` sang tiếng Việt thân thiện *"Email hoặc mật khẩu không chính xác."*), nút hiện/ẩn mật khẩu (`aria-pressed`), cảnh báo `Caps Lock đang bật.` (`role="status"`), trạng thái `aria-busy` và khóa nút khi đang gửi.
  - Bảo toàn nút đăng nhập Google có điều kiện (`authConfig?.googleEnabled`) trên Hero, form Đăng nhập, form Đăng ký và màn hình khi đăng ký email đóng, kèm guard hủy phản hồi trễ (`generation.current`) khi người dùng đóng modal giữa chừng.
  - Bảo toàn chính sách đăng ký (`authConfig?.signupEnabled`): khi tắt sẽ ẩn tab Đăng ký và hiển thị thông báo `role="status"` (`#auth-signup-disabled-notice`): *"Đăng ký bằng email hiện đang đóng. Hãy liên hệ quản trị viên hoặc đăng nhập bằng tài khoản hiện có."*; kiểm tra độ dài mật khẩu 12–128 ký tự trước khi gọi API.
  - Bảo toàn điều hướng `returnTo` / deep-link `/c/:id`, đếm ngược khóa đăng nhập từ header `Retry-After` (`#blocked-timer-display`), màn hình chờ duyệt tài khoản không làm lộ email quản trị viên, và luồng tạo/tham gia tổ chức từ base PL-02 (`f19ceed3`).
- **Tương phản WCAG AA & Responsive (320px..1440px):**
  - Nút Primary (`.planora-btn-primary` trong `components.css:145-149` và `.planora-auth-submit` trong `auth.css:437-438`) sử dụng `background-color: var(--planora-primary)` và `color: var(--planora-on-primary)` (`#fffdf7` trên `#3c5741` = **7.80:1** ở Light mode; `#132014` trên `#8fb68e` = **7.91:1** ở Dark mode — tuyệt đối không dùng chữ trắng ở Dark mode).
  - Giữ nguyên toàn bộ các bản sửa responsive và tap target từ Vòng 1–4 (`F1–F8`, `R1–R3`, `C1`): không tràn ngang từ `320px` đến `1440px`, vùng chạm `>= 44px` cho toàn bộ nút điều hướng, CTA, `.roadmap-toggle` và các nút trong Auth modal, hỗ trợ `prefers-reduced-motion: reduce`.

---

## 3. Kết quả Chạy Lệnh Kiểm thử & Kiểm chứng Mutation

### 3.1. Bảng lệnh kiểm thử thực tế tại worktree review

| Lệnh kiểm thử | Exit Code | Kết quả | Chi tiết |
| :--- | :---: | :---: | :--- |
| `npm run typecheck:v3` | `0` | **PASS** | `tsc -p apps/chat-api/tsconfig.json --noEmit && tsc -p apps/chat-web/tsconfig.json --noEmit` (0 lỗi) |
| `npm test -w @wap/chat-web -- tests/fe-08-landing-auth.test.tsx` | `0` | **PASS** | `1 passed (1)`, `24 passed (24)` |
| `npm test -w @wap/chat-web -- tests/landing-orbital-redesign.test.tsx` | `0` | **PASS** | `1 passed (1)`, `5 passed (5)` |
| `npm test -w @wap/chat-web -- tests/components/login-view.test.tsx` | `0` | **PASS** | `1 passed (1)`, `10 passed (10)` |
| `npm test -w @wap/chat-web -- tests/auth-signup-reset.test.tsx` | `0` | **PASS** | `1 passed (1)`, `5 passed (5)` |
| `npm test -w @wap/chat-web -- tests/auth-google.test.tsx` | `0` | **PASS** | `1 passed (1)`, `43 passed (43)` |
| `npm test -w @wap/chat-web -- tests/fe-04b-prototype-foundation.test.tsx` | `0` | **PASS** | `1 passed (1)`, `6 passed (6)` |
| `npm test -w @wap/chat-web -- --maxWorkers=4` | `0` | **PASS** | `98 passed (98)` test files, `1080 passed (1080)` tests (`57.73s`) |
| `npm run build:v3` | `0` | **PASS** | Vite production build thành công (`193 modules transformed`, `dist/assets/index-DJmrU-cp.js`, `dist/assets/index-D827N8NT.css`) |
| `node scripts/test-v3-web-build-security.mjs` | `0` | **PASS** | `PASS: production build excludes credential sentinels and 7 forbidden UI claims` |
| `node scripts/test-v3-browser.mjs planora-public.spec.ts` | `NOT_RUN` | **NOT_RUN** | Không thay đổi CSS layout/geometry của Landing so với HEAD `5633e6b8` đã kiểm chứng 34/34 Playwright cases ở Vòng 4; PostgreSQL 16 sandbox không chạy trong phiên review này |

### 3.2. Kiểm chứng Mutation / Regression thực tế (Chống Mock Ảo giác)

Thực hiện 4 phép đột biến (mutation) tạm thời trên `apps/chat-web/src/pages/Landing/LandingPage.tsx` trong worktree review `review-planora-pl-03-r5`:
1. **Mutation M1:** Bỏ class `.workflow-step-card` trên thẻ bước 1 của quy trình 3 bước (`LandingPage.tsx:789`).
2. **Mutation M2:** Tắt lưu `sessionStorage.setItem('ati_prefill_prompt', ...)` trong `handleTryPlaybook` (`LandingPage.tsx:509`).
3. **Mutation M3a:** Bỏ kiểm tra độ dài mật khẩu `12..128` ký tự trong `handleSignupSubmit` (`LandingPage.tsx:450-453`).
4. **Mutation M3b:** Tắt khôi phục tiêu điểm `restoreRequestedModalFocus()` khi đóng Auth modal (`LandingPage.tsx:373`).

- **Kết quả chạy `npm test -w @wap/chat-web -- tests/fe-08-landing-auth.test.tsx tests/landing-orbital-redesign.test.tsx` khi có mutation (RED):**
  - **Exit code:** `1` (`2 failed (2)` test files, **`8 failed | 21 passed (29)`** tests):
    - `FAIL fe-08-landing-auth.test.tsx > ports Planora landing with hero rotator and three workflow step cards` (`expected length 3 but got 2`)
    - `FAIL fe-08-landing-auth.test.tsx > blocks short signup passwords even when a form submit bypasses native validation` (`Unable to find role="alert"`)
    - `FAIL fe-08-landing-auth.test.tsx > returns focus to the actual opener after Escape/close/forgot closes its routed modal` (3 ca fail: `Expected element with focus: <a data-od-id="...">, Received: <body>`)
    - `FAIL fe-08-landing-auth.test.tsx > shows the root Google transfer modal for a real pending HTTP response and discards it after close` (`expect(opener).toHaveFocus()` fail)
    - `FAIL landing-orbital-redesign.test.tsx > Item #2: renders Planora 3-step workflow illustration` (`expected length 3 but got 2`)
    - `FAIL landing-orbital-redesign.test.tsx > Item #7: clicking Dùng thử kịch bản này saves ati_prefill_prompt to sessionStorage` (`expected null to be truthy`)
- **Khôi phục code gốc & chạy lại (GREEN):**
  - Chạy `git checkout -- apps/chat-web/src/pages/Landing/LandingPage.tsx` (`git status -s` sạch hoàn toàn) và chạy lại `npm test -w @wap/chat-web -- tests/fe-08-landing-auth.test.tsx tests/landing-orbital-redesign.test.tsx` -> **PASS 29/29 tests (exit code 0)**.

---

## 4. Ghi chú Nhỏ Không Chặn (Non-Blocking Notes)

- **[P3-N1] `apps/chat-web/src/pages/Landing/LandingPage.tsx:1046, 1052`:** Hai thẻ trong mục Auto-Digest sử dụng ký tự emoji trang trí (`🛡️`, `⚡`) trong `.planora-proof-num` (ngoài vùng `<nav>` điều hướng chính). Không ảnh hưởng tới trợ năng của thanh điều hướng hay hành vi nghiệp vụ; có thể thay bằng icon SVG `aria-hidden="true"` ở đợt tinh chỉnh chung tiếp theo.
- **[P3-N2] `apps/chat-web/tests/fe-08-landing-auth.test.tsx`:** Các thay đổi trình bày/copy của Round 5 (vector input icons `.planora-auth-input-icon`, chữ ký `.planora-auth-endnote`, và bỏ thẻ bọc `.planora-auth-tabs` lồng nhau) là tinh chỉnh CSS/markup thuần túy theo `COMMON.md` nên được bảo vệ bởi bộ regression hiện có (98 files / 1080 tests PASS).

---

## 5. Đánh giá Tổng hợp & Kết luận (Verdict)

- **Đánh giá Behavior & Technical:** **PASS**
- **Đánh giá UX Gate 05/11 (Business-First & Design Brief v2.0 MẪU 1):** **ĐẠT**
- **Findings (P1 / P2 / P3 cần sửa):** Không còn finding nào chặn nghiệm thu.
- **Overall Verdict:** **Đạt**

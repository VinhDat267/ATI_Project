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

- [ ] Giữ toàn bộ hành vi của `fe-08-landing-auth` và `auth-02-signup-reset`: tất cả các ca kiểm thử đăng nhập, đăng ký, validation mật khẩu, error message, Google auth đều PASS.
- [ ] Màn hình Landing chuẩn Planora với hero, ví dụ quy trình 3 bước, CTA rõ ràng, điều hướng công khai (Cẩm nang, Chính sách an toàn, Đăng nhập).
- [ ] Không gây tràn ngang trên các viewport từ 320px đến 1440px ở cả Light và Dark mode.
- [ ] `npm run typecheck:v3` exit 0.
- [ ] `npm run build:v3` exit 0.
- [ ] `npm test -w @wap/chat-web` PASS 100%, không hồi quy bất kỳ test suite nào.
- [ ] Có ảnh chụp trực quan kiểm chứng trên các viewport (1440px, 1024px, 768px, 375px, 320px).
- [ ] Gửi packet `READY_FOR_CODEX_REVIEW` cho Codex re-review độc lập.

---

## 5. Kết quả

*(Worker điền sau khi hoàn thành nhiệm vụ)*

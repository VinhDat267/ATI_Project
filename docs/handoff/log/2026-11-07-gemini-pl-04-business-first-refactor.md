# 2026-11-07 · gemini · PL-04 · Refactor Advanced Auth & Callbacks theo Business-First UX v2.0

- **Nhiệm vụ:** [PL-04 · Xác thực nâng cao và vòng đời tài khoản (Advanced Auth)](../tasks/PL-04-planora-auth-lifecycle.md)
- **UX Task:** [PLANORA-UX-01 · Business-First Redesign](../tasks/PLANORA-UX-01-business-first-redesign.md)
- **Worktree:** `feat-planora-pl-04`
- **Nhánh:** `longnguyen005/feat-planora-pl-04`
- **Target branch:** `codex/planora-ui`

---

## 1. Mục tiêu & Bối cảnh

Module PL-04 (Advanced Auth & Callbacks) được refactor để đạt chuẩn Business-First UX v2.0 đồng bộ với PL-02 và PL-03:
1. **Vector Input Icons:**
   - Bổ sung vector SVG Mail icon (`.planora-auth-input-icon`) và class `.has-icon-left` cho ô nhập email gửi lại xác minh trong `verify-expired` và `email-not-verified`.
   - Bổ sung vector SVG Lock icon (`.planora-auth-input-icon`) và class `.has-icon-left` cho ô nhập mật khẩu mới và xác nhận mật khẩu mới trong `reset-password`.
2. **Chữ ký nghệ thuật Planora (Signature Endnote):**
   - Tích hợp `.planora-auth-endnote` (*"Một lời nhắn. Một khởi đầu nhẹ nhàng."*) kèm vector icon nhẹ nhàng trên các view xác thực, tạo sự liền mạch thương hiệu Planora.
3. **Triệt tiêu Emoji trần & Tiêu chuẩn Trợ năng (A11y):**
   - Loại bỏ hoàn toàn ký tự emoji trần `⏳` trong màn hình `blocked-pending`, thay thế bằng huy hiệu số 2 sạch sẽ đồng bộ quy trình 1 - 2 - 3.
   - Bổ sung thuộc tính `aria-hidden="true"` cho 100% các icon SVG vector trang trí, đảm bảo khả năng đọc của trình đọc màn hình.
4. **Copywriting hướng giá trị công việc:**
   - Đồng bộ thông điệp chân trang: *"Planora — Nền tảng điều phối công việc liên dịch vụ · 2026 · Xác thực tài khoản và phân quyền quản trị"*.
5. **Bảo toàn 100% hợp đồng kỹ thuật và kiểm thử:**
   - Giữ nguyên toàn bộ 13 modes của `AuthActionPage`, DOM IDs (`#view-*`, `#resend-email-input`, `#btn-submit-resend`, `#new-password-input`, `#confirm-password-input`, `#blocked-timer-display`, v.v.), countdown timer từ deadline, 4-stage password strength meter, và chống double-trigger của Google callback.

---

## 2. Chi tiết các tệp đã sửa đổi

1. **`apps/chat-web/src/pages/AuthAction/AuthActionPage.tsx`:**
   - Tích hợp vector SVG Mail icon và Lock icon vào ô input, gắn class `.has-icon-left`.
   - Bổ sung `{signatureEndnote}` vào các view hành động xác thực.
   - Chuẩn hóa thuộc tính `aria-hidden="true"` trên toàn bộ 35 thẻ `<svg>`.
   - Thay thế emoji `⏳` bằng số 2 trong bước duyệt tài khoản `blocked-pending`.
   - Cập nhật văn bản chân trang theo định vị nền tảng điều phối công việc liên dịch vụ.

2. **`apps/chat-web/src/pages/AuthAction/page.css`:**
   - Bổ sung quy tắc CSS tự thân cho `.planora-auth-input-wrapper`, `.planora-auth-input-icon`, `.planora-auth-input.has-icon-left`, và `.planora-auth-endnote`.

3. **`apps/chat-web/tests/planora-auth-lifecycle.test.tsx`:**
   - Thêm suite kiểm thử mới `Business-First UX v2.0: Input Vector Icons, Signature Endnote & Zero Raw Emojis` (5 tests mới, nâng tổng số lên 28 tests) bao phủ:
     - Vector mail icon & class `.has-icon-left` trên `verify-expired` và `email-not-verified`.
     - Vector lock icons & eye toggles với `aria-hidden="true"` trên `reset-password`.
     - Endnote chữ ký Planora hiển thị trên các view.
     - Kiểm tra không có emoji `⏳` và chuỗi bước 1 - 2 - 3 trong `blocked-pending`.
     - Footer copy chuẩn Business-First, không chứa thuật ngữ AI kỹ thuật.

4. **`docs/handoff/tasks/PL-04-planora-auth-lifecycle.md`:**
   - Bổ sung mục 7 ghi nhận kết quả và bằng chứng kiểm thử của đợt refactor Business-First UX v2.0.

---

## 3. Bằng chứng Kiểm thử Thực tế

| Lệnh kiểm thử | Kết quả | Ghi chú |
|---|---|---|
| `npm run typecheck:v3` | **PASS (exit code 0)** | Chat API & Chat Web 0 lỗi TypeScript |
| `npm run build:v3` | **PASS (exit code 0)** | Build Vite production thành công |
| `node scripts/test-v3-web-build-security.mjs` | **PASS (exit code 0)** | Loại trừ credential sentinels và 7 claim UI bị cấm |
| `node --check scripts/test-v3-browser.mjs` | **PASS (exit code 0)** | Cú pháp script kiểm tra trình duyệt hợp lệ |
| `npm test -w @wap/chat-web -- tests/planora-auth-lifecycle.test.tsx` | **PASS (28/28 tests, exit code 0)** | Toàn bộ unit tests của PL-04 pass |
| `npm test -w @wap/chat-web -- tests/auth-google.test.tsx tests/auth-signup-reset.test.tsx tests/auth-return-target.test.tsx` | **PASS (57/57 tests, exit code 0)** | Toàn bộ luồng auth/google/reset pass |
| `npm test -w @wap/chat-web` | **PASS (99/99 files, 1108/1108 tests, exit code 0)** | Toàn bộ test suite web xanh sạch, 0 hồi quy |

---

## 4. Trạng thái Bàn giao

- **Trạng thái:** `STATUS: READY_FOR_CODEX_REVIEW`.
- Không sửa `CURRENT-STATE.md` hay `ROADMAP.md` (chỉ reviewer cập nhật sau khi merge).

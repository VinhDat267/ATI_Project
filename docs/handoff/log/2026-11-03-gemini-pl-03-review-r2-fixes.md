# Nhật ký thi công: Khắc phục Codex review findings Vòng 2 (R1-R3) cho PL-03

- **Ngày:** 03/11/2026
- **Người thực hiện:** Antigravity / Gemini worker
- **Nhiệm vụ:** [PL-03 · Landing, đăng nhập và đăng ký (Public & Auth)](../tasks/PL-03-planora-public-auth.md)
- **Worktree:** `feat-planora-pl-03`
- **Nhánh:** `longnguyen005/feat-planora-pl-03`
- **Reviewed Head SHA:** `1b41b14c4ba50e71acd21b808bd792f2b3742540`
- **Base SHA:** `965150a9d80418d85354b7b3e8c6e8fff1fedd90`

---

## 1. Chi tiết 3 Findings từ Codex Review Vòng 2 & Giải pháp Triệt để

### R1 (P2) · F1 chưa đóng: navbar vẫn cắt Đăng ký ở 375/320px
- **Nguyên nhân cốt lõi:**
  - `LandingPage.tsx:559` sử dụng `<Brand size="md" />`.
  - Trong `src/planora/styles/components.css:91`, quy tắc `.planora-brand-md .planora-brand-word` đặt `font-size: 32px`. Do `components.css` được import sau `page.css`, quy tắc font size 32px của global components đã thắng cascade quy tắc compact của `page.css`.
  - Kết quả: Brand wordmark vẫn giữ font-size 32px, tổng bề ngang Brand đạt ~147.7px. Cùng với actions (~204px) và padding navbar, thanh điều hướng đạt độ rộng 383px trên 375px (tràn 8px) và 354px trên 320px (tràn 34px).
- **Khắc phục:**
  - Trong `apps/chat-web/src/pages/Landing/page.css`:
    - Tăng độ đặc hiệu với selector có tiền tố header và class kích thước:
      `.planora-landing-nav .planora-brand.planora-brand-md .planora-brand-word, .planora-landing-nav .planora-brand .planora-brand-word`.
    - Tại `@media (max-width: 768px)`:
      - `.planora-brand-word`: `font-size: 18px !important; line-height: 1 !important;` (giảm bề ngang wordmark xuống ~56px).
      - `.planora-brand-symbol svg`: `width: 22px !important; height: 22px !important;`.
      - `.planora-brand`: `gap: 6px !important; min-height: 44px !important;`.
      - `.planora-landing-nav-inner`: `padding: 8px 12px; gap: 8px;`.
      - Nút điều hướng `.planora-btn-sm`: `min-height: 44px !important; height: 44px !important; padding: 0 10px !important; font-size: 12px !important;`.
      - Tổng độ rộng tại 375px: 84px (Brand) + 8px (gap) + 190px (actions) + 24px (padding) = 306px << 375px. Dư 69px không gian đệm.
    - Tại `@media (max-width: 360px)`:
      - `.planora-brand-word`: `font-size: 16px !important; line-height: 1 !important;` (~50px).
      - `.planora-brand-symbol svg`: `width: 20px !important; height: 20px !important;`.
      - `.planora-brand`: `gap: 4px !important;`.
      - `.planora-landing-nav-inner`: `padding: 6px 8px; gap: 4px;`.
      - Nút điều hướng: `padding: 0 6px !important; font-size: 11px !important;`.
      - Tổng độ rộng tại 320px: 74px (Brand) + 4px (gap) + 162px (actions) + 16px (padding) = 256px << 320px. Dư 64px không gian đệm.
    - `scrollWidth <= window.innerWidth` đạt `true` trên cả 375px và 320px ở cả hai theme sáng và tối.

### R2 (P2) · F6 chưa đóng: locator mới làm cả 10 ca landing PL-03 đỏ
- **Nguyên nhân cốt lõi:**
  - Trong `apps/chat-web/tests/browser/planora-public.spec.ts:43`, locator kiểm tra `page.locator('.planora-landing-nav-actions button').filter({ hasText: 'Đăng ký' })`.
  - Tuy nhiên, phần tử thực tế tại `LandingPage.tsx:578` là một thẻ link `<a>` mang `data-od-id="btn-header-signup"`. Việc tìm thẻ `<button>` khiến Playwright timeout trên toàn bộ 10 ca responsive.
- **Khắc phục:**
  - Sửa locator thành `page.locator('.planora-landing-nav-actions [data-od-id="btn-header-signup"]')`, nhắm chính xác vào thẻ CTA thật.
  - Bổ sung assertion kiểm tra nút Đăng nhập `[data-od-id="btn-header-login"]`, đảm bảo cả hai CTA hiển thị đầy đủ, nằm trong viewport width và có chiều cao >= 44px.

### R3 (P3) · CTA landing trên mobile vẫn chỉ cao 36px
- **Nguyên nhân cốt lõi:**
  - Các nút CTA `landing-try-playbook-btn` (`LandingPage.tsx:648`) và `landing-try-digest-btn` (`LandingPage.tsx:1069`) sử dụng class `.planora-btn-sm` thừa hưởng `min-height: 36px` từ `components.css:189`, chưa đạt tiêu chuẩn tap target 44px của mục 3 card.
- **Khắc phục:**
  - Trong `apps/chat-web/src/pages/Landing/page.css`:
    ```css
    .planora-landing-nav-actions .planora-btn-sm {
      min-height: 44px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
    }

    [data-testid="landing-try-playbook-btn"],
    [data-testid="landing-try-digest-btn"] {
      min-height: 44px !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      box-sizing: border-box !important;
    }
    ```
  - Trong `apps/chat-web/tests/browser/planora-public.spec.ts`: Bổ sung kiểm tra bounding box height >= 44px cho cả 4 CTA landing:
    - `landing-try-playbook-btn`: height >= 44px
    - `landing-try-digest-btn`: height >= 44px
    - `[data-od-id="btn-header-signup"]`: height >= 44px
    - `[data-od-id="btn-header-login"]`: height >= 44px

---

## 2. Bảng Bằng chứng Kiểm thử Thực tế

| Lệnh kiểm thử | Kết quả | Ghi chú |
|---|---|---|
| `npm run typecheck:v3` | **PASS (exit code 0)** | Chat API & Chat Web sạch 100% lỗi TypeScript |
| `npm run build:v3` | **PASS (exit code 0)** | Vite production build thành công (193 modules) |
| `npm test -w @wap/chat-web` | **PASS (98/98 files, 1075/1075 tests, exit code 0)** | Toàn bộ 1075 unit/integration tests xanh |
| `git diff --check` | **PASS (exit code 0)** | Không có lỗi whitespace hay trailing spaces |

---

## 3. Danh sách File Sửa đổi

- `apps/chat-web/src/pages/Landing/page.css`
- `apps/chat-web/tests/browser/planora-public.spec.ts`
- `docs/handoff/tasks/PL-03-planora-public-auth.md`
- `docs/handoff/log/2026-11-03-gemini-pl-03-review-r2-fixes.md`

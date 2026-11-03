# PL-01 · Baseline, design tokens và component nền

**Trạng thái:** sẵn sàng nhận · **Nhánh gợi ý:** `feat/planora-pl-01` · **Phụ thuộc:** Kế hoạch/spec đã được giao thực hiện; coordinator đã khóa lại main mới nhất (`6c235837efa6811064c652b570e8c91bf8f77ab6`).  
**Base SHA:** `9402b32480d7326b9794fe711775b68a5d51d3d5` (hoặc commit tạo card này trên integration branch).  
**Target branch:** `codex/planora-ui`.  
**Đặc tả:** [Planora migration design](../../superpowers/specs/2026-11-02-planora-migration-design.md) mục 4, 5 · **Kế hoạch:** [Planora migration plan](../../superpowers/plans/2026-11-02-planora-migration.md) mục PL-01.  
**Prompt thi công:** [PL-01.md](../planora-prompts/PL-01.md).  
**Quy ước chung:** [COMMON.md](../planora-prompts/COMMON.md).

---

## 1. Mục tiêu

Tạo bộ nền Planora dùng được (design tokens, typography, CSS nền, các component cơ sở) và dựng bốn mẫu tham chiếu để chủ dự án duyệt hình thức trước khi chuyển giao diện hàng loạt ở các task tiếp theo.

---

## 2. Ranh giới sở hữu & Phạm vi file

- **Tạo mới:**
  - `apps/chat-web/src/planora/styles/tokens.css`
  - `apps/chat-web/src/planora/styles/base.css`
  - `apps/chat-web/src/planora/styles/components.css`
  - `apps/chat-web/src/planora/components/Brand.tsx`
  - `apps/chat-web/src/planora/components/Button.tsx`
  - `apps/chat-web/src/planora/components/Field.tsx`
  - `apps/chat-web/src/planora/components/StatusBadge.tsx`
  - `apps/chat-web/src/planora/samples/` (hoặc các component mẫu cho 4 màn cần duyệt)
- **Sửa đổi cho phép:**
  - `apps/chat-web/src/index.css` (tích hợp token Planora)
  - `apps/chat-web/index.html` (font, favicon, tiêu đề)
  - `apps/chat-web/DESIGN.md` và `DESIGN.md` (cập nhật design authority ghi rõ Planora thay thế phần thị giác, giữ nguyên logic v3)
  - Copy có chọn lọc tài nguyên tĩnh có bản quyền: `public/fonts`, logo/favicon Planora từ commit `ef13c5695ce2da030ff613422b4f8d6e1d7e72c3` (`Frontend_UXUI`).
- **Ngoài phạm vi:**
  - Không sửa `apps/chat-api`, `packages/*`, `db/v3`, `prompts`, `evaluations`.
  - Không sửa logic backend, router hay phá vỡ 22 route entries của `apps/chat-web`.
  - Không chuyển hàng loạt các màn hình khác ngoài 4 mẫu tham chiếu.

---

## 3. Interfaces & Design Tokens

- **CSS Variables `--planora-*`:**
  - Light mode:
    - canvas: `#f8f4eb`
    - paper: `#fffdf7`
    - sidebar: `#eee9dd`
    - text: `#2e382d`
    - muted: `#656b5b`
    - divider: `#deded0`
    - primary: `#3c5741`
    - primary-hover: `#2f4633`
    - primary-soft: `#e4e9d8`
    - pending bg/text: `#f6e6cf` / `#85532b`
    - error bg/text: `#f8e6df` / `#9a3f32`
    - unknown bg/text: `#eee6f2` / `#654576`
  - Dark mode (đề xuất bổ sung, cần kiểm tương phản):
    - canvas: `#171c18`
    - paper: `#202820`
    - sidebar: `#151b16`
    - text: `#f5f1e7`
    - muted: `#b5bcae`
    - divider: `#394638`
    - primary: `#8fb68e`
    - on-primary: `#132014`
  - Theme key: giữ nguyên preference `ati-theme` và event `ati:theme`.
- **Component nền:**
  - `Brand`: logo Planora, hỗ trợ kích thước và biến thể.
  - `Button`: wrapper nhận native button props (`disabled`, `onClick`, `type`, `aria-*`), các variant (`primary`, `secondary`, `ghost`, `danger`), không bọc API call.
  - `Field`: wrapper native input / textarea kèm label, error message, helper text.
  - `StatusBadge`: hiển thị trạng thái chuẩn (success, pending, error, unknown) theo semantic tokens.

---

## 4. Bốn mẫu cần trình duyệt

1. **Landing:** giới thiệu Planora, hero, illustration, nhận diện thương hiệu.
2. **Chat có plan:** hội thoại làm trung tâm, một composer ở đáy, card plan/step hiển thị rõ.
3. **Settings có OAuth/scope:** cấu hình kết nối dịch vụ, trạng thái kết nối và danh sách tài nguyên trong phạm vi (kèm dữ liệu cập nhật từ PR #260).
4. **Nhật ký có lịch:** danh sách lịch chạy, trạng thái chạy và nhật ký hoạt động.
*(Lưu ý: Mẫu chưa kết nối API thật phải có nhãn "Demo / Mẫu tham chiếu" rõ ràng).*

---

## 5. Tiêu chí nghiệm thu

- [ ] Baseline main mới nhất đã khóa tại SHA `6c235837efa6811064c652b570e8c91bf8f77ab6`; inventory diff GitHub PR #260 được đối chiếu.
- [ ] CSS tokens `--planora-*` đầy đủ cho cả light và dark mode; contrast chữ/nền đạt chuẩn WCAG AA ≥ 4.5:1.
- [ ] Fonts tự host Be Vietnam Pro, Times New Roman/Georgia (tiêu đề), font mono kiểm tra license hợp lệ và không lỗi tải.
- [ ] Bốn component nền (`Brand`, `Button`, `Field`, `StatusBadge`) chạy đúng, gõ type sạch, hỗ trợ accessibility.
- [ ] Bốn mẫu trình duyệt hoàn thiện, có thể hiển thị và chụp ảnh minh họa ở cả 2 theme (sáng/tối).
- [ ] `npm run build:v3` exit 0, không có lỗi TypeScript hay bundle.
- [ ] Ảnh chụp màn hình tại 1440×900 và 375×812 (sáng và tối), kiểm tra overflow tại 320px.
- [ ] Gói bàn giao đầy đủ theo mẫu tại `COMMON.md` để chuyển sang Codex review độc lập.
- [ ] Dừng lại sau PL-01 để chủ dự án duyệt bộ mẫu trước khi triển khai các task tiếp theo.

---

## 6. Kết quả

*(Worker điền sau khi hoàn thành nhiệm vụ)*

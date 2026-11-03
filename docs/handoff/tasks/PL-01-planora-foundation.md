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

- [x] Baseline main mới nhất đã khóa tại SHA `6c235837efa6811064c652b570e8c91bf8f77ab6`; inventory diff GitHub PR #260 được đối chiếu.
- [x] CSS tokens `--planora-*` đầy đủ cho cả light và dark mode; contrast chữ/nền đạt chuẩn WCAG AA ≥ 4.5:1.
- [x] Fonts tự host Be Vietnam Pro, Times New Roman/Georgia (tiêu đề), font mono kiểm tra license hợp lệ và không lỗi tải.
- [x] Bốn component nền (`Brand`, `Button`, `Field`, `StatusBadge`) chạy đúng, gõ type sạch, hỗ trợ accessibility.
- [x] Bốn mẫu trình duyệt hoàn thiện, có thể hiển thị và chụp ảnh minh họa ở cả 2 theme (sáng/tối).
- [x] `npm run build:v3` exit 0, không có lỗi TypeScript hay bundle.
- [x] Ảnh chụp màn hình tại 1440×900 và 375×812 (sáng và tối), kiểm tra overflow tại 320px.
- [x] Gói bàn giao đầy đủ theo mẫu tại `COMMON.md` để chuyển sang Codex review độc lập.
- [x] Dừng lại sau PL-01 để chủ dự án duyệt bộ mẫu trước khi triển khai các task tiếp theo.

---

## 6. Kết quả

- **Hoàn thành ngày:** 03/11/2026 bởi Antigravity / Gemini worker.
- **Base SHA:** `91f52a0b134d8ccc47641da58f9d5a1223fb7d83` (trên integration branch `feat/planora-pl-01`, fast-forward từ main `6c235837efa6811064c652b570e8c91bf8f77ab6`).
- **Inventory & Baseline:**
  - Đối chiếu 14 files thay đổi từ GitHub PR #260 (`ec31403`): 9 tools `GITHUB_OAUTH_TOOLS`, chọn kho cá nhân (giới hạn 10 kho), nhãn Private/Public, đích gửi `github_digest` tới Slack/Telegram.
- **Design Tokens & Typography:**
  - `apps/chat-web/src/planora/styles/tokens.css`: CSS Variables `--planora-*` đầy đủ cho cả light và dark mode.
  - Tương phản WCAG AA: Đạt ≥ 4.5:1 cho toàn bộ cặp màu (Light: text/canvas 11.12:1, text/paper 12.0:1, text/sidebar 10.08:1, muted/paper 5.42:1, primary/paper 7.84:1; Dark: text/canvas 15.31:1, text/paper 13.44:1, text/sidebar 15.51:1, muted/paper 7.77:1, primary/paper 6.67:1, on-primary/primary 7.43:1; Status badges: pending 9.13:1, error 8.42:1, unknown 9.24:1, success 11.27:1).
  - Tự host font Be Vietnam Pro (regular, medium, semibold) trong `apps/chat-web/public/fonts/` kèm giấy phép SIL Open Font License 1.1 (`OFL.txt`). Tự host logo favicon Planora SVG và 8 logo dịch vụ SVG/PNG từ `ef13c56`.
- **Component cơ sở & Trình duyệt mẫu:**
  - Tạo `Brand.tsx` (monogram P SVG, wordmark, subtitle, ServiceLogo cho 8 dịch vụ).
  - Tạo `Button.tsx` (nhận native HTML button props, variants primary/secondary/ghost/danger, sizes sm/md/lg, square, không bọc API call).
  - Tạo `Field.tsx` (hỗ trợ input một dòng và textarea đa dòng, liên kết aria-invalid/aria-describedby theo WCAG).
  - Tạo `StatusBadge.tsx` (4 trạng thái chuẩn success/pending/error/unknown theo semantic tokens).
  - Xây dựng 4 mẫu tham chiếu: `LandingSample.tsx`, `ChatPlanSample.tsx` (sidebar 248px, card kế hoạch 2 bước kèm `plan_hash`, một composer đáy), `SettingsScopeSample.tsx` (OAuth GitHub/Trello/Sheets với tìm kiếm nhanh, nhãn Private/Public, 10/10 kho và đích gửi digest), `HistoryScheduleSample.tsx` (lịch chạy, needs_attention, nhật ký thực thi).
  - `PlanoraShowcase.tsx`: Bộ điều khiển chuyển đổi giữa 4 mẫu và toggle theme sáng/tối đồng bộ `ati-theme`.
- **Cập nhật Design Authority:**
  - Tạo `apps/chat-web/DESIGN.md` quy định chuẩn tắc thị giác Planora thay thế phong cách Agentic cũ, bảo tồn toàn bộ logic nghiệp vụ v3.
  - Cập nhật thông báo `DESIGN.md` gốc trỏ sang `apps/chat-web/DESIGN.md`.
  - Cập nhật `apps/chat-web/index.html` và `apps/chat-web/src/index.css` tích hợp tokens Planora.
- **Bằng chứng kiểm thử:**
  - `npm run test -w @wap/chat-web`: 97 test files / 1056 tests PASS, exit 0 (trong đó có 19 tests của `tests/planora-foundation.test.tsx`).
  - `npm run typecheck:v3`: PASS, exit 0.
  - `npm run build:v3`: PASS, exit 0.
  - `node scripts/test-v3-web-build-security.mjs`: PASS, exit 0.
  - Chụp ảnh tự động 16 ảnh (`scripts/capture-planora-pl01.mjs`) lưu tại `docs/evidence/PL-01/`:
    - 4 mẫu tại 1440×900 (sáng và tối).
    - 4 mẫu tại 375×812 (sáng và tối).
    - Kiểm tra tràn ngang tại 320px: 4/4 mẫu PASS (scrollWidth: 320px, không tràn ngang).
- **Khắc phục các finding P2 từ Codex review (F1 - F5):**
  - **F1 (Chat mobile layout & composer desktop docked):** Thêm `.planora-mobile-nav-toggle` và `.planora-sidebar-open` cho sidebar trên mobile; thiết lập `.planora-chat-plan-sample` có `height: calc(100vh - 60px)` trên desktop giúp feed cuộn độc lập và composer luôn ghim tại đáy viewport 900px; trên mobile controls co giãn tự nhiên (`flex-wrap: wrap`, textarea `min-width: 0`), script capture chứng minh các bounding box (`approveBtn`, `textarea`, `sendBtn`) không bị clipping tại 375px và 320px.
  - **F2 (Bảng nhật ký có vùng cuộn ngang trên mobile):** Bọc bảng trong `.planora-table-scroll` (`overflow-x: auto`), khai báo `role="region"`, `aria-label="Bảng nhật ký thực thi gần đây"`, `tabIndex={0}`, bảng có `minWidth: 540` đảm bảo cột "Chi tiết kết quả" xem được trọn vẹn.
  - **F3 (Hợp đồng theme showcase):** `showcase.html` tích hợp `#theme-bootstrap` inline script giải quyết FOUC trước first paint; `PlanoraShowcase.tsx` chuyển sang dùng hook chuẩn `useTheme()` đồng bộ hoàn toàn với `localStorage('ati-theme')`, `data-theme`, `colorScheme` và CustomEvent `ati:theme`.
  - **F4 (Placeholder contrast WCAG AA ≥ 4.5:1):** Đặt `--planora-placeholder: #686e5e` (Light, 5.19:1 trên paper, 4.81:1 trên canvas) và `--planora-placeholder: #9ba393` (Dark, 5.81:1 trên paper, 6.62:1 trên canvas); áp dụng vào `.planora-field-input::placeholder` và `.planora-field-textarea::placeholder`.
  - **F5 (Field aria-describedby composition & no phantom ID):** Tách `aria-describedby` ngoại vi, chỉ sinh `helperId` khi không có lỗi, ghép `[errorId, helperId, externalDescribedBy]` loại bỏ triệt để IDREF ảo.
- **Trạng thái:** `FIXES_APPLIED_READY_FOR_RECHECK`. Đã sửa toàn bộ 5 findings P2, vượt qua 100% kiểm thử và assertions thực tế.

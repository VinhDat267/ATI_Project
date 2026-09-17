---
version: alpha
name: ATI Operations
description: "Light-first operational workspace: navy primary on clean white/slate neutrals, semantic run-status colors that always pair with icon and text, dense but readable Vietnamese payloads."
colors:
  primary: "#1E3A5F"
  primary-hover: "#162D4A"
  primary-subtle: "#E8EEF6"
  on-primary: "#FFFFFF"
  background: "#F8FAFC"
  surface: "#FFFFFF"
  surface-muted: "#F1F5F9"
  on-surface: "#0F172A"
  on-surface-muted: "#475569"
  on-surface-subtle: "#64748B"
  border: "#E2E8F0"
  border-control: "#64748B"
  link: "#1D4ED8"
  focus-ring: "#2563EB"
  progress: "#1D4ED8"
  progress-subtle: "#DBEAFE"
  success: "#166534"
  success-subtle: "#DCFCE7"
  action: "#92400E"
  action-subtle: "#FEF3C7"
  danger: "#B91C1C"
  danger-hover: "#991B1B"
  danger-subtle: "#FEE2E2"
  unknown: "#9A3412"
  unknown-subtle: "#FFEDD5"
  neutral: "#334155"
  neutral-subtle: "#F1F5F9"
  planner: "#5B21B6"
  planner-subtle: "#EDE9FE"
  demo: "#854D0E"
  demo-subtle: "#FEF9C3"
  tooltip: "#0F172A"
  on-tooltip: "#FFFFFF"
typography:
  headline-lg:
    fontFamily: "ui-sans-serif, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: "ui-sans-serif, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 28px
  title-md:
    fontFamily: "ui-sans-serif, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 24px
  body-lg:
    fontFamily: "ui-sans-serif, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 26px
  body-md:
    fontFamily: "ui-sans-serif, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 22px
  body-sm:
    fontFamily: "ui-sans-serif, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 20px
  label-md:
    fontFamily: "ui-sans-serif, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
  label-sm:
    fontFamily: "ui-sans-serif, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
  caption:
    fontFamily: "ui-sans-serif, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 18px
    fontFeature: "'tnum' 1"
  mono-md:
    fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, 'SFMono-Regular', Menlo, monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 20px
  mono-sm:
    fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, 'SFMono-Regular', Menlo, monospace"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 18px
rounded:
  none: 0px
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 48px
  sidebar-width: 240px
  header-height: 56px
  content-max: 1200px
  gutter-mobile: 16px
  control-height: 36px
  row-height: 44px
components:
  page:
    backgroundColor: "{colors.background}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
    padding: 16px
  card-divider:
    backgroundColor: "{colors.border}"
    height: 1px
  sidebar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface-muted}"
    width: "{spacing.sidebar-width}"
  nav-item:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 8px 12px
  nav-item-active:
    backgroundColor: "{colors.primary-subtle}"
    textColor: "{colors.primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: "{spacing.control-height}"
    padding: 0px 16px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: "{spacing.control-height}"
    padding: 0px 16px
  button-secondary-hover:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.primary}"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: "{spacing.control-height}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: "{spacing.control-height}"
    padding: 0px 16px
  button-danger-hover:
    backgroundColor: "{colors.danger-hover}"
    textColor: "{colors.on-primary}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    height: "{spacing.control-height}"
    padding: 0px 12px
  input-border:
    backgroundColor: "{colors.border-control}"
    width: 1px
  input-helper:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface-subtle}"
    typography: "{typography.caption}"
  focus-ring:
    backgroundColor: "{colors.focus-ring}"
    width: 2px
  link:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.link}"
    typography: "{typography.label-md}"
  tab-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    typography: "{typography.label-md}"
  tab-inactive:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.label-md}"
  list-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    height: "{spacing.row-height}"
    padding: 0px 16px
  list-row-hover:
    backgroundColor: "{colors.background}"
    textColor: "{colors.on-surface}"
  status-progress:
    backgroundColor: "{colors.progress-subtle}"
    textColor: "{colors.progress}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: 2px 8px
  status-action:
    backgroundColor: "{colors.action-subtle}"
    textColor: "{colors.action}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: 2px 8px
  status-success:
    backgroundColor: "{colors.success-subtle}"
    textColor: "{colors.success}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: 2px 8px
  status-danger:
    backgroundColor: "{colors.danger-subtle}"
    textColor: "{colors.danger}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: 2px 8px
  status-unknown:
    backgroundColor: "{colors.unknown-subtle}"
    textColor: "{colors.unknown}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: 2px 8px
  status-neutral:
    backgroundColor: "{colors.neutral-subtle}"
    textColor: "{colors.neutral}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: 2px 8px
  status-planner:
    backgroundColor: "{colors.planner-subtle}"
    textColor: "{colors.planner}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: 2px 8px
  banner-unknown:
    backgroundColor: "{colors.unknown-subtle}"
    textColor: "{colors.unknown}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: 12px 16px
  banner-action:
    backgroundColor: "{colors.action-subtle}"
    textColor: "{colors.action}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: 12px 16px
  badge-demo:
    backgroundColor: "{colors.demo-subtle}"
    textColor: "{colors.demo}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.sm}"
    padding: 2px 8px
  action-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: 16px
  payload-block:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.on-surface}"
    typography: "{typography.mono-md}"
    rounded: "{rounded.md}"
    padding: 12px
  identifier:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.mono-sm}"
  tooltip:
    backgroundColor: "{colors.tooltip}"
    textColor: "{colors.on-tooltip}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 6px 10px
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.xl}"
    padding: 24px
---

# ATI UI/UX and Design System

**Trạng thái: `DIRECTION_SELECTED` — người dùng chọn hướng A (navy trầm, nền trắng/slate sạch) ngày 17/09/2026.** Token và quy tắc dưới đây là hợp đồng thị giác cho WEB-01C trở đi, theo [ADR-002](docs/ADR-002-FRONTEND-UI-DATA-LAYER.md). Chưa được kiểm chứng trên màn hình thật: cần review trực quan (canvas/mockup) các màn V05 chờ duyệt, V05 cần đối chiếu và V02 trước khi coi là `APPROVED_FOR_IMPLEMENTATION`. Hướng Airtable trước đó đã bị người dùng rút lại ngày 16/09/2026 và file tham khảo đã xoá ngày 17/09/2026.

## Overview

ATI là **công cụ vận hành có kiểm soát**, không phải trang marketing. Người dùng (trưởng nhóm dự án môn học) cần đọc kỹ kế hoạch, payload sẽ ghi, thời hạn duyệt và chứng cứ sau khi chạy. Giao diện phải tạo cảm giác **bình tĩnh, chính xác, đáng tin**: nền trắng/slate trung tính, primary navy trầm, màu chỉ xuất hiện khi mang nghĩa trạng thái hoặc hành động.

Nguyên tắc cốt lõi:

- **Nội dung là nhân vật chính.** Payload, đích ghi, lý do lỗi và timestamp quan trọng hơn trang trí. Không gradient, không minh hoạ, không glassmorphism, không số liệu trang trí.
- **Màu có nghĩa cố định.** Mỗi họ màu gắn với một nhóm trạng thái (xem Components → Run status). Màu không bao giờ là tín hiệu duy nhất: luôn đi kèm icon và chữ.
- **Server là authority.** UI không tạo cảm giác chắc chắn giả: không phần trăm tiến trình tự tính, không “thành công” trước khi server xác nhận, không animation gợi ý đã xong.
- **Mật độ vừa phải.** Dày hơn trang tài liệu, thoáng hơn bảng tính: đọc được đoạn tiếng Việt dài mà vẫn quét được danh sách.
- **Light-first.** B/local chỉ có giao diện sáng. Dark mode ngoài phạm vi; token màu đặt tên theo vai trò để có thể thêm sau mà không đổi component.

Nguồn tham khảo đã chọn lọc (không sao chép nguyên): bảng màu navy/slate và chip quy trình của CorpScale; quy tắc audit-trail của ComplianceOne; cấu trúc token của Command Center; quy tắc tương tác kiểu Vercel. Các mẫu này chỉ là input thị giác.

## Colors

Bảng màu gồm một primary navy, thang neutral slate và bảy họ màu ngữ nghĩa. Mỗi họ có cặp **đậm (chữ/icon)** và **nhạt (nền)**, mọi cặp đạt WCAG AA ≥ 4.5:1 cho chữ thường.

**Primary và neutral**

- **Navy (#1E3A5F) — `primary`:** hành động chính (Lập kế hoạch, Duyệt), mục điều hướng đang chọn, tab đang chọn. Chữ trắng trên navy 11.5:1. Hover `primary-hover` (#162D4A). Nền chọn nhẹ `primary-subtle` (#E8EEF6).
- **Slate canvas (#F8FAFC) — `background`:** nền trang. **White (#FFFFFF) — `surface`:** card, sidebar, dialog, input. **Slate muted (#F1F5F9) — `surface-muted`:** khối payload, vùng phụ.
- **Ink (#0F172A) — `on-surface`:** chữ chính. **Slate 600 (#475569) — `on-surface-muted`:** chữ phụ, nhãn, nav chưa chọn. **Slate 500 (#64748B) — `on-surface-subtle`:** helper text, timestamp — **chỉ đặt trên `surface` hoặc `background`**, không đặt trên `surface-muted` (4.34:1, không đạt AA).
- **Border (#E2E8F0):** viền card/divider mang tính trang trí. **Border control (#64748B):** viền input, checkbox, radio — đạt 4.76:1, vượt ngưỡng 3:1 cho thành phần giao diện.
- **Link (#1D4ED8)**, **Focus ring (#2563EB)** 2px với offset 2px, 5.17:1 trên nền trắng.

**Họ màu ngữ nghĩa**

| Token | Đậm / nhạt | Ý nghĩa | Contrast |
|---|---|---|---|
| `progress` | #1D4ED8 / #DBEAFE | Hệ thống đang xử lý, người dùng chỉ cần chờ | 5.49:1 |
| `action` | #92400E / #FEF3C7 | Cần người dùng quyết định ngay (chờ duyệt, TTL) | 6.37:1 |
| `success` | #166534 / #DCFCE7 | Hoàn tất có xác nhận của server | 6.49:1 |
| `danger` | #B91C1C / #FEE2E2 | Lỗi đã biết, hành động phá huỷ | 5.30:1 |
| `unknown` | #9A3412 / #FFEDD5 | Kết quả ghi **chưa xác định**, cần đối chiếu | 6.38:1 |
| `neutral` | #334155 / #F1F5F9 | Kết thúc không lỗi do người/thời gian (từ chối, huỷ, hết hạn) | 9.45:1 |
| `planner` | #5B21B6 / #EDE9FE | Planner không tạo được kế hoạch (từ chối hỗ trợ, cần bổ sung) | 7.57:1 |
| `demo` | #854D0E / #FEF9C3 | Dữ liệu mô phỏng/fixture | 6.38:1 |

`action` (amber) và `unknown` (cam đất) gần nhau về sắc: luôn phân biệt thêm bằng icon và nhãn chữ. `danger` đặc (#B91C1C, chữ trắng 6.47:1) chỉ dùng cho nút phá huỷ; từ chối duyệt **không** phải hành động phá huỷ.

## Typography

Dùng **font hệ thống**, không tải font từ CDN (ràng buộc ADR-001/002). Trên Windows là Segoe UI, trên macOS/iOS là San Francisco, Android là Roboto — đều hiển thị đủ dấu tiếng Việt. Mono dùng Cascadia Mono/Consolas/SF Mono cho định danh, hash, JSON payload.

- **Headline (`headline-lg` 24/32, `headline-md` 20/28, 600):** tiêu đề trang và tiêu đề run. Không dùng cỡ hero.
- **Title (`title-md` 16/24, 600):** tiêu đề card, ActionCard, section trong chi tiết run.
- **Body (`body-md` 14/22):** chữ mặc định. `body-lg` 16/26 cho đoạn yêu cầu gốc và mô tả payload dài. `body-sm` 13/20 cho mô tả phụ.
- **Label (`label-md` 14/20, `label-sm` 12/16, 500):** nút, nav, tab, badge trạng thái.
- **Caption (12/18, tabular numbers):** timestamp, đếm ngược TTL, số lượng — số không nhảy độ rộng khi cập nhật mỗi 2 giây.
- **Mono (`mono-md` 13/20, `mono-sm` 12/18):** `run_id`, `approval_id`, `snapshot_hash`, tên tool, JSON.

Line-height thân chữ ≥ 1.5 để dấu tiếng Việt chồng (ví dụ “ệ”, “ỗ”) không chạm dòng trên. Tối đa hai độ đậm trên một vùng (400 và 500/600). Không viết hoa toàn bộ câu tiếng Việt; chỉ nhãn nhóm ngắn được dùng chữ hoa nhỏ.

## Layout

- **Khung desktop (≥ 1024px):** sidebar trái 240px nền trắng, viền phải `border`; header 56px chứa tên trang, nhãn chế độ (demo/live) và phiên; nội dung tối đa 1200px, padding 24px.
- **Tablet (768–1023px):** sidebar thu thành nút “Điều hướng” mở panel; nội dung một cột.
- **Mobile (390px, tối thiểu 320px):** gutter 16px, mọi hàng hành động xếp dọc, không cuộn ngang trang; bảng chuyển thành danh sách thẻ, khối payload tự cuộn ngang bên trong.
- **Thang spacing 4px:** 4 / 8 / 12 / 16 / 24 / 32 / 48. Khoảng giữa section 24px, trong nhóm liên quan 12–16px, padding card 16px (dialog 24px).
- **Chiều cao điều khiển:** 36px mặc định; hàng danh sách 44px; vùng chạm trên mobile ≥ 44px.
- **Chi tiết run (V05):** header ổn định (yêu cầu gốc, thời gian, badge trạng thái, hành động chính) → banner trạng thái nếu có → tabs Kế hoạch / Tiến trình / Chứng cứ. Khu vực chờ duyệt đặt **tóm tắt số thao tác ghi, đích, TTL** ngay dưới header, trước mọi chi tiết đọc.

## Elevation & Depth

Phân tầng bằng **nền và viền**, không bằng bóng:

- Tầng 0 `background` (#F8FAFC) → tầng 1 `surface` (#FFFFFF) có viền `border` 1px.
- Bóng chỉ cho lớp nổi: dropdown/popover `0 4px 12px rgba(15,23,42,0.08)`; dialog `0 12px 32px rgba(15,23,42,0.16)` với overlay `rgba(15,23,42,0.40)`.
- Không blur, không bóng màu, không nâng card khi hover.
- Chuyển động: 150ms `cubic-bezier(0.4,0,0.2,1)` cho hover/focus/mở disclosure; tôn trọng `prefers-reduced-motion`. Không animation cho cập nhật polling.

## Shapes

Bo góc **vừa phải, nhất quán**: đủ mềm để hiện đại, không tròn kiểu ứng dụng tiêu dùng.

- `sm` 4px: badge demo, chip lọc, code inline.
- `md` 6px: nút, input, nav item, tooltip, khối payload.
- `lg` 8px: card, ActionCard, banner.
- `xl` 12px: dialog.
- `full`: badge trạng thái dạng pill, chấm trạng thái, avatar.

Không trộn góc vuông 0px với bo tròn trong cùng một view; `none` chỉ cho divider và hàng bảng full-width.

## Components

Tất cả component lấy từ shadcn/ui (Radix) và được chỉnh theo token trên; không dùng giá trị màu/spacing tuỳ ý.

### Buttons

- **Primary** (`button-primary`): một hành động chính mỗi vùng — “Lập kế hoạch”, “Duyệt và ghi”. Hover `primary-hover`.
- **Secondary** (`button-secondary`): nền trắng, chữ navy, viền `border-control`. “Từ chối”, “Làm mới”, “Mở chi tiết”.
- **Ghost** (`button-ghost`): thao tác phụ trong toolbar/disclosure.
- **Danger** (`button-danger`): chỉ cho hành động phá huỷ thật. B/local hiện chưa có; không dùng cho Từ chối/Huỷ run.
- **Đang gửi:** khoá nút, giữ nguyên nhãn, thêm spinner sau 150ms; không đổi nhãn thành “Thành công” trước khi server trả lời. Disabled giữ contrast chữ ≥ 4.5:1 và có lý do hiển thị gần đó (ví dụ “Đang tải lại snapshot”).
- Nhãn nút là động từ cụ thể: “Duyệt 2 thao tác ghi”, không phải “Tiếp tục”.

### Inputs

- `input`: nền trắng, viền `border-control` 1px, cao 36px, focus ring 2px `focus-ring`.
- Label luôn hiển thị phía trên (không dùng placeholder thay label); helper text `caption` màu `on-surface-subtle`.
- Lỗi: viền và chữ `danger`, icon cảnh báo đứng trước thông điệp, liên kết `aria-describedby`.
- Ô yêu cầu (V03) là textarea tự giãn, `body-lg`, tối thiểu 4 dòng.

### Run status

Mỗi trạng thái trong 14 `RunStatus` ánh xạ đúng một biến thể badge. Badge luôn gồm **icon + nhãn tiếng Việt**; trạng thái chưa kết thúc có icon động nhẹ (spinner) trừ khi người dùng bật reduced motion.

| RunStatus | Nhãn hiển thị | Biến thể | Icon (lucide) |
|---|---|---|---|
| `planning` | Đang lập kế hoạch | `status-progress` | `loader-circle` |
| `validating` | Đang kiểm tra kế hoạch | `status-progress` | `loader-circle` |
| `dry_running` | Đang đọc dữ liệu xem trước | `status-progress` | `loader-circle` |
| `awaiting_approval` | Chờ duyệt | `status-action` | `hand` |
| `running` | Đang thực thi | `status-progress` | `loader-circle` |
| `replanning` | Đang điều chỉnh kế hoạch | `status-progress` | `refresh-cw` |
| `succeeded` | Hoàn tất | `status-success` | `circle-check` |
| `failed` | Thất bại | `status-danger` | `circle-x` |
| `rejected` | Đã từ chối ghi | `status-neutral` | `ban` |
| `cancelled` | Đã huỷ | `status-neutral` | `circle-slash` |
| `expired` | Hết hạn duyệt | `status-neutral` | `clock-alert` |
| `refused` | Không thể lập kế hoạch | `status-planner` | `message-circle-x` |
| `needs_input` | Cần bổ sung thông tin | `status-planner` | `message-circle-question` |
| `reconciliation_required` | Cần đối chiếu | `status-unknown` | `triangle-alert` |

### Banners

- **`banner-action`** (chờ duyệt): tóm tắt số thao tác ghi, đích, đồng hồ TTL (caption tabular). Không tự đóng.
- **`banner-unknown`** (cần đối chiếu): giải thích có thao tác ghi chưa rõ kết quả, dẫn tới tab Chứng cứ. **Không bao giờ tự đóng, không có nút retry/resume.**
- Lỗi phiên/mạng: dùng `danger-subtle`, nêu cách thoát (“Đăng nhập lại”, “Làm mới”).
- Banner dùng `role="status"` cho thông tin, `role="alert"` chỉ khi cần người dùng xử lý ngay.

### ActionCard

Một card cho mỗi thao tác ghi trong snapshot chờ duyệt: tiêu đề `title-md` (tên thao tác bằng tiếng Việt), dòng đích (server/tool trong `identifier` mono), khối `payload-block` hiển thị payload đã resolve (tự cuộn ngang, không cắt nội dung). Viền trái 3px `action` khi đang chờ duyệt. Payload không bao giờ sửa được từ UI.

### Navigation và tabs

- `nav-item` 36px, icon 16px + nhãn; mục đang chọn `nav-item-active` (nền `primary-subtle`, chữ navy) và `aria-current="page"`.
- Tabs chi tiết run: gạch chân 2px `primary` cho tab đang chọn, chữ `on-surface-muted` cho tab khác; điều khiển bằng phím mũi tên (Radix Tabs).

### Lists và bảng

- `list-row` 44px, divider `border`, hover `background`. Cột thời gian dùng `caption` tabular; định danh dùng `identifier`.
- Mobile: mỗi hàng thành thẻ xếp dọc (trạng thái → yêu cầu → thời gian).
- Trạng thái rỗng và “không có kết quả lọc” là hai thông điệp khác nhau.

### Dialog, tooltip, demo badge

- **Dialog** (`dialog`, bo 12px, padding 24px): chỉ dùng cho xác nhận quyết định ghi; tiêu đề nêu số thao tác và đích; focus đầu vào nút an toàn (Huỷ), Esc đóng, trả focus về nút mở.
- **Tooltip** (`tooltip` nền ink, chữ trắng): chỉ bổ sung, không chứa thông tin bắt buộc; hiện sau 300ms, có với cả focus bàn phím.
- **Demo badge** (`badge-demo`): “Dữ liệu mô phỏng” luôn hiển thị ở header khi build fixture; không tắt được.

## Do's and Don'ts

- **Do** ghép màu trạng thái với icon và nhãn chữ; kiểm lại bằng chế độ xám (grayscale) vẫn phân biệt được.
- **Do** hiển thị timestamp (và TTL tính từ `approval.expires_at` của server) ở mọi thay đổi trạng thái quan trọng.
- **Do** đặt payload ghi, đích và số thao tác lên trước mọi chi tiết đọc khi chờ duyệt.
- **Do** dùng token qua class Tailwind sinh từ `@theme`; mọi giá trị mới phải thêm vào DESIGN.md trước.
- **Do** giữ focus ring 2px nhìn thấy được trên mọi phần tử tương tác; kiểm bàn phím toàn bộ luồng duyệt.
- **Do** giữ nguyên vị trí cuộn, disclosure đang mở và focus khi dữ liệu polling cập nhật.
- **Don't** dùng giá trị tuỳ ý (`bg-[#...]`, `p-[13px]`) trong view/component.
- **Don't** tự đóng banner cần đối chiếu, chờ duyệt hoặc lỗi.
- **Don't** hiển thị phần trăm tiến trình, biểu đồ trang trí hay số liệu “tỷ lệ thành công” không có ý nghĩa đo.
- **Don't** dùng `danger` đặc cho Từ chối/Huỷ; dùng nút secondary.
- **Don't** đặt chữ `on-surface-subtle` trên nền `surface-muted`.
- **Don't** tải font, icon hay ảnh từ CDN; không gradient, glassmorphism, bóng màu.
- **Don't** dùng animation > 150ms hoặc animation báo hiệu dữ liệu mới mỗi lần poll.

## Implementation notes

- Kiểm tra hợp lệ và contrast bằng `@google/design.md@0.4.0 lint DESIGN.md` trước khi commit thay đổi token. Lần kiểm 17/09/2026: 0 error, 0 warning (33 colors, 11 typography, 6 rounded, 13 spacing, 37 components).
- `export --format css-tailwind` của bản 0.4.0 **chưa dùng trực tiếp được**: (1) bọc cả font stack trong một cặp nháy kép nên trình duyệt coi là một tên font; (2) bỏ `fontFeature` và toàn bộ component token; (3) sinh `--leading-*` riêng thay vì `--text-<name>--line-height` của Tailwind v4. WEB-01C phải có bước sinh `apps/web/src/app/theme.css` từ DESIGN.md (export rồi hậu xử lý có test, hoặc script đọc frontmatter) và review file sinh ra; không chỉnh tay theme.css, sửa DESIGN.md rồi sinh lại.
- Spacing đặt tên (`--spacing-sm`…) cùng tồn tại với thang số mặc định của Tailwind (`p-2`, `gap-4`); trong code ưu tiên tên token, thang số chỉ dùng khi giá trị trùng thang 4px ở trên.
- Component token dùng `backgroundColor` cho `card-divider`, `input-border`, `focus-ring` để biểu diễn màu đường viền, vì spec alpha chưa có thuộc tính border; khi áp vào CSS đó là `border-color`/`outline-color`.

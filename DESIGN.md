---
version: alpha
name: ATI Soft Operations
description: "Airbnb-inspired soft workspace with a navy accent: white canvas, near-black ink, hairline dividers, generous 8/14px radii, 48px controls, one shadow tier, a sticky decision card, and semantic run-status colors that always pair with icon and text."
colors:
  primary: "#1E3A5F"
  primary-hover: "#162D4A"
  primary-subtle: "#E8EEF6"
  on-primary: "#FFFFFF"
  canvas: "#FFFFFF"
  surface-soft: "#F7F7F7"
  surface-strong: "#F2F2F2"
  ink: "#222222"
  muted: "#6A6A6A"
  hairline: "#DDDDDD"
  hairline-soft: "#EBEBEB"
  border-control: "#8A8A8A"
  focus-ring: "#222222"
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
typography:
  display-md:
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"
    fontSize: 26px
    fontWeight: 600
    lineHeight: 34px
    letterSpacing: -0.02em
  headline-sm:
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"
    fontSize: 21px
    fontWeight: 600
    lineHeight: 28px
    letterSpacing: -0.01em
  title-md:
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 22px
  body-lg:
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 24px
  body-md:
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 22px
  body-sm:
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
  button-md:
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 20px
  button-sm:
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 20px
  nav-link:
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"
    fontSize: 15px
    fontWeight: 500
    lineHeight: 20px
  badge:
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"
    fontSize: 13px
    fontWeight: 600
    lineHeight: 18px
  caption:
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 18px
    fontFeature: "'tnum' 1"
  overline:
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"
    fontSize: 12px
    fontWeight: 700
    lineHeight: 16px
    letterSpacing: 0.04em
  wordmark:
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"
    fontSize: 20px
    fontWeight: 700
    lineHeight: 24px
    letterSpacing: -0.01em
  display-md-mobile:
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"
    fontSize: 23px
    fontWeight: 600
    lineHeight: 31px
    letterSpacing: -0.01em
  headline-sm-mobile:
    fontFamily: "'Be Vietnam Pro', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 25px
  mono-md:
    fontFamily: "'Cascadia Mono', Consolas, ui-monospace, 'SFMono-Regular', Menlo, monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 20px
  mono-sm:
    fontFamily: "'Cascadia Mono', Consolas, ui-monospace, 'SFMono-Regular', Menlo, monospace"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 18px
rounded:
  none: 0px
  xs: 4px
  sm: 8px
  md: 14px
  lg: 20px
  full: 9999px
spacing:
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  base: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 64px
  nav-height: 80px
  content-max: 1120px
  rail-width: 372px
  rail-gap: 72px
  gutter-desktop: 80px
  gutter-mobile: 24px
  control-height: 48px
  control-height-compact: 36px
components:
  page:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
  top-nav:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.nav-link}"
    height: "{spacing.nav-height}"
  nav-link:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.muted}"
    typography: "{typography.nav-link}"
  nav-link-active:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.nav-link}"
  divider:
    backgroundColor: "{colors.hairline}"
    height: 1px
  divider-soft:
    backgroundColor: "{colors.hairline-soft}"
    height: 1px
  icon-button-circle:
    backgroundColor: "{colors.surface-strong}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: 36px
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.sm}"
    height: "{spacing.control-height}"
    padding: 0px 24px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.button-md}"
    rounded: "{rounded.sm}"
    height: "{spacing.control-height}"
    padding: 0px 24px
  button-secondary-hover:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink}"
  button-text:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.button-sm}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.sm}"
    height: "{spacing.control-height}"
  button-danger-hover:
    backgroundColor: "{colors.danger-hover}"
    textColor: "{colors.on-primary}"
  input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.sm}"
    height: 56px
    padding: 0px 12px
  input-border:
    backgroundColor: "{colors.border-control}"
    width: 1px
  focus-ring:
    backgroundColor: "{colors.focus-ring}"
    width: 2px
  decision-card:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: 24px
    width: "{spacing.rail-width}"
  decision-timer:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.title-md}"
  decision-timer-urgent:
    backgroundColor: "{colors.action-subtle}"
    textColor: "{colors.action}"
    typography: "{typography.title-md}"
    rounded: "{rounded.sm}"
  write-summary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.headline-sm}"
  summary-box:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: 10px 12px
  summary-label:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.overline}"
  step-row:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-lg}"
    height: 48px
  step-row-meta:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.muted}"
    typography: "{typography.body-sm}"
  step-icon-read:
    backgroundColor: "{colors.surface-strong}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: 48px
  step-icon-write:
    backgroundColor: "{colors.action-subtle}"
    textColor: "{colors.action}"
    rounded: "{rounded.full}"
    size: 48px
  write-card:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
  payload-table-head:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.muted}"
    typography: "{typography.caption}"
  payload-block:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.mono-md}"
    rounded: "{rounded.sm}"
    padding: 12px 16px
  selected-row:
    backgroundColor: "{colors.primary-subtle}"
    textColor: "{colors.primary}"
  status-progress:
    backgroundColor: "{colors.progress-subtle}"
    textColor: "{colors.progress}"
    typography: "{typography.badge}"
    rounded: "{rounded.full}"
    padding: 4px 10px
  status-action:
    backgroundColor: "{colors.action-subtle}"
    textColor: "{colors.action}"
    typography: "{typography.badge}"
    rounded: "{rounded.full}"
    padding: 4px 10px
  status-success:
    backgroundColor: "{colors.success-subtle}"
    textColor: "{colors.success}"
    typography: "{typography.badge}"
    rounded: "{rounded.full}"
    padding: 4px 10px
  status-danger:
    backgroundColor: "{colors.danger-subtle}"
    textColor: "{colors.danger}"
    typography: "{typography.badge}"
    rounded: "{rounded.full}"
    padding: 4px 10px
  status-unknown:
    backgroundColor: "{colors.unknown-subtle}"
    textColor: "{colors.unknown}"
    typography: "{typography.badge}"
    rounded: "{rounded.full}"
    padding: 4px 10px
  status-neutral:
    backgroundColor: "{colors.neutral-subtle}"
    textColor: "{colors.neutral}"
    typography: "{typography.badge}"
    rounded: "{rounded.full}"
    padding: 4px 10px
  status-planner:
    backgroundColor: "{colors.planner-subtle}"
    textColor: "{colors.planner}"
    typography: "{typography.badge}"
    rounded: "{rounded.full}"
    padding: 4px 10px
  banner-action:
    backgroundColor: "{colors.action-subtle}"
    textColor: "{colors.action}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: 20px
  banner-unknown:
    backgroundColor: "{colors.unknown-subtle}"
    textColor: "{colors.unknown}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: 20px
  banner-danger:
    backgroundColor: "{colors.danger-subtle}"
    textColor: "{colors.danger}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: 20px
  badge-demo:
    backgroundColor: "{colors.demo-subtle}"
    textColor: "{colors.demo}"
    typography: "{typography.badge}"
    rounded: "{rounded.full}"
    padding: 4px 12px
  identifier:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.muted}"
    typography: "{typography.mono-sm}"
  tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: 6px 10px
  dialog:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: 24px
  mobile-decision-bar:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    height: 80px
    padding: 12px 24px
---

# ATI UI/UX and Design System

**Trạng thái: `DIRECTION_SELECTED` — người dùng chốt “kiểu Airbnb, nhấn navy” ngày 17/09/2026** sau khi so sánh ba phương án V05 trên canvas review (gốc, giàu hơn, kiểu Airbnb). Token và quy tắc dưới đây là hợp đồng thị giác cho WEB-01C trở đi theo [ADR-002](docs/ADR-002-FRONTEND-UI-DATA-LAYER.md). Chưa kiểm chứng trong ứng dụng thật; cần review trực quan bộ màn đã vẽ lại (V05 chờ duyệt, V05 cần đối chiếu, V05 mobile, V02) trước khi coi là `APPROVED_FOR_IMPLEMENTATION`. Hướng navy/slate dạng sidebar (17/09) và Airbnb gốc chỉ còn trong lịch sử git.

## Overview

ATI là công cụ **duyệt và kiểm soát thao tác ghi** cho trưởng nhóm dự án môn học. Giao diện mượn **ngôn ngữ hình khối và khoảng trắng** của một marketplace tiêu dùng (tham khảo phân tích Airbnb): nền trắng, chữ gần đen, đường kẻ mảnh thay khung, bo góc mềm, nút lớn dễ bấm, chỉ một mức bóng. Mục tiêu cảm xúc: **thân thiện, rõ ràng, đáng tin** — người không rành kỹ thuật vẫn hiểu “cái gì sẽ bị ghi, ở đâu, còn bao lâu để quyết”.

Nguyên tắc cốt lõi:

- **Một màu nhấn: navy (#1E3A5F).** Chỉ dùng cho hành động chính và mục đang chọn. Đỏ/cam/amber được dành riêng cho trạng thái, không bao giờ làm màu thương hiệu.
- **Nội dung trước, khung sau.** Section ngăn bằng hairline và khoảng trắng 32px; chỉ nội dung cần gom (payload, thẻ quyết định) mới có khung bo 14px.
- **Điều người dùng sắp đồng ý là thứ lớn nhất, không phải thời hạn.** Khối “Bạn sắp ghi” (`headline-sm`) đứng đầu thẻ quyết định; đồng hồ là một dòng `title-md` ngay trên nút duyệt và chỉ nổi lên ở 2 phút cuối (chốt 18/09/2026, thay đồng hồ 56px của phương án A). Mọi tiêu đề giữ độ đậm vừa (600).
- **Màu trạng thái luôn kèm icon và chữ.** Server là authority: không phần trăm tiến trình tự tính, không báo thành công trước khi server xác nhận.
- **Light-only trong B/local.** Dark mode ngoài phạm vi; token đặt theo vai trò để có thể thêm sau.

**Không sao chép thương hiệu Airbnb:** không dùng màu Rausch, font Airbnb Cereal, logo, minh hoạ, ảnh hay bố cục marketing/listing của họ. Chỉ mượn nguyên tắc hình khối, khoảng trắng, mật độ và mẫu “thẻ đặt chỗ dính bên phải”.

## Colors

**Nhấn và nền**

- **Navy (#1E3A5F) — `primary`:** nút chính (“Duyệt 2 thao tác ghi”, “Lập kế hoạch”), avatar/logo, hàng đang chọn (`primary-subtle` #E8EEF6). Chữ trắng 11.5:1. Hover `primary-hover` (#162D4A).
- **Canvas (#FFFFFF):** nền toàn trang và card. **Surface soft (#F7F7F7):** đầu bảng payload, khối JSON, bong bóng tin nhắn xem trước. **Surface strong (#F2F2F2):** nút icon tròn, icon bước đọc.
- **Ink (#222222):** chữ chính, nút secondary viền, link dạng gạch chân, focus ring. 15.9:1 trên trắng.
- **Muted (#6A6A6A):** chữ phụ, nav chưa chọn, timestamp. 5.41:1 trên trắng, 5.05:1 trên `surface-soft`, 4.83:1 trên `surface-strong` — đạt AA trên mọi nền trung tính của hệ.
- **Hairline (#DDDDDD) / hairline soft (#EBEBEB):** divider section, viền card, dòng bảng. Chỉ mang tính trang trí.
- **Border control (#8A8A8A):** viền input, checkbox, hộp tóm tắt trong thẻ quyết định — 3.45:1, đạt ngưỡng 3:1 cho thành phần giao diện.

**Họ màu ngữ nghĩa** (giữ nguyên từ bản trước; mọi cặp đạt AA ≥ 4.5:1)

| Token | Đậm / nhạt | Ý nghĩa | Contrast |
|---|---|---|---|
| `progress` | #1D4ED8 / #DBEAFE | Hệ thống đang xử lý | 5.49:1 |
| `action` | #92400E / #FEF3C7 | Cần người dùng quyết định (chờ duyệt, TTL) | 6.37:1 |
| `success` | #166534 / #DCFCE7 | Hoàn tất có xác nhận | 6.49:1 |
| `danger` | #B91C1C / #FEE2E2 | Lỗi đã biết, hành động phá huỷ | 5.30:1 |
| `unknown` | #9A3412 / #FFEDD5 | Kết quả ghi chưa xác định | 6.38:1 |
| `neutral` | #334155 / #F1F5F9 | Từ chối, huỷ, hết hạn | 9.45:1 |
| `planner` | #5B21B6 / #EDE9FE | Planner từ chối / cần bổ sung | 7.57:1 |
| `demo` | #854D0E / #FEF9C3 | Dữ liệu mô phỏng | 6.38:1 |

## Typography

**Be Vietnam Pro** (SIL Open Font License, thiết kế cho tiếng Việt) cho toàn bộ giao diện, **tự host** trong `apps/web` (không tải từ Google Fonts/CDN theo ADR-001/002), fallback Segoe UI/system-ui. Chỉ nạp 400/500/600/700, subset `latin` + `vietnamese`. Mono: Cascadia Mono/Consolas/SF Mono cho mã run, hash, tên tool, JSON.

| Token | Cỡ/dòng | Đậm | Dùng cho |
|---|---|---|---|
| `display-md` | 26/34 | 600 | Tiêu đề trang, yêu cầu gốc của run |
| `headline-sm` | 21/28 | 600 | Tiêu đề section (“Kế hoạch gồm 3 bước”) |
| `title-md` | 16/22 | 600 | Tiêu đề card, thẻ ghi |
| `body-lg` | 16/24 | 400 | Tên bước, input, đoạn quan trọng |
| `body-md` | 15/22 | 400 | Chữ mặc định |
| `body-sm` | 14/20 | 400 | Dòng phụ, bảng payload |
| `button-md` / `button-sm` | 16/20, 14/20 | 600 | Nút 48px / nút chữ |
| `nav-link` | 15/20 | 500 | Top nav (mục chọn dùng 600) |
| `badge` | 13/18 | 600 | Pill trạng thái |
| `caption` | 13/18, tabular | 400 | Timestamp, thời lượng |
| `overline` | 12/16, +0.04em | 700 | Nhãn ô trong hộp tóm tắt (THAO TÁC GHI, ĐÍCH) — chỉ nhãn ngắn |
| `wordmark` | 20/24, -0.01em | 700 | Chữ “ATI” cạnh logo (mobile 18/22) |
| `mono-md` / `mono-sm` | 13/20, 12/18 | 400 | Mã run, mã băm, tên tool, JSON |

**Thang mobile (< 744px)** — chỉ hai role đổi cỡ, phần còn lại giữ nguyên để không sinh thêm biến thể:

| Token | Cỡ/dòng | Thay cho | Dùng cho |
|---|---|---|---|
| `display-md-mobile` | 23/31 | `display-md` 26/34 | Tiêu đề trang và yêu cầu gốc |
| `headline-sm-mobile` | 18/25 | `headline-sm` 21/28 | Tiêu đề section |

Mỗi bước liền kề của thang phải cách nhau ≥ 1.25× ở ít nhất một bậc: mobile là 23 → 18 (1.28), desktop là 26 → 21 → 16 (1.24 và 1.31). Không dùng cỡ ngoài thang (đã bỏ 17px, 12.5px, 19px, 20px thân chữ).

Line-height thân chữ ≥ 1.45 để dấu tiếng Việt chồng không chạm dòng trên. Không viết hoa toàn câu; `overline` chỉ cho nhãn 1–3 từ (11px làm bẹt dấu trên chữ hoa tiếng Việt nên sàn là 12px).

**Độ dài dòng:** văn xuôi tối đa ~75 ký tự — `max-width` 600px ở 16px, 560px ở 15px, 520px ở 14px; khung có icon thì cộng thêm bề rộng icon, gap và padding. Tiêu đề, nội dung yêu cầu và bảng dữ liệu không áp trần này.

## Layout

- **Desktop (≥ 1128px):** top nav 80px trắng, hairline dưới: logo trái, 4 mục điều hướng ở giữa (Tổng quan, Tạo yêu cầu, Lần chạy, Công cụ & kết nối), nhãn “Dữ liệu mô phỏng” + nút tài khoản dạng pill bên phải. Nội dung rộng tối đa **1120px** căn giữa, lề tối thiểu 80px.
- **Chi tiết run (V05):** hai cột — nội dung trái (co giãn) và **thẻ quyết định 372px dính bên phải**, cách nhau 72px. Trạng thái không cần quyết định (đối chiếu, kết thúc): cột phải là thẻ tóm tắt kết quả, không có nút ghi.
- **Tablet (744–1127px):** top nav giữ logo + nút menu; một cột, thẻ quyết định nằm trên nội dung.
- **Mobile (< 744px, tối thiểu 320px):** gutter 24px (16px khi < 360px); thẻ quyết định thành **thanh dính đáy ~98px** gồm một dòng “Còn mm:ss · hết hạn lúc … theo máy chủ” (mốc tuyệt đối, vì người dùng mobile hay rời app rồi quay lại) và nút chính rộng hết thanh, nút duyệt có `aria-describedby` tới mốc hết hạn và câu cảnh báo; câu “Nếu dữ liệu nguồn thay đổi…” nằm trong banner chờ duyệt ở đầu trang — chỗ người dùng đọc đầu tiên khi quay lại; nút phụ nằm trong nội dung. Payload dạng bảng **không cuộn ngang trên màn duyệt**: mỗi dòng thành một bản ghi có nhãn (DÒNG n · Tuần / Thành viên / Công việc / Tình trạng) để đọc hết mọi ô trước khi đồng ý; trang không cuộn ngang.
- **Nhịp khoảng cách:** section cách nhau bằng hairline + padding 32px; nhóm liên quan 16–20px; card padding 20–24px; khoảng lớn giữa vùng trang 64px.
- **Chiều cao điều khiển:** 48px (nút chính/phụ), 56px (input), 36px (nút icon tròn, nút chữ — chỉ trên desktop có con trỏ). Mobile: mọi điều khiển ≥ 44px, kể cả nút chữ, nút quay lại và nút hiện mật khẩu. Link chữ đứng riêng ở mọi độ rộng có vùng chạm cao 44px (`min-height`), chữ giữ nguyên cỡ.

## Elevation & Depth

Hệ có **đúng một mức bóng**:

`box-shadow: rgba(0,0,0,0.02) 0 0 0 1px, rgba(0,0,0,0.04) 0 2px 6px 0, rgba(0,0,0,0.1) 0 4px 8px 0`

dùng cho thẻ quyết định, nút tài khoản, dropdown/popover và thanh quyết định mobile. Mọi bề mặt khác phẳng, phân tách bằng hairline và khoảng trắng. Dialog dùng scrim `ink` 50%. Không blur, không bóng màu, không nâng card khi hover. Chuyển động 150ms ease-out cho hover/focus/mở disclosure, tôn trọng `prefers-reduced-motion`, không animation khi polling cập nhật.

## Shapes

- `xs` 4px: code inline.
- `sm` 8px: nút, input, hộp tóm tắt, khối JSON, tooltip.
- `md` 14px: card, thẻ ghi, thẻ quyết định, banner.
- `lg` 20px: dialog.
- `full`: pill trạng thái, nhãn demo, nút icon tròn, icon bước, avatar, nút tài khoản.

Không góc vuông trên phần tử tương tác; `none` chỉ cho hairline và hàng bảng.

## Components

Component lấy từ shadcn/ui (Radix), chỉnh theo token; không giá trị màu/spacing tuỳ ý.

### Top navigation

`top-nav` 80px. Mục đang chọn: chữ `ink` 600 + gạch chân 2px `ink` sát đáy nav, `aria-current="page"`; mục khác `muted` 500. Có badge số lượng việc cần xử lý cạnh “Lần chạy” khi > 0 (pill `action`).

### Buttons

- **Primary** (`button-primary`): navy, 48px, bo 8px, chữ 16/600. Một nút chính mỗi vùng; trong thẻ quyết định dàn full-width.
- **Secondary** (`button-secondary`): nền trắng, viền 1px `ink`, chữ `ink`. “Từ chối ghi”.
- **Text** (`button-text`): chữ `ink` 600 gạch chân, không nền. “Xem JSON gốc”, “Yêu cầu huỷ lần chạy”, “Xem chứng cứ đầy đủ”.
- **Icon tròn** (`icon-button-circle`): 36px nền `surface-strong`, luôn có `aria-label` (nút quay lại).
- **Danger**: chỉ cho hành động phá huỷ thật; B/local chưa có. Không dùng cho Từ chối/Huỷ.
- **Đang gửi:** khoá nút, giữ nhãn, spinner sau 150ms; không đổi nhãn sang thành công trước phản hồi server. Disabled có lý do hiển thị gần đó.

### Decision card (thẻ quyết định)

Thẻ 372px dính bên phải, bo 14px, hairline + mức bóng duy nhất, padding 24px. Thứ tự cố định:

1. `write-summary`: nhãn “Bạn sắp ghi” (`muted`), rồi mỗi thao tác ghi một dòng `headline-sm` kèm icon tròn 40px nền `action-subtle` (“Thêm 3 dòng vào “Báo cáo tuần””, “Gửi 1 tin nhắn vào #nhom-ati”); tên đích không xuống dòng giữa chừng. Đây là phần tử lớn nhất thẻ.
2. Hairline, dòng khoá–giá trị “Chế độ lập kế hoạch”.
3. `decision-timer` ngay trên nút duyệt: icon đồng hồ trong vòng 32px + “Còn mm:ss” (`title-md`, tabular) + “Hết hạn lúc hh:mm:ss theo máy chủ” (`caption`). Thời hạn lấy từ `approval.expires_at`; về 0 thì khoá nút và tải lại chi tiết. Còn ≤ 2 phút: `decision-timer-urgent` (nền `action-subtle`, chữ `action`, icon đồng hồ cát, “Sắp hết hạn · còn mm:ss”), không đổi bố cục, không nhấp nháy.
4. Nút primary “Duyệt N thao tác ghi” (`aria-describedby` tới `write-summary` và dòng hết hạn), nút secondary “Từ chối ghi”, dòng phụ căn giữa.
5. Hairline, rồi múi giờ và disclosure “Chi tiết kỹ thuật” (phiên bản kế hoạch, mã bản xem trước).

Trên mobile, dòng đồng hồ + nút primary rộng hết thanh thành `mobile-decision-bar` dính đáy (~98px); `write-summary` là các bản ghi có nhãn trong nội dung, phần còn lại nằm cuối nội dung.

### Steps list

Mỗi bước là một hàng: icon tròn 48px (`step-icon-read` nền `surface-strong` cho bước đọc; `step-icon-write` nền `action-subtle` cho bước ghi đang chờ), tên bước `body-lg` 500, dòng phụ `body-sm` `muted` (“Bước 2 · ghi · dùng dữ liệu của bước 1”), trạng thái bên phải là chữ màu ngữ nghĩa có icon. Không đóng khung từng hàng.

### Write card (thẻ ghi)

Viền hairline bo 14px. Đầu thẻ: tiêu đề `title-md` (“Bảng ‘Báo cáo tuần’ · thêm 3 dòng”), dòng tool/đích mono `muted`, nút text “Xem JSON gốc” bên phải. Thân thẻ hiển thị payload **ở dạng người đọc được**: bảng cho dòng dữ liệu (đầu bảng `surface-soft`; mobile đổi thành bản ghi có nhãn), bong bóng xem trước cho tin nhắn. JSON gốc mở trong `payload-block`. Payload không sửa được.

### Run status

Pill `badge` 13/600, bo full, padding 4×10, **icon + nhãn tiếng Việt**; trạng thái đang chạy có spinner trừ khi reduced motion.

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

Bo 14px, padding 20px, icon trong vòng tròn trắng 40px, tiêu đề 16/600 + đoạn 15/24.

- **`banner-action`** (chờ duyệt): “Hệ thống đang chờ bạn quyết định”. Không tự đóng.
- **`banner-unknown`** (cần đối chiếu): giải thích thao tác chưa rõ kết quả và việc cần tự kiểm tra; **không tự đóng, không có nút đóng, retry hay resume**; `role="alert"`.
- **`banner-danger`**: lỗi phiên/mạng/thất bại, nêu cách thoát.

### Inputs

56px, bo 8px, viền 1px `border-control`; focus: viền 2px `ink`, không glow. Label luôn phía trên (`body-sm` 600); helper `caption` `muted`; lỗi dùng `danger` kèm icon và `aria-describedby`. Ô yêu cầu (V03) là textarea tự giãn, `body-lg`, tối thiểu 4 dòng.

### Request composer (V03)

- **Nhãn chế độ planner** cạnh tiêu đề, không đặt phía trên tiêu đề: demo dùng `badge-demo` (“Kế hoạch mẫu”); AI dùng pill `primary-subtle`/`primary` (“AI lập kế hoạch”). Luôn hiển thị.
- **Ô yêu cầu:** chế độ demo chỉ đọc, nền `surface-soft`, icon khoá và lý do trong thanh dưới ô; chế độ AI sửa được, nền `canvas`, focus viền 2px `ink`, gợi ý viết trong thanh dưới ô. Bộ đếm ký tự chỉ hiện khi gần giới hạn 4000.
- **Mẫu (demo):** thẻ radio thật bo 14px; đang chọn viền 2px `ink`; vô hiệu nền `surface-soft`, chữ `muted`, kèm lý do có icon.
- **Gợi ý (AI):** chip pill 40px viền `hairline`, chữ `ink` 14/500; chèn vào ô, không tự gửi.
- **Tuỳ chọn nâng cao:** disclosure ngăn bằng hairline trên/dưới, tiêu đề 16/600 + dòng tóm tắt `muted`.
- **Cột “Hệ thống làm được gì”:** viền hairline bo 14px, không bóng; nhóm việc với icon tròn 40px, trạng thái kết nối có icon + chữ, cam kết trước khi ghi; chế độ AI thêm các kết quả planner có thể trả về.

### Run history (V04)

- **Filter pill:** 40px, bo full, viền 1px `hairline`, chữ `ink` 14/500 kèm số đếm `muted` tabular; đang chọn nền `ink`, chữ và số trắng 600, `aria-pressed="true"`. Mobile: một `select` 48px có nhãn “Nhóm trạng thái” (giá trị đang lọc luôn nhìn thấy, bộ chọn của hệ điều hành lo phần chạm), ngay dưới là “Đang hiển thị x / y lần chạy đã tải” và nút chữ “Bỏ lọc” — không dùng hàng pill cuộn ngang vì pill đang bật có thể nằm ngoài màn hình.
- **Ô tìm kiếm:** 48px, viền `border-control`, icon kính lúp trái, nút xoá tròn `icon-button-circle` khi có từ khoá; label ẩn nhưng đọc được.
- **Hàng lần chạy:** link toàn hàng; lưới badge 208px · nội dung · thời gian 150px (mobile xếp dọc); yêu cầu `body-lg` 500 tối đa 2 dòng; dòng phụ `body-sm` `muted`, phần cần chú ý dùng màu ngữ nghĩa 600; mã run `mono-sm` `muted`; ngăn bằng `hairline-soft`; focus viền 2px `ink` bo 8px, nền `surface-soft`.
- **Trạng thái rỗng:** khung hairline bo 14px, icon tròn 56px `surface-strong`, tiêu đề `headline-sm`, đoạn `muted` tối đa ~520px, một hành động.

### Tools & connections (V06)

- **Khối server:** ngăn bằng hairline; icon 52px bo 14px nền `surface-strong`; tên `headline-sm` + slug `mono`; dòng tóm tắt `body-sm` `muted` tabular; badge trạng thái bên phải (`success` đã kết nối, `neutral` chưa kiểm tra/tắt theo cấu hình, `danger` lỗi, `unknown` chưa review).
- **Hàng tool:** lưới icon tròn 40px · nhãn `body-lg` 500 + mô tả `body-sm` `muted` · pill Đọc/Ghi · nút “Chi tiết kỹ thuật” có chevron và `aria-expanded`; ngăn bằng `hairline-soft`, cao ≥ 64px.
- **Pill Đọc/Ghi:** 24px, bo full, chữ 12/600 kèm icon (sách/bút); Đọc nền `surface-strong` chữ `ink`, Ghi nền `neutral-subtle` chữ `neutral`. Không dùng màu `action` vì đây là chính sách, không phải việc đang chờ.
- **Chi tiết kỹ thuật:** khung `surface-soft` bo 14px thụt theo cột nhãn; ô nhãn `overline`; giá trị kỹ thuật `mono-md`; bảng tham số nền `canvas` bo 8px; nút sao chép `icon-button-circle` 32px có `aria-label`.
- **Nút kiểm tra bị giới hạn:** nền `surface-strong`, chữ `muted`, dòng đếm ngược `body-sm` tabular kèm icon đồng hồ, `role="status"`.

### Sign-in (V01)

- **Khung:** không top nav; logo trái, badge demo phải; hai cột 1120px (giới thiệu · thẻ form 420px), căn giữa dọc; mobile form trước.
- **Giới thiệu:** tiêu đề 40/50px đậm 600 tracking -0.03em (ngoại lệ đã ghi trong Do's and Don'ts); đoạn `body-lg` `muted`; 3 bước dạng hàng icon tròn 48px `surface-strong` + tiêu đề `body-lg` 500 + dòng phụ `body-sm` `muted`, không đánh số.
- **Thẻ form:** `decision-card` style (hairline, bo 14px, mức bóng duy nhất, padding 32px); input 56px; nút hiện/ẩn mật khẩu `icon-button-circle` 40px bên trong ô; helper `caption` `muted`; banner lỗi/hết phiên bo 14px đặt dưới tiêu đề form; dòng môi trường `caption` `muted` sau hairline.

### Copy & labeling conventions

Nguồn chuẩn cho mọi màn (chốt sau `/impeccable polish` 17/09/2026); code và test dùng đúng các chuỗi này.

| Chỗ dùng | Chuẩn | Không dùng |
|---|---|---|
| Tên sản phẩm | **ATI** | ati |
| Nhãn dữ liệu fixture | Pill “Dữ liệu mô phỏng” 28px/13px ở mọi kích thước màn; **chỉ** khi transport là fixture, và màn đó phải kể đúng yêu cầu/dữ liệu fixture đang có trên server | “Mô phỏng”; hiện trên màn kể chuyện chạy thật; kể chuyện fixture mà nội dung không có trong fixture |
| Chế độ lập kế hoạch | “Kế hoạch mẫu” · “AI lập kế hoạch”; nhãn khoá–giá trị “Chế độ lập kế hoạch” | “Demo · kế hoạch mẫu”, “Chế độ planner” |
| Chủ thể trong câu | “Hệ thống …” (hỏi, trả lời, không lập được kế hoạch) | “Planner …” |
| Trạng thái bước | Xong · Đang chạy · Chưa chạy (còn có thể chạy) · Không chạy (sẽ không chạy) · Thất bại · Chờ duyệt — luôn kèm icon | Hoàn tất (dành cho trạng thái run), Không thực hiện, không diễn ra |
| Tiêu đề danh sách bước | “Kế hoạch gồm N bước” (trước khi thực thi: chờ duyệt, hết hạn) · “Kết quả từng bước” (từ lúc thực thi) · “Tiến trình” (dải giai đoạn khi chưa có kế hoạch) | “Các bước” |
| Nhật ký | “Hoạt động” | “Nhật ký sự kiện” |
| Thẻ bên phải V05 (không quyết định) | Nhãn “Tóm tắt lần chạy” + giá trị là tình trạng hiện tại | “Trạng thái”, “Kết quả lần chạy” |
| Hộp tóm tắt | XONG “x / y bước” · ĐANG CHẠY / THẤT BẠI / CHƯA RÕ “Bước n” · ĐÃ GHI “Chưa ghi gì” / “N thao tác” · KẾ HOẠCH “Chưa có” (đang lập) / “Không có” (kết thúc) | ĐÃ XONG, HOÀN TẤT, “Không có thao tác ghi nào” |
| Chứng cứ | Nút secondary “Xem chứng cứ” trong thẻ phải của run có kế hoạch đã kết thúc; link chữ “Xem chứng cứ” cuối mục Hoạt động | “Xem chứng cứ đầy đủ” |
| Huỷ | Nút chữ gạch chân “Yêu cầu huỷ lần chạy” cuối thẻ phải, kèm hệ quả (“Huỷ sẽ dừng trước bước kế tiếp” / “không hoàn tác thao tác đang chạy”) | Nút secondary “Yêu cầu huỷ”, đặt góc trên |
| Kết nối server | “Đã kết nối” · “Đang tắt theo cấu hình” · “Chưa kiểm tra trong phiên này” · “Không kết nối được” | “Sẵn sàng”, “Đang tắt” |
| Mốc thời gian | “Tải lúc” (danh sách) · “Cập nhật lúc” (chi tiết đang poll) · “Kiểm tra lúc” (V06) · “quan sát lúc” (`observed_at`) | giờ trần không nhãn |
| Badge nav | “Lần chạy” + số việc cần xử lý (amber) trên mọi trang có nav khi > 0; có chữ ẩn “cần xử lý:” | chỉ hiện ở Tổng quan |
| Nhãn trạng thái run | Đúng bảng Run status (ví dụ “Đang đọc dữ liệu xem trước”, “Đang điều chỉnh kế hoạch”) | rút gọn tuỳ màn |
| Tiêu đề run | Nguyên văn yêu cầu ở mọi màn (cắt bằng CSS, không viết lại) | bản rút gọn bằng tay |

### Hardening rules (after `/impeccable harden`, 17/09/2026)

- **Control không được mâu thuẫn với chữ cạnh nó.** Hành động bị server từ chối chắc chắn (vd. `409 ACTIVE_RUN`) thì nút bị `disabled` với lý do liên kết qua `aria-describedby`; khi kết quả gửi chưa rõ, hành động chính là **kiểm tra** (nút primary “Mở Lần chạy để kiểm tra”), gửi lại chỉ là nút secondary “Gửi lại yêu cầu” kèm điều kiện.
- **Giới hạn không phải lỗi.** `409 HISTORY_LIMIT` dùng banner `neutral` với icon thông tin, không có “Thử lại”/“Làm mới” vô ích; `unknown` chỉ dành cho kết quả ghi chưa rõ, `danger` cho lỗi thật.
- **Trạng thái chỉ có ở API thật không mang gợi ý fixture.** `401`, `429`, phiên hết hạn không có badge “Dữ liệu mô phỏng”, gợi ý email demo hay “mật khẩu bất kỳ”; ô lỗi có `aria-invalid="true"` và `aria-describedby` trỏ tới banner.
- **Đồng hồ thời hạn** có `role="timer"` với `aria-label` đầy đủ phút/giây; một vùng `aria-live="polite"` ẩn chỉ thông báo theo mốc (9, 5, 2, 1 phút, hết hạn); mốc 2 phút cũng là lúc dòng đồng hồ chuyển sang `decision-timer-urgent`, không đọc mỗi giây. Banner chờ duyệt có `role="status"`.
- **Tên truy cập duy nhất:** nút lặp lại phải nêu đối tượng (“Chi tiết kỹ thuật: Thêm dòng vào bảng tính”, “Xem JSON gốc: Kênh #nhom-ati”, “Xem nội dung: Bảng “Báo cáo tuần””). Hàng lần chạy là một link với `aria-label` gọn “Trạng thái: yêu cầu, thời gian”.
- **Focus nhìn thấy được ở mọi trang:** `:focus-visible { outline: 2px solid ink; outline-offset: 2px }` áp chung, không phần tử nào tự tắt outline.
- **Thẻ dẫn tới việc cần làm là một link cả thẻ** (thẻ “Cần xử lý” ở Tổng quan, hàng V04): `aria-label` gọn “Hành động: yêu cầu (trạng thái, thời gian)”, chữ hành động có mũi tên ở cuối thẻ chỉ là dấu hiệu nhìn thấy, không phải link lồng.
- **Điều hướng là link, hành động là nút:** “Xem chứng cứ” là `<a>` có dáng nút phụ. Hai link cùng tên được phép khi cùng đích (vd. “Tạo yêu cầu” ở nav và CTA trang).
- **Đăng nhập có một dàn ý ở mọi độ rộng:** H1 “Đăng nhập”, form đứng trước khối giới thiệu trong DOM (desktop dùng grid để đặt giới thiệu bên trái). `aria-invalid` và viền `danger` chỉ khi chính giá trị ô sai (401); 429 và hết phiên không đánh dấu ô.
- **Nút chỉ có icon** mang `font: inherit` để không rơi về cỡ chữ mặc định của trình duyệt khi có thêm chữ.
- **Lựa chọn bị chặn vẫn đọc được lý do:** radio mẫu không khả dụng dùng `aria-disabled="true"` (vẫn nhận focus) + `aria-describedby` tới dòng lý do, không dùng thuộc tính `disabled`.
- **Văn bản dài:** tiêu đề run hiển thị nguyên văn nhưng cắt tối đa 3 dòng trên V05 (2 dòng trong danh sách) bằng CSS, có “Xem toàn bộ yêu cầu” khi bị cắt; payload/bảng cuộn ngang trong khung riêng; thời gian dùng `Intl.DateTimeFormat('vi-VN', { timeZone })`.

### Distill rules (after `/impeccable distill`, 18/09/2026)

- **Định danh kỹ thuật nằm sau disclosure “Chi tiết kỹ thuật”.** Thẻ tóm tắt lần chạy chỉ để lộ dữ kiện người dùng đọc được (Duyệt bởi, Múi giờ, Chế độ lập kế hoạch); phiên bản kế hoạch và mã băm bản xem trước nằm sau nút “Chi tiết kỹ thuật” (chevron + `aria-expanded`), đúng mẫu đã dùng ở V06. Chỉ màn `succeeded` mở sẵn disclosure vì đó là lúc người dùng cần chứng cứ; các màn khác đóng.
- **Không lặp bảng chú giải trạng thái trong sản phẩm.** Bản đồ 14 `RunStatus` chỉ sống trong tài liệu này; mỗi hàng và mỗi thẻ đã tự mang pill trạng thái của nó.
- **Mỗi con số nói một lần.** Tổng số lần chạy đã tải thuộc dòng chân danh sách; tiêu đề phụ chỉ giữ “Tải lúc” và nghĩa của cột thời gian. Số việc cần xử lý thuộc badge nav và khu “Cần xử lý”, không nhắc lại ở tiêu đề phụ.
- **Màn chờ nói thời gian đã trôi** ngay trong banner trạng thái, dạng “mốc bắt đầu · đã N”: “Nhận yêu cầu lúc 14:22:07 · đã 4 giây”, “Bắt đầu chạy lúc 14:23:04 · đã 8 giây”.
- **Mục “Hoạt động” chỉ xuất hiện khi nó thêm thông tin** so với dải “Tiến trình”. Ở `planning` hai mốc duy nhất trùng với dải giai đoạn nên bỏ cả mục lẫn hairline ngăn section, không để lại đường kẻ mồ côi.
- **Artboard bằng chiều cao nội dung** (làm tròn lên bội số 20px): khoảng trắng dưới cùng là `padding-bottom: 64px` của `main`, không phải phần thừa của khung.

### Icons & bề mặt trình duyệt

- **Một bộ icon, một độ dày nét:** lucide, `viewBox="0 0 24 24"`, `stroke-width="2"` ở mọi kích thước hiển thị (12–32px) vì nét co giãn theo viewBox — không “chỉnh quang học” bằng 1.8 hay 2.4. Nét mảnh 1.4 chỉ thuộc logo ATI, không phải icon giao diện. Không dùng emoji hay ký tự Unicode thay icon.
- **Kích thước icon** theo vai trò: 14–16px trong pill và dòng chữ, 16px trong nút, 20px trong vòng tròn 40–48px, 32px cho logo.
- **Bề mặt trình duyệt cũng thuộc hệ:** `::selection` nền `primary-subtle` chữ `primary`; link `ink` với `text-underline-offset: 3px`, hover `primary`; số liệu thời gian và đếm dùng `font-variant-numeric: tabular-nums`; focus là viền 2px `ink`, không glow.

### Lists, tables, dialog, tooltip, demo badge

- **Danh sách lần chạy:** hàng cao ≥ 64px, ngăn bằng `hairline-soft`, pill trạng thái bên trái, yêu cầu `body-lg` 500 + dòng phụ `muted`, thời gian `caption`. Hover nền `surface-soft`. Mobile: xếp dọc.
- **Dialog** bo 20px: chỉ cho xác nhận quyết định; focus vào nút an toàn; Esc đóng; trả focus.
- **Tooltip** nền `ink`, chữ trắng, bo 8px; chỉ bổ sung, có với focus bàn phím.
- **Demo badge**: pill “Dữ liệu mô phỏng” luôn ở top nav khi build fixture.

## Do's and Don'ts

- **Do** dùng navy chỉ cho hành động chính và mục đang chọn; mọi màu khác phải mang nghĩa trạng thái.
- **Do** ghép màu trạng thái với icon và chữ; kiểm lại ở chế độ xám.
- **Do** đặt thời hạn, số thao tác ghi và đích trong thẻ quyết định trước mọi chi tiết khác.
- **Do** hiển thị payload dạng bảng/xem trước cho người đọc, JSON gốc luôn mở được.
- **Do** ngăn section bằng hairline và khoảng trắng; chỉ đóng khung nội dung cần gom.
- **Do** giữ vị trí cuộn, disclosure và focus khi dữ liệu polling cập nhật.
- **Do** tự host Be Vietnam Pro; mọi token mới thêm vào DESIGN.md trước khi dùng.
- **Don't** dùng màu Rausch, font Cereal, logo, ảnh hay bố cục marketing của Airbnb.
- **Don't** thêm mức bóng thứ hai, blur, gradient hay bóng màu.
- **Don't** dùng đậm 700 cho chữ nội dung; 700 chỉ dành cho `overline` và `wordmark`. Không có con số khổng lồ nào trên màn thao tác; ngoại lệ cỡ chữ duy nhất là tiêu đề giới thiệu ở trang Đăng nhập (V01) 40/50px, đậm 600.
- **Don't** dùng giá trị tuỳ ý (`bg-[#...]`, `p-[13px]`) trong view/component.
- **Don't** tự đóng banner chờ duyệt, cần đối chiếu hoặc lỗi; không thêm retry/resume cho ghi chưa rõ.
- **Don't** hiển thị phần trăm tiến trình hay số liệu trang trí không có ý nghĩa đo.
- **Don't** dùng danger đặc cho Từ chối/Huỷ.

## Implementation notes

- Kiểm tra hợp lệ và contrast bằng `@google/design.md@0.4.0 lint DESIGN.md` trước khi commit thay đổi token.
- `export --format css-tailwind` của bản 0.4.0 **chưa dùng trực tiếp được**: bọc cả font stack trong một cặp nháy kép; bỏ `fontFeature` và component token; sinh `--leading-*` thay vì `--text-<name>--line-height`. WEB-01C cần bước sinh `apps/web/src/app/theme.css` có hậu xử lý và test; không chỉnh tay file sinh ra.
- Component token dùng `backgroundColor` cho `divider`, `input-border`, `focus-ring` để biểu diễn màu đường kẻ, vì spec alpha chưa có thuộc tính border; khi áp vào CSS đó là `border-color`/`outline-color`.
- Font Be Vietnam Pro tự host: đặt file woff2 (400/500/600/700, subset latin + vietnamese) trong `apps/web/src/assets/fonts/`, khai báo `@font-face` với `font-display: swap`, ghi license OFL kèm file.
- Spacing đặt tên cùng tồn tại với thang số mặc định của Tailwind; trong code ưu tiên tên token.
- Mockup tham chiếu: canvas review “ATI Run Screens” (riêng tư). Mockup không chứng minh accessibility, responsive hay hành vi polling; các kiểm tra đó thuộc WEB-03.
- **Ngoại lệ chỉ có ở mockup:** artboard nạp Be Vietnam Pro từ Google Fonts vì canvas không có pipeline font cục bộ; `apps/web` vẫn tự host theo ADR-001/002. Các board mở đầu bằng “Cũ ·” là phương án đã loại, giữ để đối chiếu và **không** nằm trong phạm vi kiểm tra.
- **Cảnh báo `cramped-padding` được chấp nhận** khi chiều cao cố định thay cho padding: đo trên bản render, hàng tool 65px cách nội dung 11px trên/dưới, vòng tròn icon 40px cách 11px, pill 26px cách chữ 4.6–5.4px (đo lại ở critique 18/09). Mọi cảnh báo khác của detector phải sửa chứ không bỏ qua.

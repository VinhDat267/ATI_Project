# Design system: Agentic theo bản mẫu ATI

**Ngày:** 07/10/2026 · **Người viết:** Claude Code, theo yêu cầu của người dùng · **Nguồn:** 12 bản mẫu trong [`prototypes/`](prototypes/README.md) và bản React của chúng ([`prototypes/react/`](prototypes/react/README.md))

Tài liệu này mô tả design system mà 12 bản mẫu thật sự dùng. Theo quyết định ngày 07/10/2026, app đưa thẳng bản React của bản mẫu vào (đặc tả giao diện mục 1 và 1.2, task FE-04b → FE-10). Vì vậy đây là chuẩn cho:
- người làm FE khi cần hiểu một class trong trang đã chép;
- màn và thành phần **chưa có trong bản mẫu** (ví dụ màn "kết thúc không thành công" của FE-06).

Trang nào đã có trong bản mẫu thì chép nguyên bản React, kể cả những chỗ khác với tài liệu này (mục 9).

Số liệu đếm trên 12 file HTML ngày 07/10, không tính CSS trong thẻ `<style>`. "803/12" nghĩa là 803 lần, có ở 12 trang.

## 1. Nguồn gốc: Agentic của Open Design

Người dùng tạo 12 bản mẫu bằng Open Design và chọn design system **Agentic** (nhóm "Themed & Unique"). Gói Agentic nằm ở `resources/open-design/design-systems/agentic/` trong thư mục cài Open Design 0.24.1, gồm `DESIGN.md`, `USAGE.md`, `tokens.css`, `tailwind-v4.css`, `design-tokens.json`, trang xem trước và bộ component mẫu. Gói ghi nguồn là "OpenDesign curated bundled fixture" và không kèm giấy phép, nên repo **không chép các file đó**; tài liệu này chỉ ghi lại giá trị và mô tả bằng lời của nhóm.

Hai file chính của gói không khớp nhau:

| | `DESIGN.md` của Agentic | `tokens.css` của Agentic | 12 bản mẫu |
|---|---|---|---|
| Màu chính | cam `#FF5701` | xanh dương `#60a5fa` | cam `#FF5701` |
| Nền | `#F6F6F1` | tối `#0b1020` | `#F8F8F6`; chế độ tối `#0B1020` |
| Thẻ / chữ chính | `#FFFFFF` / `#111827` | `#131b2f` / `#f8fafc` | sáng như `DESIGN.md`, tối gần như `tokens.css` |
| Thành công / cảnh báo / lỗi | `#16A34A` / `#D97706` / `#DC2626` | `#22c55e` / `#fbbf24` / `#fb7185` | như `DESIGN.md` |
| Font | Playfair Display cho mọi chữ, JetBrains Mono | Inter, JetBrains Mono | Be Vietnam Pro (chữ thường), Playfair Display (tiêu đề), JetBrains Mono |
| Cỡ chữ | 14/16/18/24/32/40 | 12/13/15/17/22/32/48/66 | chủ yếu 10–12px cho nội dung, tiêu đề tới 52px (mục 3) |
| Chữ phụ, viền, bóng | không có | có, cho nền tối | bản mẫu tự thêm (mục 2, 5) |

Bản mẫu giữ tinh thần của `DESIGN.md`: một tín hiệu cam cho hành động chính, nền sáng ấm, thẻ trắng, tiêu đề có cá tính, chuyển động ngắn 150–300 ms, không thêm màu ngoài bảng. Mục 3.1 của đặc tả giao diện chép từ `DESIGN.md` nên khác bản mẫu ở nền và cỡ chữ.

## 2. Màu

### 2.1 Màu chính và bề mặt

Tên token là tên trong `tailwind.config` của bản mẫu (bản React khai theo từng trang trong `react/src/styles/tokens.css`). Cột "Tối" là giá trị `theme.css` ghi đè khi `<html>` có class `dark`.

| Token | Sáng | Tối | Dùng cho | Class hay gặp |
|---|---|---|---|---|
| `brand-primary` | `#FF5701` | `#FF5701` | nút chính, link nhấn, viền focus, phần tử đang chọn | `bg-[#FF5701]` 103/11, `text-[#FF5701]` 148/12 |
| `brand-primary-hover` | `#E04C00` | như sáng | hover của nút chính | `hover:bg-[#E04C00]` 19/2 |
| `brand-primary-light` | `#FFF3ED` | `rgba(255,87,1,.14)` | nền nhạt của chip/hộp nhấn cam | `bg-[#FFF3ED]`, `bg-[#FF5701]/10` |
| `brand-bg` | `#F8F8F6` | `#0E1528` (thân trang `#0B1020`) | nền trang, vùng lõm | `bg-[#F8F8F6]` 122/11 |
| `brand-surface` | `#FFFFFF` | `#131B2F` | thẻ, ngăn, hộp thoại, ô nhập | `bg-white` 282/12 |
| `brand-border` | `#E7E7E2` | `rgba(148,163,184,.18)` | viền mặc định | `border-[#E7E7E2]` 423/11 |
| `brand-border-subtle` | `#F0F0EB` | (theo `theme.css`) | đường chia trong thẻ | `border-[#F0F0EB]` |
| nền phụ | `neutral-100`, `#F3F4F6`, `neutral-50` | `#1A2338`, `#172036` | hàng hover, chip trung tính | `bg-neutral-100` 96/10, `hover:bg-neutral-100` 56/8 |
| nền tối nhấn | `#111827` (token `brand-text`) | `#334155` | nút tối (ví dụ "Xem hội thoại"), toast thông tin | `bg-[#111827]` 29/8, `bg-brand-text` |
| lớp phủ | `black/40` | như sáng | nền sau hộp thoại/ngăn (kèm `backdrop-blur`) | `bg-black/40` 12/5 |

### 2.2 Chữ

| Vai trò | Sáng | Tối | Class |
|---|---|---|---|
| chữ chính | `#111827` | `#F1F5F9` | `text-[#111827]` 383/11 |
| chữ phụ | `#4B5563` | `#B4BFCD` | `text-[#4B5563]` 247/11 |
| chữ mờ (nhãn, giờ, gợi ý) | `#6B7280` | `#A1AEC0` | `text-[#6B7280]` 256/11 |
| chữ rất mờ (placeholder, chú thích) | `#9CA3AF` | `#8F9CB1` | `text-[#9CA3AF]` 62/9, `placeholder-[#9CA3AF]` |

Bản mẫu còn dùng thang `neutral-400…900` ở một số trang (khoảng 200 lần). Màn mới dùng bốn mã hex ở bảng trên.

### 2.3 Trạng thái

| Vai trò | Màu đặc | Nền nhạt | Chữ trên nền nhạt | Tối (chữ) |
|---|---|---|---|---|
| thành công | `#16A34A` | `emerald-50` / `#F0FDF4` | `emerald-600/700` | `#6EE7B7` |
| cảnh báo, chưa rõ kết quả | `#D97706` | `amber-50` | `amber-800` | `#FCD34D` |
| lỗi, hành động phá huỷ | `#DC2626` | `red-50` / `#FEF2F2` | `red-700` | `#FCA5A5` |
| dải thử nghiệm | — | `#FEF9C3`, viền `amber-200/80` | `amber-900` | (theo `theme.css`) |

Nền nhạt ở chế độ tối là màu cùng họ với độ mờ 0,14 (ví dụ `rgba(16,185,129,.14)`).

### 2.4 Màu của dịch vụ

Màu nhận diện (Trello `#0079BF`, Google Sheets `#0F9D58`, GitHub `#24292E`…) dùng trong logo và biểu tượng dịch vụ. Bản mẫu có dùng làm màu chữ ở chip dịch vụ (khoảng 50 lần); màn mới chỉ dùng trong logo.

## 3. Chữ

| Vai trò | Font | Ghi chú |
|---|---|---|
| chữ thường, nút, nhãn | Be Vietnam Pro (`font-sans`) | đọc tốt tiếng Việt ở cỡ nhỏ |
| tiêu đề, số lớn | Playfair Display (`font-display`, 140/12) | thường kèm `tracking-tight` (56/12) |
| mã, ID, khoá | JetBrains Mono (`font-mono`, 56/10) | |

Thang cỡ chữ bản mẫu thật sự dùng (Tailwind v3, line-height cố định):

| Cỡ | Class | Số lần | Dùng cho |
|---|---|---|---|
| 10px | `text-[10px]` | 79/11 | nhãn chữ in hoa (`uppercase tracking-wider`), chú thích rất nhỏ |
| 11px | `text-[11px]` | 198/12 | chip, nhãn phụ, giờ |
| 12px | `text-xs` | 803/12 | phần lớn nội dung trong thẻ, nút phụ |
| 14px | `text-sm`, `sm:text-sm` | 162 + 197/12 | nội dung chính, nút chính, ô nhập |
| 16–20px | `text-base`, `text-lg`, `text-xl` | 41, 43, 19 | tiêu đề thẻ, đoạn dẫn |
| 24–36px | `text-2xl`…`sm:text-4xl`, `sm:text-[26px]` | khoảng 110 | tiêu đề trang, tiêu đề khoảnh khắc |
| 42–52px | `lg:text-[42px]`, `lg:text-5xl`, `lg:text-[52px]` | vài chỗ | tiêu đề trang giới thiệu và một số màn lớn ở desktop |

Độ đậm: `font-medium` (507) cho chữ thường có nhấn, `font-semibold` (400) cho nút và nhãn, `font-bold` (222) cho tiêu đề và số. Nhãn nhóm viết hoa dùng `tracking-wider` (65/11).

Màn mới chọn cỡ trong bảng trên, theo đúng vai trò. Không dùng cỡ khác bảng.

## 4. Khoảng cách và bố cục

- Khung nội dung giữa trang: `max-w-5xl mx-auto px-4 sm:px-6` (thanh trên, dải thử nghiệm); nội dung đọc hẹp hơn (`max-w-3xl`, `max-w-md` cho hộp thoại).
- Đệm thẻ `p-4 sm:p-5` hoặc `p-5 sm:p-6`; hộp thoại `p-6 sm:p-8`.
- Khoảng cách giữa khối: `space-y-*`/`gap-*` theo bước 4px của Tailwind (`gap-2`, `gap-3`, `space-y-6`, `space-y-8`). Agentic ghi lưới 8pt; bản mẫu dùng cả bước 2/6/10px (`gap-1.5`, `py-2.5`).
- Thanh trên dính (`sticky top-0`), nền trang mờ 90% và `backdrop-blur-md`.

## 5. Bo góc và bóng

| Bo góc | Số lần | Dùng cho |
|---|---|---|
| `rounded-xl` (12px) | 350/12 | nút, ô nhập, toast, thẻ nhỏ |
| `rounded-lg` (8px) | 246/12 | tab, nút nhỏ, chip vuông |
| `rounded-full` | 236/11 | chip, huy hiệu, avatar, nút tròn |
| `rounded-2xl` (16px) | 152/10 | thẻ, khối nội dung |
| `rounded-3xl` (24px) | 9/3 | hộp thoại |

| Bóng | Giá trị (chuẩn cho màn mới, mục 9) | Dùng cho |
|---|---|---|
| `shadow-sm` | mặc định Tailwind v3 | thẻ, nút (250/12) |
| `shadow-soft-card` | `0 1px 3px rgba(0,0,0,.02), 0 8px 24px -4px rgba(0,0,0,.04)` | thẻ nổi ở cockpit |
| `shadow-elevated` | `0 4px 6px -1px rgba(0,0,0,.02), 0 20px 32px -6px rgba(0,0,0,.07)` | thẻ nổi lớn |
| `shadow-orange-glow` | `0 0 0 3px rgba(255,87,1,.18)` | ô nhập lớn đang focus (`focus-within`) |
| `shadow-drawer` | `-8px 0 32px rgba(0,0,0,.08)` | ngăn kéo bên phải |
| `shadow-2xl`, `shadow-lg` | mặc định Tailwind v3 | hộp thoại, ngăn kéo; toast |

## 6. Chuyển động

- `transition-all` hoặc `transition-colors` với `duration-200` (18/7) hoặc `duration-300` (25/6); Agentic ghi 150–250 ms.
- Chuyển khoảnh khắc ở cockpit: mờ dần và trượt ngắn 180–260 ms (CSS riêng của `app-stage`).
- Có `prefers-reduced-motion`: tắt hoặc rút ngắn hiệu ứng (ví dụ trang giới thiệu ẩn sân khấu tương tác, chữ gõ dần hiện ngay).

## 7. Chế độ tối

- Bật bằng class `dark` trên `<html>`; lựa chọn lưu ở `localStorage` khoá `ati-theme`; chưa chọn thì theo hệ điều hành (`theme.js` của bản mẫu, `use-theme.ts` của app).
- Màu tối do `prototypes/theme.css` ghi đè **theo tên class màu** (ví dụ `.bg-white` → `#131B2F`), không dùng biến. Hệ quả cho màn mới: chỉ dùng các class màu đã có trong `theme.css`. Dùng class màu mới thì phải thêm dòng ghi đè tương ứng vào `theme.css` (và chạy lại `npm run verify` của bản React).
- Màu cam giữ nguyên ở chế độ tối; chữ trên nền nhạt chuyển sang màu sáng cùng họ (mục 2.3).

## 8. Thành phần

Class mẫu lấy nguyên từ bản React. Màn mới chép class của thành phần tương ứng, không tự viết bộ class mới.

| Thành phần | Class mẫu | Tham chiếu trong `prototypes/react/src/pages/` |
|---|---|---|
| Nút chính | `w-full py-3 px-4 bg-[#FF5701] hover:bg-[#E04C00] text-white text-sm font-semibold rounded-xl shadow-md shadow-[#FF5701]/20 transition-all v3-transform active:scale-[0.99] flex items-center justify-center gap-2` | `Landing/LandingPage.tsx` `#btn-submit-login` |
| Nút phụ | `w-full py-2.5 px-4 bg-white border border-[#E7E7E2] hover:bg-[#F8F8F6] text-xs font-medium text-[#4B5563] rounded-xl transition-all` | `Landing/LandingPage.tsx` `#btn-back-from-forgot` |
| Nút tối | `inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-brand-text hover:bg-black rounded-lg shadow-sm transition-all` | `AppStage/AppStagePage.tsx` `#btn-open-chat` |
| Ô nhập | `w-full px-3.5 py-2.5 text-sm bg-white border border-[#E7E7E2] rounded-xl text-[#111827] placeholder-[#9CA3AF] focus:border-[#FF5701] focus:ring-2 focus:ring-[#FF5701]/20` | `Landing/LandingPage.tsx` `#login-email` |
| Ô nhập lớn (thẻ) | `relative bg-white rounded-2xl border border-brand-border shadow-soft-card p-3 sm:p-4 focus-within:border-brand-primary focus-within:shadow-orange-glow` | `AppStage/AppStagePage.tsx` khoảnh khắc 1 |
| Thẻ gợi ý bấm được | `p-4 bg-white hover:bg-neutral-50 rounded-2xl border border-brand-border shadow-soft-card hover:-translate-y-0.5 hover:shadow-md` | `AppStage/AppStagePage.tsx` khoảnh khắc 1 |
| Tab | đang chọn `px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold bg-[#FF5701] text-white shadow-sm`; không chọn `font-medium text-[#6B7280] hover:text-[#111827]` | `Users/UsersPage.tsx` `TAB_ON`, `TAB_OFF` |
| Chip trạng thái | `text-[11px] font-semibold px-2.5 py-0.5 rounded-full` + màu trạng thái (mục 2.3) | `AppStage/AppStagePage.tsx` `RECEIPT_STATUS` |
| Huy hiệu bước | `text-xs px-1.5 py-0.5 rounded font-medium` + màu trạng thái | `AppStage/AppStagePage.tsx` `BADGE_DONE` |
| Toast | `px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium shadow-lg border flex items-center gap-2` + màu theo loại | `AppStage/AppStagePage.tsx` `TOAST_BASE`, `TOAST_COLOR` |
| Hộp thoại | `bg-white border border-[#E7E7E2] rounded-3xl shadow-2xl max-w-md w-full p-6 sm:p-8`, nền sau `bg-black/40` mờ nhoè | `Landing/LandingPage.tsx` `#auth-modal-card` |
| Ngăn kéo | `fixed inset-y-0 right-0 z-50 w-full sm:w-[420px] bg-white border-l border-brand-border shadow-2xl`, trượt `translate-x-full` | `AppStage/AppStagePage.tsx` `#chat-drawer`, `#history-drawer` |
| Thanh trên | `sticky top-0 z-30 w-full bg-[#F8F8F6]/90 backdrop-blur-md border-b border-brand-border` | `AppStage/AppStagePage.tsx` `<header>` |
| Dải thử nghiệm | `bg-[#FEF9C3] border-t border-amber-200/80 text-amber-900`, cao `h-8`, chữ `text-[11px] sm:text-xs` | `AppStage/AppStagePage.tsx` `#test-mode-banner` |
| Nút sáng/tối | `.ati-theme-toggle` 32×32, bo 10px, viền `#E7E7E2` | `prototypes/theme.css` |

## 9. Chỗ lệch giữa các trang và giá trị chuẩn

Người dùng chốt ngày 07/10: trang đã có trong bản mẫu **giữ nguyên** giá trị của trang đó (để vẫn khớp bản React); màn và thành phần mới dùng giá trị chuẩn dưới đây, lấy theo `app-stage` vì đó là màn chính của app.

| Chỗ lệch | Các giá trị trong bản mẫu | Chuẩn cho màn mới |
|---|---|---|
| Hover nút chính | `#E04C00` (`app-stage`, `auth-action`, `index`; 21 lần), `#E04D00` (`guide`, `history`, `privacy`, `responses`; 14 lần) | `#E04C00` |
| `shadow-soft-card` | 3 giá trị (`app-stage`, `index`, `privacy`) | giá trị của `app-stage` (mục 5) |
| `shadow-elevated` | 3 giá trị (`app-stage`, `index`, `privacy`) | giá trị của `app-stage` (mục 5) |
| `shadow-orange-glow` | độ mờ 0,18 (`app-stage`), 0,2 (`index`) | 0,18 |
| Tên token cảnh báo | `brand-warn` (9 trang), `brand-warning` (2 trang), cùng `#D97706` | `brand-warn` |
| Tên token cam nhạt | `brand-primary-light` (`app-stage`), `brand-primary-subtle` (`index`), cùng `#FFF3ED` | `brand-primary-light` |
| Font chữ thường dự phòng | ba cách viết sau `"Be Vietnam Pro"` | `"Be Vietnam Pro", system-ui, -apple-system, sans-serif` |
| Màu chữ trung tính | mã hex (`#111827`, `#4B5563`, `#6B7280`, `#9CA3AF`) và thang `neutral-*` | mã hex (mục 2.2) |

## 10. Trợ năng

Người dùng chấp nhận ngày 07/10 (đặc tả 1.1 điểm 4): các yêu cầu làm đổi hình thức không áp dụng. Cụ thể là chữ tối thiểu 14px, vùng chạm 40×40, tương phản 4,5:1 cho chữ nhỏ màu xám (ví dụ `#9CA3AF` trên nền trắng 2,54:1, trên `#F8F8F6` 2,39:1; `#6B7280` trên nền trắng đạt 4,83:1). FE-10 đo và ghi lại.

Vẫn bắt buộc cho mọi màn:
- `role`/`aria-*`, landmark, một `h1`, nhãn cho nút chỉ có biểu tượng, bẫy focus, Esc và trả focus cho hộp thoại/ngăn;
- **viền focus thấy được.** Bản mẫu có 36 phần tử `focus-visible:outline-none` nhưng chỉ 3 phần tử có vòng focus thay thế. Với lớp tương thích v3, `outline-none` chỉ còn viền trong suốt, nên khi dùng bàn phím không thấy focus. Màn mới và trang đã chép thêm `focus-visible:ring-2 focus-visible:ring-[#FF5701]` (không đổi kích thước), giống nút sáng/tối của `theme.css`.

## 11. Quy tắc cho màn mới

1. Tìm thành phần gần nhất ở mục 8 và chép class; không tự viết bộ class mới.
2. Màu chỉ lấy từ mục 2. Class màu phải có dòng ghi đè trong `theme.css`, nếu không sẽ không đổi theo chế độ tối.
3. Cỡ chữ, bo góc, bóng chỉ lấy từ các bảng ở mục 3 và 5. Chỗ có lệch thì dùng giá trị chuẩn ở mục 9.
4. Một tín hiệu cam cho mỗi vùng: nút chính, phần tử đang chọn hoặc viền focus. Không dùng cam cho trang trí.
5. Theo quy ước Tailwind v3 của bản React (`v3-space-*`, `v3-transform`, `v3-outline-none`, `hidden!`; xem README `react/`), để trong app không lẫn hai cách tính.
6. Quy tắc trung thực của đặc tả mục 6 đứng trên hình thức: không hiện số liệu hay trạng thái chưa có.

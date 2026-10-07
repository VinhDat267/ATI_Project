---
name: "ATI · Sân khấu điều phối"
description: "Design system Agentic theo 12 bản mẫu của ATI: nền giấy ấm, thẻ trắng viền mảnh, một tín hiệu cam #FF5701, tiêu đề Playfair Display, chữ Be Vietnam Pro."
colors:
  agentic-orange: "#FF5701"
  agentic-orange-deep: "#E04C00"
  apricot-wash: "#FFF3ED"
  warm-paper: "#F8F8F6"
  card-white: "#FFFFFF"
  hairline-sand: "#E7E7E2"
  hairline-faint: "#F0F0EB"
  ink-graphite: "#111827"
  slate-secondary: "#4B5563"
  pebble-muted: "#6B7280"
  ash-quiet: "#9CA3AF"
  forest-success: "#16A34A"
  forest-success-text: "#059669"
  mint-wash: "#ECFDF5"
  amber-warning: "#D97706"
  amber-warning-text: "#92400E"
  honey-wash: "#FFFBEB"
  brick-danger: "#DC2626"
  brick-danger-text: "#B91C1C"
  blush-wash: "#FEF2F2"
  sandbox-lemon: "#FEF9C3"
  sandbox-ink: "#78350F"
  night-canvas: "#0B1020"
  night-inset: "#0E1528"
  night-card: "#131B2F"
  night-ink: "#F1F5F9"
  night-secondary: "#B4BFCD"
  night-muted: "#A1AEC0"
typography:
  display:
    fontFamily: "'Playfair Display', Georgia, serif"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: "2.5rem"
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "'Playfair Display', Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: "2rem"
    letterSpacing: "-0.025em"
  title:
    fontFamily: "'Be Vietnam Pro', system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: "1.5rem"
  body:
    fontFamily: "'Be Vietnam Pro', system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  body-sm:
    fontFamily: "'Be Vietnam Pro', system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: "1rem"
  label:
    fontFamily: "'Be Vietnam Pro', system-ui, -apple-system, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: "1rem"
    letterSpacing: "0.05em"
  micro:
    fontFamily: "'Be Vietnam Pro', system-ui, -apple-system, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 600
    lineHeight: "1rem"
    letterSpacing: "0.05em"
  mono:
    fontFamily: "'JetBrains Mono', ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: "1rem"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  2xl: "16px"
  3xl: "24px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
components:
  button-primary:
    backgroundColor: "{colors.agentic-orange}"
    textColor: "{colors.card-white}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: "12px 16px"
  button-primary-hover:
    backgroundColor: "{colors.agentic-orange-deep}"
    textColor: "{colors.card-white}"
  button-secondary:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.slate-secondary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.xl}"
    padding: "10px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.warm-paper}"
  button-night:
    backgroundColor: "{colors.ink-graphite}"
    textColor: "{colors.card-white}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    padding: "6px 12px"
  tab-active:
    backgroundColor: "{colors.agentic-orange}"
    textColor: "{colors.card-white}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    padding: "6px 14px"
  tab-idle:
    textColor: "{colors.pebble-muted}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    padding: "6px 14px"
  input-field:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink-graphite}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: "10px 14px"
  card:
    backgroundColor: "{colors.card-white}"
    rounded: "{rounded.2xl}"
    padding: "16px"
  chip-success:
    backgroundColor: "{colors.mint-wash}"
    textColor: "{colors.forest-success-text}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
  toast-info:
    backgroundColor: "{colors.ink-graphite}"
    textColor: "{colors.card-white}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.xl}"
    padding: "10px 16px"
  dialog:
    backgroundColor: "{colors.card-white}"
    rounded: "{rounded.3xl}"
    padding: "24px"
  sandbox-banner:
    backgroundColor: "{colors.sandbox-lemon}"
    textColor: "{colors.sandbox-ink}"
    typography: "{typography.label}"
    height: "32px"
---

# Design System: ATI · Sân khấu điều phối

Design system **Agentic** (Open Design) đúng như 12 bản mẫu trong [`docs/design/prototypes/`](docs/design/prototypes/README.md) thể hiện, và như bản React của chúng ([`docs/design/prototypes/react/`](docs/design/prototypes/react/README.md)) mà app chép vào từ FE-04b. Số liệu sử dụng, bảng chế độ tối đầy đủ, chỗ tham chiếu từng thành phần và các chỗ lệch giữa trang ở [`docs/design/design-system.md`](docs/design/design-system.md). Phần đầu YAML là chuẩn; phần chữ giải thích.

## Overview

**Creative North Star: "Sân khấu điều phối"**

Mỗi lúc trên màn hình chỉ có một khoảnh khắc đang diễn: người dùng nói việc cần làm, ATI tìm đúng chỗ, hỏi lại khi thiếu, trình kế hoạch để duyệt, làm từng việc, rồi trao biên nhận. Sân khấu là một nền giấy ấm (#F8F8F6), các thẻ trắng viền mảnh đứng trên đó như đạo cụ, và chỉ một luồng sáng cam (#FF5701) chỉ vào việc cần làm tiếp. Mọi thứ khác lùi về sau: hội thoại đầy đủ nằm trong ngăn kéo, chi tiết kỹ thuật thu vào một nút.

Mật độ cao nhưng không chật: phần lớn nội dung trong thẻ dùng chữ 12px, tiêu đề Playfair Display mang cá tính, khoảng thở đến từ khoảng cách giữa các khối hơn là từ viền. Tông giọng điềm tĩnh và trung thực: giao diện không hiện điều chưa xảy ra (không có số issue trước khi việc chạy xong, không có phần trăm giả).

Chế độ tối giữ nguyên vai diễn: nền xanh đêm (#0B1020), thẻ #131B2F, chữ sáng #F1F5F9, và tia cam không đổi.

**Key Characteristics:**
- Một tín hiệu cam cho hành động chính, phần tử đang chọn và viền focus.
- Nền giấy ấm, thẻ trắng viền cát mảnh (#E7E7E2), bóng rất nhẹ.
- Tiêu đề Playfair Display, chữ Be Vietnam Pro (đọc tốt tiếng Việt ở cỡ nhỏ), mã và ID JetBrains Mono.
- Thông tin dày ở cỡ 11–12px, phân cấp bằng độ đậm và màu xám thay vì nhiều cỡ chữ.
- Chuyển cảnh ngắn 200–300 ms, tắt khi người dùng giảm chuyển động.

## Colors

Bảng màu ấm và tiết chế: giấy, mực, cát, và một màu cam duy nhất làm tín hiệu.

### Primary
- **Cam Agentic** (#FF5701): nút chính, tab đang chọn, link nhấn, viền focus, ô nhập lớn đang focus (vòng sáng cam mờ). Chữ trên nút cam luôn trắng, đậm 600 trở lên.
- **Cam sẫm** (#E04C00): hover của nút chính. Màn mới dùng giá trị này; một số trang bản mẫu dùng #E04D00 và được giữ nguyên.
- **Nước mơ** (#FFF3ED): nền nhạt của chip và hộp nhấn cam; ở chế độ tối là cam mờ 14%.

### Neutral
- **Giấy ấm** (#F8F8F6): nền trang, vùng lõm, thanh trên mờ 90% có nhoè nền.
- **Thẻ trắng** (#FFFFFF): thẻ, ngăn kéo, hộp thoại, ô nhập.
- **Viền cát** (#E7E7E2): viền mặc định của thẻ, ô nhập, đường chia; **viền mờ** (#F0F0EB) cho đường chia trong thẻ.
- **Mực than chì** (#111827): chữ chính, nền nút tối và toast thông tin.
- **Xám đá phiến** (#4B5563): chữ phụ, nhãn nút phụ.
- **Xám sỏi** (#6B7280): nhãn, giờ, gợi ý.
- **Xám tro** (#9CA3AF): placeholder và chú thích rất nhỏ.

### Trạng thái
- **Xanh rừng** (#16A34A, chữ #059669 trên nền #ECFDF5): thành công, "Đã tạo/Đã ghi/Đã gửi".
- **Hổ phách** (#D97706, chữ #92400E trên nền #FFFBEB): cảnh báo, chưa rõ kết quả.
- **Gạch đỏ** (#DC2626, chữ #B91C1C trên nền #FEF2F2): lỗi, hành động phá huỷ.
- **Chanh thử nghiệm** (#FEF9C3, chữ #78350F, viền trên hổ phách nhạt): dải "Chế độ thử nghiệm" khi máy chủ chạy sandbox.

### Chế độ tối
- **Nền đêm** (#0B1020), **lõm đêm** (#0E1528), **thẻ đêm** (#131B2F); chữ **sáng đêm** (#F1F5F9), phụ (#B4BFCD), mờ (#A1AEC0). Màu tối do `docs/design/prototypes/theme.css` ghi đè theo tên class; class màu mới phải có dòng ghi đè tương ứng.

**The One Signal Rule.** Mỗi vùng màn hình chỉ có một tín hiệu cam: nút chính, phần tử đang chọn hoặc viền focus. Cam không dùng để trang trí; hiếm mới có sức chỉ dẫn.

**The Service Color Rule.** Màu nhận diện của dịch vụ (Trello #0079BF, Google Sheets #0F9D58, GitHub #24292E…) chỉ nằm trong logo và biểu tượng dịch vụ, không làm màu chữ hay nền của màn mới.

## Typography

**Display Font:** Playfair Display (với Georgia, serif)
**Body Font:** Be Vietnam Pro (với system-ui, sans-serif)
**Label/Mono Font:** JetBrains Mono (với ui-monospace)

**Character:** Playfair có chân, đậm, giãn chữ hẹp (-0.025em) cho tiêu đề mang dáng biên tập; Be Vietnam Pro không chân, dấu tiếng Việt rõ ở 11–14px, gánh toàn bộ nội dung thao tác.

### Hierarchy
- **Display** (700, 36px, dòng 40px; trang giới thiệu tới 42–52px ở desktop): tiêu đề trang và tiêu đề khoảnh khắc.
- **Headline** (700, 24px, dòng 32px): tiêu đề thẻ lớn, tiêu đề hộp thoại.
- **Title** (600, 16px, dòng 24px): tên thẻ, tên dịch vụ.
- **Body** (400, 14px, dòng 20px): nội dung chính, ô nhập, nút chính.
- **Body-sm** (500, 12px, dòng 16px): phần lớn nội dung trong thẻ, nút phụ, tab.
- **Label** (600, 11px, giãn 0.05em, thường viết hoa): chip, nhãn nhóm, giờ.
- **Micro** (600, 10px, viết hoa, giãn 0.05em): nhãn nhóm nhỏ nhất.
- **Mono** (500, 12px): mã, ID, khoá, đường dẫn.

**The Weight Before Size Rule.** Phân cấp trong thẻ bằng độ đậm (500/600/700) và màu (mực, đá phiến, sỏi), không thêm cỡ chữ ngoài thang trên.

## Layout

Khung nội dung giữa trang, tối đa 1024px (`max-w-5xl`) cho thanh trên và dải thử nghiệm; nội dung hẹp hơn tuỳ trang (576–896px, `max-w-xl` → `max-w-4xl`), hộp thoại 448px (`max-w-md`); lề 16px ở điện thoại, 24px từ 640px. Khoảng cách theo bước 4px (4, 8, 12, 16, 20, 24, 32px; có cả 6px và 10px cho đệm nút). Thẻ đệm 16–24px, hộp thoại 24–32px, giữa các khối 24–32px. Thanh trên dính đầu trang. Từ 640px và 1024px bố cục mở rộng (lưới gợi ý 2×2, ngăn kéo 420px bên phải); dưới 640px mọi thứ xếp một cột, ngăn kéo phủ toàn màn.

## Elevation & Depth

Phân tầng chủ yếu bằng tông nền (giấy → thẻ trắng) và viền cát; bóng rất nhẹ, chỉ đủ tách thẻ khỏi nền. Bóng đậm chỉ dành cho lớp nổi lên trên nội dung (hộp thoại, ngăn kéo, toast).

### Shadow Vocabulary
- **Mặc định thẻ** (`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)`): thẻ, nút, chip có viền.
- **Thẻ nổi** (`box-shadow: 0 1px 3px rgba(0,0,0,.02), 0 8px 24px -4px rgba(0,0,0,.04)`): thẻ ở cockpit, ô nhập lớn.
- **Nổi cao** (`box-shadow: 0 4px 6px -1px rgba(0,0,0,.02), 0 20px 32px -6px rgba(0,0,0,.07)`): khối nổi lớn.
- **Vòng sáng cam** (`box-shadow: 0 0 0 3px rgba(255,87,1,.18)`): ô nhập lớn khi đang focus.
- **Ngăn kéo** (`box-shadow: -8px 0 32px rgba(0,0,0,.08)`): ngăn bên phải.
- **Lớp phủ:** nền đen 40% có nhoè sau hộp thoại và ngăn kéo.

**The Quiet Shadow Rule.** Thẻ ở trạng thái nghỉ chỉ có bóng mặc định; bóng lớn chỉ xuất hiện cho lớp đang nằm trên nội dung khác.

## Shapes

Góc bo mềm, tăng theo kích thước khối: chip vuông 4px, tab và nút nhỏ 8px (`rounded-lg`), nút và ô nhập 12px (`rounded-xl`), thẻ 16px (`rounded-2xl`), hộp thoại 24px (`rounded-3xl`); chip, huy hiệu và avatar bo tròn hẳn. Viền 1px màu cát cho mọi khối nền trắng; logo là ô vuông cam 32px bo 8px chữ "A" Playfair trắng.

## Components

### Buttons
- **Shape:** bo 12px (`rounded-xl`); nút nhỏ trên thanh trên bo 8px.
- **Primary:** nền cam (#FF5701), chữ trắng 14px đậm 600, đệm 12×16px, bóng cam mờ; hover cam sẫm (#E04C00), nhấn co 99%.
- **Secondary:** nền trắng, viền cát, chữ đá phiến (#4B5563) 12px đậm 500, đệm 10×16px; hover nền giấy.
- **Night:** nền mực (#111827), chữ trắng 12px, bo 8px, đệm 6×12px; hover đen. Dùng cho "Xem hội thoại".
- **Focus:** viền focus cam thấy được trên mọi nút (xem Do's and Don'ts).

### Chips
- **Style:** chữ 11px đậm 600, đệm 2×10px, bo tròn; màu theo trạng thái (nền nhạt, chữ đậm cùng họ).
- **State:** chỉ hiện "Đã tạo/Đã ghi/Đã gửi" khi bước đã thành công.

### Cards / Containers
- **Corner Style:** 16px.
- **Background:** thẻ trắng trên nền giấy; ở chế độ tối #131B2F trên #0B1020.
- **Shadow Strategy:** mặc định thẻ, hoặc thẻ nổi ở cockpit (Elevation & Depth).
- **Border:** 1px viền cát (#E7E7E2).
- **Internal Padding:** 16–20px, 24px cho thẻ lớn.

### Inputs / Fields
- **Style:** nền trắng, viền cát, bo 12px, chữ 14px, placeholder xám tro (#9CA3AF), đệm 10×14px.
- **Focus:** viền chuyển cam và vòng cam mờ 2px; ô nhập lớn dạng thẻ dùng vòng sáng cam 3px.
- **Error / Disabled:** chữ lỗi đỏ gạch (#DC2626) 11–12px dưới ô; chỉ một ô nhập chat hiện cùng lúc.

### Navigation
- **Thanh trên:** dính đầu trang, nền giấy mờ 90% nhoè nền, viền dưới cát; trái là logo và nút quay lại, phải là cụm nút (lịch sử, xem hội thoại, sáng/tối, avatar). Nút sáng/tối 32×32 bo 10px.
- **Tab:** tab đang chọn nền cam chữ trắng 12–14px đậm 600; tab khác chữ sỏi, hover chữ mực.
- **Ngăn kéo:** trượt từ phải, rộng 420px (toàn màn dưới 640px), bóng lớn, có bẫy focus và Esc.

### Thẻ khoảnh khắc (signature)
Mỗi khoảnh khắc của cockpit là một khối giữa trang: nhãn nhỏ viết hoa, tiêu đề Playfair, nội dung trong thẻ trắng, và một hành động cam duy nhất. Thẻ từng việc có ô biểu tượng dịch vụ, chip hành động, "Việc n", mô tả đậm và "Đích đến".

### Dải thử nghiệm (signature)
Dải vàng chanh cao 32px dưới thanh trên, chữ nâu hổ phách (#78350F) 11–12px, chỉ hiện khi máy chủ chạy sandbox.

## Do's and Don'ts

### Do:
- **Do** chép class của thành phần gần nhất trong bản React (`docs/design/prototypes/react/src/pages/`) thay vì tự viết bộ class mới.
- **Do** giữ một tín hiệu cam mỗi vùng (The One Signal Rule) và chữ trắng đậm 600 trên nút cam.
- **Do** dùng thang chữ trong Typography; phân cấp bằng độ đậm và màu trước khi đổi cỡ.
- **Do** thêm viền focus thấy được (`focus-visible:ring-2` màu #FF5701, không đổi kích thước) cho phần tử nào trong bản mẫu đang tắt viền focus.
- **Do** chỉ dùng class màu đã có dòng ghi đè chế độ tối trong `theme.css`.
- **Do** hiện đúng trạng thái thật: số issue, link và chip "Đã tạo" chỉ sau khi bước chạy xong; thanh tiến độ bằng số việc xong / tổng.

### Don't:
- **Don't** thêm màu ngoài bảng khi một màu có sẵn đáp ứng được.
- **Don't** dùng màu nhận diện dịch vụ làm màu chữ hay nền (The Service Color Rule).
- **Don't** dùng utility gradient của Tailwind v4 (`bg-linear-to-*`, `from-*`… ngoài danh sách `@source not inline`): nó làm hỏng gradient chế độ tối của bản mẫu.
- **Don't** đặt chữ trắng trên nền cam ở cỡ dưới 14px; huy hiệu nhỏ dùng nền nước mơ và chữ cam đậm.
- **Don't** hiện câu ước lượng chưa đo ("Thường mất khoảng 3–5 giây") hay phần trăm tiến độ giả.
- **Don't** hiện hai ô nhập chat cùng lúc.

Giới hạn đã được người dùng chấp nhận ngày 07/10/2026: chữ 10–12px và một số chữ xám nhỏ (#9CA3AF trên nền trắng 2,54:1) không đạt tương phản 4,5:1; vùng chạm một số nút 32px. Chỉ đo và ghi lại, không sửa nếu làm đổi hình thức bản mẫu.

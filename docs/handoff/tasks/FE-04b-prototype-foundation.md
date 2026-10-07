# FE-04b · Lớp nền của bản React trong app (design system bản mẫu)

**Trạng thái:** chờ, giao được ngay · **Nhánh gợi ý:** `feat/fe-04b-prototype-foundation` · **Phụ thuộc:** PROTO-01 đã xong (#96 tại `581addd`) · **Mốc:** 09/10/2026, trước FE-05b và FE-07
**Đặc tả:** mục 1, 1.1, 1.2 (bản 07/10), 8, 12 · **Nguồn:** `docs/design/prototypes/react/` (README, `src/styles/`, `src/app/`, `index.html`)

## Vì sao quan trọng

Ngày 07/10/2026 người dùng chốt: **đưa thẳng bản React của bản mẫu vào app**, dùng design system của bản mẫu thay cho token Agentic. Mỗi trang của bản React chỉ hiển thị đúng khi có các lớp CSS nền: lớp tương thích Tailwind v3, bảng màu v3, token theo trang, `theme.css` cho chế độ tối và hook đặt class/CSS của trang. Task này đưa các lớp đó vào `apps/chat-web` một lần, để FE-05b → FE-10 chỉ còn chép trang và nối dữ liệu.

## Hiện trạng

- App: Tailwind 4.3, `src/index.css` có `@import "tailwindcss"`, `@custom-variant dark`, `@theme inline` với token Agentic của FE-04. Sáng/tối ở `hooks/use-theme.ts`: khoá `ati-theme`, class `dark` trên `<html>`, theo hệ điều hành khi chưa chọn, đồng bộ giữa các tab.
- Bản React (`docs/design/prototypes/react/`): cùng React 19.3, Vite 8.3, Tailwind 4.3.3. `src/styles/` có `tailwind.css`, `tokens.css`, `v3-base.css`, `v3-compat.css`, `v3-palette.css`, `v3-theme-targets.css`; nạp thêm `../theme.css` của bản mẫu. `src/app/` có `usePrototypePage.ts`, `ThemeToggle.tsx`, `theme.ts`, `router.ts`. README mục "Giữ đúng giao diện khi đổi Tailwind v3 sang v4" giải thích từng lớp.
- Hai bên dùng chung khoá `ati-theme` và class `dark`; `theme.js` của bản mẫu đặt thêm `data-theme`.

## Việc cần làm

1. Chép vào `apps/chat-web/src/prototype/` (hoặc tên tương đương, ghi trong PR):
   - `styles/`: sáu file CSS ở trên và `theme.css` của bản mẫu, giữ nguyên nội dung; ghi nguồn và commit `581addd` ở đầu mỗi file;
   - `usePrototypePage.ts`: đặt title, class của `<html>`/`<body>`, `data-proto-page`, CSS riêng của trang khi vào và gỡ khi rời. Kiểm lại với route của app (Back/Forward, chuyển trang không tải lại);
   - giữ thứ tự nạp CSS như bản React (`theme.css` và CSS của trang trước Tailwind, preflight/utilities không qua cascade layer). Đọc `src/main.tsx` và `src/styles/tailwind.css` của bản React trước khi sửa `src/index.css`/`main.tsx` của app.
2. Cấu hình Tailwind của app: thêm `@source not inline(...)` như bản React, để gradient và màu `divide-*` chỉ đến từ `v3-theme-targets.css`.
3. Sáng/tối: một cơ chế duy nhất. Giữ `use-theme.ts` của app (đã có OS, `localStorage`, nhiều tab, script chống nháy), thêm `data-theme` như `theme.js`. Nút sáng/tối của các trang bản React dùng hook này, không dùng `theme.ts` của bản React.
4. Font: nạp đủ các độ đậm như `index.html` của bản React.
5. Token Agentic của FE-04 (`@theme inline`) **giữ nguyên** trong lúc chuyển dần, vì các màn chưa chuyển còn dùng. Kiểm tên token không trùng với tên của bản React (`--p-*`, `brand-*`, `--page-font-*`); trùng thì đổi bên app và ghi lại.
6. Một trang thử: chuyển `404` của bản React vào app thay `NotFoundView` (trang nhỏ nhất, không có dữ liệu thật). Nút "Về không gian làm việc"/"Về trang chủ" theo trạng thái đăng nhập như FE-10 mục 3.
7. Ghi trong PR danh sách màn chưa chuyển bị lệch nhẹ vì lớp tương thích áp cho cả app (bảng màu hex, line-height của `text-*`, `hover:` mọi thiết bị, preflight v3), kèm ảnh trước/sau ở 1440×900, sáng và tối.

## Tiêu chí nghiệm thu

- [ ] Trang 404 của app đặt cạnh trang `/404` của bản React (`npm run dev` trong `docs/design/prototypes/react/`) ở 1440×900 và 375×812, sáng và tối: giống nhau, trừ nội dung nút theo trạng thái đăng nhập.
- [ ] Đổi sáng/tối trên trang 404 và trên một màn cũ (cockpit): đổi đúng, lưu lại sau khi tải lại, đồng bộ sang tab khác; không nháy giao diện sáng khi tải ở chế độ tối.
- [ ] Rời trang 404 sang cockpit rồi Back: class/CSS của trang 404 được gỡ, cockpit không mang class của 404 (test tự động).
- [ ] Các test FE-04 (shell, theme) và toàn bộ test hiện có vẫn xanh; test tương phản token chỉ được bỏ cho màn đã chuyển, ghi rõ trong PR.
- [ ] `npm run check` và `npm run test:browser:v3` exit 0; quét bản build vẫn đạt.

## Ngoài phạm vi

Chuyển các trang khác (FE-05b → FE-10). Không sửa bản mẫu HTML hay bản React trong `docs/`. Không đổi store, API, route.

## Kết quả

_(agent thi công điền)_

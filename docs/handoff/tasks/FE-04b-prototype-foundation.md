# FE-04b · Lớp nền của bản React trong app (design system bản mẫu)

**Trạng thái:** thi công xong 07/10 (Claude Code), chờ review/merge · **Nhánh gợi ý:** `feat/fe-04b-prototype-foundation` · **Phụ thuộc:** PROTO-01 đã xong (#96 tại `581addd`) · **Mốc:** 09/10/2026, trước FE-05b và FE-07
**Đặc tả:** mục 1, 1.1, 1.2 (bản 07/10), 8, 12 · **Nguồn:** `docs/design/prototypes/react/` (README, `src/styles/`, `src/app/`, `index.html`); design system: [`docs/design/design-system.md`](../../design/design-system.md)

## Vì sao quan trọng

Ngày 07/10/2026 người dùng chốt: **đưa thẳng bản React của bản mẫu vào app**, theo design system Agentic đúng như 12 bản mẫu thể hiện, bỏ các điều chỉnh riêng cho app của đặc tả (chữ tối thiểu 14px, nền `#F6F6F1`, token suy ra ở đặc tả 3.3). Mỗi trang của bản React chỉ hiển thị đúng khi có các lớp CSS nền: lớp tương thích Tailwind v3, bảng màu v3, token theo trang, `theme.css` cho chế độ tối và hook đặt class/CSS của trang. Task này đưa các lớp đó vào `apps/chat-web` một lần, để FE-05b → FE-10 chỉ còn chép trang và nối dữ liệu.

## Hiện trạng

- App: Tailwind 4.3, `src/index.css` có `@import "tailwindcss"`, `@custom-variant dark`, `@theme inline` với token suy ra của FE-04 (đặc tả 3.3). Sáng/tối ở `hooks/use-theme.ts`: khoá `ati-theme`, class `dark` trên `<html>`, theo hệ điều hành khi chưa chọn, đồng bộ giữa các tab.
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
5. Token suy ra của FE-04 (`@theme inline`, đặc tả 3.3) **giữ nguyên** trong lúc chuyển dần, vì các màn chưa chuyển còn dùng. Kiểm tên token không trùng với tên của bản React (`--p-*`, `brand-*`, `--page-font-*`); trùng thì đổi bên app và ghi lại.
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

## Kết quả (Claude Code, 07/10/2026)

Người dùng nói "merge #97 rồi tiếp tục đi"; Claude Code thi công FE-04b trong worktree `.claude/worktrees/fe-04b`, nhánh `feat/fe-04b-prototype-foundation` từ `main` `0cdb02a`. **Tự review, nên có review độc lập.**

**Đã làm:**
- `apps/chat-web/src/prototype/styles/`: chép `tokens.css`, `v3-theme-targets.css` nguyên văn; `v3-palette.css`, `v3-compat.css`, `v3-base.css` chép rồi đổi sang khai theo phạm vi `:root[data-proto-page]` (mỗi file ghi rõ chỗ khác bản React). `src/prototype/theme.css` chép nguyên văn `docs/design/prototypes/theme.css`.
- `src/index.css`: Tailwind nạp không qua cascade layer theo đúng thứ tự của bản React, `@source not inline(...)` như bản React. Cỡ chữ, chiều cao dòng và font của Tailwind đọc biến `--ati-*`: màn chưa chuyển giữ giá trị FE-04 (chữ 14–40px, chiều cao dòng mặc định v4, Be Vietnam Pro), trang bản mẫu dùng thang v3 và font theo token trang. Quy tắc nền và trợ năng của FE-04 (40×40, viền focus, font-weight nút đặc) chỉ áp khi không có `data-proto-page`, với độ ưu tiên tương đương trước đây.
- `src/prototype/usePrototypePage.ts`: như bản React, thêm: `theme.css` chỉ nạp khi có trang bản mẫu đang mở (đếm số trang), rời trang thì trả lại class `<body>` và tiêu đề cũ. `index.html` có mốc `proto-css-anchor`.
- Sáng/tối một cơ chế: `use-theme.ts` và script khởi động đặt thêm `data-theme`; `src/prototype/ThemeToggle.tsx` là nút của bản mẫu dùng `use-theme`.
- Trang thử `src/pages/NotFound/`: chép `NotFoundPage.tsx` và `page.css` của bản React, nối `navigate` của app; route lạ hiện trang này ở cả hai trạng thái đăng nhập, ngoài `AppShell`. Chưa đăng nhập thì nhãn là "Về trang chủ" (đặc tả 1.1 điểm 8). Lỗi tải hội thoại vẫn dùng `NotFoundView` cũ trong cockpit (FE-05b/FE-06).
- **Gradient của màn cũ** (`LandingPageView`, `LoginView`, `AuthFormFrame`, 10 chỗ) đổi sang giá trị viết thẳng `bg-[linear-gradient(... in oklab ...)]`, cùng cách Tailwind v4 dựng (nội suy oklab, điểm 0/50/100%). Lý do: chỉ cần một utility gradient v4 là Tailwind khai `@property --tw-gradient-*` kiểu `<color>` cho cả trang, làm hỏng ghi đè chế độ tối của `theme.css` (PROTO-01 đã gặp). Test browser kiểm không còn `@property` này.

**RED → GREEN:**
- unit `tests/fe-04b-prototype-foundation.test.tsx` (5 ca): RED 5/5 fail trước khi thi công; GREEN 5/5.
- toàn bộ test frontend: 423/423 (418 cũ + 5 mới); typecheck exit 0.
- browser `tests/browser/fe-04b-prototype-foundation.spec.ts` (2 ca, đăng ký vào nhóm `default`); `npm run test:browser:v3` (cùng PostgreSQL tạm): exit 0, **56/56 qua 11 nhóm** (54 ca cũ + 2 ca FE-04b). Lần chạy đầu fail 1 ca FE-04b vì test đặt sai giá trị mong đợi: nền `<body>` ở chế độ tối là `rgb(14, 21, 40)`, không phải `rgb(11, 16, 32)`, vì quy tắc `html.dark .bg-[#F8F8F6]` của `theme.css` thắng `html.dark body`; bản React cũng vậy (ảnh 404 tối khớp 0 pixel). Sửa giá trị mong đợi rồi chạy lại toàn bộ. Hai ca browser mới chưa chạy trên `main` để thấy RED.
- `npm run check` (PostgreSQL tạm 55533, sandbox): exit 0; v3 **1.380** = 47 schema + 340 adapters + 196 planner + 25 executor + 349 API + 423 web; 165 test đánh giá; build và quét bản build đạt.

**Giống bản mẫu** (script so riêng, server dev của app và của bản React, ảnh không commit; SHA256 16 ký tự đầu ở log):

| Trường hợp | 1440 sáng | 1440 tối | 375 sáng | 375 tối |
|---|---|---|---|---|
| 404 đã đăng nhập, so với `/khong-co-trang` của bản React | 0 pixel | 0 pixel | 0 pixel | 0 pixel |
| 404 chưa đăng nhập | 8.948 pixel | 11.161 pixel | 35.169 pixel | 49.714 pixel |

Trường hợp chưa đăng nhập khác chỉ vì nhãn "Về trang chủ" ngắn hơn "Về không gian làm việc", nên các phần tử trên thanh trên và nút chính dịch theo.

**Màn chưa chuyển so với `main` `0cdb02a`** (cùng API, cùng dữ liệu; 1440 sáng và 375 tối; so computed style từng phần tử và ảnh):
- `/login`, `/signup`, `/forgot-password`, `/guide`, `/privacy`, `/history`, `/account`: 0 thuộc tính khác, 0 pixel.
- `/` (trang giới thiệu): 1 thuộc tính khác, khoảng 3.900 pixel: bóng `shadow-sm` của một nút nhạt hơn. Cockpit `/` và `/settings`: bóng `shadow-sm` khác (1 và 8 phần tử), 0 pixel trên ngưỡng.
- `/admin/users`: 0 thuộc tính khác; 290 pixel ở chữ Playfair (dao động nét chữ đã biết từ PROTO-01, xem ảnh cắt trong log).
- Lý do `shadow-sm` đổi cho cả app: Tailwind chép thẳng giá trị bóng vào utility lúc dựng CSS, không đọc biến, nên không khai theo phạm vi được. Giá trị mới là của v3 (bản mẫu).

**Khác với task card:**
- Mục 1: ba file đổi sang khai theo phạm vi thay vì "giữ nguyên nội dung", để màn chưa chuyển không đổi (mỗi file ghi chỗ khác).
- Thêm việc đổi gradient của màn cũ (lý do ở trên).
- Mục 7: thay cho ảnh trước/sau tự chụp, so tự động computed style và ảnh với `main` (kết quả ở trên).

**Cảnh báo cho FE-05b → FE-10:**
- `hover:` theo cách v3 (áp cả trên màn hình cảm ứng) áp cho cả app, vì `@custom-variant` không khai theo phạm vi được.
- CSS riêng của trang bản mẫu khai biến trên `:root` (ví dụ `--surface`, `--border` ở `404`) trùng tên token của app; chỉ có hiệu lực khi trang đó đang mở. Màn của app hiện cùng lúc với trang bản mẫu (toast, hộp thoại dùng chung) cần kiểm.
- Màn mới hoặc trang chuyển sau không được dùng utility gradient của v4 (`bg-linear-to-*`, `from-*`… ngoài danh sách `@source not inline`), nếu không `@property` quay lại; test browser FE-04b bắt lỗi này.

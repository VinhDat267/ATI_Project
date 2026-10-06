# Bản React của 12 bản mẫu

Chuyển 12 file HTML trong `docs/design/prototypes/` sang React với cùng công nghệ của `apps/chat-web`:
React 19.3, Vite 8.3, Tailwind CSS 4.3, TypeScript strict. Giữ nguyên design system của bản mẫu: màu, font,
bóng, cỡ chữ, dữ liệu mẫu và nút "Kịch bản demo". Chưa đưa vào app; app vẫn chạy như cũ.

Thư mục này nằm ngoài workspace npm và dùng `node_modules` ở gốc repo, nên không cần cài thêm gói. CI không chạy thư mục này.

## Chạy

```bash
cd docs/design/prototypes/react
npm run dev        # http://127.0.0.1:5181
npm run typecheck
npm run build
npm run verify     # so với bản HTML gốc, cần mạng (Tailwind CDN, Google Fonts)
```

Đường dẫn ứng với tên file bản mẫu: `privacy.html` → `/privacy`, `index.html` → `/`. Đường dẫn chưa có trang hiện trang 404, như máy chủ tĩnh.

## Tiến độ

| Bản mẫu | Route | Trạng thái |
|---|---|---|
| `404.html` | `/404` và mọi đường dẫn lạ | khớp bản gốc (verify 4/4) |
| `privacy.html` | `/privacy` | khớp bản gốc (verify 4/4) |
| `errors.html` | `/errors` (`?type=`) | khớp bản gốc ở lúc mở và 14 trạng thái thao tác |
| `responses.html` | `/responses` | khớp bản gốc ở lúc mở và 8 trạng thái thao tác |
| `auth-action.html` | `/auth-action` (`?mode=`, `?state=`) | khớp bản gốc ở lúc mở và 23 trạng thái thao tác |
| `account.html`, `users.html`, `settings.html`, `history.html`, `guide.html` | | chưa chuyển (bước 3) |
| `index.html`, `app-stage.html` | | chưa chuyển (bước 4) |

## Cách chuyển một trang

1. `node scripts/html-to-jsx.mjs <file>.html <TênComponent>` sinh `src/pages/<TênComponent>/<TênComponent>Page.tsx` (JSX của `<body>`) và `page.css` (các thẻ `<style>`), rồi in số handler và số dòng script cần viết tay.
2. Thêm route vào `src/App.tsx` và `ROUTES` trong `scripts/verify-parity.mjs` nếu route khác tên file. Khai các trạng thái thao tác cần so trong `scripts/parity-states.mjs`.
3. Viết lại JS của bản mẫu bằng state React. Hàm `todo()` đánh dấu chỗ chưa chuyển; bản hoàn chỉnh không còn lời gọi nào.
4. `npm run verify -- <tên-file>` đến khi đạt.

Bộ chuyển xử lý: `class` → `className`, thuộc tính SVG, `style` → object, `value`/`checked`/`selected` → `defaultValue`/`defaultChecked`, link `x.html#y` → `/x#y`, khoảng trắng giữa các phần tử theo đúng cách HTML hiển thị.

## Giữ đúng giao diện khi đổi Tailwind v3 (bản mẫu) sang v4 (app)

| Khác biệt v3 → v4 | Cách giữ giống v3 | File |
|---|---|---|
| Mỗi trang tự khai `tailwind.config`; 6/32 token khác nhau giữa các trang | Mỗi token trỏ tới biến `--p-*` khai theo `:root[data-proto-page]`; trang không khai thì class không có tác dụng | `src/styles/tokens.css` (sinh bởi `scripts/gen-tokens.mjs`) |
| Bảng màu mặc định chuyển sang OKLCH | Ghi đè 242 màu bằng mã hex đọc từ Tailwind v3 CDN | `src/styles/v3-palette.css` (sinh bởi `scripts/extract-v3-palette.mjs`) |
| `shadow-sm`, `blur-sm`, `rounded-sm`, `drop-shadow-sm` đổi giá trị | Khai lại giá trị v3 | `src/styles/v3-compat.css` |
| `line-height` của `text-*` thành tỉ lệ | Khai lại giá trị tuyệt đối của v3 | `src/styles/v3-compat.css` |
| `leading-*` luôn thắng `text-*` nhờ `--tw-leading` | Vô hiệu `--tw-leading` để theo thứ tự CSS như v3 | `src/styles/v3-base.css` |
| `space-x/y`, `divide-y` đặt margin/viền ở phần tử trước | Đổi tên thành `v3-space-*`, `v3-divide-*` và tự khai theo cách tính v3 | `src/styles/v3-compat.css`, bộ chuyển |
| `hover:` chỉ áp trên thiết bị có chuột | `@custom-variant hover (&:hover)` | `src/styles/v3-compat.css` |
| `outline-none` bỏ hẳn viền; v3 dùng viền trong suốt 2px, vẫn hiện ở chế độ tương phản cao | Đổi tên thành `v3-outline-none`, khai như v3 | `src/styles/v3-compat.css`, bộ chuyển |
| Hai class cùng thuộc tính trên một phần tử (ví dụ `border-transparent` và `border-[#FF5701]`): v3 CDN cho class xuất hiện sau trong trang thắng, v4 xếp theo tên class | Chỉ gặp ở class do JS thêm vào. Đánh dấu `!` cho class phải thắng, ghi chú ngay tại chỗ | `ErrorsPage.tsx` (toast), `AuthActionPage.tsx` (tab) |
| Màu viền mặc định, placeholder, con trỏ trên nút | Quy tắc preflight của v3 | `src/styles/v3-base.css` |
| CSS v4 nằm trong cascade layer | Nạp preflight/utilities không qua layer; `theme.css` và CSS của trang chèn trước Tailwind như thứ tự trong bản mẫu | `src/styles/tailwind.css`, `src/main.tsx`, `src/app/usePrototypePage.ts` |

Các phần chung:

- `src/app/ThemeToggle.tsx`, `src/app/theme.ts`: nút Sáng/Tối gắn vào đúng chỗ như `theme.js`, cùng khoá `localStorage` `ati-theme`.
- `src/app/usePrototypePage.ts`: mỗi trang tự đặt title, class của `<html>`/`<body>` và CSS riêng khi vào, gỡ khi rời trang.
- `src/app/router.ts`: điều hướng bằng History API, không thư viện router, giống `apps/chat-web`.

## Kiểm tra bằng `npm run verify`

Script mở bản HTML gốc (server tĩnh, cổng 5190) và bản React (Vite, cổng 5191) bằng Chromium. Mỗi trang chạy ở 1440×900 và 375×812, sáng và tối. Script so:

- **cấu trúc:** từng phần tử theo thứ tự DOM (thẻ và class);
- **vị trí:** sai số 1px;
- **khoảng 60 thuộc tính computed style:** màu chuẩn hoá về RGBA;
- **chữ;**
- **ảnh chụp cả trang:** so từng pixel.

Đạt khi không còn khác biệt nào và không có lỗi console.

- Ảnh gốc, ảnh React, ảnh khác biệt và `report.json` nằm ở `.parity/`, không commit.
- Hiệu ứng chuyển động được tắt khi chụp.
- Bản gốc được nạp thêm đủ font của design system, vì vài trang chỉ nạp một phần độ đậm (ví dụ `404.html` không nạp JetBrains Mono nên chữ mã rơi về font mono hệ thống). Bản React nạp đủ font ở `index.html`.

Ngoài lúc mở trang (đủ 4 tổ hợp), mỗi trang có các trạng thái thao tác khai trong `scripts/parity-states.mjs`, chạy ở 1440 sáng và 375 tối. Ví dụ: bấm tab, mở menu demo, điền form, chờ hẹn giờ, mở trang kèm `?type=`.
- Các bước chạy y hệt trên hai bản, nên selector chỉ dùng id hoặc chữ có ở cả hai.
- Chạy một trạng thái: `node scripts/verify-parity.mjs errors --state=loi-may-chu`.
- Khi so tên class, script bỏ tiền tố `v3-` và dấu `!`.
- Bóng đổ không vẽ gì (trong suốt, hoặc mọi kích thước bằng 0) được bỏ qua.
- Không so giá trị margin theo chiều có `auto` (`mx-auto`, `ml-auto`…), vì Chrome đôi khi trả 0px dù phần tử đã được căn đúng. Vị trí của phần tử vẫn được so nên kết quả margin auto vẫn được kiểm.
- Trường hợp nào lệch thì chạy lại đúng một lần, chỉ tính đạt nếu lần chạy lại khớp hoàn toàn. Khác biệt thật luôn lặp lại; các dao động của trình duyệt (lẻ pixel, đua thời gian) thì không. Kết quả ghi "(chạy lại 1 lần)" và `attempts` trong `report.json`.

## Lỗi của bản mẫu đang giữ nguyên

Bản React chép đúng hành vi bản mẫu, kể cả các chỗ dưới đây. Sửa hay không là việc khi đưa vào app.

- `responses.html`: dòng phụ của tình huống 4 ("Kênh bạn cần chưa có trong danh sách?") chỉ được vẽ sau khi đổi vai trò trong menu demo. Lúc mới mở, ô này trống.
- `auth-action.html`: nhánh JS báo "Mật khẩu mới phải có ít nhất 12 ký tự!" không bao giờ chạy, vì thuộc tính `minlength` của ô nhập chặn form trước và Chrome hiện bong bóng của trình duyệt.
- `errors.html`, `auth-action.html`: nhiều thao tác chuyển về `app-stage.html` sau 1–2 giây. Trang này chưa chuyển sang React nên tạm hiện trang 404.
- Màu của một phần tử đôi khi phụ thuộc thứ tự class xuất hiện trong trang (xem dòng cuối bảng tương thích). Kết quả hiện tại đúng như bản mẫu, nhưng dễ đổi khi sửa trang.

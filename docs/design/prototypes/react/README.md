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
| `account.html` | `/account` | khớp bản gốc ở lúc mở và 28 trạng thái thao tác |
| `users.html` | `/users` | khớp bản gốc ở lúc mở và 20 trạng thái thao tác |
| `settings.html` | `/settings` (`#notion` mở thẳng ngăn của dịch vụ) | khớp bản gốc ở lúc mở và 26 trạng thái thao tác |
| `history.html` | `/history` | khớp bản gốc ở lúc mở và 23 trạng thái thao tác |
| `guide.html` | `/guide` (`?tab=`, `?service=`) | khớp bản gốc ở lúc mở và 12 trạng thái thao tác |
| `index.html`, `app-stage.html` | | chưa chuyển (bước 4) |

## Cách chuyển một trang

1. `node scripts/html-to-jsx.mjs <file>.html <TênComponent>` sinh `src/pages/<TênComponent>/<TênComponent>Page.tsx` (JSX của `<body>`) và `page.css` (các thẻ `<style>`), rồi in số handler và số dòng script cần viết tay.
2. Thêm route vào `src/App.tsx` và `ROUTES` trong `scripts/verify-parity.mjs` nếu route khác tên file. Khai các trạng thái thao tác cần so trong `scripts/parity-states.mjs`.
3. Viết lại JS của bản mẫu bằng state React. Hàm `todo()` đánh dấu chỗ chưa chuyển; bản hoàn chỉnh không còn lời gọi nào. Hai công cụ giúp phần này:
   - `node scripts/extract-data.mjs <file>.html <TênComponent> <TÊN_HẰNG[:jsx]>…` chép nguyên văn các hằng dữ liệu (danh sách dịch vụ, hội thoại mẫu…) sang `src/pages/<TênComponent>/data.tsx`; hậu tố `:jsx` đổi map chuỗi SVG thành JSX. Kiểu dữ liệu khai thêm bằng tay.
   - `node scripts/template-to-jsx.mjs <file>.html [tên-hàm…]` in JSX của các chuỗi template HTML trong JS (`innerHTML = \`…\``), kèm số dòng gốc và các handler cần chuyển tay.
4. `npm run verify -- <tên-file>` đến khi đạt.

Bộ chuyển (`scripts/lib/html-jsx.mjs`, dùng chung cho hai công cụ trên) xử lý: `class` → `className`, thuộc tính SVG, `style` → object, `value`/`checked`/`selected` → `defaultValue`/`defaultChecked`, link `x.html#y` → `/x#y`, khoảng trắng giữa các phần tử theo đúng cách HTML hiển thị.

Bản mẫu thường chỉ vẽ lại một phần DOM ở một số thao tác (`renderServiceLists()`, `renderRequestsList()`…); giữa các lần đó phần còn lại giữ nội dung cũ, kể cả khi đang ẩn. Bản React giữ đúng điều này: dữ liệu nằm trong `useRef` như biến toàn cục của bản mẫu, còn giao diện là ảnh chụp trong state, chỉ cập nhật đúng lúc bản mẫu gọi hàm vẽ lại. Ví dụ ngăn chi tiết của `settings` vẫn giữ dịch vụ vừa đóng, danh sách của `history` dựng lại thẻ (như `innerHTML` mới) mỗi lần vẽ.

## Giữ đúng giao diện khi đổi Tailwind v3 (bản mẫu) sang v4 (app)

| Khác biệt v3 → v4 | Cách giữ giống v3 | File |
|---|---|---|
| Mỗi trang tự khai `tailwind.config`; 6/32 token khác nhau giữa các trang | Mỗi token trỏ tới biến `--p-*` khai theo `:root[data-proto-page]`; trang không khai thì class không có tác dụng | `src/styles/tokens.css` (sinh bởi `scripts/gen-tokens.mjs`) |
| Bảng màu mặc định chuyển sang OKLCH | Ghi đè 242 màu bằng mã hex đọc từ Tailwind v3 CDN | `src/styles/v3-palette.css` (sinh bởi `scripts/extract-v3-palette.mjs`) |
| `shadow-sm`, `blur-sm`, `rounded-sm`, `drop-shadow-sm` đổi giá trị | Khai lại giá trị v3 | `src/styles/v3-compat.css` |
| `line-height` của `text-*` thành tỉ lệ | Khai lại giá trị tuyệt đối của v3 | `src/styles/v3-compat.css` |
| `leading-*` luôn thắng `text-*` nhờ `--tw-leading` | Vô hiệu `--tw-leading` để theo thứ tự CSS như v3 | `src/styles/v3-base.css` |
| `space-x/y`, `divide-y` đặt margin/viền ở phần tử trước | Đổi tên thành `v3-space-*`, `v3-divide-y` và tự khai theo cách tính v3 | `src/styles/v3-compat.css`, bộ chuyển |
| Gradient (`bg-gradient-to-*`, `from-/via-/to-*`) và màu `divide-*`: chế độ tối của bản mẫu (`theme.css`) ghi đè các class này theo tên và theo biến của v3 (`--tw-gradient-from`…). v4 đặt hướng trong `--tw-gradient-position` và khai `@property` kiểu `<color>` cho biến gradient, nên ghi đè của `theme.css` làm mất hướng và màu | Giữ tên class gốc, viết lại bằng CSS thường theo cách tính v3; loại các class này khỏi v4 bằng `@source not inline(...)`. Thêm class mới loại này thì thêm ở cả hai chỗ | `src/styles/v3-theme-targets.css`, `src/styles/tailwind.css` |
| `hover:` chỉ áp trên thiết bị có chuột | `@custom-variant hover (&:hover)` | `src/styles/v3-compat.css` |
| `outline-none` bỏ hẳn viền; v3 dùng viền trong suốt 2px, vẫn hiện ở chế độ tương phản cao | Đổi tên thành `v3-outline-none`, khai như v3 | `src/styles/v3-compat.css`, bộ chuyển |
| Hai class cùng thuộc tính trên một phần tử (ví dụ `border-transparent` và `border-[#FF5701]`, hay `hidden` và `inline-flex`): v3 CDN xếp theo thứ tự xuất hiện trong trang hoặc theo bảng giá trị của từng plugin, v4 xếp theo tên class | Chỉ gặp ở class do JS thêm vào. Đánh dấu `!` cho class phải thắng, ghi chú ngay tại chỗ. `hidden` thêm vào phần tử `flex`/`grid` không cần, vì v4 cũng cho `hidden` thắng | `ErrorsPage.tsx` (toast), `AuthActionPage.tsx` (tab), `AccountPage.tsx` (nút đăng xuất các phiên khác) |
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

Ngoài lúc mở trang (đủ 4 tổ hợp), mỗi trang có các trạng thái thao tác khai trong `scripts/parity-states.mjs`, chạy ở 1440 sáng và 375 tối. Ví dụ: bấm tab, mở menu demo, điền form, chọn trong `<select>`, chờ hẹn giờ, mở trang kèm `?type=` hoặc `#notion`.
- Các bước chạy y hệt trên hai bản, nên selector chỉ dùng id hoặc chữ có ở cả hai.
- Nút nằm trong khung cuộn (`overflow-hidden`) thì thêm bước `scroll` trước khi bấm: Playwright tự cuộn khác nhau giữa các lần nên vị trí cuộn của trang không ổn định.
- Sau mỗi bước, script chờ hai khung hình rồi mới làm bước sau. Bấm ngay sau khi cuộn thì Playwright đôi khi tự cuộn thêm, nên vị trí cuộn cuối khác nhau giữa các lần ở cả hai bản (`users-xac-nhan-khoa` 375: lúc 583, lúc 189).
- Sau các bước, script chờ font tải xong rồi mới chụp, vì thao tác có thể làm hiện chữ ở độ đậm chưa dùng.
- Ngay trước khi chụp, script ép vẽ lại cả trang bằng cách đổi bề rộng khung nhìn thêm 1px rồi trả lại, làm y hệt cho cả hai bản. Bản React dựng trang bằng JS sau lần vẽ đầu, nên Chromium giữ lại mảnh header đã vẽ ở lượt trước: mép avatar tròn lệch tới 67 mức màu ở 9 pixel, dù DOM, style và vị trí giống hệt. Trang cao hơn khung nhìn thì Playwright đã giãn khung để chụp cả trang nên tự vẽ lại; trang vừa khít khung nhìn (1440×900) thì không, nên lệch chỉ lộ ở đó.
- Chạy một trạng thái: `node scripts/verify-parity.mjs errors --state=loi-may-chu`.
- Khi so tên class, script bỏ tiền tố `v3-` và dấu `!`.
- Bóng đổ không vẽ gì (trong suốt, hoặc mọi kích thước bằng 0) được bỏ qua.
- Không so giá trị margin theo chiều có `auto` (`mx-auto`, `ml-auto`…), vì Chrome đôi khi trả 0px dù phần tử đã được căn đúng. Vị trí của phần tử vẫn được so nên kết quả margin auto vẫn được kiểm.
- Trường hợp nào lệch thì chạy lại đúng một lần, chỉ tính đạt nếu lần chạy lại khớp hoàn toàn. Khác biệt thật luôn lặp lại; các dao động của trình duyệt (lẻ pixel, đua thời gian) thì không. Kết quả ghi "(chạy lại 1 lần)" và `attempts` trong `report.json`; ảnh của lần lệch đầu giữ ở `.parity/<trường hợp>-first-*.png`.
- Dao động còn lại: vài chục đến vài trăm pixel ở nét chữ Playfair Display (tiêu đề, tên dịch vụ), không lệch phần tử nào. Ảnh khác biệt chỉ có chấm đỏ rải trên chữ. Chụp lặp lại cho thấy chỉ bản React đổi (khoảng 1/12 lần, kể cả khi đã ép vẽ lại), bản gốc thì không; nguyên nhân chưa tìm ra. Lệch ở chỗ khác hoặc lặp lại khi chạy lại là khác biệt thật.
- Mỗi trang, và mỗi lần chạy lại, dùng một tiến trình Chromium mới.

## Lỗi của bản mẫu đang giữ nguyên

Bản React chép đúng hành vi bản mẫu, kể cả các chỗ dưới đây. Sửa hay không là việc khi đưa vào app.

- `responses.html`: dòng phụ của tình huống 4 ("Kênh bạn cần chưa có trong danh sách?") chỉ được vẽ sau khi đổi vai trò trong menu demo. Lúc mới mở, ô này trống.
- `auth-action.html`: nhánh JS báo "Mật khẩu mới phải có ít nhất 12 ký tự!" không bao giờ chạy, vì thuộc tính `minlength` của ô nhập chặn form trước và Chrome hiện bong bóng của trình duyệt.
- `errors.html`, `auth-action.html`, `history.html` ("Mở lại trên sân khấu"): nhiều thao tác chuyển về `app-stage.html` sau 0,5–2 giây. Trang này chưa chuyển sang React nên tạm hiện trang 404.
- `users.html`: sau khi vẽ danh sách thành viên, khung bảng desktop bị gỡ class `hidden` (vốn đi cùng `sm:block`), nên ở màn hẹp bảng hiện cùng danh sách thẻ.
- `history.html`: vai trò quản trị ghi `style.display = 'inline-flex'` cho link "Người dùng", đè class `hidden lg:inline-flex`, nên link hiện cả ở màn hẹp.
- `account.html`:
  - đổi mật khẩu thành công chỉ đặt lại độ rộng thanh độ mạnh và chữ "Ít nhất 12 ký tự", còn màu của lần kiểm tra trước vẫn giữ;
  - "Đặt lại dữ liệu" dựng lại thẻ phiên đã thu hồi ở cuối danh sách, nên thu hồi iPhone rồi đặt lại thì thứ tự thành macOS trước iPhone.
- Màu của một phần tử đôi khi phụ thuộc thứ tự class xuất hiện trong trang (xem dòng cuối bảng tương thích). Kết quả hiện tại đúng như bản mẫu, nhưng dễ đổi khi sửa trang.

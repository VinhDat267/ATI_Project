# PROTO-01 · Chuyển 12 bản mẫu HTML sang React, giữ nguyên design system

**Trạng thái:** xong cả 4 bước · bước 1 xong (#93 tại `00e9c5f`), bước 2 xong (#94 tại `852342c`), bước 3 xong (#95 tại `458c5ad`), bước 4 xong (#96 tại `581addd`) · **Nhánh:** `feat/proto-react-01` (bước 1), `feat/proto-react-02` (bước 2), `feat/proto-react-03` (bước 3), `feat/proto-react-04` (bước 4, tách từ bước 3) · **Phụ thuộc:** không
**Người yêu cầu:** chủ dự án, 06/10/2026 · **Thi công bước 1:** Claude Code (theo yêu cầu trực tiếp của người dùng)

## Vì sao

Người dùng muốn có bản React của 12 bản mẫu trong `docs/design/prototypes/` trước khi đưa vào app, dùng đúng công nghệ của `apps/chat-web`. Design system của 12 bản mẫu đã đồng nhất và được giữ nguyên: màu, font, bóng, cỡ chữ (kể cả chữ 10–12px), dữ liệu mẫu, nút demo.

## Phạm vi

- Chỉ trong `docs/design/prototypes/react/`. Không sửa `apps/chat-web`, không sửa 12 file HTML gốc.
- Không thêm gói npm: dùng React 19.3, Vite 8.3, Tailwind 4.3.3, TypeScript ở `node_modules` gốc.
- Mỗi trang phải khớp bản gốc theo `npm run verify`: từng phần tử (thẻ, class, vị trí, khoảng 60 thuộc tính computed style, chữ) và từng pixel, ở 1440×900 và 375×812, sáng và tối.

## Các bước

1. **Khung, công cụ, hai trang thử:**
   - bộ chuyển HTML → JSX, lớp tương thích Tailwind v3 → v4, token theo trang;
   - nút Sáng/Tối, điều hướng, script so;
   - trang `404` và `privacy`.
2. `errors`, `responses`, `auth-action`.
3. `account`, `users`, `settings`, `history`, `guide`.
4. `index` và `app-stage`. JS nhiều nhất (750 và 1.109 dòng): cuộn kể chuyện, 9 khoảnh khắc, ngăn kéo. Script so cần thêm kịch bản thao tác.

## Tiêu chí nghiệm thu (mỗi bước)

- [ ] `npm run verify -- <các trang của bước>` exit 0: 0 phần tử lệch, 0 pixel lệch, không lỗi console ở bản React.
- [ ] Hành vi của bản mẫu (nút, form, ngăn kéo, demo) viết lại bằng state React; không còn lời gọi `todo()`.
- [ ] `npm run typecheck` và `npm run build` exit 0.
- [ ] Từ bước 2: trang có thao tác thì script so thêm kịch bản thao tác và so trạng thái sau thao tác.

## Ngoài phạm vi, cần chốt sau

Đưa bản React vào `apps/chat-web`. Khi làm, design system của bản mẫu sẽ mâu thuẫn với:
- đặc tả giao diện mục 1.1 (chữ tối thiểu 14px, tiêu đề tối đa 40px, token màu của app, nền `#F6F6F1`);
- token của FE-04.

Người dùng đã nói muốn giữ design system của bản mẫu; cần sửa đặc tả trước khi tích hợp.

**Đã chốt 07/10/2026:** người dùng chọn đưa thẳng bản React vào app: app theo Agentic đúng như 12 bản mẫu, bỏ các điều chỉnh riêng cho app của đặc tả (chữ tối thiểu 14px, nền `#F6F6F1`, token suy ra). Đặc tả giao diện mục 1, 1.1, 1.2 đã viết lại; việc đưa vào app làm ở [FE-04b](FE-04b-prototype-foundation.md) (lớp nền) và FE-05b → FE-10.

## Kết quả bước 1 (Claude Code, 06/10/2026)

**Đã làm** (`docs/design/prototypes/react/`):
- `scripts/html-to-jsx.mjs`, `gen-tokens.mjs`, `extract-v3-palette.mjs`, `verify-parity.mjs`;
- `src/styles/` (token 12 trang, 242 màu v3, lớp tương thích);
- `src/app/` (theme, nút Sáng/Tối, CSS theo trang, router);
- trang `NotFound` và `Privacy`;
- `README.md` giải thích cách chạy và từng điểm tương thích.

**RED → GREEN** bằng `node scripts/verify-parity.mjs 404 privacy`:

| Lần chạy | Kết quả | Lệch tìm thấy |
|---|---|---|
| 1 (khung + markup sinh tự động) | 8/8 lệch; cấu trúc khớp 47/47 và 283/283 phần tử | `space-y` đặt margin sai phía; `rounded-full` khác số; privacy 1440 cao hơn 77px (`leading-*` thắng `text-*` qua `--tw-leading`); 404 chưa có JS |
| 2 | 404 đạt 4/4 | privacy còn `line-height` 46,67px so với 40px: v4 lưu `line-height` của `text-*` dạng tỉ lệ |
| 3 | privacy 0 phần tử lệch | 349–1.385 pixel lệch: khoảng trắng đầu text bị tách thành text node riêng, chữ lệch lẻ pixel |
| 4 | **8/8 ĐẠT**, exit 0 | 404 (47 phần tử) và privacy (283 phần tử, ảnh 1440×4414 và 375×6868) không lệch phần tử nào, không lệch pixel nào |

**Kiểm tra khác:**
- **Hành vi** (Playwright, script tạm), 8/8 đạt:
  - một nút Sáng/Tối; bấm thì sang tối, lưu `ati-theme`, cập nhật `aria-pressed`/`aria-label`, có thông báo cho trình đọc màn hình;
  - link nội bộ đổi trang không tải lại, gỡ CSS và class của trang cũ;
  - 404 hiện đường dẫn lạ kèm query; "Quay lại trang trước" chạy đúng;
  - không lỗi console.
- `npm run typecheck` exit 0; `npm run build` exit 0 (CSS 34,93 kB, JS 286,55 kB). Trong bản build, link CSS đứng sau mốc chèn CSS của trang.

**Giới hạn:**
- Script so trạng thái mở trang. Thao tác chỉ kiểm bằng script tạm ở trên.
- Bản gốc được nạp thêm đủ font khi so (README giải thích).
- Script so cần mạng.
- `parse5` dùng qua phụ thuộc của `jsdom` ở `node_modules` gốc.

## Kết quả bước 2 (Claude Code, 06/10/2026)

**Đã làm:**
- ba trang `Errors`, `Responses`, `AuthAction` sinh bằng bộ chuyển, rồi viết lại toàn bộ JS bằng state React:
  - `errors` 288 dòng, 25 handler;
  - `responses` 324 dòng, 18 handler;
  - `auth-action` 389 dòng, 32 handler;
- không còn lời gọi `todo()`;
- script so có thêm trạng thái thao tác (`scripts/parity-states.mjs`): bấm, điền, nhấn phím, chờ, mở trang kèm query; lỗi ở một trường hợp không làm dừng cả lần chạy.

**RED → GREEN** (`node scripts/verify-parity.mjs <trang>`):

| Trang | Lần đầu | Nguyên nhân | Sửa |
|---|---|---|---|
| `responses` | 16/20 trường hợp lệch (lần chạy trước đó dừng giữa chừng vì menu demo che tab 4, đã sửa kịch bản) | `outline-none` (v4 bỏ hẳn viền); lớp bóng ring-offset 0px của v3 | `v3-outline-none`; bỏ qua lớp bóng không vẽ gì |
| `errors` | 34/36 đạt | toast cảnh báo có `text-white` và `text-amber-400`; v3 cho màu hổ phách thắng, v4 cho trắng thắng | `!` cho màu theo loại toast |
| `auth-action` | tab đang chọn mất viền cam | v3 CDN xếp class theo thứ tự xuất hiện trong trang: `border-[#FF5701]` thắng `border-transparent` nhưng `border-[#E7E7E2]` thua | Chỉ `border-[#FF5701]` có `!`. Lần thử đầu gắn `!` cho cả hai màu làm lệch thêm 40 chỗ, đã bỏ |

**Các trường hợp loại khỏi bộ so:**
- "lưu khi mật khẩu quá ngắn": lệch vài pixel do bong bóng kiểm tra form của Chrome (giao diện trình duyệt); phần trang khớp (0 phần tử lệch).
- Margin `auto` và lẻ pixel thỉnh thoảng lệch rồi không lặp lại khi chạy lại:
  - Chrome đôi khi trả 0px cho margin `auto` của phần tử trong khối `fixed`, dù vị trí trùng khớp;
  - 7 pixel lệch dưới một pixel ở mép bong bóng chat.

  Script giờ đọc vị trí trước rồi mới đọc style, không so margin theo chiều có `auto` (vị trí vẫn được so), và chạy lại đúng một lần những trường hợp lệch. Một trường hợp chỉ đạt khi lần chạy lại khớp hoàn toàn.
- Kịch bản `responses` chờ 150ms sau khi bấm tab, vì bản mẫu đưa focus vào tiêu đề sau 50ms; bấm tiếp quá sớm làm kết quả focus phụ thuộc thời điểm.

**Kết quả cuối** (`node scripts/verify-parity.mjs`, 5 trang, exit 0): **110/110 trường hợp đạt**, 0 phần tử lệch, 0 pixel lệch.
- 404 (4) và privacy (4) của bước 1 vẫn đạt sau khi đổi `v3-outline-none` dùng chung;
- errors: 4 lúc mở + 14 trạng thái × 2;
- responses: 4 + 8 × 2;
- auth-action: 4 + 23 × 2.

Hai trường hợp phải chạy lại một lần mới đạt: `responses-tinh-huong-3-chon-375-dark` và `auth-action-doi-tai-khoan-1440-light`. Chạy riêng lại thì đạt ngay lần đầu. Ngoài ra:
- `npm run typecheck` exit 0;
- `npm run build` exit 0 (CSS 50,22 kB, JS 429,56 kB).

**Giữ nguyên lỗi của bản mẫu** (liệt kê ở README `react/`):
- dòng phụ tình huống 4 của `responses` trống cho tới khi đổi vai trò;
- nhánh JS "mật khẩu ngắn" của `auth-action` không chạy được.

## Kết quả bước 3 (Claude Code, 07/10/2026)

**Đã làm:** năm trang sinh bằng bộ chuyển, rồi viết lại toàn bộ JS bằng state React, không còn lời gọi `todo()`.

| Trang | JS của bản mẫu | Hành vi viết lại |
|---|---|---|
| `account` | 515 dòng | đổi tên, đổi mật khẩu và thanh độ mạnh, ẩn/hiện mật khẩu, thu hồi phiên, gỡ/liên kết Google, 3 kịch bản Google/mật khẩu, 2 hộp thoại |
| `users` | 685 dòng | 2 tab, tìm và lọc, duyệt tài khoản, khoá/mở khoá, đổi vai trò, 3 hộp thoại, thêm yêu cầu mẫu |
| `settings` | 885 dòng | 2 nhóm dịch vụ, ngăn chi tiết (ô khoá theo dịch vụ, nơi được dùng, lưu, kiểm tra kết nối thành công/từ chối/quá giờ), vai trò thành viên, bẫy focus, `#dịch-vụ` |
| `history` | 1.028 dòng | nhóm theo ngày, tìm/lọc/chip nhanh, tải thêm, đổi tên tại chỗ, ngăn biên nhận, sao chép, thêm/khôi phục dữ liệu mẫu, vai trò lưu ở `localStorage` |
| `guide` | 1.037 dòng | 3 tab, 8 dịch vụ, tìm và lọc mẫu lệnh, sao chép, `?tab=`/`?service=`, vai trò |

Công cụ mới (`docs/design/prototypes/react/scripts/`):
- `lib/html-jsx.mjs`: lõi của bộ chuyển, tách từ `html-to-jsx.mjs`. Kết quả của `html-to-jsx.mjs` trên `privacy` và `guide` giống hệt trước khi tách.
- `template-to-jsx.mjs`: chuyển chuỗi template HTML trong JS sang JSX.
- `extract-data.mjs`: chép nguyên văn hằng dữ liệu sang `data.tsx`.

Bản mẫu chỉ vẽ lại một phần DOM ở một số thao tác. Bản React giữ dữ liệu trong `useRef` như biến toàn cục và giữ giao diện là ảnh chụp trong state, chỉ cập nhật khi bản mẫu gọi hàm vẽ lại (README `react/` giải thích).

**RED → GREEN** (`node scripts/verify-parity.mjs <trang>`):

| Trang | Lệch | Nguyên nhân | Sửa |
|---|---|---|---|
| `guide` | gradient ở chế độ tối mất hướng và mất màu | `theme.css` ghi đè gradient theo biến của v3; v4 đặt hướng ở biến khác và khai `@property` kiểu `<color>` cho biến gradient | `src/styles/v3-theme-targets.css`: giữ tên class gốc, viết CSS theo cách v3; loại khỏi v4 bằng `@source not inline(...)` |
| `users` | màu đường chia dòng bảng ở chế độ tối | tên `v3-divide-color-*` không khớp selector của `theme.css` | giữ tên `divide-*`, đưa vào `v3-theme-targets.css` |
| `users` | vị trí cuộn lệch khi chạy cả loạt | Playwright tự cuộn khác nhau với nút trong khung `overflow-hidden` | bước `scroll` trước khi bấm |
| `history` | ô đổi tên ở 375px: 1.412 pixel, lặp lại cả hai lần | React ghi `value` bằng thuộc tính DOM nên con trỏ nằm cuối chữ, ô hẹp cuộn về cuối; bản mẫu đọc `value` từ HTML nên con trỏ ở đầu | đặt con trỏ về đầu khi tạo ô |
| `account` | 3 trạng thái sau khi hết phiên khác: nút "Đăng xuất khỏi tất cả phiên khác" vẫn hiện | bản mẫu thêm `hidden` vào nút `inline-flex`; v3 cho `hidden` thắng, v4 cho `inline-flex` thắng | `hidden!`, có ghi chú |
| `settings` | không lệch thật | | |

Script so có thêm:
- bước `select` và `scroll`;
- chờ font sau các thao tác;
- ép vẽ lại cả trang trước khi chụp (xem mục 9 pixel dưới đây);
- chờ hai khung hình sau mỗi bước thao tác (xem dưới đây);
- giữ ảnh của lần lệch đầu (`-first-*.png`);
- mặc định chạy cả 10 trang;
- mỗi trang và mỗi lần chạy lại dùng một tiến trình Chromium mới.

**Hai lần chạy toàn bộ đầu tiên** (07/10, rạng sáng) chưa đạt:
- chung một tiến trình Chromium: 346/348, lệch `users-xac-nhan-duyet-1440-light` (9 pixel ở avatar) và `history-bien-nhan-tam-dung-1440-light` (170 pixel ở chữ Playfair);
- mỗi trang một tiến trình mới: 347/348, lệch `history-loc-tam-dung-1440-light` (9 pixel ở avatar). Script tự mở PR #95 dạng draft vì kết quả này.

**Nguyên nhân 9 pixel ở avatar** (điều tra 07/10, theo yêu cầu người dùng):

| Bước | Bằng chứng | Kết luận |
|---|---|---|
| Tái hiện | chạy riêng 3 trạng thái nghi vấn × 3 lần: 3 lần chụp lệch, đều 9 pixel, đều trang cao đúng 900px (1440×900) | chập chờn, chỉ ở trang vừa khít khung nhìn |
| Bên nào đổi | chụp cùng trạng thái 8 lần mỗi bản, băm vùng avatar: bản gốc 1 kiểu; bản React 2 kiểu (3/8 lần khác), vị trí avatar/header, cuộn, chiều cao trang giống hệt | bản React vẽ không ổn định |
| Chỗ lệch | so từng kiểu ảnh React với ảnh gốc: chỉ góc phải header (avatar tới 67 mức màu, nút Sáng/Tối tới 2 mức) | |
| Giả thuyết 1: transition lúc tải | bản React chạy 110 transition `color`/`background-color` 0,01ms lúc tải (quy tắc `prefers-reduced-motion` của bản mẫu + `usePrototypePage` đổi class `body` sau lần vẽ đầu), bản gốc 0. Tắt transition từ đầu trang: React vẫn lệch 2/10 | **bác bỏ** |
| Giả thuyết 2: mảnh vẽ cũ | ép vẽ lại cả trang trước khi chụp (đổi bề rộng khung nhìn 1px rồi trả lại): React khớp bản gốc 10/10. Trang cao 1388px: chỉ chụp vùng avatar thì React lệch 5/8, chụp cả trang trước (Playwright giãn khung) thì khớp 6/6 | **xác nhận**: nội dung cuối giống hệt, lệch chỉ do Chromium giữ mảnh header vẽ ở lượt trước khi React dựng trang bằng JS; trang cao hơn khung nhìn tự được vẽ lại khi chụp cả trang nên không lộ |

Sửa ở script so, không ở trang: ép vẽ lại cả trang trước khi chụp, làm y hệt cho cả hai bản. Sau khi sửa, 3 trạng thái nghi vấn × 3 lần không còn lệch ở avatar. Không tìm hiểu sâu cơ chế raster bên trong Chromium.

Lần chạy toàn bộ thứ ba (sau khi sửa 9 pixel) lộ ra một lệch khác, lặp lại cả hai lần: `users-xac-nhan-khoa-375-dark`, 313 phần tử, header `sticky` và toast `fixed` lệch đúng một độ cuộn. Giả thuyết đầu (đổi bề rộng làm Chromium chỉnh lại độ cuộn) bị số đo bác bỏ: `scrollY` không đổi khi đổi bề rộng, mà đã khác từ trước, ở cả hai bản (gốc 583/189/583/583/583, React 189/189/189/583/583). Chờ hai khung hình giữa các bước thì 10/10 lần đều 583. Sửa: script chờ hai khung hình sau mỗi bước; chạy riêng trạng thái đó 3/3 đạt, không cần chạy lại. Lần chạy toàn bộ thứ ba bị dừng giữa chừng vì kết quả không còn dùng được.

Dao động thứ hai, nét chữ Playfair (nguồn của hầu hết lần "chạy lại"), là chuyện khác: băm vùng tiêu đề 12 lần mỗi bản, kể cả khi đã ép vẽ lại, bản gốc 1 kiểu, bản React 2 kiểu (1/12). Chưa tìm ra nguyên nhân; script vẫn chạy lại một lần như trước.

**Kết quả cuối:** lần chạy toàn bộ thứ tư (07/10, head `b36a99b`, `node scripts/verify-parity.mjs`, exit 0) khớp **348/348** trường hợp của 10 trang, 0 phần tử lệch, 0 pixel lệch. 3 trường hợp đạt ở lần chạy lại: `404-1440-dark`, `settings-luu-thanh-cong-1440-light`, `settings-kiem-tra-thanh-cong-1440-light`.

Giới hạn phát hiện sau lần chạy này (khi làm bước 4): script chưa so thuộc tính `transform`. Class `transform` của Tailwind v3 luôn đặt ma trận đơn vị nên phần tử có lớp vẽ riêng; v4 không đặt gì. Lệch này chỉ lộ thành pixel ở `index` (nét chữ một nút). Bước 4 sửa cho cả 12 trang và so lại.

**Không so được hoặc chỉ so một phần:**
- `settings`: kết quả "quá giờ" chờ 10 giây, chỉ so lúc đang chờ. Bấm nền để đóng ngăn chỉ thử bằng Esc, vì ở 375px panel phủ kín nền.
- `account`: nút gỡ Google bị khoá ở kịch bản "chỉ Google" nên không bấm được trong kịch bản so.
- Sao chép vào bộ nhớ tạm (`history`, `guide`) phụ thuộc quyền clipboard của Chromium headless; hai bản cho cùng kết quả.

**Giữ nguyên lỗi của bản mẫu** (README `react/`):
- `users`: bảng desktop hiện cả ở màn hẹp sau khi vẽ danh sách;
- `history`: link "Người dùng" hiện ở màn hẹp khi là quản trị viên; "Mở lại trên sân khấu" tạm ra trang 404;
- `account`: đổi mật khẩu xong thanh độ mạnh giữ màu cũ; đặt lại dữ liệu có thể đổi thứ tự thẻ phiên.

## Kết quả bước 4 (Claude Code, 07/10/2026)

**Đã làm:** hai trang sinh bằng bộ chuyển, rồi viết lại toàn bộ JS bằng state React, không còn lời gọi `todo()` ở cả 12 trang.

| Trang | JS của bản mẫu | Hành vi viết lại |
|---|---|---|
| `index` (route `/`) | 750 dòng | hộp đăng nhập/đăng ký/quên mật khẩu (ẩn/hiện mật khẩu, tài khoản bị chặn, gửi email, Google), hộp email mô phỏng, Esc và bấm nền để đóng, bẫy focus; sân khấu kể chuyện: cuộn tới khoảnh khắc (`IntersectionObserver`), bấm chấm khoảnh khắc, chữ gõ dần, khoảnh khắc 2 "tìm thấy" |
| `app-stage` | 1.109 dòng | 9 khoảnh khắc (phím 1–9, chấm), gửi yêu cầu và gợi ý, chọn bảng tính, xem trước từng việc, chi tiết kỹ thuật, sửa qua chat, duyệt và chạy theo 4 chế độ (bình thường, thử lại việc 3, bỏ qua việc 3, làm tiếp từ việc 3), ngăn hội thoại và ngăn lịch sử có bẫy focus, menu người dùng, menu demo (thành viên, máy chủ thật, giải thích chế độ thử nghiệm), nút Sáng/Tối riêng |

Dòng việc ở khoảnh khắc 5 của `app-stage` giữ theo từng trường (class, nhãn, mô tả, thời gian), vì bản mẫu không đặt lại khi vào lại khoảnh khắc 5 mà chỉ ghi đè từng phần.

**RED → GREEN** (`node scripts/verify-parity.mjs index app-stage`):

| Trang | Lệch | Nguyên nhân | Sửa |
|---|---|---|---|
| `index`, `app-stage` | font của `body` sai, `index` lệch 777 phần tử | biến `--font-body/--font-display/--font-mono` của trang trùng tên biến theme Tailwind v4 khai trên `:root`, bị đè | đổi thành `--page-font-*` trong `page.css` của 7 trang có biến này, bộ chuyển đổi tự động |
| `index` | nút "Vào không gian làm việc" hiện cả khi chưa đăng nhập (2 phần tử lệch ở lúc mở) | nút có sẵn cả `hidden` lẫn `inline-flex` trong HTML, v4 cho `inline-flex` thắng | `hidden!`, có ghi chú. Làm tương tự cho nút "Xem mô phỏng email" (JS thêm `hidden` khi đăng nhập thành công) và nút "Xem hội thoại" của `app-stage` (có sẵn trong HTML) |
| `index` | bấm chấm khoảnh khắc: bản gốc quá giờ 5 giây | CSS giảm chuyển động của bản mẫu ẩn hẳn sân khấu tương tác | tuỳ chọn `motion: true` cho trạng thái, viết lại các trạng thái cuộn/bấm chấm |
| `index` | `bam-nen-dong` 375: viền focus của ô email khác | đua với hẹn giờ focus 100 ms của bản mẫu | chờ 300 ms sau khi mở |
| `index` | `quen-mat-khau`: 594 pixel (1440), 9 pixel (375), 0 phần tử lệch | chữ nút "Quay lại đăng nhập" được khử răng cưa xám thay vì điểm ảnh con. Computed style của nút giống hệt; khác ở cây lớp vẽ (CDP `LayerTree`): nút gửi ngay trước có class `transform`, v3 đặt ma trận đơn vị nên nút có lớp riêng, v4 không | class `transform` → `v3-transform` (`transform: translate(0, 0)`) ở bộ chuyển và 20 chỗ trong 9 trang; script so thêm transform thực tế (RED: 6 phần tử lệch ở trạng thái này) |
| `app-stage` | khoảng cách âm `-space-x-1.5` mất tác dụng | v4 cần utility âm khai riêng | `-v3-space-*` |
| `app-stage` | `bo-qua-viec-3-xong`: toast còn hiện ở bản gốc, đã ẩn ở bản React (14.554 pixel) | hai bản ẩn toast đúng 2,6 giây sau khi bấm; chờ 2 giây cộng thời gian chụp thì bản React (dev, chậm hơn vài trăm ms) đã qua mốc | chờ 3,2 giây; toast lúc đang hiện đã có trạng thái `bo-qua-viec-3` |
| `index` | `cham-khoanh-khac-2`: chữ gõ dần ở khoảnh khắc 1 khác nhau (gốc đang gõ tới "…ghi vào", React đã đủ câu), 3 phần tử, lặp lại khi chạy lại | bấm chấm thì trang cuộn mượt qua đoạn của khoảnh khắc 1 nên chữ gõ lại, nhưng chỉ khi lần gõ trước đã xong. Đo: bản gốc gõ ~38 ms/ký tự (xong sau ~4,3 giây), bản React dev ~55 ms/ký tự (~6 giây, mỗi ký tự dựng lại cả trang); bản build production ngang bản gốc (~4,3 giây, 2/2 lượt). Lúc bấm (giây thứ 4) bản gốc đã gõ xong nên gõ lại, bản React dev chưa xong nên không | không sửa trang (logic giống bản mẫu, chậm chỉ ở dev); trạng thái `motion` chờ 7 giây trước khi thao tác và 8 giây sau mỗi lần bấm chấm. 4 trạng thái chạy lại đạt ngay lần đầu |
| bộ chuyển | handler `if(...) f()` bị hiểu là lời gọi hàm `if` | regex nhận mọi `tên(` | chỉ nhận handler là đúng một lời gọi hàm, bỏ từ khoá; kết quả trên `privacy`, `errors`, `settings`, `history` giống hệt trước |

Hai lỗi console chỉ có ở bản React đã sửa: React chặn `href="javascript:void(0)"` của `app-stage` (đổi thành `href="#"` kèm `preventDefault`); `flushSync` gọi trong `useLayoutEffect` lúc mở `app-stage`.

Script so có thêm: bước `move` (đưa chuột tới toạ độ); transform thực tế (lần chạy 12 trang đầu tiên báo sai ở biểu tượng SVG `-translate-y-1/2` của `users`, vì SVG không có `offsetHeight`; sửa script rồi chạy lại từ đầu); tuỳ chọn `only` (một khổ màn hình) và `motion`; cổng qua `PARITY_ORIGINAL_PORT`/`PARITY_REACT_PORT`; mặc định chạy cả 12 trang.

**Kết quả cuối:** lần so toàn bộ 12 trang (07/10, `node scripts/verify-parity.mjs`, mọi thay đổi bước 4 trên nền `4dc4a39`) khớp **462/464** trường hợp, exit 1:

| Trang | Đạt |
|---|---|
| `index` | 44/44 |
| `app-stage` | 72/72 |
| `404`, `privacy`, `errors`, `responses`, `auth-action`, `users`, `history`, `guide` | 4/4, 4/4, 32/32, 20/20, 50/50, 44/44, 50/50, 28/28 |
| `account` | 59/60 |
| `settings` | 55/56 |

8 trường hợp đạt ở lần chạy lại (6 ở `account`/`auth-action`, 2 ở `settings`). Hai trường hợp lệch ở cả lần chạy lại:
- `account-thu-hoi-roi-dat-lai-375-dark`: 88 pixel ở dấu ngã chữ "Nguyễn" (tiêu đề Playfair), 0 phần tử lệch. Đây là dao động nét chữ Playfair đã ghi ở bước 3. Chạy riêng 3/3 đạt ngay lần đầu; hai lần so toàn bộ trước cũng đạt.
- `settings-them-noi-dung-375-dark`: màu hover của nút "Thêm". Ở 375px, mục mới làm danh sách xuống dòng nên nút bị đẩy khỏi con trỏ; Chromium chỉ bỏ `:hover` ở lần di chuột kế tiếp, nên còn hover hay không tuỳ thời điểm, ở cả hai bản. Chạy riêng 3/3 đạt (1 lần cần chạy lại). Sửa trạng thái: thêm bước `move` đưa chuột ra góc sau khi bấm; sau đó 6/6 đạt ngay lần đầu.

Sau khi sửa: chạy lại đủ hai trang `node scripts/verify-parity.mjs account settings` khớp **116/116**, exit 0 (7 trường hợp đạt ở lần chạy lại). Tính theo trường hợp: 464/464 khớp ở lần so toàn bộ hoặc lần chạy lại hai trang này; chưa có một lần so toàn bộ 12 trang nào exit 0 sau bước `move`.

`npm run typecheck` exit 0, `npm run build` exit 0. Từ `history` và `index` bấm sang `/app-stage` đều tới đúng trang, 0 lỗi console (thử trên bản build).

Hai lần so toàn bộ trước đó bị dừng giữa chừng: lần đầu vì script báo sai ở SVG (xem trên); lần hai vì người dùng tắt máy (372/464, 0 lệch).

**Không so được hoặc chỉ so một phần:**
- `index`: sân khấu tương tác chỉ có từ khổ `lg`, nên 6 trạng thái của nó chỉ so ở 1440. Chữ gõ dần và hiệu ứng chuyển cảnh chỉ so ở trạng thái cuối.
- `app-stage`: các bước chạy có hẹn giờ được so ở lúc bắt đầu và lúc xong, không so từng khung giữa chừng.

### Sau merge #96 (Claude Code, 07/10/2026)

#96 merge tại `581addd` lúc 14:14:47 (Việt Nam); cây merge bằng head `841e674`, CI PR và CI main xanh. Lần so toàn bộ 12 trang chạy lại trên `main` `581addd`: 459/464 trường hợp, exit 1 (`index` 43/44, `app-stage` 57/58, `auth-action` 47/50, chín trang còn lại đạt hết; 9 trường hợp đạt ở lần chạy lại). Cả 5 trường hợp lệch đều là trạng thái chụp giữa chừng một hẹn giờ: `auth-action` "Đang gửi lại" (2 khổ) và đồng hồ đếm ngược, `index` trả focus sau Esc, `app-stage` gợi ý tự chuyển khoảnh khắc. Chạy riêng từng trạng thái đều đạt (2 trong 4 lần cần chạy lại). Chưa có lần so toàn bộ 12 trang nào exit 0.

# 2026-10-07 · Claude Code · FE-04b: lớp nền của bản React trong app

- **Yêu cầu:** người dùng nói "merge #97 rồi tiếp tục đi".
  - #97 (kế hoạch đưa bản React vào app, design system Agentic theo bản mẫu) merge tại `0cdb02a` lúc 15:48:56 ngày 07/10 (Việt Nam). CI `v3` xanh đúng head `61cf11f`, cây merge bằng head. Nhánh và worktree đã xoá.
  - Việc tiếp theo theo ROADMAP là FE-04b. Claude Code thi công trong worktree `.claude/worktrees/fe-04b`, nhánh `feat/fe-04b-prototype-foundation`. **Tự review, nên có review độc lập.**
- **Phân tích trước khi làm** (`apps/chat-web/src/index.css` so với lớp nền của bản React):
  - FE-04 đặt lại thang chữ (`--text-xs: 14px`…), quy tắc 40×40 và viền focus ngoài cascade layer; trang bản React cần chữ 12px và không bị ép kích thước;
  - `tokens.css` của bản React khai lại `--font-*` theo trang; không có trang bản mẫu thì màn cũ mất Be Vietnam Pro;
  - bảng màu v3, `rounded-sm`, line-height, preflight v3 nếu khai toàn cục sẽ đổi màn cũ;
  - `theme.css` ghi đè theo tên class bằng `!important`; nạp toàn cục sẽ đè chế độ tối của màn cũ;
  - màn cũ dùng utility gradient v4 ở 10 chỗ; chỉ cần một chỗ là Tailwind khai `@property --tw-gradient-*` kiểu `<color>` và gradient chế độ tối của bản mẫu hỏng (lỗi PROTO-01 đã gặp).
- **Cách làm:** mọi giá trị khác nhau giữa hai bên đổi theo thuộc tính `data-proto-page` trên `<html>`. Có thuộc tính này (trang bản mẫu) thì theo bản mẫu, không có thì giữ nguyên FE-04; `theme.css` chỉ nạp khi có trang bản mẫu. Chi tiết ở task card.
- **Bằng chứng giống bản mẫu** (script riêng trong scratchpad, ảnh không commit), so `/khong-co-trang` của app với của bản React (`npm run dev` trong `docs/design/prototypes/react/`):

  | Ảnh | SHA256 (16 ký tự đầu) app / bản React | Pixel lệch |
  |---|---|---|
  | đã đăng nhập 1440 sáng | `22e5af2b9145bca0` / `a400dda729c7231b` | 0 |
  | đã đăng nhập 1440 tối | `6324921fcd8405f1` / `4f17cee3b4280c2c` | 0 |
  | đã đăng nhập 375 sáng | `894575fe1b2bbf6b` / `5ed38a3f0c590f90` | 0 |
  | đã đăng nhập 375 tối | `8a0d1fdfc166b9a9` / `8a0d1fdfc166b9a9` | 0 |
  | chưa đăng nhập 1440 sáng | `ae0c52840b01e99d` / `e7f3c2771d990245` | 8.948 (nhãn "Về trang chủ") |
  | chưa đăng nhập 1440 tối | `2ec4c63c38377554` / `4f17cee3b4280c2c` | 11.161 (như trên) |
  | chưa đăng nhập 375 sáng | `b478329ee6646449` / `894575fe1b2bbf6b` | 35.169 (như trên) |
  | chưa đăng nhập 375 tối | `996a63bbf84cb34b` / `8a88b941eba5c84d` | 49.714 (như trên) |

  SHA khác nhau mà 0 pixel lệch nghĩa là khác dưới ngưỡng 16 mức màu (khử răng cưa).
- **Màn chưa chuyển so với `main` `0cdb02a`**: hai server dev (`main` và nhánh) cùng trỏ một API trên PostgreSQL tạm, 11 route × 2 tổ hợp; kết quả ở task card.
  - Lần so đầu `/account` và `/admin/users` khác vì dữ liệu: mỗi lần script đăng nhập là thêm một phiên. Đăng nhập cả hai bên trước rồi mới chụp thì `/account` khớp hoàn toàn; `/admin/users` còn 290 pixel ở chữ Playfair, nhìn ảnh cắt hai bản như nhau.
  - `/signup` lần đầu chụp lúc Vite dev đang đóng gói lại thư viện (trang chưa có CSS); chụp lại thì khớp.
- **Hook thiết kế impeccable** báo font JetBrains Mono và Playfair Display "không có trong `DESIGN.md`" ở dòng `@import` font của `index.css`. Hai font đã có từ FE-04 và người dùng chốt ngày 05/10; `DESIGN.md` ở gốc repo đang lỗi thời. Không ghi bỏ qua vì lệnh đó tạo file `.impeccable/config.json` mới trong repo; hỏi người dùng.
- **Môi trường:** PostgreSQL tạm `ati-fe04b-pg` ở cổng 55533 (tmpfs), tài khoản test như CI; worktree nối `node_modules` của repo gốc bằng junction (bị git bỏ qua). Không dùng DB dev 15433, không đọc `.env`.
- **Kết quả kiểm tra:** xem task card, mục "Kết quả".
- **Không làm:** không sửa bản mẫu HTML hay bản React trong `docs/`; không đổi store, API, route; không gọi model hay dịch vụ thật; không merge.

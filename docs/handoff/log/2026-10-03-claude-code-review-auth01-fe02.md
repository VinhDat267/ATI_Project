# 2026-10-03 · Claude Code · Review sau merge AUTH-01, FE-02 và phần sửa W3-08

- **Phạm vi:** `main` `1e6ced4`, gồm #41 (AUTH-01), #42 (FE-02), #45 (sửa W3-08 theo review của Codex). Các PR đã merge trước khi review, nên đây là review sau merge.
- **Kết luận:** **Đạt.** Không tìm thấy lỗi cần sửa. Có ba ghi chú nhỏ ở cuối.

## Chạy lại

Chạy trên PostgreSQL 16 tạm (tmpfs, cổng 55533, xóa sau khi chạy); không dùng database của người dùng ở 15433.
- `npm run check` exit 0: v3 955 = 47 schema + 320 adapters + 176 planner + 25 executor + 203 API + 184 web; eval 165; quét bản build PASS.
- `test-v3-browser.mjs` 20/20, đủ 9 kịch bản.
- Test frontend chạy 5 lần liên tiếp, đều 184/184. Lỗi "timing" ở test Back/Forward mà Codex gặp một lần lúc máy tải nặng chưa tái hiện được.

## Đọc code

- **AUTH-01, migration `0003`:** idempotent. Tài khoản cũ thành `active`/`email_verified`, tài khoản mới mặc định `pending`.
- **AUTH-01, xoay vòng refresh token:**
  - một câu `UPDATE` có điều kiện theo hash, nên khi đồng thời chỉ một bên thắng;
  - lịch sử hash phát hiện việc dùng lại token cũ;
  - token liền trước dùng lại trong vòng 30 giây trả `REFRESH_ROTATED`, token cũ hơn thì thu hồi cả phiên.
- **AUTH-01, middleware:** kiểm phiên và trạng thái người dùng trong database ở mỗi request, nên đăng xuất và khóa có hiệu lực ngay.
- **AUTH-01, đăng nhập:**
  - xếp hàng theo (IP, email);
  - băm mật khẩu giả cho email không tồn tại để thời gian phản hồi không lộ tài khoản;
  - chỉ lộ `pending`/`disabled` sau khi mật khẩu đúng.
- **FE-02, điều hướng:** route theo đường dẫn, có `popstate`, `/c/<id>` mở đúng hội thoại.
- **FE-02, quyền:** hội thoại của người khác trả 404; đổi tên kiểm chủ sở hữu ngay trong SQL.
- **FE-02, migration `0004`:** chỉ điền tiêu đề lần đầu thêm cột, nên chạy lại không ghi đè tên đã đổi.

## Mutation (14, worktree sạch tại `1e6ced4`, database tạm)

Cả 14 đều bị bắt:
- **AUTH-01 (11):**
  - dùng lại token cũ không thu hồi phiên;
  - cửa sổ ân hạn 30 giây thành 1 giờ;
  - middleware bỏ kiểm `status`; middleware bỏ kiểm `revoked_at`;
  - refresh cho người bị khóa;
  - `logout-all` không làm gì;
  - bỏ xếp hàng đăng nhập; giới hạn 5 thành 50;
  - lộ trạng thái trước khi kiểm mật khẩu;
  - migration để tài khoản mới mặc định `active`;
  - `isAdmin` tin bất kỳ `role` nào.
- **FE-02 (3):** bỏ listener `popstate`; đọc được hội thoại của người khác; đổi tên không kiểm chủ sở hữu.

## Phần sửa W3-08 của Codex (#45)

Probe trên `formatSearchResults` của `main`:
- args query dài 30.000 ký tự → prompt 18.539 ký tự (trước khi sửa khoảng 30.290);
- lỗi dài 50.000 ký tự → 18.543;
- kết quả nhỏ giữ nguyên.

Hai P2 mà Codex tìm trong phần Claude Code thi công là lỗi thật, và đã sửa đúng.

## Ghi chú nhỏ (không chặn)

1. **FE-02:** `App.tsx` còn 12 dòng, nhưng `components/Workspace.tsx` có 423 dòng. Khối logic lớn được dời chỗ chứ chưa được chia nhỏ hẳn. Nên tách tiếp khi làm FE-03 hoặc các view AUTH.
2. **Dữ liệu test trong database dev:** database của người dùng (15433) có 441 tài khoản `@wap.local`, tạo dần từ 29/09 qua các lần chạy `npm run check` của mọi agent (trong đó có 2 lần của Claude Code ngày 02–03/10). Test tích hợp không dọn dữ liệu. Nên luôn chạy test trên database tạm như Codex đang làm, hoặc để `npm run check` từ chối database không phải database test. Chưa xóa gì: việc dọn do chủ dự án quyết định.
3. **Giới hạn chặn đoán mật khẩu** chỉ theo (IP, email), đúng task card. Một IP thử nhiều email khác nhau (credential stuffing) chưa bị giới hạn chung theo IP. Có thể thêm khi làm AUTH-02 (đăng ký mở).

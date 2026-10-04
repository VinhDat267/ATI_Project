# 2026-10-04 · Claude Code · Review #52 (AUTH-02), #53 (AUTH-03), #54 (FE-03)

- **Kết luận:**
  - #53 **Đạt**; #54 **Đạt**;
  - #52 **Đạt có điều kiện**: một P2 về lộ tài khoản qua thời gian phản hồi; chưa có hậu quả trong sandbox vì thư ghi vào outbox, nhưng phải sửa trước khi gửi email thật → task card AUTH-02b.
  - Chủ dự án chọn merge cả ba rồi sửa P2 sau.
- **Merge:**
  - #52 tại `e578520`;
  - #53 tại `46cc6e6`: base đổi thủ công sang `main`, vì nhánh của #52 đang mở trong worktree Codex nên không tự xóa được; vẫn 22 file của chính nó;
  - #54 tại `9709a2d`: base đổi tương tự;
  - code sản phẩm trên `main` trùng head đã review `4859788` (`git diff` thư mục sản phẩm rỗng);
  - nhánh remote của ba PR đã xóa; nhánh local trong worktree Codex giữ nguyên.

## Chạy lại (head #54 `4859788`, chứa cả ba PR)

- `npm ci` trong worktree riêng (#52 thêm `nodemailer`).
- `npm run check` exit 0: v3 1.063 = 47 schema + 328 adapters + 180 planner + 25 executor + 252 API + 231 web; eval 165; quét bản build PASS. PostgreSQL tạm tmpfs ở cổng 55541, tránh cổng 55533 mà agent khác có thể dùng.
- `test-v3-browser.mjs` 25/25 qua 10 kịch bản, có `auth02`.
- **Sự cố của reviewer:** lần chạy đầu báo 17 test API lỗi `ECONNREFUSED`. Nguyên nhân là `docker run --tmpfs /var/lib/postgresql/data` trong Git Bash bị đổi đường dẫn nên container không được tạo; lúc đầu đã đoán sai là agent khác xóa container. Chạy lại với `MSYS_NO_PATHCONV=1` thì đạt. Không phải lỗi sản phẩm.

## Đọc code

- **AUTH-02:**
  - token SHA-256, phát hành khóa dòng user và vô hiệu token cũ;
  - tiêu thụ token bằng `UPDATE … used_at IS NULL AND expires_at > now`;
  - đặt lại mật khẩu thu hồi mọi phiên và token;
  - đăng ký trùng email gửi thư thông báo, cùng phản hồi;
  - giới hạn tần suất;
  - SMTP bắt buộc TLS.
- **AUTH-03:**
  - advisory lock chung cho mọi thao tác quản trị;
  - đọc lại quyền admin của người thao tác sau khi chờ khóa;
  - kiểm phiên của người thao tác trong transaction;
  - chặn tự khóa hoặc tự hạ quyền; kiểm "còn ít nhất một admin";
  - khóa thì thu hồi phiên;
  - tìm kiếm escape wildcard, không trả hash mật khẩu hay Google subject.
- **FE-03:**
  - `resource_labels` lưu cột riêng, không nằm trong plan đã duyệt và hash;
  - nhãn mơ hồ thì bỏ;
  - link chỉ `http`/`https` + `noopener noreferrer`;
  - SSE 401 refresh một lần rồi kết nối lại, có `openWhenHidden`.

## Mutation (15, worktree sạch, database tạm)

- **Bị bắt (13):**
  - AUTH-02: token dùng lại được; token hết hạn vẫn dùng được; reset giữ phiên cũ; token mới không vô hiệu token cũ; signup bỏ qua cờ đóng; giới hạn quên mật khẩu 3 → 300; đăng ký trùng email không gửi thư;
  - AUTH-03: admin tự khóa được; khóa giữ phiên; không kiểm lại người thao tác dưới khóa; duyệt email chưa xác minh;
  - FE-03: hiển thị link `javascript:`; nhãn mơ hồ vẫn giữ.
- **Lọt (2):**
  - bỏ kiểm "còn ít nhất một admin active": mutation tương đương, vì qua API không thể về 0 admin (tự hạ quyền bị chặn, người thao tác được kiểm lại dưới khóa). Lớp này là phòng thủ thêm;
  - `openWhenHidden: false`: thiếu test. Đường refresh 401 vẫn xử lý được kết nối mở lại; ghi nhận, không chặn.

## Probe thời gian (P2)

HTTP + PostgreSQL thật, sender chậm 800 ms: `forgot-password` email có tài khoản 832 ms, email không có 6 ms, cùng body → AUTH-02b mục 1.

## Ghi nhận khác

- Sau AUTH-03, `AUTH_SIGNUP_ENABLED` mặc định `true`.
- Live bắt buộc đủ biến SMTP, nên `RUNTIME_MODE=live npm run up` lỗi khi chưa làm AUTH-06 → AUTH-02b mục 2.
- FE-03 đổi câu chữ trong planner/registry. Golden set cần đo lại khi có quyền gọi model (Codex đã ghi NOT_RUN).
- Codex ghi nhận vài test khởi động child process (`memory-execution-snapshot`, `startup-reconciliation`) timeout khi chạy nhiều suite cùng lúc dưới tải; chạy tuần tự đạt. Lần chạy của reviewer không gặp.

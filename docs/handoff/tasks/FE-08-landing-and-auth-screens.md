# FE-08 · Trang giới thiệu và các màn đăng nhập, đăng ký, xác minh, đặt lại

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/fe-08-landing-auth` · **Phụ thuộc:** FE-04 đã merge · **Mốc:** 23/10/2026
**Đặc tả:** mục 2, 4, 6 · **Bản mẫu:** `index.html` (trang giới thiệu, modal đăng nhập/đăng ký/quên mật khẩu/Google), `auth-action.html`

## Vì sao quan trọng

Đây là màn đầu tiên người mới thấy. Bản mẫu đã sửa qua nhiều vòng để nói đúng quy trình thật (xác minh email → quản trị viên duyệt → nhận email), đúng quy tắc mật khẩu và đúng luồng Google.

## Việc cần làm

1. **`/` khi chưa đăng nhập:** trang giới thiệu cuộn kể chuyện 5 khoảnh khắc (sân khấu dính bên phải trên desktop, thẻ xếp dọc trên điện thoại và khi `prefers-reduced-motion`), phần nguyên tắc, 8 dịch vụ, hướng dẫn bắt đầu. Số liệu mẫu khớp cockpit (issue #42, dòng 104); không có số liệu chưa đo.
2. **`/login`, `/signup`, `/forgot-password`:** giữ route (link trong email và nút trên trang giới thiệu trỏ tới đây), trình bày như thẻ modal của bản mẫu:
   - đăng ký: Họ tên, Email, Mật khẩu ≥ 12 ký tự; lưu ý 3 bước (xác minh email, quản trị viên duyệt, nhận email khi được duyệt);
   - quên mật khẩu: một câu trả lời chung "Nếu email này có tài khoản, bạn sẽ nhận được link đặt lại mật khẩu.";
   - Google: chuyển sang trang Google thật (luồng AUTH-04), không có bảng chọn tài khoản trong trang;
   - không có "Ghi nhớ phiên", "Đăng ký dùng thử", chọn công cụ khi đăng ký.
3. **Các màn trong `auth-action.html`:**
   - xác minh email: thành công (bước 1/3), link hết hạn (24 giờ, gửi lại), link đã dùng;
   - đặt mật khẩu mới: ≥ 12 ký tự, nhập lại; ghi "Link có hiệu lực 30 phút và chỉ dùng được một lần"; thành công thì báo các thiết bị khác đã đăng xuất;
   - Google: đang chuyển trang, chờ duyệt (email đã được Google xác minh nên chỉ còn bước duyệt), huỷ/lỗi;
   - đăng nhập bị chặn: chờ duyệt (không hiện tên/email quản trị viên), bị khoá ("liên hệ quản trị viên", không có nút gửi yêu cầu), sai mật khẩu quá nhiều (5 lần/15 phút, đếm ngược theo `Retry-After`; đặt lại mật khẩu vẫn phải chờ hết thời gian);
   - nút "Thử đăng nhập lại" thay cho "Kiểm tra trạng thái duyệt".
4. Giữ mọi bảo đảm của AUTH-02 → AUTH-05: callback Google xoá query trước khi gọi API, phản hồi muộn không ghi đè phiên mới, thông báo không lộ email có tồn tại hay không.

## Tiêu chí nghiệm thu

- [ ] Test: mật khẩu dưới 12 ký tự bị chặn ở cả đăng ký và đặt lại.
- [ ] Test: màn sai mật khẩu quá nhiều đọc `Retry-After` và đếm ngược; không có câu "đăng nhập lại ngay".
- [ ] Test: màn chờ duyệt không chứa email/tên quản trị viên.
- [ ] Các test AUTH-02, AUTH-04, AUTH-05 (unit và browser) vẫn xanh; browser spec cập nhật cách tìm phần tử trong cùng PR.
- [ ] Browser: trang giới thiệu ở 1440px và 375px, sáng và tối, không cuộn ngang; với `prefers-reduced-motion` không có sân khấu dính.
- [ ] **Giống bản mẫu** (đặc tả mục 1 và 1.1; làm bằng cách chuyển markup bản mẫu sang JSX theo mục 1.2): ảnh app và ảnh `index.html` (từng đoạn cuộn và các modal đăng nhập/đăng ký/quên mật khẩu) và `auth-action.html` (từng trạng thái) đặt cạnh nhau ở 1440×900 và 375×812, sáng và tối. Danh sách ảnh và SHA256 ghi trong log; ảnh không commit. Mọi khác biệt còn lại nằm trong đặc tả 1.1 hoặc ghi ở phần "Kết quả" kèm lý do.
- [ ] `npm run check` và `npm run test:browser:v3` exit 0.

## Ngoài phạm vi

Mô phỏng hộp thư trong bản mẫu (chỉ để trình diễn). Thay đổi API xác thực.

## Kết quả

_(agent thi công điền)_

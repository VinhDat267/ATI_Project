# FE-10 · Cẩm nang, Chính sách an toàn, 404 và rà soát toàn app

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/fe-10-guide-privacy-audit` · **Phụ thuộc:** FE-04 đã merge (rà soát cuối chạy sau FE-05 → FE-09) · **Mốc:** 28/10/2026
**Đặc tả:** mục 6, 7, 8 · **Bản mẫu:** `guide.html`, `privacy.html`, `404.html`

## Vì sao quan trọng

Cẩm nang giúp quản trị viên tự kết nối dịch vụ đúng cách. Trang chính sách trả lời câu hỏi "dữ liệu của tôi đi đâu" khi bảo vệ. Cả hai đã được sửa nội dung cho khớp hệ thống thật (Trello Board ID 24 ký tự, Telegram chỉ văn bản thuần, GitHub không đọc commit…).

## Việc cần làm

1. **`/guide`** (công khai): hướng dẫn lấy khoá 8 dịch vụ, mẫu câu lệnh chạy được với catalog hiện tại, bảng làm được/chưa làm được. Mỗi mẫu câu lệnh phải ánh xạ được tới tool có thật trong `@wap/tool-schemas`.
2. **`/privacy`** (công khai): giữ nội dung đã sửa của bản mẫu (mục lưu trữ nói đúng: hội thoại, kế hoạch đã duyệt, kết quả từng bước kể cả dữ liệu đọc được; khoá mã hoá khi lưu; phiên 7 ngày; không có gỡ khoá, bản nháp, lịch sử cả nhóm).
3. **404:** thay `NotFoundView`, có nút về không gian làm việc (đã đăng nhập) hoặc trang chủ (chưa đăng nhập).
4. **Rà soát toàn app sau FE-05 → FE-09:**
   - tương phản ở cả hai chế độ trên mọi trang (tự động, kể cả trạng thái sau khi bấm: ngăn, hộp thoại, tab);
   - không còn chữ dưới 14px;
   - mỗi trang một `h1`, landmark đủ, nút chỉ có biểu tượng có nhãn;
   - danh sách quy tắc trung thực (đặc tả mục 6) quét bằng test chuỗi trên bundle build.

## Tiêu chí nghiệm thu

- [ ] Test: mọi mẫu câu lệnh trong Cẩm nang khai báo danh sách tool cần dùng, và các tool đó tồn tại trong catalog.
- [ ] Test quét bundle build không chứa các chuỗi cấm (ví dụ "100%", "REQ-20", "security@", "Allowed Scope", "Đăng xuất mọi thiết bị" trong menu).
- [ ] Test tương phản tự động chạy trên mọi route ở hai chế độ; chỉ ngoại lệ đặc tả 3.2.1 được bỏ qua.
- [ ] `/guide`, `/privacy` xem được khi chưa đăng nhập; route lạ hiện 404 mới.
- [ ] **Giống bản mẫu** (đặc tả mục 1 và 1.1): ảnh app và ảnh `guide.html`, `privacy.html`, `404.html` đặt cạnh nhau ở 1440×900 và 375×812, sáng và tối. Danh sách ảnh và SHA256 ghi trong log; ảnh không commit. Mọi khác biệt còn lại nằm trong đặc tả 1.1 hoặc ghi ở phần "Kết quả" kèm lý do.
- [ ] Rà soát cuối: chụp lại mọi route và khoảnh khắc đã làm ở FE-05b → FE-09 cạnh bản mẫu tương ứng, liệt kê khác biệt còn lại ngoài đặc tả 1.1 (nếu có) thành việc sửa hoặc ghi lý do.
- [ ] `npm run check` và `npm run test:browser:v3` exit 0.

## Ngoài phạm vi

Viết lại nội dung pháp lý; dịch sang tiếng Anh.

## Kết quả

_(agent thi công điền)_

# FE-10 · Cẩm nang, Chính sách an toàn, 404 và rà soát toàn app

**Trạng thái:** đang làm, giao `longnguyen005` (thi công bằng Codex) ngày 10/10/2026 · **Nhánh gợi ý:** `feat/fe-10-guide-privacy-audit` · **Phụ thuộc:** FE-04b đã merge (lớp nền bản React; FE-04 đã merge) (rà soát cuối chạy sau FE-05 → FE-09) · **Mốc:** 28/10/2026
**Đặc tả:** mục 6, 7, 8 · **Bản mẫu:** `guide.html`, `privacy.html`, `404.html`

## Vì sao quan trọng

Cẩm nang giúp quản trị viên tự kết nối dịch vụ đúng cách. Trang chính sách trả lời câu hỏi "dữ liệu của tôi đi đâu" khi bảo vệ. Cả hai đã được sửa nội dung cho khớp hệ thống thật (Trello Board ID 24 ký tự, Telegram chỉ văn bản thuần, GitHub không đọc commit…).

## Việc cần làm

**Cách làm (đổi 07/10/2026, đặc tả mục 1.2):** chép `Guide/GuidePage.tsx`, `Privacy/PrivacyPage.tsx` từ `docs/design/prototypes/react/src/pages/` sang app sau khi FE-04b đã merge; giữ nguyên markup, class, cỡ chữ và màu của bản mẫu; bỏ JS demo, nối store/API; giữ các bảo đảm hành vi đang có. Ảnh "giống bản mẫu" so với trang tương ứng của bản React (`npm run dev` trong `docs/design/prototypes/react/`). Các mục dưới đây là phần dữ liệu và hành vi phải đúng.

1. **`/guide`** (công khai): hướng dẫn lấy khoá 8 dịch vụ, mẫu câu lệnh chạy được với catalog hiện tại, bảng làm được/chưa làm được. Mỗi mẫu câu lệnh phải ánh xạ được tới tool có thật trong `@wap/tool-schemas`.
2. **`/privacy`** (công khai): giữ nội dung đã sửa của bản mẫu (mục lưu trữ nói đúng: hội thoại, kế hoạch đã duyệt, kết quả từng bước kể cả dữ liệu đọc được; khoá mã hoá khi lưu; phiên 7 ngày; không có gỡ khoá, bản nháp, lịch sử cả nhóm).
3. **404:** đã chuyển ở FE-04b (trang thử của lớp nền); FE-10 chỉ kiểm lại trong rà soát.
4. **Rà soát toàn app sau FE-05 → FE-09:**
   - đo tương phản ở cả hai chế độ trên mọi trang (tự động, kể cả trạng thái sau khi bấm: ngăn, hộp thoại, tab) và ghi lại; chỗ không đạt mà sửa thì đổi hình thức bản mẫu thì giữ như bản mẫu (đặc tả 1.1 điểm 4, người dùng chốt 07/10), chữ thường dưới 3:1 thì báo người dùng quyết định;
   - không kiểm cỡ chữ tối thiểu (bỏ yêu cầu 14px từ 07/10);
   - mỗi trang một `h1`, landmark đủ, nút chỉ có biểu tượng có nhãn;
   - đo tương phản logo Jira (`#0052cc`, `apps/chat-web/src/assets/cockpit-services.json`) trên nền tối (chuyển từ CURRENT-STATE mục 5, thêm 10/10);
   - danh sách quy tắc trung thực (đặc tả mục 6) quét bằng test chuỗi trên bundle build.

## Tiêu chí nghiệm thu

- [ ] Test: mọi mẫu câu lệnh trong Cẩm nang khai báo danh sách tool cần dùng, và các tool đó tồn tại trong catalog.
- [ ] Test quét bundle build không chứa các chuỗi cấm (ví dụ "100%", "REQ-20", "security@", "Allowed Scope", "Đăng xuất mọi thiết bị" trong menu).
- [ ] Script đo tương phản chạy trên mọi route ở hai chế độ, xuất bảng kết quả vào log; không chặn merge (đặc tả mục 7, bản 07/10).
- [ ] `/guide`, `/privacy` xem được khi chưa đăng nhập; route lạ hiện 404 mới.
- [ ] **Giống bản mẫu** (đặc tả mục 1, 1.1, 1.2 bản 07/10; chép trang của bản React rồi nối dữ liệu thật): ảnh app và ảnh trang `/guide`, `/privacy`, `/404` của bản React đặt cạnh nhau ở 1440×900 và 375×812, sáng và tối. Danh sách ảnh và SHA256 ghi trong log; ảnh không commit. Mọi khác biệt còn lại nằm trong đặc tả 1.1 hoặc ghi ở phần "Kết quả" kèm lý do.
- [ ] Rà soát cuối: chụp lại mọi route và khoảnh khắc đã làm ở FE-05b → FE-09 cạnh bản mẫu tương ứng, liệt kê khác biệt còn lại ngoài đặc tả 1.1 (nếu có) thành việc sửa hoặc ghi lý do.
- [ ] `npm run check` và `npm run test:browser:v3` exit 0.

## Ngoài phạm vi

Viết lại nội dung pháp lý; dịch sang tiếng Anh.

## Kết quả

_(agent thi công điền)_

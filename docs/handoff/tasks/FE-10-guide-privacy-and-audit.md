# FE-10 · Cẩm nang, Chính sách an toàn, 404 và rà soát toàn app

**Trạng thái:** xong #128 tại `e08e623` (10/10/2026, `longnguyen005` thi công bằng Codex), trừ tiêu chí "Rà soát cuối" chưa làm, chờ người dùng quyết · **Nhánh:** `feat/fe-10-guide-privacy-audit` · **Phụ thuộc:** FE-04b đã merge (lớp nền bản React; FE-04 đã merge) (rà soát cuối chạy sau FE-05 → FE-09) · **Mốc:** 28/10/2026
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

- Đã thay hai placeholder công khai bằng trang React `/guide` và `/privacy`, giữ cấu trúc/CSS bản mẫu, nối điều hướng/theme/menu thật và bỏ vai trò, tài khoản, kịch bản demo. Cẩm nang có đủ 8 dịch vụ, 12 mẫu câu lệnh; từng mẫu khai báo tool và test đối chiếu trực tiếp `ALL_TOOLS`.
- Privacy giữ đúng hợp đồng dữ liệu thật: lưu hội thoại/kế hoạch đã duyệt/kết quả từng bước, khoá mã hoá khi lưu, phiên 7 ngày; không quảng bá gỡ khoá, bản nháp, lịch sử cả nhóm hay tính năng không có. 404 được kiểm lại và bỏ tuyên bố “an toàn tuyệt đối”.
- Bundle production được quét 6 nhóm tuyên bố cấm. Guard generic-plumbing chỉ có ngoại lệ hẹp cho `Guide/data.tsx`; logic trang không hardcode dịch vụ mặc định. Logo Jira dark mode đổi riêng sang `#60A5FA`, đạt **7,14:1** trên `#0E1528`.
- Audit **kỹ thuật tự động** đã đi qua toàn bộ route công khai/riêng tư ở sáng/tối: mỗi màn có một `h1` được expose, một `main`, header và nút biểu tượng có nhãn. Bảng tương phản không chặn merge được ghi đầy đủ trong [log FE-10](../log/2026-10-10-codex-fe-10.md); các chữ thường dưới 3:1 giữ nguyên theo bản mẫu và chờ quyết định thiết kế như yêu cầu task.
- Visual parity tạo **12 cặp** app/prototype cho Guide, Privacy, 404 ở 1440×900 và 375×812, sáng/tối; ảnh nằm ngoài Git tại `node_modules/.cache/fe10-parity`, manifest SHA256 sau sửa review `1aeb781df24fab5b420f17da38ffe021ddf650d80d8c380df5c7b125c332df63`. Khác biệt còn lại là dữ liệu/điều hướng thật, bỏ control demo và Jira dark-mode accessibility; không có ảnh được commit.
- RED ban đầu: focused test không import được `pages/Guide/data`. RED sau review: test vị trí theme toggle không tìm thấy nút trong `banner`. GREEN cuối: 6/6 focused; frontend 649/649; `npm run check` exit 0 với **1.641 source tests + 173 eval**; `npm run test:browser:v3` exit 0 với **100 pass, 1 skip có sẵn, 11 scenario**. Một lần full check trước review gặp Calendar integration flake; cùng test chạy riêng 1/1 và nguyên gate chạy lại exit 0, không sửa Calendar/timeout.
- Sửa theo review: nút sáng/tối của `/privacy` đã được chuyển từ cuối trang vào `header`, đồng thời có regression test ở DOM và browser cho vị trí này.
- **Chưa làm:** chưa chụp và đối chiếu lại toàn bộ route/khoảnh khắc của FE-05b → FE-09 cạnh từng bản mẫu React tương ứng. Canonical browser suite chỉ chạy lại hành vi và ảnh riêng của từng test, không thay thế tiêu chí visual audit này. Vì vậy tiêu chí “Rà soát cuối” ở trên vẫn chưa đạt và cần được thực hiện trong một task/PR riêng nếu chủ dự án quyết định tiếp tục.

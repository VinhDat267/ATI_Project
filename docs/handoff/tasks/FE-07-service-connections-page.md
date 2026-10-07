# FE-07 · Trang Kết nối dịch vụ

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/fe-07-service-connections` · **Phụ thuộc:** FE-04b đã merge (lớp nền bản React; FE-04 đã merge); UI-API-01 phần 2 để lưu riêng nơi được dùng · **Mốc:** 20/10/2026
**Đặc tả:** mục 3, 6, 9 · **Bản mẫu:** `settings.html`

## Vì sao quan trọng

Đề tài là nền tảng đa dịch vụ, nhưng `SettingsModal` hiện là lưới thẻ có chữ kỹ thuật ("Allowed Scope (Write Safety)", "AES-256-GCM", biểu tượng chữ cái). Quản trị viên khó biết dịch vụ nào đang dùng được và vì sao.

## Hiện trạng

- `SettingsModal` + `ServiceCard`: ô khoá, danh sách nơi được dùng, nút Kiểm tra và Lưu cấu hình. `GET /api/services` trả `configured`, `connectionStatus`, `lastCheckedAt`, `allowedScope`, `credentialFields`, `scopeLabel`, `tools`.
- Lưu bắt buộc gửi đủ khoá (`hasValidCredentials`), chỉ quản trị viên (`isAdmin`); kiểm tra kết nối ai cũng gọi được; kết quả kiểm tra lưu trong bộ nhớ tiến trình.

## Việc cần làm

**Cách làm (đổi 07/10/2026, đặc tả mục 1.2):** chép `Settings/SettingsPage.tsx` từ `docs/design/prototypes/react/src/pages/` sang app sau khi FE-04b đã merge; giữ nguyên markup, class, cỡ chữ và màu của bản mẫu; bỏ JS demo, nối store/API; giữ các bảo đảm hành vi đang có. Ảnh "giống bản mẫu" so với trang tương ứng của bản React (`npm run dev` trong `docs/design/prototypes/react/`). Các mục dưới đây là phần dữ liệu và hành vi phải đúng.

1. Trang `/settings` thay `SettingsModal`:
   - tóm tắt "x / 8 dịch vụ đã thiết lập · y kết nối tốt";
   - hai nhóm "Đã thiết lập" / "Chưa thiết lập" theo `configured`;
   - mỗi hàng: logo SVG, tên, việc làm được (diễn đạt từ `tools`), nhãn trạng thái 4 giá trị (đặc tả mục 6) kèm giờ kiểm tra.
2. Ngăn chi tiết (phải trên desktop, toàn màn hình dưới 640px), 3 phần:
   - **Khoá truy cập:** nhãn ô theo `credentialFields`; "Lấy khoá ở đâu?" lấy nội dung từ `guide` (FE-10) hoặc chuỗi tĩnh cùng nguồn; khoá đã lưu không hiện lại, placeholder "Đã lưu · nhập lại nếu muốn thay";
   - **Nơi ATI được phép dùng:** chip theo `scopeLabel`, kiểm định dạng (GitHub `owner/repo`, Jira site `https://…atlassian.net`), cần ít nhất một mục;
   - **Kiểm tra kết nối:** khoá khi chưa `configured` kèm câu "Lưu khoá và ít nhất một nơi được dùng trước, rồi mới kiểm tra được"; kết quả trong vùng `aria-live`: thành công kèm thời gian phản hồi, bị từ chối, quá 10 giây.
3. Lưu:
   - đổi khoá: gửi đủ khoá như hiện tại;
   - chỉ đổi nơi được dùng: dùng API của UI-API-01, không bắt nhập lại khoá; khi UI-API-01 chưa merge thì giữ cách cũ và hiện ghi chú "Muốn lưu thay đổi, nhập lại đủ các ô khoá";
   - lưu xong nhãn về "Chưa kiểm tra".
4. Thành viên: ô khoá, chip, nút Lưu bị khoá kèm câu "Chỉ quản trị viên thay đổi được khoá dùng chung của nhóm."; nút Kiểm tra vẫn dùng được khi đã thiết lập.
5. `/settings#<service>` mở thẳng ngăn của dịch vụ đó; mã không tồn tại thì không mở gì.
6. Giữ bảo đảm của W3-00b: phản hồi lưu của dịch vụ A không xoá khoá đang nhập dở của dịch vụ B; chỉ xoá trường còn bằng giá trị đã gửi.

## Tiêu chí nghiệm thu

- [ ] Test: dịch vụ chưa thiết lập không kiểm tra được (cả hai vai trò); sau khi lưu nhãn là "Chưa kiểm tra" và hàng chuyển nhóm.
- [ ] Test: thành viên không lưu được, vẫn kiểm tra được dịch vụ đã thiết lập.
- [ ] Test: `#notion` mở đúng ngăn; Esc đóng và trả focus về hàng Notion kể cả khi danh sách vừa vẽ lại.
- [ ] Test W3-00b (giữ draft khi phản hồi lưu đến muộn) chuyển sang trang mới và vẫn xanh.
- [ ] Không còn các chữ "Allowed Scope", "Write Safety", "Least Privilege", "AES" trên giao diện.
- [ ] Browser: quản trị viên lưu và kiểm tra một dịch vụ sandbox; không cuộn ngang ở 375px; chế độ tối giống bản React.
- [ ] **Giống bản mẫu** (đặc tả mục 1, 1.1, 1.2 bản 07/10; chép trang của bản React rồi nối dữ liệu thật): ảnh app và ảnh bản React của `settings.html` (danh sách, ngăn từng dịch vụ, vai trò quản trị viên và thành viên) đặt cạnh nhau ở 1440×900 và 375×812, sáng và tối. Danh sách ảnh và SHA256 ghi trong log; ảnh không commit. Mọi khác biệt còn lại nằm trong đặc tả 1.1 hoặc ghi ở phần "Kết quả" kèm lý do.
- [ ] `npm run check` và `npm run test:browser:v3` exit 0.

## Ngoài phạm vi

Gỡ khoá dịch vụ, lưu tên tài nguyên kèm ID, kiểm tra kết nối bền qua khởi động lại.

## Kết quả

_(agent thi công điền)_

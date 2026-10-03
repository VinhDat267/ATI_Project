# UI-06 · Bố cục công khai và motion editorial Planora

**Trạng thái:** đã triển khai, chờ review · **Nhánh:** `Frontend_UXUI`

## Phạm vi

- Bỏ dòng “Planora · Dự án môn ATI” trong footer dùng chung.
- Đưa section dịch vụ công khai xuống sau Cách hoạt động; giữ anchor và hành vi điều hướng.
- Thêm motion nhẹ cho minh họa SVG giấy đăng nhập dùng chung các trang auth, giữ form và chữ đứng yên; tắt với reduced motion.
- Giữ các thay đổi UI-01→05 chưa commit. Không sửa backend/v2, không thêm thư viện, không commit/push/deploy.

## Nghiệm thu

- Chạy bộ kiểm thử và build frontend hiện có.
- Browser desktop/mobile: đúng thứ tự section, không tràn ngang, minh họa chuyển động bằng transform và reduced-motion có fallback tĩnh.
- Cập nhật DESIGN.md và thêm log bàn giao; không sửa CURRENT-STATE/ROADMAP.

## Kết quả

- Bỏ credit ATI trong PublicFooter dùng chung. PublicServices nằm ngay sau section how, trước CTA; giữ navbar/fragment/CTA thật.
- LoginStory dùng hai wrapper SVG và CSS transform 6s: cụm giấy nổi6px, biểu tượng P nổi thêm3px/nghiêng2°. Form, chữ, bóng và kích thước khung đứng yên. Reduced-motion tắt cả hai animation; không thêm JS, dependency hoặc listener cần cleanup.
- `npm run test -w @wap/chat-web`: 37files/203tests pass, exit0. `npm run build -w @wap/chat-web`: TypeScript/Vite exit0. `git diff --check`: exit0.
- Browser preview5176: desktop1440×900 và mobile390×844/320×740 không tràn ngang; thấy motion đổi transform giữa hai lần lấy mẫu, SVG không bị méo; thứ tự how→services đúng, navbar Dịch vụ và CTA login hoạt động. Reduced-motion được kiểm qua CSS, chưa giả lập setting media của browser.
- DESIGN cập nhật; có log UI-06 mới. Không sửa backend/v2/CURRENT-STATE/ROADMAP, HEAD995f5f7, không commit/push/deploy.

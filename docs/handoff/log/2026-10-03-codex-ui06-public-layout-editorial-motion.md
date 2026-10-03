# UI-06 · Footer, vị trí dịch vụ và motion minh họa auth

Ngày03/10/2026 · nhánh `Frontend_UXUI` · base/HEAD `995f5f7`.
Đã triển khai tại working tree, chờ review; chưa commit/PR/push/deploy.

## Thay đổi

- `apps/chat-web/src/components/PublicFooter.tsx`: bỏ “Planora · Dự án môn ATI”, giữ tagline và đầu trang.
- `apps/chat-web/src/components/LandingPageView.tsx`: chuyển PublicServices xuống sau toàn bộ Cách hoạt động/roadmap, trước CTA; giữ ID services, điều hướng và các motion hiện có.
- `apps/chat-web/src/components/LoginStory.tsx`, `apps/chat-web/src/login.css`: SVG giữ artwork gốc, thêm wrapper giấy và seal; float6px/6s ease-in-out, seal lệch thêm3px/nghiêng2°. Bóng, chữ và form đứng yên; chỉ transform, không thay layout. CSS reduced-motion tắt cả hai. Component dùng chung login/signup/verify. Không thêm dependency/state/frame/timer/listener.
- `apps/chat-web/DESIGN.md`, task UI-06 và log này: đồng bộ trạng thái thiết kế hiện tại.
- Giữ toàn bộ dirty changes UI-01→05 thuộc các lượt trước; không sửa backend/v2/CURRENT-STATE/ROADMAP.

## Kiểm chứng

- `npm run test -w @wap/chat-web`: exit0, 37files/203tests, 23:51:50 ngày03/10.
- `npm run build -w @wap/chat-web`: exit0, TypeScript và Vite; không lỗi.
- `git diff --check`: exit0; HEAD vẫn995f5f7.
- Browser desktop1440×900: SVG hiển thị đúng; mẫu transform stack từ−0.022px đến−5.888px, seal từ−0.011px đến−2.944px kèm nghiêng; nội dung đứng yên. Width1440/scrollWidth1425 (scrollbar), không tràn.
- Mobile390×844: SVG rộng285px nằm trong panel; width390/scrollWidth375. Login320×740: width320/scrollWidth305. Landing320px: section top theo thứ tự ecosystem1496, how1615, services3756, CTA5953; không tràn ngang.
- Navbar Dịch vụ dẫn đến #services; desktop how.bottom=services.top=32 sau cuộn, đúng thứ tự. CTA “Đăng nhập để kết nối” chuyển login&next=services. Footer cả landing/login không còn ATI.
- Reduced-motion: xác nhận media CSS animation:none cho stack/seal; chưa giả lập media setting browser. Không test lại backend vì lượt này chỉ sửa UI. Không đăng nhập/gửi email/provider write trong kiểm tra.

## Preview và ảnh

Giữ preview riêng đang chạy `http://127.0.0.1:5176/`; không dừng server của người dùng. Tab đăng nhập được mở và giữ lại, viewport đã reset.

Ảnh tại `C:/Users/Admin/.codex/visualizations/2026/10/02/01a0faf0-f9b9-7432-89ab-cfec274816e2/ati-implementation/`:

- `planora-editorial-motion-desktop.png`
- `planora-editorial-motion-mobile.png`
- `planora-public-order-desktop.png`

Ảnh PNG thể hiện bố cục; motion cần xem trực tiếp trong preview. Không tuyên bố hoàn thành nền tảng đa dịch vụ hoặc các AUTH task còn mở.

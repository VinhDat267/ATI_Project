# UI-01 · Nổi bật card quy trình và hover · 03/10/2026

## Phạm vi

Chủ dự án muốn ba card01/02/03 nổi bật hơn và nổi lên khi hover. Đọc state/README/ba log mới nhất, git status/log; nhánh Frontend_UXUI ở HEAD995f5f7 sạch trước thay đổi. Tiếp tục UI-01, chỉ landing-story.css và docs riêng; không backend/v2/API ghi/dependency mới/CURRENT-STATE/ROADMAP.

## Kết quả

- Card paper, viền xanh kem, radius18px, số serif34px; active xanh nhạt. Desktop fine pointer hover nhấc6px trong280ms, viền mạnh hơn, bóng mềm và nội dung rõ đầy đủ. Giữ cream/green/editorial, hero/marquee/roadmap/CTA không sửa.
- Rail nằm ngoài card, không hover theo. Heading giữ vùng2.2em, fragment đáy, ba card bằng chiều cao trên desktop. Mobile radius16px/padding nhỏ hơn, gap20px, rail dọc cạnh card; không hover lift. Reduced-motion không kích hoạt lift/transition; không thêm JavaScript, frame loop hay state.
- DESIGN và kết quả UI-01 cập nhật; log mới này là bàn giao.

## Bằng chứng

- npm run build -w @wap/chat-web: exit0, TypeScript/Vite8.3.0,1915 modules,545ms. CSS79.65kB/gzip17.08; main310.83kB/gzip96.99; services7.92kB/gzip2.91.
- npm run test -w @wap/chat-web -- tests/components/landing-page-view.test.tsx tests/components/landing-story.test.tsx tests/components/hero-motion.test.tsx: exit0,3 files/19 tests PASS,17.69s. Không thêm test mirror CSS; kiểm trực quan là bằng chứng chính.
- CUA desktop1440×900: card02 hover thực, computed transform matrix(1,0,0,1,0,-6); trước/sau hover offsetTop20 và offsetHeight302 giữ nguyên. Hai card còn lại transform none. document scrollWidth1425≤innerWidth1440; không thấy layout nhảy (không đo CLS tự động).
- CUA mobile390×844: ba card width312.67, rail1px dài600px theo offset thực bước03; không lift, scrollWidth375≤390. Cuộn tới03: hai bước passed,03 active, progress1/token100%; nội dung đầy đủ và roadmap/CTA vẫn bên dưới. Chỉ viewport QA, không touch thiết bị thật.
- Reduced-motion kiểm qua phạm vi media CSS, không đổi OS hoặc browser media emulation trong lượt này. Logic/cleanup hero/story giữ nguyên và regressions PASS.

Ảnh ngoài repo: C:/Users/Admin/.codex/visualizations/2026/10/02/01a0faf0-f9b9-7432-89ab-cfec274816e2/ati-implementation/workflow-cards-desktop.jpg và workflow-cards-mobile.jpg.

Preview frontend được mở lại tại http://127.0.0.1:5175/?view=landing#how vì server trước đã dừng; không khởi động lại backend. Không kết luận chat/service runtime đang sẵn sàng từ kiểm tra landing này. Thay đổi mới chưa commit/push/deploy, chưa CI/review độc lập; không đóng FE-01/02/03 hoặc roadmap dịch vụ.

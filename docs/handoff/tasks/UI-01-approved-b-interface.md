# UI-01 · Triển khai bộ giao diện B được chủ dự án chọn

**Trạng thái:** đã kiểm chứng cục bộ, chờ review · **Nhánh bàn giao:** `Frontend_UXUI` (phát triển trước đó trên `codex/ati-ui-b`)

## Phạm vi được giao

Chủ dự án chọn bộ preview B ngày 02/10/2026 và yêu cầu triển khai: workspace, dịch vụ, đăng nhập, giới thiệu. Chat, duyệt kế hoạch, tiến trình và kết quả dùng chung workspace.

- Áp dụng nền kem, xanh rêu, serif và font tiếng Việt cục bộ của preview.
- Nối với API hiện có; không dùng dữ liệu mẫu thay dữ liệu thật trong ứng dụng.
- Điều hướng giữa bốn giao diện, trạng thái tải/lỗi/trống, responsive và bàn phím.
- Giữ hợp đồng API/SSE và các ràng buộc recovery; bỏ quick-fill admin và không đóng hộp thoại bằng Stop.
- Không triển khai backend tài khoản/service mới, resourceLabels, pagination hay dịch thuật planner của FE-01/02/03. Không đánh dấu các task đó hoàn tất.
- Không ghi lên dịch vụ thật trong khi kiểm thử; không commit/deploy trong lượt này.

## Nghiệm thu

- Test hành vi mới fail trước khi sửa; frontend test, typecheck, build đạt.
- Browser kiểm tra desktop/mobile bằng dữ liệu sandbox có nhãn, không gọi dịch vụ thật.
- Dịch vụ lấy từ API, lưu và kiểm tra riêng. Đăng ký/Google/quên mật khẩu là roadmap.
- Thanh duyệt rõ; textarea Enter/Shift+Enter, chặn gửi trong lúc xử lý; kết quả có liên kết an toàn và chi tiết thu gọn.
- Ghi bằng chứng và giới hạn vào log mới. Không sửa CURRENT-STATE/ROADMAP.

## Kết quả

- Chủ dự án cho phép tạo nhánh `Frontend_UXUI`, commit và push ngày03/10/2026. PR chưa tạo; không merge hoặc deploy.
- Kiểm tra: 7 test hành vi mới RED trước thay đổi; cuối lượt 25 file / 146 test frontend PASS. `npm run check` PASS (572 Vitest tests toàn v3/evaluations, typecheck, build, launcher và kiểm tra môi trường); sau chỉnh nhỏ giữ hội thoại từ landing, chạy lại frontend 146/146 và build PASS. `git diff --check` PASS. Bundle không có sentinel mật khẩu, `VITE_DEFAULT_ADMIN` hoặc mật khẩu admin cấu hình.
- Browser: desktop 1440×900, mobile 390×844, bốn màn hình. Chat → kế hoạch GitHub/Trello/Slack → duyệt sandbox → 3/3 bước → reload khôi phục kết quả. Menu Escape/trả focus, draft edit và modal cấu hình kiểm chứng; không gọi Save/Test credential thật. Bản chờ duyệt riêng được để lại cho chủ dự án.
- Giao diện chạy tại `http://127.0.0.1:5175` qua sandbox API `127.0.0.1:3005`; DB local chuyên dụng `55533/ati_v3`, tài khoản minh họa riêng. Không thay cấu hình dịch vụ bên ngoài. Phiên cũ 5174 giữ nguyên.
- Tài liệu giao diện thực tế: `apps/chat-web/DESIGN.md`; bằng chứng ảnh/log nằm ngoài repo ở khu visualizations (đường dẫn trong handoff log).
- Giới hạn: FE-01/02/03 chưa đóng; chưa thêm resourceLabels, pagination, dịch planner, auth mới hoặc runtime health. Role lưu do API quyết định. Bộ E2E Playwright cập nhật selector theo UI mới, chưa chạy nguyên suite; browser QA dùng công cụ CUA. Chưa review độc lập/CI/PR/commit/deploy theo yêu cầu lượt này.
- Bổ sung 03/10 theo yêu cầu chủ dự án: motion CSS cho bốn view, card/bước xuất hiện lần lượt, phản hồi nút, modal/drawer, reveal khi cuộn và trạng thái chạy/thành công thực. Hỗ trợ reduced motion, không thêm dependency. Frontend 146/146, typecheck/build và diff-check PASS; CUA kiểm tra desktop/mobile, modal Escape/focus, drawer Escape/focus, composer và snapshot đã lưu. Chi tiết ở log `2026-10-03-codex-ui01-motion.md`.
- Bổ sung hero 3D theo yêu cầu cụ thể: giữ front, float5s/−6px, drag Y không giới hạn/X±12°, mặt sau, threshold/click guard, pan-y, inertia ngắn, reduced-motion và cleanup. TDD6 RED trước triển khai; thêm hai regression RED rồi sửa. Cuối lượt 26 files /155 tests PASS; TypeScript/build PASS, CUA chuột vượt731°, front/back desktop/mobile, scroll/CTA và vị trí giữ sau float. Log `2026-10-03-codex-ui01-hero-3d.md` ghi giới hạn kiểm tra touch thật.
- Tinh chỉnh tiếp theo yêu cầu: thêm bóng mềm hai lớp cho hai mặt hero, giảm chu kỳ float từ5s xuống4s, giữ biên độ−6px. Build PASS; CUA desktop1440×900/mobile390×844 xác nhận CSS thực4s, bóng hiển thị và không tràn ngang. Chỉ CSS và tài liệu; không sửa logic drag. Chi tiết ở log `2026-10-03-codex-ui01-hero-shadow.md`.
- Bổ sung độ dày hero14px desktop/10px mobile, cạnh bo góc màu xanh kem. Giữ mặt trước/float/drag; mặt sau lùi Z, thêm14 lớp trang trí không bắt pointer. Build và11 tests liên quan PASS; CUA góc75°/90°/180° desktop và105° mobile không tràn ngang. Log `2026-10-03-codex-ui01-hero-thickness.md`.
- Đặt góc ban đầu theo ảnh được chọn: desktop X6°/Y−12°, mobile≤760px thẳng0°/0°. Khởi tạo trước first paint; rerender/float resume không reset, kéo tiếp từ góc hiện tại. Hai test mới RED trước sửa;26 files/157 tests và build PASS. CUA reload desktop/mobile xác nhận góc/không overflow. Log `2026-10-03-codex-ui01-hero-initial-pose.md`.
- Làm đẹp khu tích hợp: heading và hàng logo căn giữa, SVG marks chính thức GitHub/Trello/Slack tự host, màu nguyên gốc; mobile ba cột mark trên tên. Build/2 tests landing/diff-check PASS; CUA desktop/mobile ba ảnh tải đúng và không overflow. Log `2026-10-03-codex-ui01-integration-logos.md`.
- Theo yêu cầu bổ sung: logo chạy ngang marquee18s linear infinite, bốn nhóm nối vòng bằng−25%; heading đứng yên, bản sao aria-hidden, reduced-motion chuyển về ba dịch vụ tĩnh. Đã bỏ nút tạm dừng theo steering cuối; chỉ hover tạm dừng. Build/14 tests hero+landing/diff-check PASS; CUA desktop/mobile chạy, không nút và không overflow. Log `2026-10-03-codex-ui01-logo-marquee.md`.
- Đồng bộ assets theo yêu cầu tiếp theo: ServiceLogo dùng chung mark GitHub/Trello/Slack cho card dịch vụ, hero/marquee, kế hoạch và các vị trí Icon dịch vụ hiện có; thêm logo chính thức cho năm chip roadmap, giữ nhãn chưa tích hợp. Card dùng mark32px, bỏ khung trung tính và hover xoay logo; không đổi hành vi API/nút. Frontend26 files/158 tests và TypeScript/Vite build PASS; CUA desktop1440×900/mobile390×844 xác nhận ảnh tải đúng và không tràn ngang, kế hoạch snapshot có ba mark đúng. Nguồn ở public/logos/README.md; chi tiết log `2026-10-03-codex-ui01-service-logo-sync.md`.
- Tinh chỉnh motion landing theo yêu cầu chi tiết: giữ hero/marquee, thêm scroll story với token6px và fragment minh họa, mask serif/độ sâu≤10px desktop, roadmap inline có keyboard/Escape và nhóm planned trung thực, CTA light/magnetic≤3px desktop, press0.985/nav underline. Mobile story dọc, không cursor effects. Observer/rAF/ref, cleanup và reduced-motion fallback tĩnh, không dependency. Frontend27 files/163 tests PASS; TypeScript/build PASS;19 tests liên quan PASS sau cập nhật test sự kiện. CUA desktop/mobile có đủ3 stage, roadmap inline không overflow, CTA phản hồi con trỏ và hero vượt912°; giới hạn reduced-motion OS/touch thật ghi ở log `2026-10-03-codex-ui01-landing-story.md`.
- Trước bàn giao GitHub, chạy `npm run check` exit0:523 tests v3 +66 evaluations =589 Vitest tests, typecheck/API+web và build PASS, launcher1/1 và environment3/3 PASS. `git diff --check` PASS. Chưa review độc lập hoặc CI/merge; không đóng FE-01/02/03.

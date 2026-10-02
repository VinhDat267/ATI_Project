# 2026-10-03 · Codex · UI-01 hàng logo tích hợp

## Phạm vi

Chủ dự án yêu cầu căn giữa “Các dịch vụ đã có tích hợp”, làm đẹp hàng dịch vụ và tìm logo assets GitHub/Trello/Slack thay icon. Đã đọc state/README/ba log mới nhất, git status/log; tiếp tục UI-01 trên `codex/ati-ui-b`, HEAD `c6d6e89`. Các thay đổi chưa commit đều của phiên này, không có thay đổi người khác.

## Thay đổi

- `LandingPageView.tsx`: section có heading/accessible label và list ba dịch vụ. SVG mark32×32, alt rỗng vì tên dịch vụ đã là text ngay bên cạnh. Không tạo button/link/action giả.
- `index.css`: căn giữa hai hàng, spacing36/24/64px desktop; mobile ba cột, mark trên tên, padding28px/gap16px. Giữ nền kem và ranh giới nhẹ, tên dùng typography ATI.
- `public/logos`: ba SVG sao chép nguyên bản từ nguồn chính thức; README ghi nguồn và quyền thương hiệu. Không scripts/external href/event attributes trong SVG. Không đổi màu, không thêm shadow/filter hay sửa hình logo. Tổng artwork4377 bytes, tự host; không thêm dependency.
- DESIGN/task cập nhật; không sửa hero, app services, API/packages/v2/CURRENT-STATE/ROADMAP. Không gọi API ghi, commit/deploy.

## Nguồn

- GitHub: https://brand.github.com/foundations/logo → https://brand.github.com/GitHub_Logos.zip → SVG/GitHub_Invertocat_Black.svg.
- Trello: https://atlassian.design/foundations/logos/ → https://atlassian.design/assets/1f181c2c377d/logos/trello_app.zip → trello/svg/Trello_icon.svg.
- Slack: https://slack.com/media-kit → logo SVG được tham chiếu trong HTML chính thức: https://a.slack-edge.com/9cc0056/marketing/img/nav/logo.svg.

Chỉ dùng mark để nhận diện tích hợp; không tuyên bố endorsement hoặc trạng thái kết nối tài khoản. Roadmap vẫn nằm trong section riêng.

## Kiểm chứng

- `npm run build -w @wap/chat-web`: exit0, TypeScript/Vite PASS;1913 modules; CSS70.34kB/gzip15.36, main304.87kB/gzip95.09.
- `npm run test -w @wap/chat-web -- tests/components/landing-page-view.test.tsx`: exit0,1 file/2 tests PASS; CTA và phân biệt tích hợp/roadmap. Chỉ sửa layout/assets, không thêm test soi CSS hoặc chạy lại full monorepo.
- CUA1440×900/390×844: cả ba SVG complete=true/naturalWidth>0; heading và list căn giữa, mobile xếp ba cột rõ; không tràn ngang. Title center trùng strip center cả hai viewport. Reset viewport sau QA.
- `git diff --check`: PASS. Download network ban đầu bị sandbox chặn; tải lại từ ba nguồn chính thức với quyền được auto-review chấp thuận, không cài/chạy mã từ mạng.

Ảnh ở `C:/Users/Admin/.codex/visualizations/2026/10/02/01a0faf0-f9b9-7432-89ab-cfec274816e2/ati-implementation/`: `integrations-desktop.jpg` (crop toàn section), `integrations-mobile.jpg` (context landing).

Preview: `http://127.0.0.1:5175/?view=landing#ecosystem`. UI-01 vẫn chờ chủ dự án xem/review độc lập.

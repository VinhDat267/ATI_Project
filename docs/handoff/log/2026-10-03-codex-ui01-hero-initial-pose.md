# 2026-10-03 · Codex · UI-01 góc ban đầu hero

## Phạm vi

Chủ dự án gửi ảnh và yêu cầu đặt trạng thái ban đầu như ảnh. Đọc state/README/ba log mới nhất, kiểm tra status/log; tiếp tục cùng UI-01 trên `codex/ati-ui-b`, HEAD `c6d6e89`, không có thay đổi người khác. Không sửa front, CSS, trang khác hoặc task roadmap.

## Thay đổi

- `use-hero-motion.ts`: useLayoutEffect khởi tạo trước paint, desktop X6°/Y−12°, viewport≤760px X0°/Y0°. Kéo và phím tiếp tục từ góc hiện tại. Không setState trên pointermove. Rerender/float resume giữ góc; mount mới/reload đặt lại theo viewport lúc mở. Resize không reset tương tác đang có.
- Test matchMedia phân biệt viewport/reduced-motion; hai test hành vi mới kiểm khởi tạo, drag từ góc khác0, resume/rerender giữ góc, mount mới khôi phục và góc compact. Tài liệu DESIGN/task cập nhật.

## Kiểm chứng

- TDD:2 test mới RED (transform rỗng), sau sửa GREEN.
- `npm run test -w @wap/chat-web`: exit0,26 files/157 tests PASS.
- `npm run build -w @wap/chat-web`: exit0, TypeScript/Vite PASS; CSS70.09kB/gzip15.29; main304.67kB/gzip95.03.
- CUA reload desktop1440×900: computed inline rotateX6/rotateY−12, ảnh gần góc mẫu; bàn phím tăng Y tới3° từ−12°, float running, không overflow. Reload mobile390×844:0°/0°, không overflow. Drag từ góc ban đầu được kiểm qua component PointerEvents; một lần CUA coordinate drag trong lượt này không đổi góc nên không coi là bằng chứng drag native. Không kiểm phần cứng touch thật.
- `git diff --check`: PASS. Reset viewport, reload landing để chủ dự án xem góc mở mặc định. Không gọi API ghi, cài dependency, commit/deploy.

Ảnh: `C:/Users/Admin/.codex/visualizations/2026/10/02/01a0faf0-f9b9-7432-89ab-cfec274816e2/ati-implementation/hero-initial-desktop.jpg`.

Preview: `http://127.0.0.1:5175/?view=landing`. UI-01 vẫn chờ chủ dự án xem/review độc lập.

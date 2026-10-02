# 2026-10-03 · Codex · UI-01 hero 3D tại chỗ

## Yêu cầu và phạm vi

Chủ dự án yêu cầu sửa hero hiện có tại chỗ: float nhẹ, drag xoay Y vô hạn/X±12°, mặt sau, giữ clicks/scroll, threshold, inertia và reduced-motion. Trước khi làm đọc state/README/ba log mới nhất, git status/log và hero/CSS/test hiện có. Nhánh `codex/ati-ui-b`, HEAD `c6d6e89`, chỉ tiếp tục thay đổi UI-01 của chính phiên trước. Không commit/deploy, không sửa module khác hay các phần khác của landing.

## Thay đổi

- `LandingPageView.tsx`: thêm đúng wrappers perspective/float/rotator quanh `.hero-visual`, giữ nguyên nội dung, class style và layout mặt trước; thêm mặt sau tối giản. CTA minh họa bên trong vốn là `span`, không biến thành thao tác ghi. Các CTA thật ngoài hero giữ nguyên handler.
- `hooks/use-hero-motion.ts`: refs + rAF, pointer threshold5px, Y0.35°/px không clamp, X0.15°/px clamp±12°, capture sau threshold, cursor/selection khi drag, chặn click sau drag. Touch dọc được nhường cho browser; `pan-y pinch-zoom`. Float pause đúng phase và resume400ms giữ góc. Inertia cap0.08°/ms, friction85ms, thời gian thực≤240ms; grab mới/reduced-motion hủy. Hidden face inert/aria-hidden, keyboard trái/phải ở wrapper. Cleanup toàn bộ frames/timers/listener.
- `motion.css`: chỉ thay hero entrance cũ thành float5s0→−6→0, thêm CSS 3D/back face; typography/colors/spacing/dimensions của front không đổi. Không thêm dependency. Docs cập nhật DESIGN/task.

## Bằng chứng

- TDD:6/6 test mới RED trước có wrappers/logic. Sau triển khai6 PASS. Thêm hồi quy rời card trước threshold và delayed frame:2 RED, sửa rồi PASS. Tổng9 test mới, gồm click con, suppression,720+°, X clamp, touch hướng, pen cancel, reduced-motion, bounded inertia và unmount cleanup. Test có dispatch PointerEvents qua component thật, không mock boolean để thay logic.
- `npm run test -w @wap/chat-web`: exit0,26 files/155 tests PASS. `npm run build -w @wap/chat-web`: TypeScript/Vite exit0; main304.34kB/gzip94.89, CSS69.70kB/gzip15.17. Không chạy lại monorepo vì chỉ frontend hero.
- CUA desktop1440×900: drag thực bằng chuột tới180.6° hiển thị back đúng chiều; pause ngay sau drag, sau đó running và giữ186.1° (quán tính nhẹ). Kéo tiếp367°→549°→731°, không reset góc hoặc overflow. Drag chéo X−12°; front/wrapper layout giữ551×561px trước/sau, service strip không bị đẩy.
- CUA mobile390×844: front/back render; drag bằng chuột trong viewport mobile tới193.8°; overflow=false. CSS touch-action thực là pan-y pinch-zoom. Cuộn dọc qua card đổi scrollY488→1366; float running và góc193.8° giữ nguyên. CTA “Bắt đầu cùng ATI” còn chuyển tới workspace. Không gọi dịch vụ ngoài, Save/Test hoặc duyệt plan.
- Touch/pen PointerEvents và hướng scroll được kiểm bằng component tests. CUA drag hiện phát chuột; chưa kiểm trên phần cứng cảm ứng thật hoặc browser emulation pointer touch. Reduced-motion JS đã test, CSS disable đã kiểm; chưa đổi cài đặt OS để render lại toàn bộ ở chế độ reduce. Không gọi giả các kiểm tra này là thiết bị thật.

Ảnh: `C:/Users/Admin/.codex/visualizations/2026/10/02/01a0faf0-f9b9-7432-89ab-cfec274816e2/ati-implementation/hero-3d-back-desktop.jpg`, `hero-3d-back-mobile.jpg`, `hero-3d-front-desktop.jpg`. Preview5175/API sandbox3005. Reset viewport sau QA, để landing mặt trước cho chủ dự án kéo thử. Chưa review độc lập/CI/PR; UI-01 vẫn chờ chủ dự án xem.

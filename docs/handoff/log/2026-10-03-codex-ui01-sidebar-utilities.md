# UI-01 · Tiện ích sidebar workspace

Ngày03/10/2026. Chủ dự án yêu cầu sidebar có thêm tính năng hữu ích theo ảnh gửi. Phạm vi apps/chat-web và bàn giao UI-01, không backend/v2/config/provider writes.

## Nhận việc và thay đổi

Đọc CURRENT-STATE/README và ba log mới nhất product-copy/workflow-mini-reveal/workflow-card-hover; kiểm tra git status/log5 trước sửa. Frontend_UXUI HEAD995f5f7; thay đổi local là các lượt UI trước của cùng agent, không có commit mới của agent khác, giữ nguyên checkout và toàn bộ thay đổi trước. Không chuyển nhánh/worktree.

- SidebarHistory: search title/fallback ID đã tải, bỏ dấu + đ, không đổi lựa chọn/draft. Xóa query bằng nút hoặc Escape, focus về input. Empty/loading/error/no-match tách biệt. Dữ liệu cache giữ nếu refresh lỗi; thử lại được, refresh bị khóa khi GET pending.
- Ngày giờ lấy từ API camel/snake/created, sort giảm dần; Hôm nay/Hôm qua/Trước đây và Khác khi thiếu/invalid ngày. Native button có accessible full title + tooltip, icon, timestamp vi-VN24h, active edge/dot. Không đổi loader/race guard/plan hoặc execution hydration.
- Workspace: nav Hội thoại/Dịch vụ phía trên lịch sử, reuse callback hiện có, không reset conversation. Drawer focus query thêm input; search Escape có nội dung không bubble đóng drawer. New-chat/account/logout giữ nguyên. Sidebar.css scope vào sidebar, không thư viện mới, reduced-motion tắt transition row.
- API client hiện không có rename/delete/pin; không thêm controls hứa chức năng chưa tồn tại. Search chỉ trên list đã tải, không chứng nhận phân trang/search server FE-02. Không thêm role/connection status giả hoặc dữ liệu mẫu vào UI.

Files lượt này: src/components/layout/SidebarHistory.tsx, src/views/Workspace.tsx (cùng diff copy lượt trước), src/sidebar.css, src/main.tsx, tests/components/sidebar-history.test.tsx, tests/components/workspace-sidebar.test.tsx, DESIGN.md, task UI-01, log này.

## Kiểm chứng

- Tests trước triển khai exit1:4 failed/3 passed (search/group/refresh/giờ24h chưa có). Sau triển khai sidebar7/7 PASS.
- Full run đầu có một lỗi harness dùng setMessages thay addMessage, đã sửa; một worker lỗi UNKNOWN đọc jsdom trên Windows. Chạy lại đầy đủ với `npm run test -w @wap/chat-web -- --maxWorkers=2`: exit0,30 files/178 tests PASS,12.25s, không unhandled errors. Tests thêm nav callbacks/giữ messages và mobile Escape/focus trap. Đây là test frontend với API fixtures rõ ràng, không bằng chứng database/concurrency/provider.
- `npm run build -w @wap/chat-web`: exit0 TypeScript/Vite8.3.0,1917modules,518ms. CSS85.06kB/gzip18.14; main314.76kB/gzip97.95; service chunk7.70kB/gzip2.82. Diff-check PASS.
- CUA5175 desktop1440×900/mobile390×844: nav Dịch vụ→Hội thoại cập nhật route; search fill/clear focus; mobile Escape xóa query vẫn mở drawer, Escape sau đóng/trả focus. No horizontal overflow (scrollWidth1440/390). Không logout, không gửi message hoặc gọi Save/Test provider.
- Proxy history/me trả502, giữ lỗi thật không chèn history giả để chụp ảnh. Thành công lấy history, grouping, refresh lỗi/khôi phục, mở message/plan được kiểm qua component regression; chưa QA history populated/long list bằng browser hoặc touch thiết bị thật. Backend không restart/config đổi trong lượt này.

Ảnh ngoài repo: C:/Users/Admin/.codex/visualizations/2026/10/02/01a0faf0-f9b9-7432-89ab-cfec274816e2/ati-implementation/sidebar-desktop.jpg và sidebar-mobile.jpg. Giữ workspace preview, reset viewport override.

Chưa commit/push/PR/CI/review độc lập/deploy thay đổi mới; HEAD không đổi. Không sửa CURRENT-STATE/ROADMAP, không đóng FE-01/02/03.

# UI-02 · Điều hướng và vòng đời hội thoại

Ngày03/10/2026. Chủ dự án yêu cầu sửa luồng giới thiệu/đăng nhập/workspace và thêm xóa/lưu trữ có tác dụng thật. Nhánh Frontend_UXUI, HEAD995f5f7dc75d42b2849f623dfd9ab3635020e7d7 giữ nguyên. Thay đổi chưa commit UI-01 thuộc các lượt trước của cùng agent, bảo toàn; không đổi nhánh/worktree. Đọc CURRENT-STATE/README, ba log sidebar-utilities/product-copy/workflow-mini-reveal, team-workflow và spec v3 (DELETE soft delete). Tạo task UI-02, ghi hợp đồng trước code. Không sửa v2/CURRENT-STATE/ROADMAP.

## Thay đổi

- App: root là landing công khai kể cả có session; CTA Mở workspace khi đã đăng nhập. Guest vào workspace/services chuyển login, giữ đích whitelist và c. Brand sidebar về workspace, bỏ Về giới thiệu, Đăng xuất có nhãn; giữ c khi qua dịch vụ, bỏ c khi hội thoại hiện tại được lưu trữ/xóa. Không reset cuộc trò chuyện khác.
- API/DB: migration0003 thêm timestamp visibility và partial index, không đổi workflow status. List active/archived/deleted (50), title từ tối đa60 ký tự user message đầu tiên. Archive/restore POST, delete DELETE204. Owner/JWT guard, deleted get/message/plan/SSE404; archive đọc được nhưng gửi/approve409. Soft delete giữ bằng chứng. Transaction parent FOR UPDATE rồi plans FOR UPDATE chống ẩn kế hoạch chưa xử lý; tạo plan dùng cùng parent lock. Không Stop ngầm. Fallback dev giữ hợp đồng cơ bản.
- Sidebar: ⋯ riêng khỏi nút mở hội thoại; ba tab có keyboard arrows; cache/loading/error/search không lẫn trạng thái; mutation sau API success, chống duplicate. Xóa xác nhận bằng Modal portal ngoài drawer/inert, Escape trả focus và không đóng drawer. Menu tự cuộn vào vùng nhìn trên sidebar thấp. Khôi phục qua menu/banner; composer readonly không giả xử lý, response restore cũ không mở khóa hội thoại mới.
- DESIGN phân biệt chức năng thật/roadmap: chưa pagination/rename/pin, chưa FE-02 đầy đủ, không quảng bá dịch vụ dự kiến là hoạt động.

Files thuộc lượt này: db/v3/0003_conversation_visibility.sql; chat-api conversation-repo/routes/server/execution-service; lifecycle integration mới, recovery-after-restart/startup-reconciliation schema fixtures thêm migration; chat-web App/Brand/ChatContainer/LandingPageView/Workspace/SidebarHistory/sidebar.css/api-client/conversation-loader/store/types; app-navigation/conversation-actions/archived-chat tests mới, history-snapshot-race/app-reconciliation fixtures URL protected, workspace-sidebar expected brand; DESIGN/task/log. Các file UI-01 khác trong git status là thay đổi trước, không đưa thành phạm vi mới.

## Bằng chứng

- RED backend lifecycle trước endpoints:8 failed/exit1; GREEN ban đầu8, mở rộng10 PASS PostgreSQL thật. Schema UUID riêng, migrations0001/2/3;0003 chạy hai lần. Kiểm ownership, giữ rows, readonly, deleted access, pending/approved/executing/partial/reconciliation guard. Race dùng connection thật BEGIN/FOR UPDATE và kiểm pg_stat_activity wait_event_type=Lock, insert pending/COMMIT; archive409. Adapter factory ném lỗi nếu gọi; không provider dispatch. Background proposal sau archive không approve được.
- RED frontend navigation/menu4 cases trước triển khai; GREEN13 focused. Full suite ban đầu lỗi fixtures root vốn vào workspace; sửa thành URL workspace rõ và accessible names chính xác, giữ assertions phục hồi/race. Không đổi nghiệp vụ để làm test xanh.
- `npm run check:local:v3` với DATABASE_URL local v3 chuyên dụng55533 và RUNTIME_MODE=sandbox: exit0. Schemas11, adapters53, planner128, executor25, API153, web183, evaluations66 =619 Vitest tests. Launcher1/env safeguards3 Node tests PASS. Typecheck/build PASS, web1917 modules. Attempt trước lỗi typecheck do exact:true trong Testing Library ByRoleOptions; bỏ option (string name vốn exact), không hạ typecheck.
- QA archive phát hiện busy gây indicator xử lý giả: RED archived-chat rồi readOnly riêng sửa đúng. Review cuối phát hiện response restore cũ mở khóa hội thoại khác: RED app-navigation chứng minh flag false sai, sửa guard restoringId. Sau hai chỉnh cuối: full `npm run test -w @wap/chat-web` exit0,33 files/184 tests,7.86s; `npm run build -w @wap/chat-web` exit0,1917 modules,704ms. CSS87.38kB/gzip18.52; main322.34kB/gzip100.07; services7.70kB/gzip2.81. Backend/packages không sửa sau root check PASS.

## Runtime và browser QA

API3000 cũ vẫn healthy, không restart hoặc chạy executor mới trên cùng dữ liệu. Preview5175 proxy3005 không chạy; không dùng chứng nhận endpoints mới. Migration0003 áp dụng thành công vào public của DB local v3 chuyên dụng; bổ sung cột/index, không đổi dữ liệu người dùng. Preview riêng API3006/web5176 dùng schema `ui_lifecycle_preview_20261003` trên DB local đó, cùng mã thật; không trộn data/execution recovery với public. Setup/credentials fixture ngoài repo; không ghi secrets vào log. Tài khoản Kiểm thử UX và ba hội thoại có nhãn Kiểm thử; không chat/planning/approve/save/test dịch vụ.

CUA desktop1440×900, default1280×720, mobile390×844:

- Guest root→login→workspace; đã có phiên root vẫn landing với Mở workspace hoạt động.
- Mở hội thoại PostgreSQL, archive current→remove recent/reset c; tab Lưu trữ→mở readonly. Reload archived URL giữ banner/readOnly, không processing indicator. Banner restore→editable/messages giữ nguyên/recent trở lại.
- Xóa hội thoại khác: Giữ lại không xóa; confirm→Đã xóa chỉ cho restore; restore→Gần đây. Hội thoại đang mở và c giữ nguyên. Ba fixture cuối đều restored active.
- Mobile drawer mở options/confirmation, Escape đóng dialog giữ drawer, trả focus vào Xóa; đóng drawer trả focus nút mở. No overflow scrollWidth390. Desktop menu sau chỉnh tự scroll để hiện đủ hai thao tác; scrollWidth1280/1440. Services↔workspace giữ c/messages.
- Một wait locator sai câu feedback khôi phục; đọc lại AX thấy thông báo thực “Đã khôi phục hội thoại.” và empty trash, không lặp mutation. HMR remount sidebar reset tab; chọn lại sau đọc AX.

Ảnh ngoài repo: `C:/Users/Admin/.codex/visualizations/2026/10/02/01a0faf0-f9b9-7432-89ab-cfec274816e2/ati-implementation/conversation-menu-desktop.jpg` và `conversation-menu-mobile.jpg`. Tab5176 giữ deliverable, viewport reset. Preview chạy riêng; API3000 cũ cần restart bằng môi trường hiện có để nhận endpoint mới. Chưa QA trên thiết bị touch vật lý, chưa CI/review độc lập/commit/push/PR/deploy. Không tuyên bố hoàn tất nền tảng/FE-02.

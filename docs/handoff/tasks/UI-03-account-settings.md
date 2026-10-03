# UI-03 · Cài đặt tài khoản và quản lý hội thoại

Nhánh Frontend_UXUI, tiếp tục thay đổi local cùng agent. Yêu cầu03/10: bỏ banner sandbox và làm trang Cài đặt tài khoản; đưa Lưu trữ/Đã xóa vào Cài đặt như yêu cầu trước. Không commit/push/deploy, không sửa v2/CURRENT-STATE/ROADMAP.

## Hợp đồng

- Trang protected `?view=settings`, mở từ tài khoản cuối sidebar; giữ c/messages/draft khi đổi view, Back/Forward và guest→login giữ đích settings.
- Tên/email thật từ phiên/getMe hiện có, không form Save/đổi mật khẩu/role hoặc ngày tạo giả khi API chưa hỗ trợ. Đăng xuất trình duyệt này dùng hành vi hiện có; Dịch vụ dùng route hiện có.
- Sections account/archived/deleted, query section được whitelist, giữ lựa chọn khi reload/back. Dùng history component/API filter đã có và actions restore/delete thật; không duplicate backend, không xóa vật lý/provider writes.
- RuntimeNotice sandbox/live không banner; unknown vẫn giữ thông báo môi trường không xác định. Chế độ cấu hình chỉ hiển thị nhẹ trong Cài đặt, không đổi mode thật hoặc claim health verified.
- Styling B editorial, responsive; nội dung/settings lazy-load có fallback/boundary. Tests navigation/session preservation/history/filter/error/restore; desktop/mobile. DESIGN/log mới khi xong.

## Kết quả

Hoàn thành local ngày03/10/2026; chưa review độc lập/CI/PR.

- Gỡ banner sandbox theo yêu cầu; live/sandbox không render RuntimeNotice, unknown giữ cảnh báo. Không đổi runtime mode thật, cơ chế duyệt hoặc quyền dịch vụ.
- Trang protected settings lazy JS/CSS, vào từ nút tài khoản cuối sidebar. Account có tên/email thật chỉ đọc, môi trường cấu hình nhỏ, Quản lý dịch vụ và đăng xuất phiên trình duyệt. Không tạo Save/đổi mật khẩu giả vì auth API chưa hỗ trợ.
- Hai mục Lưu trữ/Đã xóa dùng history/API có sẵn, search/loading/error/retry/restore/delete-confirmation; cập nhật sau success. Section whitelist/persist URL/Back; guest→login giữ đích Settings/section. Sidebar chính vẫn chỉ Gần đây.
- Bản nháp theo hội thoại giữ trong phiên khi đổi view; logout/mất phiên xóa draft. Chọn hội thoại hiện tại từ Cài đặt/Dịch vụ trở về workspace. Restore giữ title đã đọc nếu response không có derived title.
- Files lượt này: App, Workspace, ChatContainer, SidebarHistory, RuntimeNotice, ViewBoundary, sidebar.css; mới AccountSettingsView/settings.css; app-navigation/runtime-notice/account-settings tests; DESIGN/task/log mới. Không sửa backend/schema/dependency/v2 trong lượt này.
- RED2failed/7passed cho banner + navigation/draft; GREEN focused15/15, cuối full34files/191tests PASS exit0 (4.02s), build tsc+Vite PASS exit0 (1919modules). Chunk Settings5.36kB JS/5.18kB CSS, không thêm framework. Diff-check PASS.
- Browser CUA: desktop1440×900/mobile390×844, width đúng viewport/no horizontal overflow, nội dung cuộn được, drawer→settings đóng đúng. Draft giữ khi chuyển Settings→Workspace. API local/PostgreSQL schema kiểm thử hiện có: archive→Settings archived→soft-delete confirmed→Settings deleted→restore bằng ArrowDown/Enter; fixture trở về Gần đây. Quản lý dịch vụ/Back hoạt động; không provider writes/không permanent delete. Không kiểm thiết bị touch vật lý hoặc giả lập OS reduced-motion; CSS có reduced-motion và cleanup popstate/listeners kế thừa.
- Preview5176 settings dùng tài khoản/dữ liệu Kiểm thử local; không restart API cũ. Ảnh `account-settings-desktop.png`, `account-settings-mobile.png`, `settings-archived-desktop.png` ngoài repo tại thư mục ati-implementation. HEAD vẫn995f5f7/Frontend_UXUI; không commit/push/deploy, không cập nhật CURRENT-STATE/ROADMAP.

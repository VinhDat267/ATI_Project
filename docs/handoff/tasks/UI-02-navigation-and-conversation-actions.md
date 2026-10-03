# UI-02 · Điều hướng công khai và quản lý hội thoại

**Trạng thái:** đang triển khai · **Nhánh:** Frontend_UXUI (tiếp tục checkout được chủ dự án chọn, giữ thay đổi UI-01 chưa commit).

## Yêu cầu ngày03/10/2026

Chủ dự án nhận thấy giới thiệu/đăng nhập/workspace chưa logic và yêu cầu option xóa/lưu trữ hội thoại. Phạm vi gồm frontend v3 và API/DB tối thiểu để các thao tác được lưu thật; không sửa v2, không gọi dịch vụ thật, không commit/deploy lượt này.

## Hợp đồng trước triển khai

- Landing là trang công khai tại root; đăng nhập dẫn vào workspace. Khi đã có phiên, landing hiển thị Mở workspace. Sidebar không có Về giới thiệu; brand dẫn về workspace. URL protected khi chưa đăng nhập chuyển sang login và giữ đích hợp lệ để quay lại sau đăng nhập.
- `GET /api/conversations?filter=active|archived|deleted`, mặc định active, giới hạn hiện có50 mỗi danh sách. Timestamp `archived_at`/`deleted_at` riêng với execution status.
- `POST /api/conversations/:id/archive` → `{conversation}`; `DELETE /api/conversations/:id` →204 (soft delete theo spec v3); `POST /api/conversations/:id/restore` → `{conversation}` về active.
- Chỉ owner, xác thực JWT như endpoint hiện tại; deleted không mở được qua message/plan/SSE/get. Archive vẫn đọc được, gửi/duyệt phải khôi phục. Không ẩn hội thoại có kế hoạch chưa kết thúc (409, trừ pending đã hết hạn); không xóa plan/message/output hoặc gọi Stop ngầm.
- Menu riêng từng dòng, xác nhận trước xóa, danh sách Lưu trữ/Đã xóa và Khôi phục. UI chỉ cập nhật sau API success; lỗi giữ dòng, chống bấm trùng; thao tác hội thoại khác không reset hội thoại hiện tại.

## Nghiệm thu

- TDD route/menu và PostgreSQL thật trong schema riêng: ownership, archive/restore/delete, giữ bằng chứng, migration idempotent, unfinished-plan guard.
- Frontend/API regressions, typecheck/build, desktop/mobile và no overflow. Ghi bằng chứng/giới hạn vào log mới. Chưa đóng FE-02 tổng thể (pagination/title rename/refactor lớn ngoài phạm vi).

## Kết quả

**Yêu cầu dropdown tiếp theo03/10:** thay menu mở rộng trong dòng bằng dropdown nổi cạnh nút ⋯, không đẩy lịch sử; giữ xác nhận và API, hỗ trợ mép viewport/desktop/mobile/Escape/bàn phím. Không thay chức năng Cài đặt đang để sau.

Đã triển khai dropdown paper/native popover, spacing/icon/separator/motion nhẹ; no-layout-shift và đầy đủ trong viewport desktop/mobile. Keyboard/outside-dismiss RED→GREEN; full frontend185 tests/33 files và build exit0. Bàn giao: `../log/2026-10-03-codex-ui02-floating-dropdown.md`. Chưa commit/push/deploy.

**Điều chỉnh theo yêu cầu tiếp theo03/10:** workspace chỉ hiện Gần đây, bỏ bộ ba tab. Danh sách Lưu trữ/Đã xóa dành cho màn Cài đặt ở lượt sau; chưa thêm entry Cài đặt không hoạt động. Giữ API/bằng chứng và thao tác Lưu trữ/Xóa trong menu ⋯.

Đã thực hiện điều chỉnh: SidebarHistory dùng filter do view truyền (workspace mặc định active), region Gần đây thay tabpanel, gỡ CSS tab. Xác nhận xóa không dẫn tới mục chưa có. Full web184 tests/33 files PASS; cuối cùng9 focused PASS và build PASS. Desktop/mobile không tab hoặc overflow. Log tiếp theo: `../log/2026-10-03-codex-ui02-recent-only-sidebar.md`.

Bằng chứng lượt triển khai trước điều chỉnh trên (local, chưa review độc lập/CI; chưa commit/push/PR/deploy):

- Landing công khai, auth redirect giữ đích; sidebar không còn Về giới thiệu, brand về workspace và Đăng xuất có nhãn rõ.
- Menu ⋯ và Gần đây/Lưu trữ/Đã xóa nối API thật, xác nhận xóa, khôi phục. Archive readonly cả UI/API; soft delete giữ message/plan/output. Owner404, unfinished409, SQL parent lock kiểm qua PostgreSQL thật. Title list lấy từ tin nhắn đầu tiên; chưa rename/pagination.
- Migration0003 đã áp dụng vào DB local v3 chuyên dụng. API3000 cũ không restart. Preview5176/API3006 dùng schema riêng `ui_lifecycle_preview_20261003`, fixture có tiền tố Kiểm thử, không chèn sample vào public hoặc provider writes. API cũ cần restart để nhận endpoints mới ở phiên chính.
- `npm run check:local:v3`: exit0,619 Vitest tests và4 Node tests, typecheck/build pass. Sau hai tinh chỉnh cuối (menu vào vùng nhìn, guard phản hồi restore cũ), full chat-web184 tests/33 files exit0, build exit0. Backend153 tests/22 files gồm10 lifecycle integration PostgreSQL thật.
- Browser desktop1440×900/1280×720, mobile390×844: login/CTA, archive readonly/reload/restore, xác nhận/hủy/xóa/restore, giữ current khi thao tác dòng khác, nav services↔workspace, modal Escape/focus mobile, no overflow. Chưa kiểm thiết bị touch vật lý hoặc CI. Bằng chứng: `../log/2026-10-03-codex-ui02-navigation-and-history-actions.md`.

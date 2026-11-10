# TRELLO-REM-C — Khắc phục che giấu lỗi 503 Trello (`TRELLO-AUDIT-18`), bổ sung 4 kịch bản trình duyệt vào CI (`TRELLO-AUDIT-13`) và đồng bộ trạng thái gửi chưa xác định (`TRELLO-AUDIT-10`)

- **Ngày:** 10/11/2026 (Asia/Saigon)
- **Nhánh:** `VinhDat267/fix-trello-ux-ci-v3` (base `2eed8d1d4309e833088d6f1d3fa774189049e283`)
- **Task card:** [`docs/handoff/tasks/TRELLO-REM-C-ux-and-ci-browser.md`](../tasks/TRELLO-REM-C-ux-and-ci-browser.md)
- **Bằng chứng ngoài Git:** `D:/ATI-Audits/trello-remediation-20261110/owner-c/`

## 1. Tóm tắt thay đổi

1. **`TRELLO-AUDIT-18` (worker ID `PROD-04`) — `apps/chat-web/src/pages/Settings/TrelloConnection.tsx`:**
   - Khắc phục lỗi nuốt ngoại lệ HTTP `503`/mạng tại 3 điểm gọi `getTrelloConnection()`, `getTrelloWorkspaces()` và `getTrelloBoards()`.
   - Phân biệt rõ trạng thái đang kiểm tra (`"Đang kiểm tra…"`), gián đoạn tạm thời (`"Tạm thời gián đoạn"` kèm `role="alert"` và nút `"Thử lại"` vô hiệu hóa khi đang tải, không tự lặp retry ngầm), chưa kết nối (`"Chưa kết nối"`), cần kết nối lại (`"Cần kết nối lại"`) và danh sách bảng rỗng thực sự (`200 OK` với `boards: []` hiển thị `"Không có bảng nào trong workspace này."`).
   - Khi làm mới thất bại trong cùng tài khoản và cùng workspace (`getActiveWorkspaceId()`), giữ lại thông tin định danh/bảng gần nhất kèm nhãn `"Dữ liệu tạm cũ"` (`data-testid="trello-stale-indicator"`); xóa sạch ngay lập tức khi chuyển workspace hoặc chuyển tài khoản để ngăn rò rỉ định danh cũ chéo không gian làm việc.
2. **`TRELLO-AUDIT-13` (worker ID `AUTO-09`) — `scripts/test-v3-browser.mjs` & `apps/chat-web/tests/browser-scenario-selection.test.ts`:**
   - Cập nhật danh sách `scenarios` mặc định trong `scripts/test-v3-browser.mjs` để bao phủ đầy đủ 4 kịch bản trình duyệt từng bị bỏ sót (`TRELLO:`, `TRELLO-E2E:`, `TELEGRAM-E2E-1:`, `TELEGRAM-E2E-2:`) đồng thời bảo toàn nguyên vẹn 22 nhóm kịch bản trước đó.
   - Bổ sung bảng phân loại tường minh `OMITTED_SCENARIO_ROUTING` tách bạch `mocked_browser_routes` (`TRELLO:`, `TELEGRAM-E2E-1:` dùng `page.route`) với `real_backend_sandbox` (`TRELLO-E2E:`, `TELEGRAM-E2E-2:` chạy qua backend sandbox + PostgreSQL cô lập), tuyệt đối không gắn nhãn native E2E cho kịch bản mock route.
3. **`TRELLO-AUDIT-10` (worker ID `AUTO-06`) — `apps/chat-web/src/pages/Cockpit/ScheduleRunRecovery.tsx`:**
   - Giữ trạng thái hiển thị trung thực khi lượt chạy `trello_digest` ở `needs_attention` (không hiển thị nút `"Lập lại kế hoạch"` và không suy diễn thao tác từ cấu hình hiện tại), đồng thời hỗ trợ mã lỗi hợp đồng `TRELLO_DELIVERY_UNKNOWN` khi có `deliveryStartedAt`.

## 2. Bằng chứng kiểm thử thực tế (RED → GREEN)

- **`TRELLO-AUDIT-18` (RED → GREEN):**
  - RED: `trello-audit-18-red.log` (`EXIT_CODE=1`, `DURATION_MS=8576`, 5 bài test mới bắt đúng lỗi trên baseline).
  - GREEN: `trello-audit-18-green.log` (`EXIT_CODE=0`, `DURATION_MS=29671`, `69/69` tests PASS trên `trello-connection.test.tsx`, `trello-ui-ux.test.tsx`, `fe-07-settings.test.tsx`, `components/settings-page.test.tsx`).
- **`TRELLO-AUDIT-13` (RED → GREEN):**
  - RED: `trello-audit-13-red.log` (`EXIT_CODE=1`, `DURATION_MS=2265`, 3 bài test bắt đúng 4 kịch bản bị bỏ sót trên baseline).
  - GREEN: `trello-audit-13-green.log` (`EXIT_CODE=0`, `DURATION_MS=2244`, `3/3` tests PASS).
- **`TRELLO-AUDIT-10` (RED → GREEN):**
  - RED: `trello-audit-10-red.log` (`EXIT_CODE=1`, `DURATION_MS=4777`).
  - GREEN: `trello-audit-10-green.log` (`EXIT_CODE=0`, `DURATION_MS=4631`, `4/4` tests PASS).
- **Typecheck (`@wap/chat-web`):** `node node_modules/typescript/bin/tsc -p apps/chat-web/tsconfig.json --noEmit` → **PASS (`EXIT_CODE=0`)**.
- **Full Unit/Component Suite (`@wap/chat-web`):** `116/116` test files PASS (`1.213/1.213` tests PASS, `EXIT_CODE=0`, `DURATION_MS=83852`).
- **Build & Security Sentinel Check:** `node scripts/test-v3-web-build-security.mjs` → **PASS (`EXIT_CODE=0`, `DURATION_MS=1501`)**.
- **Playwright Loopback Browser Harness & `design-taste-v21-app-editorial` (`inspect.mjs --app`):** `8/8` assertions PASS (`EXIT_CODE=0`, `DURATION_MS=40417`), 0 kết nối ngoại mạng, không tràn ngang ở mobile `390x844`.

## 3. Ranh giới

- Chỉ chạm vào các tệp thuộc quyền sở hữu của Owner C (`apps/chat-web/**`, `scripts/test-v3-browser.mjs`, task card và log bàn giao này).
- Không sửa `apps/chat-api/**`, `packages/**`, `package.json` gốc, `docs/handoff/CURRENT-STATE.md` hay `docs/handoff/ROADMAP.md`.

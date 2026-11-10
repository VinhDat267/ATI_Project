# TRELLO-REM-C · Khắc phục lỗi che giấu gián đoạn kết nối Trello (`TRELLO-AUDIT-18`), bổ sung kịch bản trình duyệt bị bỏ sót vào CI (`TRELLO-AUDIT-13`) và đồng bộ trạng thái đối soát chưa rõ (`TRELLO-AUDIT-10`)

**Trạng thái:** xong trên nhánh công tác · **Nhánh:** `VinhDat267/fix-trello-ux-ci-v3` · **Base:** `2eed8d1d4309e833088d6f1d3fa774189049e283` · **Phụ thuộc:** Phối hợp hợp đồng API với Owner B (`TRELLO-AUDIT-10`)

## Vấn đề

1. **`TRELLO-AUDIT-18` (worker ID `PROD-04` — Mức P1):** Trong `apps/chat-web/src/pages/Settings/TrelloConnection.tsx`, khối `catch` của `fetchStatus()` (`dòng 80–84`), `loadWorkspaces()` (`dòng 104–113`) và `loadBoards()` (`dòng 133–136`) nuốt mọi lỗi mạng và HTTP `5xx`/`503`:
   - Lỗi `GET /api/connections/trello` bị ép thành `{ status: 'not_connected', boards: [] }`, hiển thị nhãn `"Chưa kết nối"` và nút `"Kết nối Trello"` mà không có `role="alert"`.
   - Lỗi `GET /api/connections/trello/workspaces` hoặc `GET /api/connections/trello/workspaces/:id/boards` bị ép thành mảng rỗng `[]`, hiển thị thông báo sai lệch `"Không có bảng nào trong workspace này."` mà không có `role="alert"` hay nút thử lại.
2. **`TRELLO-AUDIT-13` (worker ID `AUTO-09` — Mức P1):** `.github/workflows/v3-check.yml:41` gọi `npm run test:browser:v3` (`scripts/test-v3-browser.mjs`), nhưng danh sách `scenarios` mặc định (`dòng 16–39`) bỏ sót hoàn toàn 4 kịch bản trình duyệt trong `trello-oauth.spec.ts` (`TRELLO:`, `TRELLO-E2E:`) và `telegram-oauth-and-digest.spec.ts` (`TELEGRAM-E2E-1:`, `TELEGRAM-E2E-2:`).
3. **`TRELLO-AUDIT-10` (worker ID `AUTO-06` — Phối hợp UI):** Khi lượt chạy `trello_digest` rơi vào trạng thái không rõ kết quả gửi (`needs_attention`), giao diện phải hiển thị trung thực trạng thái chưa xác định, không tự suy diễn thao tác từ cấu hình hiện tại, không hiển thị nút `"Lập lại kế hoạch"` gây gửi trùng, và hỗ trợ mã `TRELLO_DELIVERY_UNKNOWN` khi hợp đồng API cung cấp `deliveryStartedAt`.

## Việc cần làm

1. **`apps/chat-web/src/pages/Settings/TrelloConnection.tsx` (`TRELLO-AUDIT-18`):**
   - Tách biệt rõ các trạng thái `loading` (`"Đang kiểm tra…"`), `error` (`"Tạm thời gián đoạn"` + `role="alert"` + nút `"Thử lại"`), `not_connected`, `reconnect_required`, `needs_scope`, `needs_membership`, `connected` và trạng thái danh sách bảng rỗng thực sự (`200 OK` với `boards: []`).
   - Giữ thông tin định danh/bảng gần nhất kèm nhãn `"Dữ liệu tạm cũ"` (`data-testid="trello-stale-indicator"`) chỉ khi làm mới thất bại trong cùng tài khoản và cùng workspace; xóa ngay lập tức khi chuyển workspace hoặc chuyển tài khoản.
   - Không tự động lặp retry ngầm khi gặp lỗi `503`.
2. **`scripts/test-v3-browser.mjs` & `apps/chat-web/tests/browser-scenario-selection.test.ts` (`TRELLO-AUDIT-13`):**
   - Bổ sung 4 kịch bản bị bỏ sót vào danh sách `scenarios` mặc định, phân tách tường minh `mocked_browser_routes` (`TRELLO:`, `TELEGRAM-E2E-1:`) với `real_backend_sandbox` (`TRELLO-E2E:`, `TELEGRAM-E2E-2:`), bật `SCHEDULES_ENABLED=on` và giữ nguyên toàn bộ 22 nhóm kịch bản hiện có.
3. **`apps/chat-web/src/pages/Cockpit/ScheduleRunRecovery.tsx` (`TRELLO-AUDIT-10`):**
   - Giữ hiển thị trung thực cho lượt chạy `trello_digest` ở trạng thái `needs_attention` (không có nút `"Lập lại kế hoạch"`), đồng thời hỗ trợ `TRELLO_DELIVERY_UNKNOWN` khi hợp đồng API trả về `deliveryStartedAt`.

## Tiêu chí nghiệm thu

- [x] Bài kiểm thử RED → GREEN cho `TRELLO-AUDIT-18` (`apps/chat-web/tests/trello-connection.test.tsx`), `TRELLO-AUDIT-13` (`apps/chat-web/tests/browser-scenario-selection.test.ts`) và `TRELLO-AUDIT-10` (`apps/chat-web/tests/schedule-trello-digest-mode.test.tsx`).
- [x] Kiểm thử trình duyệt thật (Playwright Chromium + loopback server, 0 kết nối ngoại mạng) và kiểm định thị giác `inspect.mjs --app` (`design-taste-v21-app-editorial`).
- [x] `tsc -p apps/chat-web/tsconfig.json --noEmit`, toàn bộ unit/component test `@wap/chat-web` (`116/116` file, `1.213` test) và `node scripts/test-v3-web-build-security.mjs` đều đạt `exit code 0`.

## Kết quả (agent thi công điền)

- **Nhánh:** `VinhDat267/fix-trello-ux-ci-v3`, base `2eed8d1d4309e833088d6f1d3fa774189049e283`. [Log](../log/2026-11-10-trello-rem-c-ux-and-ci.md).
- **Tệp đã sửa / thêm mới (thuộc quyền sở hữu Owner C):**
  - `apps/chat-web/src/pages/Settings/TrelloConnection.tsx`
  - `apps/chat-web/src/pages/Cockpit/ScheduleRunRecovery.tsx`
  - `apps/chat-web/tests/trello-connection.test.tsx`
  - `apps/chat-web/tests/browser-scenario-selection.test.ts`
  - `apps/chat-web/tests/schedule-trello-digest-mode.test.tsx`
  - `apps/chat-web/tests/browser/trello-oauth.spec.ts`
  - `scripts/test-v3-browser.mjs`
- **Bằng chứng kiểm thử (`D:/ATI-Audits/trello-remediation-20261110/owner-c/`):**
  - `trello-audit-18-red.log` (`EXIT_CODE=1`, `DURATION_MS=8576`) → `trello-audit-18-green.log` (`EXIT_CODE=0`, `DURATION_MS=29671`, `69/69` tests PASS).
  - `trello-audit-13-red.log` (`EXIT_CODE=1`, `DURATION_MS=2265`) → `trello-audit-13-green.log` (`EXIT_CODE=0`, `DURATION_MS=2244`, `3/3` tests PASS).
  - `trello-audit-10-red.log` (`EXIT_CODE=1`, `DURATION_MS=4777`) → `trello-audit-10-green.log` (`EXIT_CODE=0`, `DURATION_MS=4631`, `4/4` tests PASS).
  - `typecheck-chat-web.log` (`EXIT_CODE=0`).
  - `vitest-full-chat-web.log` (`EXIT_CODE=0`, `DURATION_MS=83852`, `116/116` test files PASS, `1.213/1.213` tests PASS).
  - `web-build-security.log` (`EXIT_CODE=0`, `DURATION_MS=1501`).
  - `browser-verification-report.json` & `browser-verification.log` (`EXIT_CODE=0`, `DURATION_MS=40417`, `8/8` assertions PASS, 7 ảnh chụp màn hình desktop/mobile + `design-taste-inspect`).

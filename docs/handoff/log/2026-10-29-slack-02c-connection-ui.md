# 29/10/2026 · SLACK-02C — Giao diện Cài đặt Đa Workspace & Callback View (Frontend)

**Tác giả:** Frontend Owner (Antigravity gemini-3.8-flash-high).
**Ủy quyền:** Điều phối viên trưởng chỉ định qua Orca task `task_9d8aaedeb7d0`, dispatch `ctx_d2905204c973`.
**Nhánh công việc:** `VinhDat267/slack-02c-personal-connection` (base: `integration/slack-personal-20261029` `b757ae08`).
**Task card:** [`docs/handoff/tasks/SLACK-02C-connection-ui.md`](../tasks/SLACK-02C-connection-ui.md).
**Phụ thuộc song song:** SLACK-02A (contracts tại `@wap/tool-schemas`), SLACK-02B (consent & readiness backend của PR 192).

---

## 1. Mục tiêu & Phạm vi Thay đổi

Hoàn thiện giao diện người dùng trên web (`apps/chat-web`) cho tính năng kết nối Slack cá nhân đa workspace, kế thừa trực tiếp mã nền từ PR 184 thay vì tạo thêm các biến thể MySlack trùng lặp:
1. **`apps/chat-web/src/pages/Settings/PersonalSlack.tsx`:**
   - Liệt kê 0, 1 hoặc nhiều workspace; hiển thị song song Tên Workspace, Workspace ID và Định danh Slack (`slackUserLabel` / `slackUserId`) để các workspace trùng tên luôn tách biệt rõ ràng.
   - Hiển thị badge trạng thái chuẩn hóa:
     - `Cần kết nối lại` (đỏ) khi `status === 'reconnect_required'` kèm nút "Kết nối lại".
     - `Chờ cho phép xử lý dữ liệu` (vàng hổ phách) khi `status === 'active' && !processingReady`.
     - `Đã sẵn sàng xử lý` (xanh lá) khi `processingReady === true`.
     - `Đã thu hồi` (xám) khi `status === 'revoked'`.
   - Cảnh báo quyền thiếu `missingScopes` nếu có.
   - Thao tác ngắt kết nối tích hợp modal xác nhận `CockpitDialog`: chỉ gửi DELETE khi người dùng xác nhận; hủy bỏ không gửi request; chống click đúp khi đang xử lý; cập nhật chính xác thông báo thu hồi quyền vs chưa xác nhận thu hồi ở Slack.
   - Hỗ trợ đầy đủ layout responsive 375px (Mobile) / 1440px (Desktop) và theme Sáng / Tối không vỡ layout.
2. **`apps/chat-web/src/views/SlackCallbackView.tsx`:**
   - Đảm bảo tính đơn nhiệm (single-use) trong React StrictMode.
   - Làm sạch query parameters chứa `code` và `state` khỏi URL trình duyệt bằng `window.history.replaceState` trước khi gửi request mạng.
   - Điều hướng an toàn tới hội thoại gốc nếu có `returnTo` hợp lệ dạng `/c/<uuid>` (`conversationReturnPath`); nếu không có hoặc không hợp lệ, fallback về `/settings#myslack`.
   - Không retry lời gọi OAuth sau lỗi 401 hoặc timeout; hiển thị thông báo lỗi thân thiện (`SLACK_DENIED`, `SLACK_IDENTITY_CONFLICT`, `SLACK_STATE_INVALID`, v.v.); dừng pending khi đổi session/owner.
3. **`apps/chat-web/src/services/slack-connection.ts`:**
   - Khai báo DTO canonical 02A (`SlackConnectionPublicInfo`, `SlackCallbackResult`, v.v.).
   - Chuẩn hóa dữ liệu biên giới (`normalizeSlackConnection`): `actorId` cung cấp fallback cho `slackUserId` và `slackUserLabel` khi thiếu; thiếu consent/readiness mặc định là `pending` và `false`; bảo lưu `missingScopes` được kiểm tra tường minh; chặn tuyệt đối việc suy đoán readiness chỉ từ `active` + `granted` khi chưa có xác nhận `processingReady === true` từ server.
   - `slackConnectionApi.start` hỗ trợ truyền `{ returnTo?, workspaceHint? }`.
   - `openSlackAuthorization` kiểm tra URL an toàn (hỗ trợ sandbox loopback trong fixture).
4. **Kiểm thử (`apps/chat-web/tests/`):**
   - `slack-oauth.test.tsx`: 11 test cases HTTP component kiểm thử toàn diện TDD.
   - `browser/slack-oauth.spec.ts`: Cập nhật kịch bản Playwright để tương tác với modal xác nhận ngắt kết nối mới.

---

## 2. Bằng chứng Kiểm thử (Evidence)

| Mục kiểm tra | Kết quả thực tế | Chi tiết |
|---|---|---|
| **Component Unit Tests** (`tests/slack-oauth.test.tsx`) | **11/11 tests PASS** (1.27s) | StrictMode single-use, scrub secrets, returnTo hợp lệ vs malformed fallback, không replay sau 401, owner switch stale response, legacy/canonical normalization, wrong readiness, duplicate workspace names, CockpitDialog confirmation/cancel, reconnect action |
| **Toàn bộ Web Tests** (`npm test -w apps/chat-web`) | **80 files PASS, 894 tests PASS, 0 fail** (45.2s) | Không có hồi quy trên toàn bộ test suite của `apps/chat-web` |
| **Full Typecheck** (`npm run typecheck:v3`) | **EXIT 0** | Sạch hoàn toàn TypeScript cho cả `apps/chat-api` và `apps/chat-web` |
| **Web Build** (`npm run build:v3`) | **EXIT 0** | Vite build thành công bundle production |
| **Web Build Security** (`scripts/test-v3-web-build-security.mjs`) | **PASS** | Loại trừ credential sentinels và 7 forbidden UI claims |
| **E2E Playwright Browser** (`scripts/test-v3-browser.mjs`) | **4/4 tests PASS** (55.3s) | Chạy kịch bản `slack_oauth` trên 375px light, 375px dark, 1440px light, 1440px dark với fixture sandbox cục bộ và modal xác nhận |

*Raw command outputs được lưu tại thư mục bỏ qua `.superpowers/slack02c/`.*

---

## 3. Ranh Giới Nghiệm Thu & Hạn Chế Hiện Tại

- **Môi trường cục bộ:** Kịch bản browser E2E đã chạy và PASS trên fixture sandbox cục bộ và nền API legacy 184 với siêu dữ liệu pending.
- **Nghiệm thu liên dịch vụ (Joint Acceptance):** Việc kiểm thử tích hợp đầy đủ luồng `returnTo` phía server và chính sách readiness canonical hoàn chỉnh với Backend 02B được ghi nhận là **PENDING** cho đến khi Backend 02B (PR 192) được gộp vào nhánh tích hợp.

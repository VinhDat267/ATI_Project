# SLACK-02C · Giao diện Cài đặt Đa Workspace & Callback View (Frontend)

**Trạng thái:** đã hoàn thành thi công, sẵn sàng review  
**Nhánh:** `VinhDat267/slack-02c-personal-connection` · **Nền:** `b757ae08` (`integration/slack-personal-20261029`)  
**Vai trò sở hữu:** Frontend Engineer (sở hữu `apps/chat-web/`, task card `docs/handoff/tasks/SLACK-02C-connection-ui.md`, một file handoff log mới `docs/handoff/log/2026-10-29-slack-02c-connection-ui.md`)  
**Phụ thuộc song song:** SLACK-02A (contracts tại `@ati/tool-schemas`), SLACK-02B (consent & readiness backend của `ctx_ef5aff92da54`, PR 191)  
**Task cha:** [SLACK-02-personal-connections](SLACK-02-personal-connections.md)  

---

## 1. Mục tiêu và Ranh giới Kỹ thuật

Thi công hoàn thiện giao diện người dùng trên web (`apps/chat-web`) cho kết nối Slack cá nhân đa workspace, kế thừa và mở rộng mã nền đã duyệt từ PR 184 thay vì tạo các biến thể trùng lặp:
- **Kế thừa các file hiện hữu từ PR 184:**
  - `apps/chat-web/src/pages/Settings/PersonalSlack.tsx` (mở rộng hiển thị đa workspace, badge readiness chuẩn, modal xác nhận ngắt kết nối `CockpitDialog`, hành động kết nối lại / kết nối thêm).
  - `apps/chat-web/src/views/SlackCallbackView.tsx` (mở rộng single-use qua StrictMode, làm sạch `code`/`state` khỏi URL trước khi gửi mạng, hỗ trợ điều hướng an toàn qua `returnTo` `/c/<uuid>` hoặc fallback `/settings#myslack`, hiển thị workspace thật đã xác thực).
  - `apps/chat-web/src/services/slack-connection.ts` (chuẩn hóa dữ liệu biên giới DTO 02A + tương thích an toàn legacy, hỗ trợ start mang `returnTo` và `workspaceHint`).
  - `apps/chat-web/tests/slack-oauth.test.tsx` (bổ sung các test component HTTP cho canonical/legacy metadata, wrong readiness, duplicate names, confirmation/cancel, owner-switch stale response, malformed callback, no replay).
  - `apps/chat-web/tests/browser/slack-oauth.spec.ts` (cập nhật bước xác nhận modal ngắt kết nối theo đúng hành vi mới).
- **Ranh giới:**
  - Chỉ sửa đổi trong `apps/chat-web/`, card SLACK-02C và một file handoff log mới.
  - Không sửa API, DB, migration, schema, planner, adapters hay root package.
  - Không gọi native Slack live, không bật cờ production, không tự ý merge vào main.

---

## 2. Hợp đồng & Chuẩn Hóa Biên Giới Dữ Liệu

Theo hợp đồng thống nhất từ nhóm trưởng (msg_6bc9a55fae15):
1. **Start Connection:**
   - Endpoint: `POST /api/connections/myslack/start`
   - Tham số tùy chọn: `{ returnTo?: string; workspaceHint?: string }`.
   - Kiểm tra quyền sở hữu hội thoại thực hiện phía server; `workspaceHint` chỉ là gợi ý Slack team, frontend tuyệt đối không coi hint là định danh đã xác thực.
2. **Callback Connection:**
   - Endpoint: `POST /api/connections/myslack/callback`
   - Nhận: `{ code?: string; state: string; error?: string }`.
   - Trả về canonical flat: `{ connectionId, workspaceId, workspaceName, slackUserId, returnTo? }` kèm các alias legacy an toàn trong giai đoạn chuyển đổi (`actorId`, `processingStatus`).
   - Callback làm sạch query params khỏi URL trước khi gửi mạng; StrictMode chỉ gửi đúng 1 request; không retry sau lỗi 401 hoặc timeout; hủy trạng thái pending nếu đổi session/owner.
   - Điều hướng chỉ chấp nhận cùng app dạng `/c/<uuid>` (`conversationReturnPath`); nếu không có hoặc không hợp lệ, fallback về `/settings#myslack`.
3. **Danh sách Kết nối & Chuẩn Hóa Siêu Dữ Liệu:**
   - Sử dụng DTO chuẩn 02A (`@ati/tool-schemas` `validateSlackConnectionPublicInfo`).
   - Chuẩn hóa an toàn ở biên giới frontend:
     - `actorId` cung cấp fallback cho `slackUserId` và `slackUserLabel` khi thiếu.
     - Thiếu consent hoặc readiness mặc định an toàn là `consentStatus = 'pending'`, `processingReady = false`.
     - Lưu mảng `missingScopes` được kiểm tra tường minh nếu có.
     - Tuyệt đối không tin các thuộc tính lạ hoặc tự suy đoán readiness chỉ từ `active` + `granted` (`processingReady` phải là boolean `true` từ server và yêu cầu `status === 'active'` cùng `consentStatus === 'granted'`).
     - Không gọi thêm request health; giữ nguyên `personalOAuth: ['myslack']` từ `GET /api/services`.
4. **Huy hiệu Trạng thái (Badges):**
   - `status === 'reconnect_required'`: "Cần kết nối lại" (đỏ) kèm nút "Kết nối lại".
   - `status === 'active' && !processingReady`: "Chờ cho phép xử lý dữ liệu" (vàng hổ phách).
   - `processingReady === true`: "Đã sẵn sàng xử lý" (xanh lá).
   - `status === 'revoked'`: "Đã thu hồi" (hoặc cần kết nối lại).
   - Hiển thị cả Workspace Name + Workspace ID + Slack Identity để phân biệt rõ ràng khi trùng tên workspace.
   - Không để lộ provider keys hoặc chi tiết nội bộ cho người dùng thông thường.
5. **Modal Xác Nhận Ngắt Kết Nối:**
   - Dùng `CockpitDialog` hiện có; chỉ gửi `DELETE` sau khi người dùng bấm xác nhận; hủy bỏ không gửi request.
   - Chống click đúp khi đang busy; bỏ qua response bất đồng bộ từ session/owner cũ.
   - Thông báo rõ ràng phân biệt giữa đã thu hồi ở Slack vs chưa xác nhận thu hồi ở Slack (cần gỡ thủ công).

---

## 3. Kế Hoạch Kiểm Thử TDD & Nghiệm Thu

1. **RED Tests First (`apps/chat-web/tests/slack-oauth.test.tsx`):**
   - Viết các test case component HTTP mô phỏng chính xác:
     - Canonical metadata vs legacy metadata normalization (actorId fallback, default pending/unready).
     - Wrong readiness (ví dụ: `active + granted` nhưng `processingReady: false` hoặc không có profile tin cậy -> vẫn unready).
     - Hiển thị danh sách trùng tên workspace nhưng khác Workspace ID.
     - Modal `CockpitDialog` xác nhận ngắt kết nối và hủy bỏ không gửi DELETE.
     - Bỏ qua response cũ khi đổi chủ session/owner (`gmailSessionOwner`).
     - Callback xử lý `returnTo` hợp lệ (`/c/<uuid>`) vs không hợp lệ / thiếu -> fallback `/settings#myslack`.
     - StrictMode single-use, xóa query parameters trước khi fetch, không replay callback sau 401.
2. **GREEN Minimal Implementation:**
   - Cập nhật `apps/chat-web/src/services/slack-connection.ts`
   - Cập nhật `apps/chat-web/src/pages/Settings/PersonalSlack.tsx`
   - Cập nhật `apps/chat-web/src/views/SlackCallbackView.tsx`
3. **E2E Browser Scenario (`scripts/test-v3-browser.mjs` / `tests/browser/slack-oauth.spec.ts`):**
   - Cập nhật kịch bản browser test để tương tác với modal xác nhận ngắt kết nối mới.
   - Chạy kịch bản `slack_oauth` trên fixture sandbox cục bộ.
4. **Ghi Nhận Ranh Giới Nghiệm Thu Trung Thực:**
   - Browser acceptance trên nhánh này chạy trên nền API fixture/legacy 184 với siêu dữ liệu pending.
   - Nghiệm thu liên dịch vụ hoàn chỉnh (joint canonical-policy & server-side returnTo validation) ghi nhận là PENDING cho đến khi Backend 02B (PR 191) được tích hợp.

---

## 4. Kết Quả Thực Tế & Nghiệm Thu (Evidence & Acceptance)

1. **Unit & Integration Component Tests (`apps/chat-web/tests/slack-oauth.test.tsx`):**
   - **11/11 tests PASS** (Vitest, thời gian 1.27s).
   - Bao phủ đầy đủ:
     - Khử param secret khỏi URL trước khi gửi callback qua mạng; 1 request trong StrictMode; điều hướng về Settings fallback.
     - Điều hướng an toàn tới `returnTo` hội thoại (`/c/<uuid>`).
     - Fallback an toàn về `/settings#myslack` khi `returnTo` không hợp lệ (URL ngoài hoặc định dạng lạ).
     - Không replay callback sau 401; dừng pending và báo lỗi thân thiện.
     - Hủy pending và bỏ qua response nếu đổi session owner giữa chừng.
     - Chuẩn hóa an toàn siêu dữ liệu legacy (`actorId` fallback, default pending/unready) song song với render đầy đủ trường canonical 02A (`processingReady === true` -> "Đã sẵn sàng xử lý").
     - Chặn suy đoán readiness khi `active + granted` nhưng `processingReady: false` -> vẫn hiển thị "Chờ cho phép xử lý dữ liệu".
     - Phân biệt rõ ràng khi các workspace trùng tên bằng cách hiển thị Workspace ID và Slack Identity riêng biệt.
     - Modal `CockpitDialog` xác nhận ngắt kết nối: Hủy không gửi DELETE; Xác nhận gửi DELETE `/api/connections/myslack/:id` và cập nhật thông báo chính xác.
     - Bỏ qua response ngắt kết nối nếu session đổi chủ giữa chừng.
     - Nút "Kết nối lại" cho trạng thái `reconnect_required` và nút "Kết nối workspace Slack".

2. **Toàn bộ Web Test Suite (`npm test -w apps/chat-web`):**
   - **80 test files passed, 894 tests passed, 0 failed** (thời gian 45.2s).

3. **Typecheck & Build & Security:**
   - `npm run typecheck:v3`: EXIT 0 (sạch toàn bộ TypeScript cả api và web).
   - `npm run build:v3`: EXIT 0 (Vite build thành công).
   - `node scripts/test-v3-web-build-security.mjs`: PASS (loại trừ credential sentinels và 7 forbidden UI claims).

4. **Kịch Bản Browser Playwright (`slack_oauth`):**
   - **4/4 tests passed** (375 light, 375 dark, 1440 light, 1440 dark, thời gian 55.3s).
   - Kiểm thử E2E trên fixture sandbox cục bộ với tương tác modal `CockpitDialog` xác nhận ngắt kết nối mới.

5. **Ranh Giới Nghiệm Thu Trung Thực (Honest Acceptance Boundary):**
   - Browser acceptance trên nhánh này chạy trên nền API fixture/legacy 184 với siêu dữ liệu pending.
   - Nghiệm thu liên dịch vụ hoàn chỉnh (joint canonical-policy & server-side returnTo validation) ghi nhận là **PENDING** cho đến khi Backend 02B (PR 191) được tích hợp.

---

## 5. Tiêu Chí Hoàn Thành (Definition of Done)
- [x] Card task và handoff log phản ánh đúng file, hợp đồng và tiến độ.
- [x] Mọi component tests trong `slack-oauth.test.tsx` (11/11 PASS) và toàn bộ package `apps/chat-web` (80 files, 894 tests PASS).
- [x] Typecheck và build của `apps/chat-web` hoàn toàn sạch lỗi (exit code 0).
- [x] Kịch bản browser Slack OAuth pass với modal xác nhận mới (4/4 tests PASS).
- [ ] Commit scoped rõ ràng, push branch và tạo DRAFT PR trỏ vào `integration/slack-personal-20261029`.

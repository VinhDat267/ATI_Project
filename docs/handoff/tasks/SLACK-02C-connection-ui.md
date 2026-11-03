# SLACK-02C · Giao diện Cài đặt Đa Workspace & Callback View (Frontend)

**Trạng thái:** đã hoàn thành thi công và sửa xong các phát hiện re-review, sẵn sàng nghiệm thu
**Nhánh:** `VinhDat267/slack-02c-personal-connection` · **Nền:** `b757ae08` (`integration/slack-personal-20261029`)
**Vai trò sở hữu:** Frontend Engineer (sở hữu `apps/chat-web/`, task card `docs/handoff/tasks/SLACK-02C-connection-ui.md`, handoff logs)
**Phụ thuộc song song:** SLACK-02A (contracts tại `@wap/tool-schemas`), SLACK-02B (consent & readiness backend của PR 192, nhánh của `ctx_cfd7281af67c`)
**Task cha:** [SLACK-02-personal-connections](SLACK-02-personal-connections.md)

---

## 1. Mục tiêu và Ranh giới Kỹ thuật

Thi công hoàn thiện giao diện người dùng trên web (`apps/chat-web`) cho kết nối Slack cá nhân đa workspace, kế thừa và mở rộng mã nền đã duyệt từ PR 184 thay vì tạo các biến thể trùng lặp:
- **Kế thừa các file hiện hữu từ PR 184:**
  - `apps/chat-web/src/pages/Settings/PersonalSlack.tsx` (mở rộng hiển thị đa workspace, badge readiness chuẩn, modal xác nhận ngắt kết nối `CockpitDialog`, hành động kết nối lại mang `workspaceHint` / kết nối thêm, hiển thị lỗi tải mạng kèm nút thử lại).
  - `apps/chat-web/src/views/SlackCallbackView.tsx` (mở rộng single-use qua StrictMode, làm sạch `code`/`state` khỏi URL trước khi gửi mạng, hỗ trợ điều hướng an toàn qua `returnTo` `/c/<uuid>` hoặc fallback `/settings#myslack`, hiển thị workspace thật đã xác thực, ngắt pending lập tức với thông báo lỗi an toàn khi đổi chủ phiên/owner).
  - `apps/chat-web/src/services/slack-connection.ts` (chuẩn hóa dữ liệu biên giới DTO 02A qua canonical validator `@wap/tool-schemas` + tương thích an toàn legacy, từ chối dữ liệu thiếu định danh hoặc sai phiên bản/thời gian, hỗ trợ start mang `returnTo` và `workspaceHint`).
  - `apps/chat-web/tests/slack-oauth.test.tsx` (bổ sung các test component HTTP cho canonical/legacy metadata, wrong readiness, duplicate names, confirmation/cancel, owner-switch stale response, malformed callback, no replay, load error retry, reconnect click).
  - `apps/chat-web/tests/browser/slack-oauth.spec.ts` (cập nhật bước xác nhận modal ngắt kết nối theo đúng hành vi mới).
- **Ranh giới:**
  - Chỉ sửa đổi trong `apps/chat-web/`, card SLACK-02C và file handoff log.
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
   - Callback làm sạch query params khỏi URL trước khi gửi mạng; StrictMode chỉ gửi đúng 1 request; không retry sau lỗi 401 hoặc timeout; hủy trạng thái pending lập tức nếu đổi session/owner.
   - Điều hướng chỉ chấp nhận cùng app dạng `/c/<uuid>` (`conversationReturnPath`); nếu không có hoặc không hợp lệ, fallback về `/settings#myslack`.
3. **Danh sách Kết nối & Chuẩn Hóa Siêu Dữ Liệu:**
   - Sử dụng DTO chuẩn 02A (`@wap/tool-schemas` `validateSlackConnectionPublicInfo` và `validateSlackCallbackResult`).
   - Chuẩn hóa an toàn ở biên giới frontend:
     - `actorId` cung cấp fallback cho `slackUserId` và `slackUserLabel` khi thiếu.
     - Thiếu consent hoặc readiness mặc định an toàn là `consentStatus = 'pending'`, `processingReady = false`.
     - Lưu mảng `missingScopes` được kiểm tra tường minh nếu có.
     - Tuyệt đối không tin các thuộc tính lạ hoặc tự suy đoán readiness chỉ từ `active` + `granted` (`processingReady` phải là boolean `true` từ server và yêu cầu `status === 'active'` cùng `consentStatus === 'granted'`).
     - Không gọi thêm request health; giữ nguyên `personalOAuth: ['myslack']` từ `GET /api/services`.
4. **Huy hiệu Trạng thái (Badges) & Tiêu đề:**
   - `status === 'reconnect_required'`: "Cần kết nối lại" (đỏ) kèm nút "Kết nối lại".
   - `status === 'active' && !processingReady`: "Chờ cho phép xử lý dữ liệu" (vàng hổ phách).
   - `processingReady === true`: "Đã sẵn sàng xử lý" (xanh lá).
   - `status === 'revoked'`: "Đã thu hồi" (hoặc cần kết nối lại).
   - Tiêu đề phản ánh đúng trạng thái thực tế: khi tất cả workspace đều có `processingReady === true`, hiển thị thông điệp đã sẵn sàng xử lý mà không tuyên bố công cụ đang live (vẫn là giai đoạn siêu dữ liệu).
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
     - Đổi chủ phiên dứt điểm pending ngay lập tức với terminal alert UI.
     - Từ chối tạo kết quả callback từ tên workspace đơn thuần.
     - Từ chối identityVersion/connectedAt không hợp lệ.
     - Bấm nút kết nối lại gửi request mang `workspaceHint`.
     - Hiển thị lỗi mạng kèm nút thử lại khi GET thất bại.
2. **GREEN Minimal Implementation:**
   - Cập nhật `apps/chat-web/src/services/slack-connection.ts`
   - Cập nhật `apps/chat-web/src/pages/Settings/PersonalSlack.tsx`
   - Cập nhật `apps/chat-web/src/views/SlackCallbackView.tsx`
3. **E2E Browser Scenario (`scripts/test-v3-browser.mjs` / `tests/browser/slack-oauth.spec.ts`):**
   - Cập nhật kịch bản browser test để tương tác với modal xác nhận ngắt kết nối mới.
   - Chạy kịch bản `slack_oauth` trên fixture sandbox cục bộ.
4. **Ghi Nhận Ranh Giới Nghiệm Thu Trung Thực:**
   - Browser acceptance trên nhánh này chạy trên nền API fixture/legacy 184 với siêu dữ liệu pending.
   - Nghiệm thu liên dịch vụ hoàn chỉnh (joint canonical-policy & server-side returnTo validation) ghi nhận là PENDING cho đến khi Backend 02B (PR 192) được tích hợp.

---

## 4. Kết Quả Thực Tế & Nghiệm Thu (Evidence & Acceptance)

1. **Unit & Integration Component Tests (`apps/chat-web/tests/slack-oauth.test.tsx`):**
   - **18/18 tests PASS** (Vitest, thời gian ~1.03s).
   - Bao phủ đầy đủ:
     - Khử param secret khỏi URL trước khi gửi callback qua mạng; 1 request trong StrictMode; điều hướng về Settings fallback.
     - Điều hướng an toàn tới `returnTo` hội thoại (`/c/<uuid>`).
     - Fallback an toàn về `/settings#myslack` khi `returnTo` không hợp lệ (URL ngoài hoặc định dạng lạ).
     - Không replay callback sau 401; dừng pending và báo lỗi thân thiện.
     - Hủy pending và bỏ qua response nếu đổi session owner giữa chừng, hiện alert UI dứt điểm.
     - Không tự bịa đặt định danh kết nối khi callback chỉ trả tên workspace.
     - Từ chối identityVersion hoặc timestamp không hợp lệ thay vì tự chế siêu dữ liệu.
     - Chuẩn hóa an toàn siêu dữ liệu legacy (`actorId` fallback, default pending/unready) song song với render đầy đủ trường canonical 02A (`processingReady === true` -> "Đã sẵn sàng xử lý").
     - Chặn suy đoán readiness khi `active + granted` nhưng `processingReady: false` -> vẫn hiển thị "Chờ cho phép xử lý dữ liệu".
     - Phân biệt rõ ràng khi các workspace trùng tên bằng cách hiển thị Workspace ID và Slack Identity riêng biệt.
     - Modal `CockpitDialog` xác nhận ngắt kết nối: Hủy không gửi DELETE; Xác nhận gửi DELETE `/api/connections/myslack/:id` và cập nhật thông báo chính xác.
     - Bỏ qua response ngắt kết nối nếu session đổi chủ giữa chừng.
     - Nút "Kết nối lại" mang `workspaceHint` cho trạng thái `reconnect_required` và nút "Kết nối workspace Slack".
     - Tiêu đề phản ánh chính xác trạng thái từng workspace (none/all/mixed/none-ready) bằng ngôn ngữ sản phẩm rõ ràng, không chứa phrasing kỹ thuật `(tinh nang cong cu Slack chua kich hoat live)` hay khẳng định vô căn cứ "ATI chưa đọc tin".
     - Kiểm thử mô tả chính xác trạng thái mixed workspace ("Một số workspace đã sẵn sàng xử lý dữ liệu; các workspace còn lại đang chờ cấp quyền.").
     - Kiểm thử chặn bypass validation: từ chối các thuộc tính kế thừa (inherited prototype properties) của các trường bắt buộc trên source object (`Object.hasOwn`) trước khi chiếu canonical.
     - Hiển thị lỗi mạng kèm nút "Thử lại" thay vì ẩn giao diện.

2. **Bộ Test Độc Lập của Reviewer (`.superpowers/review193/`):**
   - **5/5 tests PASS** (Vitest, 81ms) qua lệnh `node node_modules/vitest/vitest.mjs run --config .superpowers/review193/vitest.config.mts` (gồm 2 own-properties tests và 3 rereview tests).

3. **Toàn bộ Web Test Suite (`npm test -w @wap/chat-web`):**
   - **80 test files passed, 901 tests passed, 0 failed** (thời gian ~36.2s).

4. **Typecheck & Build & Security:**
   - `npm run typecheck:v3`: EXIT 0 (sạch toàn bộ TypeScript cả api và web).
   - `npm run build:v3`: EXIT 0 (Vite build thành công).
   - `node scripts/test-v3-web-build-security.mjs`: PASS (loại trừ credential sentinels và 7 forbidden UI claims).

5. **Kịch Bản Browser Playwright (`slack_oauth`):**
   - **4/4 tests passed** (375 light, 375 dark, 1440 light, 1440 dark, thời gian 28.3s).
   - Kiểm thử E2E trên fixture sandbox cục bộ với assertion cập nhật phù hợp với copy sản phẩm mới.

6. **Ranh Giới Nghiệm Thu Trung Thực (Honest Acceptance Boundary):**
   - Browser acceptance trên nhánh này chạy trên nền API fixture/legacy 184 với siêu dữ liệu pending.
   - Nghiệm thu liên dịch vụ hoàn chỉnh (joint canonical-policy & server-side returnTo validation) ghi nhận là **PENDING** cho đến khi Backend 02B (PR 192) được tích hợp.

---

## 5. Tiêu Chí Hoàn Thành (Definition of Done)
- [x] Card task và handoff log phản ánh đúng file, hợp đồng và tiến độ.
- [x] Mọi component tests trong `slack-oauth.test.tsx` (18/18 PASS), reviewer tests (5/5 PASS) và toàn bộ package `apps/chat-web` (80 files, 901 tests PASS).
- [x] Typecheck và build của `apps/chat-web` hoàn toàn sạch lỗi (exit code 0).
- [x] Kịch bản browser Slack OAuth pass với copy mới (4/4 tests PASS).
- [x] Sửa dứt điểm các lỗi trailing whitespace base-to-head (`git diff --check b757ae08` exit 0).
- [x] Commit scoped rõ ràng, push branch cập nhật PR 193.

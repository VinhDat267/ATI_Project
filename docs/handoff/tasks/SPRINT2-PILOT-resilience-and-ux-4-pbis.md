# SPRINT2-PILOT · Gia cố khả năng chịu lỗi giải mã credential, kênh Slack Sandbox, giữ ngữ cảnh tạo/tham gia tổ chức và ổn định bộ test frontend

**Trạng thái:** Đã thi công, kiểm định độc lập (`scrum-qa-reality-auditor` + `demanding-customer-v2-playwright` `4/4 PASS`), sẵn sàng merge vào `main`.
**Nhiệm vụ:** Khắc phục triệt để 4 hạng mục cải tiến chất lượng và độ bền hệ thống trong Sprint 2 (`PBI-06` → `PBI-09`) trên nhánh tích hợp `fix/sprint2-integration`:
- **PBI-06 (`apps/chat-web`):** Tạo tổ chức mới (`handleCreateOrg`) hoặc tham gia tổ chức bằng mã mời (`handleJoinOrg`) trong `WorkspaceSwitcher.tsx` luôn gọi `navigate('/')` thay vì `navigateAfterWorkspaceChange()`, khiến người dùng đang ở `/settings` hoặc `/history` bị đẩy cưỡng bức về trang chủ `/`.
- **PBI-07 (`apps/chat-api`):** Các đường dẫn đọc/giải mã `decryptCredentials` còn lại ngoài `GET /api/services` (`loadRegisteredServicesFromDb`, `AdapterFactory.getAdapterForService`, `loadTelegramPersonalState` trong `routes/connections/telegram.ts`) chưa được bọc `try/catch`, có thể ném lỗi `Unsupported state or unable to authenticate data` (HTTP 500) khi gặp dòng credential cũ/lệch `ENCRYPTION_KEY`.
- **PBI-08 (`apps/chat-api`):** Chế độ Sandbox mặc định (`default` scenario) không có dữ liệu mẫu cho `slack.search_channels` (trả mảng rỗng `[]`), khiến câu lệnh tạo thẻ Trello kèm gửi thông báo tới `#general` trên Slack rơi vào nhánh `entity_not_found` (`Không tìm thấy kênh Slack tương ứng với "#general"`) khi chạy thử nghiệm Sandbox.
- **PBI-09 (`apps/chat-web`):** Chạy toàn bộ bộ test `apps/chat-web` dưới tải song CPU cao bị timeout 5000ms ở `tests/fe-05b-parity-b.test.tsx` do `testTimeout` mặc định của Vitest quá thấp và một test render đồng thời 4 lượt `<App />` hoàn chỉnh.

**Vai trò phụ trách:** Cross-Functional Agile Scrum Squad (`scrum-backend-api-specialist`, `scrum-frontend-ux-specialist`, `scrum-qa-reality-auditor`, `demanding-customer-v2-playwright`, `scrum-git-devops-master`).
**Nhánh thi công:** `fix/sprint2-integration` (tích hợp từ `fix/sprint2-api-resilience` và `fix/sprint2-web-ux-stability`).

---

## 1. Danh mục File phụ trách

| File | Hành động | Mục đích |
|---|---|---|
| `apps/chat-api/src/services/registered-services.ts` | Cập nhật | Bọc `decryptCredentials` trong `try/catch` tại `loadRegisteredServicesFromDb`; ghi log cảnh báo và bỏ qua dòng credential hỏng thay vì làm sập tiến trình lập kế hoạch |
| `apps/chat-api/src/services/adapter-factory.ts` | Cập nhật | Bọc `decryptCredentials` trong `try/catch` tại `getAdapterForService`; trả lỗi nghiệp vụ rõ ràng (hoặc fallback sang Sandbox khi không ở chế độ `real`) khi không giải mã được credential |
| `apps/chat-api/src/routes/connections/telegram.ts` | Cập nhật | Bọc `decryptCredentials` trong `try/catch` tại `loadTelegramPersonalState`; coi kết nối Telegram có ciphertext hỏng như chưa kết nối (`connected: false`) thay vì trả HTTP 500 |
| `apps/chat-api/src/sandbox/fake-results/slack.ts` | Cập nhật | Cung cấp danh sách kênh Slack mặc định (`#general`, `#random`, `#deploys`, `#bugs`, `#product`) cho `slack.search_channels` ở chế độ Sandbox mặc định và lọc theo `query` (bỏ tiền tố `#` nếu có) |
| `apps/chat-web/src/components/layout/WorkspaceSwitcher.tsx` | Cập nhật | Thay `navigate('/')` bằng `navigateAfterWorkspaceChange(true)` trong `handleCreateOrg` và `navigateAfterWorkspaceChange(false)` trong `handleJoinOrg` để giữ nguyên trang `/settings`, `/history` |
| `apps/chat-web/vite.config.ts` | Cập nhật | Thiết lập `testTimeout: 15000` và `hookTimeout: 15000` để chống flake timeout khi chạy song song toàn bộ bộ test `chat-web` |
| `apps/chat-web/tests/fe-05b-parity-b.test.tsx` | Cập nhật | Nâng timeout cho test tích hợp 4 trạng thái thông báo của `<App />` lên `15000ms` |
| `apps/chat-api/tests/routes/services-security.test.ts` | Cập nhật | Kiểm thử `loadRegisteredServicesFromDb` và các route `/api/connections/telegram` (`GET`, `PATCH /scope`, `POST /test`) không trả 500 khi ciphertext bị hỏng |
| `apps/chat-api/tests/services/adapter-factory.test.ts` | Tạo mới | Kiểm thử `AdapterFactory.getAdapterForService` xử lý an toàn khi `decryptCredentials` ném lỗi ở cả chế độ `real` và `sandbox` |
| `apps/chat-api/tests/config/sandbox-plumbing.test.ts` | Cập nhật | Kiểm thử `slack.search_channels` trả về `#general` khi truy vấn `"general"` hoặc `"#general"` ở chế độ Sandbox mặc định |
| `apps/chat-web/tests/sprint1-workspace-switch.test.tsx` | Cập nhật | Bổ sung kiểm thử giữ nguyên `/settings`, `/history` khi tạo tổ chức mới hoặc tham gia tổ chức bằng mã mời, và vẫn điều hướng về `/` khi đang mở `/c/:id` |

---

## 2. Tiêu chí nghiệm thu (Checklist)

- [x] **PBI-06 (Preserve Current Page on Create/Join Org):** Khi đang ở `/settings` hoặc `/history`, tạo tổ chức mới hoặc tham gia tổ chức bằng mã mời giữ nguyên đường dẫn hiện tại và tự động làm mới dữ liệu theo không gian làm việc vừa tạo/tham gia; khi đang ở `/c/:id` thì vẫn điều hướng về `/`.
- [x] **PBI-07 (`decryptCredentials` Resilience Across Remaining Paths):** Khi bảng `service_credentials` hoặc `personal_connections` chứa dòng ciphertext không giải mã được bằng `ENCRYPTION_KEY` hiện tại, `loadRegisteredServicesFromDb`, `AdapterFactory.getAdapterForService`, và `routes/connections/telegram.ts` xử lý an toàn mà không phát sinh lỗi `500 Internal Server Error`.
- [x] **PBI-08 (Default Sandbox Slack Channels):** Trong chế độ Sandbox mặc định, `slack.search_channels` với `query: "general"` hoặc `"#general"` trả về kênh `#general` (`C01GENERAL`), cho phép lập kế hoạch đa dịch vụ Trello + Slack hoạt động trọn vẹn.
- [x] **PBI-09 (`chat-web` Full Suite Stability):** Chạy toàn bộ bộ test `apps/chat-web` (`95 test files, 986 tests`) đạt 100% PASS ổn định không còn lỗi timeout ở `fe-05b-parity-b.test.tsx`.

---

## 3. Lệnh kiểm tra

```powershell
npx vitest run apps/chat-api/tests/routes/jira-workspace-conversations.test.ts apps/chat-api/tests/config/sandbox-plumbing.test.ts apps/chat-api/tests/services/adapter-factory.test.ts apps/chat-api/tests/routes/services-security.test.ts
Push-Location apps/chat-web; npx vitest run tests/fe-05b-parity-b.test.tsx tests/sprint1-workspace-switch.test.tsx; Pop-Location
npm run test:eval:v3
npm run typecheck:v3
npm run build:v3
node scripts/test-v3-web-build-security.mjs
```

---

## 4. Kết quả

- **Commit triển khai:** `16932755` (`fix/sprint2-api-resilience`), `be180130` (`fix/sprint2-web-ux-stability`), hợp nhất trên `origin/main` (`6219ec2c`) tại `d26e6322`.
- **Kiểm thử tự động (Vitest + Evaluation + Build Security):**
  - `apps/chat-api` (`jira-workspace-conversations.test.ts`, `sandbox-plumbing.test.ts`, `adapter-factory.test.ts`, `services-security.test.ts`): **4 test files, 78/78 tests PASS**.
  - `apps/chat-web` (`fe-05b-parity-b.test.tsx`, `sprint1-workspace-switch.test.tsx`): **2 test files, 31/31 tests PASS** (toàn bộ `apps/chat-web`: **95 test files, 986/986 tests PASS**).
  - `npm run test:eval:v3`: **25 test files, 406/406 tests PASS** (`static-guard.test.ts` 2/2 PASS).
  - `npm run typecheck:v3`, `npm run build:v3`, `node scripts/test-v3-web-build-security.mjs`: **exit code 0**.
- **Nghiệm thu độc lập:**
  - `scrum-qa-reality-auditor`: **APPROVED (PASS)** cho cả 2 nhánh `fix/sprint2-api-resilience` và `fix/sprint2-web-ux-stability`.
  - `demanding-customer-v2-playwright` (Live Browser Verification trên `http://127.0.0.1:5175` + PostgreSQL 16 thật): **PASS (`PBI-06`, `PBI-07`, `PBI-08`, `PBI-09`)**, `0 console.error`, `0 pageerror`, `0 HTTP 500`.

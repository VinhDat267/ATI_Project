# Bàn giao: Hoàn thiện Telegram 1-Click Pairing, 2-Way `telegram.read_messages`, Smart Digest, UI/UX & Kiểm thử Playwright E2E

**Ngày:** 03/11/2026 (Asia/Saigon)
**Phạm vi:** `@wap/tool-schemas`, `@wap/planner`, `@wap/tool-adapters`, `@wap/executor`, `apps/chat-api`, `apps/chat-web`, `scripts/test-v3-browser.mjs`

---

## 1. Tóm tắt các hạng mục đã triển khai

### 1.1. Backend: Telegram 2 Chiều (`telegram.read_messages`) & Smart Multi-Source Digest
- **Bảo toàn ngữ cảnh đa bước & Smart Fallback (`@wap/tool-schemas`, `@wap/planner`):**
  - Giữ `observedFields: ['id', 'title', 'type']` trên `telegram.list_chats` để bước sau trong cùng kế hoạch hoặc lượt hội thoại kế tiếp tham chiếu được cuộc trò chuyện đã tìm thấy.
  - Bổ sung cơ chế smart fallback trong `packages/planner/src/router.ts`: khi câu lệnh nhắc tới `"kênh"` / `"nhóm"` mà `slack` không kết nối nhưng `telegram` đang kết nối, router tự động định tuyến sang `telegram`.
- **Công cụ đọc `telegram.read_messages` (`@wap/tool-schemas`, `@wap/tool-adapters`, `@wap/executor`, `apps/chat-api`):**
  - Định nghĩa `TELEGRAM_OAUTH_TOOLS` chứa `telegram.read_messages` (`sideEffect: 'read'`) và đăng ký trong `getToolDefinition()`, `StepRunner` (`packages/executor/src/runner.ts`), `getToolCatalogFor()` (chỉ mở khi người dùng có kết nối `telegramConnection` cá nhân), và `TELEGRAM_FAKE`.
  - Thực thi `telegram.read_messages` trong `TelegramAdapter` có kiểm tra chặt `assertChatAllowed` theo `allowedScope.chats`.
  - Chuẩn hoá `step.args.chatId` trực tiếp qua `matchSelectedChat(trimmed)` trong `ChatService` khi LLM truyền tên nhóm/chat cá nhân trực tiếp mà không qua bước `telegram.list_chats`.
- **Nâng cấp `TelegramDigestRunner` đọc dữ liệu thực từ Sheets & phát hiện trùng lịch Calendar:**
  - Chuyển đổi công cụ nguồn từ `mysheets.list_spreadsheets` / `sheets.get_spreadsheet` sang `mysheets.read_range` / `sheets.read_range` (vùng `A1:Z50`) kết hợp `analyzeSheetKpiMetrics()` để trích xuất số liệu KPI thực tế.
  - Áp dụng `detectCalendarConflicts()` trên danh sách sự kiện từ `mycalendar.list_events` / `calendar.list_events` để cảnh báo trùng lịch họp ngay trong bản tin Telegram.
- **Tự động phát hiện nhóm mới (`GET /api/connections/telegram`):**
  - Khi người dùng mở trang Kết nối dịch vụ, `GET /api/connections/telegram` tự động gọi `discoverTelegramChats()` để phát hiện nhóm mới mà bot vừa được thêm vào mà không bắt bấm nút làm mới thủ công.

### 1.2. Frontend UI/UX (`FE-1` → `FE-5` trong `apps/chat-web`)
- **`FE-1` (`TelegramCallbackView.tsx`):** Tự động xác minh kết nối khi người dùng quay lại tab trình duyệt từ ứng dụng Telegram (`focus` / `visibilitychange`), hiển thị `<ServiceLogo service="telegram" />` và badge `@botUsername`.
- **`FE-2` (`TelegramConnection.tsx`):** Bổ sung badge trạng thái `Chưa chọn chat` (`needs_scope`) & `Cần kết nối lại` (`reconnect_required`), bộ đếm `Đã chọn X / 10`, ô tìm kiếm nhanh `#telegram-chat-filter`, nhãn phân loại `Chat cá nhân` / `Nhóm Telegram` / `Kênh Telegram` kèm `@username`, và link `+ Thêm bot vào nhóm mới`.
- **`FE-3` (`cockpit-services.json`, `tool-definitions.ts`, `PreviewContents.tsx`, `ExecutionProgress.tsx`):** Đăng ký hiển thị `telegram.read_messages` và `telegram.list_chats` trên `PlanMoment`, `PreviewModal` (`Xem trước nội dung`), và `ReceiptMoment` (`✓ Đã đọc tin nhắn`, hiển thị `Người gửi`, `Nội dung`, và định dạng thời gian Unix timestamp sang `<time>` tiếng Việt).
- **`FE-4` (`ScheduleMoment.tsx`, `ScheduleSection.tsx`):** Nâng cấp thẻ chọn `#schedule-mode-auto-digest`, bổ sung hộp `#schedule-auto-digest-scope` liệt kê nguồn dữ liệu & nơi nhận đã khóa, và hiển thị `(Telegram: <chatTitle> · <N> nguồn)` trong lịch sử lượt chạy (`/history`).
- **`FE-5` (`GuidePage.tsx`, `Guide/data.tsx`):** Cập nhật CTA `Kết nối Telegram 1-Click →`, đổi nhãn `Cách kết nối:`, và thêm thẻ `Telegram cá nhân & Nhóm` vào `GUIDE_OAUTH_SHOWCASE_CARDS`.

---

## 2. Bằng chứng Kiểm thử Thực tế (Exit Code 0)

1. **Unit & Integration Tests (Backend + Executor + Schemas + Planner + Adapters):**
   ```text
   npx vitest run packages/executor/tests packages/tool-schemas/tests/telegram.test.ts packages/planner/tests/telegram-routing.test.ts packages/tool-adapters/tests/telegram-adapter.test.ts apps/chat-api/tests/routes/telegram-connections.test.ts apps/chat-api/tests/routes/telegram-scope.test.ts apps/chat-api/tests/routes/telegram-shared-credentials.test.ts apps/chat-api/tests/services/telegram-planning.test.ts apps/chat-api/tests/services/schedules/telegram-digest-proposal.test.ts apps/chat-api/tests/services/schedules/telegram-digest-runner.test.ts apps/chat-api/tests/integration/telegram-extension.test.ts --exclude "**/.claude/**"
   -> Test Files: 15 passed (15) | Tests: 145 passed (145) | Exit code: 0
   ```
2. **Frontend Component & UI Tests (`apps/chat-web`):**
   ```text
   npm --prefix apps/chat-web test -- tests/telegram-connection.test.tsx tests/schedule-telegram-digest-mode.test.tsx tests/schedule-trello-digest-mode.test.tsx tests/components/settings-page.test.tsx tests/fe-07-settings.test.tsx tests/workflow-flow-canvas.test.tsx tests/auth-return-target.test.tsx
   -> Passed | Exit code: 0
   ```
3. **Playwright Browser E2E Tests (`apps/chat-web/tests/browser/telegram-oauth-and-digest.spec.ts`):**
   ```text
   npm run test:browser:v3 -- tests/browser/telegram-oauth-and-digest.spec.ts
   [1/2] TELEGRAM-E2E-1: /guide 1-click showcase, TELEGRAM_PAIRING_PENDING auto-focus verification, #telegram-scope filter & counter, and multi-source auto_digest schedule + /history
   [2/2] TELEGRAM-E2E-2: 2-way Telegram workflow (telegram.read_messages + telegram.send_message) on PlanMoment, PreviewModal, and real Backend Execution to ReceiptMoment
   -> 2 passed (16.7s) | Exit code: 0
   ```

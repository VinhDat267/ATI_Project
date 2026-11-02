# Bàn giao: Hoàn thiện Gmail OAuth 1-Click, Batch Modify, Cross-Service Grounding, Auto-Digest & Giao diện Frontend (`GMAIL-03` / `OAUTH-01`)

- **Ngày:** 03/11/2026 (Asia/Ho_Chi_Minh)
- **Nhánh:** `fix/migration-rerun-idempotency`
- **Phạm vi:** Audit, nâng cấp toàn trình tính năng Gmail cá nhân (OAuth 2.0 1-Click, tự động làm mới token khi gặp `401` non-JSON, công cụ thao tác hàng loạt `gmail.batch_modify_threads`, trích xuất metadata tệp đính kèm `hasAttachment`/`attachmentNames`, Cross-Service Recipient Grounding từ Google Sheets/Notion/Trello/GitHub/Calendar/Gmail, Scheduled AI Auto-Digest qua Gmail/Telegram, nâng cấp toàn diện UI/UX trên `chat-web`, và kiểm thử trình duyệt thật bằng Playwright Chromium).

---

## 1. Các hạng mục đã hoàn thành

### Hạng mục 1: OAuth 2.0, Token Lifecycle & Tự động kích hoạt Runtime Config
- Cập nhật [`apps/chat-api/src/config.ts`](../../../apps/chat-api/src/config.ts) và [`apps/chat-api/src/config/env.ts`](../../../apps/chat-api/src/config/env.ts): tự động bật `GMAIL_ENABLED` khi khai báo đủ bộ 3 biến môi trường `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REDIRECT_URI` (vẫn tôn trọng `GMAIL_ENABLED=off`).
- Cập nhật [`apps/chat-api/src/routes/services-routes.ts`](../../../apps/chat-api/src/routes/services-routes.ts): đồng bộ chính xác `connectionStatus` (`healthy` / `unhealthy` / `unconfigured`) với `personalStatus` (`connected` / `reconnect_required` / `not_connected`) trên `GET /api/services`.
- Cập nhật [`packages/tool-adapters/src/gmail/gmail-adapter.ts`](../../../packages/tool-adapters/src/gmail/gmail-adapter.ts): xử lý `401` ngay cả khi upstream trả về HTML/plain-text non-JSON để kích hoạt `refreshAccessToken()` đúng 1 lần trước khi chuyển sang `AUTH_ERROR`.

### Hạng mục 2: Mở rộng Bộ Công Cụ Gmail (`gmail.batch_modify_threads` & Metadata Tệp Đính Kèm)
- Cập nhật [`packages/tool-schemas/src/gmail.ts`](../../../packages/tool-schemas/src/gmail.ts):
  - Bổ sung công cụ `gmail.batch_modify_threads` (cho phép gắn/gỡ nhãn tối đa 50 luồng thư trong 1 bước duy nhất).
  - Mở rộng schema đầu ra của `gmail.search_threads` và `gmail.get_thread` thêm `hasAttachment: boolean` và `attachmentNames: string[]`.
- Cập nhật [`packages/tool-adapters/src/gmail/gmail-adapter.ts`](../../../packages/tool-adapters/src/gmail/gmail-adapter.ts):
  - Duyệt đệ quy cây MIME để trích xuất danh sách tên tệp đính kèm (`attachmentNames`) và cờ `hasAttachment`.
  - Thực thi `POST /gmail/v1/users/me/threads/batchModify` (HTTP `204 No Content`) và chuẩn hoá đầu ra cho mọi thao tác ghi.
- Cập nhật [`scripts/fake-google-gmail.mjs`](../../../scripts/fake-google-gmail.mjs): bổ sung nhánh `threads/batchModify` trên máy chủ giả lập Google phục vụ kiểm thử E2E.

### Hạng mục 3: Cross-Service Recipient Grounding & Mặc định `PLANNER_READ_ANSWERS=on`
- Cập nhật [`packages/planner/src/recipients.ts`](../../../packages/planner/src/recipients.ts), [`packages/planner/src/validator.ts`](../../../packages/planner/src/validator.ts) và [`packages/planner/src/planner.ts`](../../../packages/planner/src/planner.ts):
  - Mở rộng `collectGroundedRecipients` thu thập địa chỉ email hợp lệ từ kết quả đọc của các dịch vụ trước đó trong cùng phiên làm việc (Google Sheets, Notion, Trello, GitHub, Google Calendar, Gmail) bên cạnh văn bản yêu cầu của người dùng, đồng thời vẫn chặn chặt mọi địa chỉ email do mô hình tự bịa (`UNGROUNDED_RECIPIENT`).
  - Mặc định bật `PLANNER_READ_ANSWERS=on` để cho phép trả lời tóm tắt trực tiếp bằng tiếng Việt đối với các truy vấn chỉ đọc.

### Hạng mục 4: Scheduled AI Auto-Digest (`gmail_unread` & Đích nhận qua Hộp thư Gmail)
- Cập nhật [`apps/chat-api/src/services/schedules/telegram-digest-candidate.ts`](../../../apps/chat-api/src/services/schedules/telegram-digest-candidate.ts) và [`apps/chat-api/src/services/schedules/telegram-digest-runner.ts`](../../../apps/chat-api/src/services/schedules/telegram-digest-runner.ts):
  - Bổ sung nguồn đọc `gmail_unread` (`is:unread newer_than:1d`) và hỗ trợ gửi bản tin tổng hợp định kỳ trực tiếp vào hộp thư Gmail cá nhân của người dùng (`destination.kind = 'gmail'`) bên cạnh Telegram/Slack.

### Hạng mục 5: Nâng cấp Toàn diện Giao diện Frontend (`apps/chat-web`)
- Cập nhật [`apps/chat-web/src/assets/cockpit-services.json`](../../../apps/chat-web/src/assets/cockpit-services.json), [`ReceiptMoment.tsx`](../../../apps/chat-web/src/pages/Cockpit/ReceiptMoment.tsx), [`Cockpit.tsx`](../../../apps/chat-web/src/components/Cockpit.tsx) và [`WorkflowFlowCanvas.tsx`](../../../apps/chat-web/src/components/WorkflowFlowCanvas.tsx):
  - Bổ sung `badge`, `previewBadge`, `receiptHover` cho `services.gmail`, đăng ký `gmail.batch_modify_threads`, hiển thị dòng định danh `Gửi từ: <email> (Gmail của bạn)` tại Moment 6 (`ReceiptMoment`), và phân giải mảng `threadIds` / `to` trên cả danh sách bước lẫn sơ đồ `WorkflowFlowCanvas`.
- Cập nhật [`GmailPreview.tsx`](../../../apps/chat-web/src/pages/Cockpit/GmailPreview.tsx) và [`PersonalGmail.tsx`](../../../apps/chat-web/src/pages/Settings/PersonalGmail.tsx):
  - Thiết kế khung phong bì thư trực quan (`data-testid="gmail-preview-card"`) kèm huy hiệu nguồn gốc người nhận phân màu ngữ nghĩa.
  - Bổ sung huy hiệu phạm vi quyền `data-testid="gmail-capabilities"` (`Đọc & tóm tắt thư`, `Soạn nháp & gửi thư`, `Gắn nhãn hàng loạt`, `Bản tin tự động Telegram`) và chấm trạng thái trực quan trong `/settings#gmail`.
- Cập nhật [`GuidePage.tsx`](../../../apps/chat-web/src/pages/Guide/GuidePage.tsx), [`RequestMoments.tsx`](../../../apps/chat-web/src/pages/Cockpit/RequestMoments.tsx) và [`ResponseMoment.tsx`](../../../apps/chat-web/src/pages/Responses/ResponseMoment.tsx):
  - Rào hiển thị chuỗi `"Gmail"` và playbook liên dịch vụ có Gmail khi `GMAIL_ENABLED=off`.
  - Đồng bộ `useLayoutEffect` trong `ResponseMoment.tsx` để loại bỏ hiện tượng nháy 1-frame trạng thái `servicesLoading` khi quay về từ OAuth 1-Click.

---

## 2. Bằng chứng Kiểm thử Thực tế (Quality Gate & Playwright E2E Evidence)

- **Playwright Browser E2E (`11/11` bài kiểm thử PASS trên Chromium thật)**:
  - `node scripts/test-v3-browser.mjs -g "GMAIL-03 off"` → **1 passed (13.1s)** (exit code 0).
  - `SCENARIO=gmail node scripts/test-v3-browser.mjs` → **10 passed (1.2m)** (exit code 0), bao gồm:
    - `4/4` bài `GMAIL-03: personal OAuth, preview, receipt and disconnect` (`1440 light`, `1440 dark`, `375 light`, `375 dark`).
    - `2/2` bài `OAUTH-01 from chat: actions reached with Tab stay above the composer` (`1440`, `375`).
    - `4/4` bài `OAUTH-01 from chat: connect Gmail from the refusal, come back to the conversation and send again` (`1440 light`, `1440 dark`, `375 light`, `375 dark`).
- **Unit, Integration, Theme/Contrast & Golden Fixtures (`370/370` bài kiểm thử PASS)**:
  - `@wap/tool-schemas`: `tests/gmail.test.ts` (**15/15 PASS**).
  - `@wap/tool-adapters`: `tests/gmail-adapter.test.ts` (**71/71 PASS**).
  - `@wap/planner`: `tests/gmail-grounding.test.ts` (**21/21 PASS**).
  - `@wap/chat-api`: Gmail env, routes, chat-service & digest suites (**80/80 PASS**).
  - `evaluations/golden-v2`: `fixtures-gmail.test.ts` (**43/43 PASS**).
  - `@wap/chat-web`: `14` bộ test Gmail UI, Callback, Public, Plan State, Guide, Privacy, Recovery, Workflow Canvas, Digest Mode, OAuth-01 & Theme/Contrast (**140/140 PASS**).

# 2026-11-04 · DEMO-01 — Kiểm Toán Liên Dịch Vụ Toàn Diện (4, 5 & 9 Dịch Vụ), Playbooks & Runbook Bảo Vệ

## 1. Bối cảnh & Mục tiêu
- Giải quyết câu hỏi cốt lõi của chủ dự án: hệ thống đã tích hợp **9 dịch vụ thực tế** (`Google Calendar`, `Atlassian Jira`, `GitHub`, `Trello`, `Notion`, `Google Sheets`, `Gmail`, `Telegram`, `Slack`) và `validatePlan` hỗ trợ tối đa **10 bước/kế hoạch**, nhưng các kịch bản mẫu và Playbook trước đây mới chỉ ghép 2–3 dịch vụ.
- Đồng thời hoàn thành `DEMO-01`:
  1. Bật đầy đủ 5 cờ tính năng đã nghiệm thu trong `.env` local (`PLANNER_READ_ANSWERS=on`, `SCHEDULES_ENABLED=on`, `GMAIL_ENABLED=on`, `MYCALENDAR_ENABLED=on`, `MYSHEETS_ENABLED=on`) mà vẫn giữ nguyên mặc định an toàn (`off`) trong `.env.example` theo hợp đồng CI.
  2. Bổ sung các kịch bản `four_service` (4 dịch vụ), `five_service` (5 dịch vụ) và `nine_service` (điều phối liên thông toàn bộ **9 dịch vụ trong 1 kế hoạch 9 bước**).
  3. Bổ sung bộ Playbooks liên dịch vụ trong `cockpit-services.json`, câu lệnh mẫu `p15`–`p18` trong `/guide` (`Guide/data.tsx`), và nâng cấp `ReceiptMoment.tsx` hiển thị các thẻ chỉ số biên nhận (Receipt Metrics) cho cả 9 dịch vụ.
  4. Soạn thảo tài liệu chuẩn tắc `docs/demo/DEMO-RUNBOOK.md` phục vụ buổi bảo vệ khóa luận.

## 2. Các file đã thay đổi
- `apps/chat-api/src/sandbox/scenarios.ts`: Thêm `fourServicePlan` (4 bước), `fiveServicePlan` (5 bước) và `nineServicePlan` (9 bước qua đủ 9 dịch vụ với `$ref` và `$template`).
- `apps/chat-api/src/config/gmail-tools-runtime.ts`: Cho phép nạp `GMAIL_TOOLS` và chế độ tìm kiếm `'llm'` trong kịch bản sandbox `nine_service`, `five_service`, `four_service`.
- `apps/chat-api/src/server.ts`: Cung cấp `sandboxGmailConnection` khi chạy `SANDBOX_SCENARIO=nine_service` để kết nối liền mạch cả 9 dịch vụ trong sandbox.
- `apps/chat-web/src/assets/cockpit-services.json`: Thêm 4 Playbooks đầu bảng (`playbook-all-nine-services`, `playbook-five-service-release`, `playbook-four-service-incident`, `playbook-scheduled-calendar-slack`).
- `apps/chat-web/src/pages/Cockpit/RequestMoments.tsx`: Thêm `flex-wrap` cho hàng biểu tượng dịch vụ trên thẻ Playbook để chuỗi 9 dịch vụ hiển thị đẹp mắt trên mọi kích thước màn hình.
- `apps/chat-web/src/pages/Guide/data.tsx`: Bổ sung các câu lệnh mẫu `p15` (8 công cụ core), `p16` (5 công cụ), `p17` (4 công cụ) và `p18` (lịch chạy định kỳ).
- `apps/chat-web/src/pages/Cockpit/ReceiptMoment.tsx`: Mở rộng `MyJiraReceiptMetrics` cho cả `jira` & `myjira` (hiển thị `🎫 Mã: ${out.key}`), và bổ sung `GitHubReceiptMetrics`, `TelegramReceiptMetrics`, `CalendarReceiptMetrics`, `GmailReceiptMetrics`.
- `scripts/test-v3-browser.mjs` & `apps/chat-web/tests/browser/v3-sandbox.spec.ts`: Đăng ký và kiểm thử E2E trên trình duyệt Chromium + PostgreSQL cho `four_service` và `nine_service`.
- `docs/demo/DEMO-RUNBOOK.md` & `apps/chat-api/tests/config/demo-runbook-contract.test.ts`: Runbook bảo vệ khóa luận và bài test hợp đồng tự động.
- `apps/chat-web/tests/cockpit-receipt-metrics.test.tsx`: Unit test kiểm chứng Playbooks mới và Receipt Metrics của cả 9 dịch vụ.

## 3. Bằng chứng kiểm thử thực tế
- **Playwright Chromium + PostgreSQL E2E (`scripts/test-v3-browser.mjs`):**
  - `SCENARIO=four_service`: `1 passed (17.1s)` — xác nhận `Đã xong 4 việc trên 4 công cụ`.
  - `SCENARIO=nine_service`: `1 passed (12.9s)` — xác nhận `Đã xong 9 việc trên 9 công cụ` và hiển thị đầy đủ Receipt Metrics.
  - `SCENARIO=three_service`: `1 passed (9.0s)`.
- **Vitest Unit & Contract Suites:**
  - `apps/chat-api/tests/config/demo-runbook-contract.test.ts`: `2 passed`.
  - `apps/chat-web/tests/cockpit-receipt-metrics.test.tsx`: `2 passed`.
  - `apps/chat-web/tests/fe-10-guide-privacy.test.tsx`: `6 passed`.

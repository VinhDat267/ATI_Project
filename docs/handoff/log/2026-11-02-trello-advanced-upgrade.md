# Handoff Log — 2026-11-02: Nâng Cấp Thực Chiến Trello (Adversarial User/Business Audit + 14 Tools + Active Guardrails + Auto-Digest UI)

## 1. Bối cảnh & Mục tiêu
- Kiểm định phản biện dưới góc nhìn người dùng thực tế (`agency-reality-checker` × `agency-persona-walkthrough-specialist`) và triển khai nâng cấp toàn diện cho Trello AI Automation trong hệ sinh thái ATI:
  1. **Mở rộng Bộ Công Cụ Trello lên 14 Tools (`TRELLO_TOOLS` + `TRELLO_OAUTH_TOOLS`):**
     - `trello.add_comment`: Bình luận ghi chú tiến độ hoặc gắn link PR/email vào thẻ Trello.
     - `trello.create_list`: Tạo danh sách/cột mới trên bảng Trello (hỗ trợ ghép nối `$step_1.id` để vừa tạo cột vừa tạo thẻ trong 1 Plan).
     - `trello.remove_member`: Gỡ thành viên khỏi thẻ để điều phối lại nhân sự khi quá tải.
     - `trello.update_checklist_item`: Đánh dấu hoàn thành (`complete` / `incomplete`) mục con trong checklist theo tên mục (`itemName`) không cần nhớ mã `checkItemId`.
     - `trello.set_card_due_complete`: Đánh dấu hoàn thành hạn chót (`dueComplete = true/false`) mà không làm lưu trữ/ẩn thẻ.
     - Nâng cấp `trello.search_cards` (`query: ""`, trả về `boardId`, `due`, `dueComplete`, `idMembers`, `labels`) và `trello.get_card` (trả về thêm `checklists`).
     - Nạp trọn bộ `TRELLO_TOOLS` + `TRELLO_OAUTH_TOOLS` (14 tools) vào Runtime Catalog (`registered-services.ts`) trong khi bảo toàn SHA-256 baseline của `ALL_TOOLS` (`schedules.test.ts`).
  2. **Trí tuệ tiền thực thi chủ động (Active Pre-Execution Guardrails trong `ChatService.bindConnections`):**
     - Tự động gọi `trello.search_cards` (timeout an toàn 5s) khi `WorkingMemory` chưa có thẻ của bảng ở luồng lập kế hoạch 1 lượt, phát hiện chính xác **Cảnh báo trùng thẻ**, **Cảnh báo hạn chót quá khứ**, và **Cảnh báo quá tải thành viên**.
  3. **Báo cáo sáng tự động (`trello_digest`) & Khắc phục lỗi Crash UI (`ScheduleMoment.tsx`):**
     - Bổ sung `trello-digest-candidate.ts`, `trello-digest-runner.ts` và nâng cấp `telegram-digest-runner.ts`.
     - Sửa lỗi crash `TypeError` trên `ScheduleMoment.tsx` khi hiển thị đề xuất lịch `trello_digest` và bổ sung huy hiệu `"Tự gửi"` trên `ScheduleMoment.tsx` & `ScheduleSection.tsx`.
  4. **Định tuyến liên dịch vụ (`TRELLO_SERVICE`):**
     - Mở rộng `intentPatterns` và bổ sung `gatherRule` cho `card` trong `packages/tool-schemas/src/registry/trello.ts`.
  5. **Nâng cấp Frontend UI/UX & Kiểm thử Playwright E2E (`apps/chat-web` & Sandbox):**
     - Đồng bộ đầy đủ 14 Trello tools trong `tool-definitions.ts` và `cockpit-services.json`.
     - Hiển thị thẻ Kanban trực quan (`data-testid="trello-card-preview"`), badges thành viên/hạn chót/hoàn thành hạn (`data-testid="trello-preview-badges"`), danh sách mục checklist (`☐ / ☑`) và bình luận trên `PreviewContents.tsx`.
     - Bổ sung khung `data-testid="plan-warnings-callout"` trên `PlanMoment.tsx`, chi tiết kết quả đọc thẻ trên `ExecutionProgress.tsx`, nút điều hướng `needs_scope` / `needs_membership` trên `ResponseMoment.tsx`, bộ đếm `data-testid="trello-scope-counter"` (`Đã chọn X/10`) và ô lọc nhanh bảng trên `TrelloConnection.tsx`.
     - Hoàn thiện dữ liệu giả 14 tools trong `TRELLO_FAKE`, tách nhánh lịch `trello_digest` trong `scenarios.ts`, và mở rộng bộ kiểm thử trình duyệt thật `apps/chat-web/tests/browser/trello-oauth.spec.ts`.

## 2. Danh sách Files đã sửa đổi / thêm mới
- `packages/tool-schemas/src/trello.ts`
- `packages/tool-schemas/src/registry/trello.ts`
- `packages/tool-schemas/src/types.ts`
- `packages/tool-schemas/src/index.ts`
- `packages/tool-schemas/tests/schemas.test.ts`
- `packages/tool-adapters/src/trello/read-tools.ts`
- `packages/tool-adapters/src/trello/write-tools.ts`
- `packages/tool-adapters/src/trello/index.ts`
- `packages/tool-adapters/tests/trello-read.test.ts`
- `packages/tool-adapters/tests/trello-write.test.ts`
- `packages/planner/src/search.ts`
- `packages/planner/tests/agentic-search.test.ts`
- `packages/planner/tests/planner.test.ts`
- `db/v3/0014_trello_oauth.sql`
- `apps/chat-api/src/db/repositories/schedule-repo.ts`
- `apps/chat-api/src/services/registered-services.ts`
- `apps/chat-api/src/services/chat-service.ts`
- `apps/chat-api/src/services/schedules/trello-digest-candidate.ts` *(Mới)*
- `apps/chat-api/src/services/schedules/trello-digest-runner.ts` *(Mới)*
- `apps/chat-api/src/services/schedules/schedule-service.ts`
- `apps/chat-api/src/services/schedules/schedule-runner.ts`
- `apps/chat-api/src/services/schedules/telegram-digest-runner.ts`
- `apps/chat-api/src/sandbox/fake-results/trello.ts`
- `apps/chat-api/src/sandbox/scenarios.ts`
- `apps/chat-api/src/server.ts`
- `apps/chat-api/tests/services/trello-planning.test.ts`
- `apps/chat-api/tests/services/trello-digest.test.ts` *(Mới)*
- `apps/chat-web/src/types.ts`
- `apps/chat-web/src/services/tool-definitions.ts`
- `apps/chat-web/src/services/schedule-text.ts`
- `apps/chat-web/src/assets/cockpit-services.json`
- `apps/chat-web/src/components/Cockpit.tsx`
- `apps/chat-web/src/components/ExecutionProgress.tsx`
- `apps/chat-web/src/pages/Cockpit/PlanMoment.tsx`
- `apps/chat-web/src/pages/Cockpit/PreviewContents.tsx`
- `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx`
- `apps/chat-web/src/pages/History/ScheduleSection.tsx`
- `apps/chat-web/src/pages/Responses/ResponseMoment.tsx`
- `apps/chat-web/src/pages/Settings/TrelloConnection.tsx`
- `apps/chat-web/tests/schedule-trello-digest-mode.test.tsx` *(Mới)*
- `apps/chat-web/tests/trello-ui-ux.test.tsx` *(Mới)*
- `apps/chat-web/tests/browser/trello-oauth.spec.ts`
- `scripts/test-v3-browser.mjs`

## 3. Bằng chứng Kiểm thử (Verification Output)
- `npx --workspace=@wap/tool-schemas vitest run` → **17 test files, 342 tests PASS**
- `npx --workspace=@wap/tool-adapters vitest run tests/trello-read.test.ts tests/trello-write.test.ts` → **2 test files, 7 tests PASS**
- `npx --workspace=@wap/planner vitest run tests/planner.test.ts tests/schedules.test.ts tests/agentic-search.test.ts` → **3 test files, 110 tests PASS**
- `npx --workspace=@wap/chat-api vitest run tests/db/trello-oauth-migration.test.ts tests/services/trello-planning.test.ts tests/services/trello-digest.test.ts tests/routes/trello-shared-credentials.test.ts tests/routes/trello-connections.test.ts tests/routes/trello-scope.test.ts` → **6 test files, 60 tests PASS**
- `npx --workspace=@wap/chat-web vitest run tests/trello-ui-ux.test.tsx tests/trello-connection.test.tsx tests/schedule-trello-digest-mode.test.tsx tests/fe-05-cockpit.test.tsx tests/fe-05b-parity-a.test.tsx tests/fe-05b-parity-b.test.tsx` → **6 test files, 108 tests PASS**
- `node --env-file-if-exists=.env scripts/test-v3-browser.mjs apps/chat-web/tests/browser/trello-oauth.spec.ts` → **2 passed (18.1s), Exit code 0**

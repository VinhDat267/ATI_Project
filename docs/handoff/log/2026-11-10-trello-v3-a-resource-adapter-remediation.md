# Nhật ký bàn giao · 2026-11-10 · TRELLO-V3-A (`VinhDat267/fix-trello-resource-v3`)

- **Task card:** [`docs/handoff/tasks/TRELLO-V3-A-resource-adapter-remediation.md`](../tasks/TRELLO-V3-A-resource-adapter-remediation.md)
- **Baseline:** `2eed8d1d4309e833088d6f1d3fa774189049e283`
- **Phạm vi thực hiện (Owner A):** `packages/tool-schemas/src/trello.ts`, `packages/tool-schemas/tests/trello-resource-id.test.ts`, `packages/tool-adapters/src/trello/**`, `packages/tool-adapters/src/slack/slack-adapter.ts`, `packages/tool-adapters/tests/trello-audit-remediation.test.ts`, `packages/executor/src/runner.ts`.

## 1. Các phát hiện đã xử lý

- **`TRELLO-AUDIT-01` (`F1`, P1 & `T7`):**
  - Thêm biểu thức chính quy `TRELLO_RESOURCE_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'`, `isValidTrelloResourceId`, `validateTrelloToolArgs` và ràng buộc `pattern`, `minLength: 1`, `maxLength: 128` cho toàn bộ trường ID tài nguyên Trello trong `TRELLO_TOOLS` và `TRELLO_OAUTH_TOOLS` (`packages/tool-schemas/src/trello.ts`).
  - Thêm `assertValidResourceId` và `resolveSafeEndpointUrl` trong `TrelloBaseAdapter` (`packages/tool-adapters/src/trello/base.ts`) chặn chuỗi rỗng, khoảng trắng, `/`, `\`, `.`, `..`, `%2e`, `%2f`, `%5c`, `%00`, `?`, `#`, ký tự điều khiển và kiểm tra sự khớp tuyệt đối của `url.pathname` trước khi gửi HTTP request.
  - Trong `TrelloWriteTools.removeMember` (`packages/tool-adapters/src/trello/write-tools.ts`), kiểm tra cú pháp `cardId`, `memberId` trước mọi truy vấn mạng và khóa cứng cấu trúc 4 phân đoạn `/cards/:cardId/idMembers/:memberId`, ngăn chặn hoàn toàn việc chuẩn hóa `../../FOREIGN` thành `DELETE /1/cards/FOREIGN`.
- **`TRELLO-AUDIT-02` (`F2`, P2 — `T1`, `T2`, `T3`):**
  - `T1`: `TrelloReadTools.getCard` gọi `/cards/:id?fields=id,idBoard` và kiểm tra `assertParentBoard` trước khi tải `/cards/:id?checklists=all`.
  - `T2`: `TrelloReadTools.searchCards` khi truyền `listId` gọi `/lists/:id?fields=id,idBoard` và kiểm tra `assertParentBoard` trước khi tải `/lists/:id/cards`.
  - `T3`: `TrelloReadTools.searchCards` khi có từ khóa luôn truyền `idBoards` giới hạn theo `effectiveBoardId` hoặc `allowedBoardIds` đã xác thực quyền (từ chối `403 AUTH_ERROR` nếu danh sách bảng được phép rỗng).
- **`TRELLO-AUDIT-03` (`F3`, P2 — `T4`, `T4_RETRY`):**
  - Trong `TrelloWriteTools.addChecklist`, khi `POST /cards/:id/checklists` đã tạo checklist thành công nhưng việc tạo bất kỳ mục `checkItems` nào thất bại (403, 429, mạng, abort), ném `StepError` với `category: 'UNKNOWN'`, `retryable: false`, `details: { requestSent: true, partialWrite: true, checklistId, createdItems, failedItemIndex }`.
  - Trong `StepRunner.executeStep` (`packages/executor/src/runner.ts`), bổ sung kiểm tra `err?.details?.partialWrite === true` để luôn phân loại bước ghi dở dang thành `status: 'unknown'`, chặn `ExecutionController.retryStep` phát lại toàn bộ bước và tạo checklist trùng.
- **`TRELLO-AUDIT-04` (`F4`, P2 — `T9`):**
  - Sửa `TrelloAdapter.execute('trello.search_cards')` và `TrelloReadTools.execute('trello.search_cards')` truyền `(args, opts)` thay vì `{ ...args, ...opts }`, giữ nguyên `args.boardId` khi `context?.boardId` là `undefined`, và từ chối `403 AUTH_ERROR` khi `args.boardId` mâu thuẫn với `context.boardId`.
- **`TRELLO-AUDIT-05` (`AUTO-01` / `PROD-03`, P2 — phía adapter):**
  - `TrelloReadTools.searchCards` khử trùng lặp thẻ theo `id`, gắn thuộc tính non-enumerable `scanMetadata` (`available: 'UNKNOWN'`, `prefixLimit: 50`, `scannedCount`, `uniqueScannedCount`, `duplicateCountDropped`, `matchedCount`, `displayedCount`, `limitApplied`, `prefixCapReached`, `truncatedByLimit`, `isComplete: false`, `perBoard`) và xuất hàm `getTrelloSearchScanMetadata` cùng phương thức `searchCardsWithMetadata`.
- **`TRELLO-AUDIT-08` (`AUTO-04`, P2 — phía adapter):**
  - `SlackAdapter.sendMessage` (`packages/tool-adapters/src/slack/slack-adapter.ts`) xác thực `res.ts` là chuỗi khác rỗng và khác `'undefined'`, ném `StepError` (`category: 'UNKNOWN'`, `retryable: false`, `details: { requestSent: true }`) khi phản hồi HTTP 200 thiếu `ts`.
- **`R3` (`create_card` `idMembers` preflight):**
  - `TrelloWriteTools.createCard` xác thực cú pháp từng phần tử `idMembers` và đối chiếu với `/boards/:idBoard/members` trước khi gọi `POST /cards`.

## 2. Bằng chứng kiểm thử (Sanitized Env, No Live Network)

- **RED baseline (`D:\ATI-Audits\trello-remediation-20261110\a\red-baseline.log`):**
  - `packages/tool-adapters/tests/trello-audit-remediation.test.ts`: 28 failed, 1 passed (29 tests) — xác nhận tái hiện toàn bộ lỗi trên `2eed8d1d`.
- **GREEN focused (`D:\ATI-Audits\trello-remediation-20261110\a\green-focused.log`):**
  - `packages/tool-adapters/tests/trello-audit-remediation.test.ts` (29 tests) + `packages/tool-schemas/tests/trello-resource-id.test.ts` (2 tests): **31 passed (31)**, exit code `0`.
- **GREEN owned & adjacent suites (`D:\ATI-Audits\trello-remediation-20261110\a\green-all-owned.log`):**
  - 42 test files (`packages/tool-adapters/tests/trello-*.test.ts`, `slack-adapter.test.ts`, toàn bộ `packages/tool-schemas/tests/**`, toàn bộ `packages/executor/tests/**`, `apps/chat-api/tests/services/trello-oauth-client.test.ts`, `apps/chat-api/tests/services/trello-planning.test.ts`): **42 passed (42), 744 passed (744)**, exit code `0`.
  - `packages/tool-adapters/tests/sheets-adapter.test.ts`: **42 passed (42)**, exit code `0`.
- **Typecheck (`D:\ATI-Audits\trello-remediation-20261110\a\typecheck.log`):**
  - `npm run typecheck:v3`: **PASS**, exit code `0`.

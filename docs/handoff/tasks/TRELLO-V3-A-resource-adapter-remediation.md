# TRELLO-V3-A · Khắc phục lỗ hổng đường dẫn tài nguyên Trello, phạm vi đọc trước tải dữ liệu và tính toàn vẹn bước ghi

**Trạng thái:** Đã hoàn thành trên nhánh · **Nhánh:** `VinhDat267/fix-trello-resource-v3`

## Mục tiêu

Xử lý triệt để các phát hiện kiểm toán thuộc phạm vi `packages/tool-schemas`, `packages/tool-adapters`, và `packages/executor` trên baseline `2eed8d1d4309e833088d6f1d3fa774189049e283`:

1. **`TRELLO-AUDIT-01` (`F1`, P1 & `T7`):** Chặn tấn công thay thế đường dẫn trong `trello.remove_member` (`memberId: "../../FOREIGN"` bị chuẩn hóa thành `DELETE /1/cards/FOREIGN`) và mọi biến thể path traversal / ký tự điều khiển trên toàn bộ các trường ID tài nguyên Trello (`boardId`, `listId`, `cardId`, `memberId`, `checkItemId`, `idList`, `idMembers`).
2. **`TRELLO-AUDIT-02` (`F2`, P2 — `T1`, `T2`, `T3`):** Kiểm tra phạm vi bảng được phép trước khi tải nội dung chi tiết (`get_card` kiểm tra `/cards/:id?fields=id,idBoard` trước khi gọi `?checklists=all`; `search_cards` với `listId` kiểm tra `/lists/:id?fields=id,idBoard` trước khi gọi `/lists/:id/cards`; `search_cards` có từ khóa bắt buộc truyền `idBoards` giới hạn trong phạm vi được phép).
3. **`TRELLO-AUDIT-03` (`F3`, P2 — `T4`, `T4_RETRY`):** Bảo vệ bước ghi phức hợp `trello.add_checklist`: khi `POST /cards/:id/checklists` đã tạo checklist nhưng việc thêm mục con (`checkItems`) thất bại (403, 429, mạng, timeout), phân loại trạng thái bước thực thi là `unknown` kèm chi tiết `partialWrite: true` để `ExecutionController.retryStep` không phát lại toàn bộ bước và tạo trùng checklist.
4. **`TRELLO-AUDIT-04` (`F4`, P2 — `T9`):** Giữ nguyên `args.boardId` khi gọi `TrelloAdapter.execute('trello.search_cards', args, context)` hoặc `TrelloReadTools.execute('trello.search_cards', args, context)` mà `context?.boardId` không được truyền, đồng thời từ chối khi `args.boardId` và `context.boardId` mâu thuẫn.
5. **`TRELLO-AUDIT-05` (`AUTO-01` / `PROD-03`, P2 — phía adapter):** Khử trùng lặp `card.id` trong `TrelloReadTools.searchCards` và gắn metadata độ phủ `scanMetadata` (non-enumerable trên mảng kết quả, tương thích ngược 100%) cùng hàm trợ giúp `getTrelloSearchScanMetadata` và `searchCardsWithMetadata` để phản ánh trung thực giới hạn tiền tố 50 thẻ (`available: 'UNKNOWN'`, `isComplete: false`).
6. **`TRELLO-AUDIT-08` (`AUTO-04`, P2 — phía adapter):** Trong `SlackAdapter.sendMessage`, kiểm tra biên nhận trả về từ `/chat.postMessage` phải có `ts` chuỗi hợp lệ khác rỗng (không ép kiểu `String(res.ts)` thành `"undefined"`), ném `StepError` với `category: 'UNKNOWN'` nếu thiếu `ts`.
7. **`R3` (Rủi ro điều kiện — `create_card` `idMembers`):** Kiểm tra trước danh sách thành viên bảng (`/boards/:idBoard/members`) khi `trello.create_card` truyền `idMembers`, đồng nhất với `trello.add_member` và chặn trước khi gửi `POST /cards`.

## Phạm vi file được phép sửa

- `packages/tool-schemas/src/trello.ts`
- `packages/tool-schemas/tests/trello-resource-id.test.ts`
- `packages/tool-adapters/src/trello/base.ts`
- `packages/tool-adapters/src/trello/read-tools.ts`
- `packages/tool-adapters/src/trello/write-tools.ts`
- `packages/tool-adapters/src/trello/index.ts`
- `packages/tool-adapters/src/slack/slack-adapter.ts`
- `packages/tool-adapters/tests/trello-audit-remediation.test.ts`
- `packages/executor/src/runner.ts`
- `packages/planner/tests/read-answers.test.ts` (cập nhật mã băm SHA-256 baseline của system prompt sau khi bổ sung ràng buộc schema cho các trường ID tài nguyên Trello)
- `packages/planner/tests/schedules.test.ts` (cập nhật mã băm SHA-256 baseline của system prompt sau khi bổ sung ràng buộc schema cho các trường ID tài nguyên Trello)

## Kết quả (10/11/2026)

- **TDD (Red -> Green):**
  - Viết trước bộ kiểm thử hồi quy `packages/tool-adapters/tests/trello-audit-remediation.test.ts` (29 test cases) trên baseline `2eed8d1d`: 28/29 test mới fail đúng như dự kiến (ghi nhận tại `D:\ATI-Audits\trello-remediation-20261110\a\red-baseline.log`).
  - Sau khi triển khai sửa lỗi tối thiểu tại các ranh giới sở hữu: toàn bộ 29/29 test trong `trello-audit-remediation.test.ts` và 2/2 test trong `trello-resource-id.test.ts` đều PASS (`green-focused.log`).
- **Chi tiết khắc phục:**
  - `TRELLO-AUDIT-01` (`F1` & `T7`): Bổ sung `TRELLO_RESOURCE_ID_PATTERN` (`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`), `isValidTrelloResourceId`, `validateTrelloToolArgs` trong `packages/tool-schemas/src/trello.ts`; bổ sung `assertValidResourceId` và bộ kiểm tra đường dẫn `resolveSafeEndpointUrl` trong `TrelloBaseAdapter` (`packages/tool-adapters/src/trello/base.ts`) chặn mọi chuỗi rỗng, khoảng trắng, `/`, `\`, `.`, `..`, `%2e`, `%2f`, `%5c`, `%00`, `?`, `#`, ký tự điều khiển và kiểm tra cấu trúc 4 phân đoạn của `DELETE /cards/:id/idMembers/:idMember` trong `removeMember` với `0` lượt gọi HTTP khi dữ liệu không hợp lệ.
  - `TRELLO-AUDIT-02` (`F2`): `getCard` truy vấn `/cards/:id?fields=id,idBoard` và xác thực `assertParentBoard` trước khi gọi `/cards/:id?checklists=all`; `searchCards` xác thực `/lists/:id?fields=id,idBoard` trước khi lấy thẻ của danh sách và luôn truyền `idBoards` đã xác thực quyền khi gọi `/search`.
  - `TRELLO-AUDIT-03` (`F3`): `addChecklist` bắt mọi lỗi phát sinh sau khi `POST /cards/:id/checklists` đã tạo checklist, ném `StepError` (`category: 'UNKNOWN'`, `retryable: false`, `details: { requestSent: true, partialWrite: true, checklistId, createdItems, failedItemIndex }`) và `StepRunner.executeStep` chuyển trạng thái bước sang `'unknown'`, ngăn `ExecutionController.retryStep` tạo checklist trùng.
  - `TRELLO-AUDIT-04` (`F4`): `TrelloAdapter.execute` và `TrelloReadTools.execute` truyền `(args, opts)` vào `searchCards` thay vì `{ ...args, ...opts }`, giữ nguyên `args.boardId` khi `context.boardId` là `undefined` và từ chối `403 AUTH_ERROR` nếu hai giá trị xung đột.
  - `TRELLO-AUDIT-05` (`AUTO-01` / `PROD-03` — phía adapter): `searchCards` khử trùng lặp `card.id` và gắn thuộc tính non-enumerable `scanMetadata` (`available: 'UNKNOWN'`, `prefixLimit: 50`, `scannedCount`, `uniqueScannedCount`, `duplicateCountDropped`, `matchedCount`, `displayedCount`, `prefixCapReached`, `truncatedByLimit`, `isComplete: false`, `perBoard`) cùng `getTrelloSearchScanMetadata` và `searchCardsWithMetadata`.
  - `TRELLO-AUDIT-08` (`AUTO-04` — phía adapter): `SlackAdapter.sendMessage` xác thực `res.ts` là chuỗi khác rỗng và khác `"undefined"`, ném `StepError` (`category: 'UNKNOWN'`, `retryable: false`, `details: { requestSent: true }`) khi phản hồi HTTP 200 thiếu `ts`.
  - `R3`: `TrelloWriteTools.createCard` kiểm tra cú pháp từng phần tử `idMembers` và đối chiếu với `/boards/:idBoard/members` trước khi gửi `POST /cards`.
  - **Cập nhật hồi quy mã băm System Prompt (`packages/planner/tests/read-answers.test.ts`, `packages/planner/tests/schedules.test.ts`):** Chứng minh dòng-đối-dòng (`D:\ATI-Audits\trello-remediation-20261110\a\prompt-diff-proof.log`) rằng chỉ đúng 8 dòng `Input:` của các tool Trello trong `ALL_TOOLS` thay đổi do bổ sung `pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$"`, `minLength: 1`, `maxLength: 128` trên các trường ID tài nguyên Trello (khi lược bỏ 3 thuộc tính này thì khớp tuyệt đối 100% mã băm lịch sử), đồng thời hành vi tắt cờ (`readAnswers: false`, `schedules: false`, `scheduledRun: true`) giữ nguyên từng byte so với khi lược bỏ cờ; cập nhật mã băm baseline và vượt qua toàn bộ 40/40 file test của `@wap/planner` (567/567 tests).

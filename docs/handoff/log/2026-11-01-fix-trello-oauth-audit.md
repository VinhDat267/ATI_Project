# Bàn giao: Khắc phục các lỗi Audit tính năng Trello OAuth 2.0 (3LO)

- **Ngày:** 2026-11-01
- **Nhánh:** `feat/trello-oauth`
- **Đặc tả & Kế hoạch:** `docs/superpowers/specs/2026-11-01-trello-oauth-design.md`, `docs/superpowers/plans/2026-11-01-trello-oauth.md`

## Thay đổi
- `packages/tool-adapters/src/trello/read-tools.ts`, `packages/tool-adapters/src/trello/write-tools.ts`, `packages/tool-adapters/tests/trello-oauth-scope.test.ts`: Kiểm tra `options.boardId` với `assertBoardInScope` trước khi phát sinh bất kỳ lệnh gọi HTTP nào tới Trello, đồng thời giữ kiểm tra `assertParentBoard` sau khi lấy thông tin `list`/`card`.
- `apps/chat-api/src/routes/connections/trello.ts`, `apps/chat-api/src/routes/services-routes.ts`, `apps/chat-api/tests/routes/trello-connections.test.ts`, `apps/chat-api/tests/routes/trello-scope.test.ts`, `apps/chat-api/tests/routes/trello-shared-credentials.test.ts`: Xoá đoạn trả fake boards khi chưa cấu hình OAuth; trả đúng `status: 'reconnect_required'` khi token refresh gặp `invalid_grant`; loại trùng `boardIds` trong `PUT /api/connections/trello/scope`; bổ sung `personalStatus`, `username`, `connectedAt` cho Trello trong `GET /api/services`.
- `apps/chat-api/src/services/chat-service.ts`, `apps/chat-api/src/services/adapter-factory.ts`, `apps/chat-api/src/server.ts`, `apps/chat-api/tests/services/trello-planning.test.ts`, `apps/chat-api/tests/sandbox/trello-sandbox.test.ts`: Xoá biến mutable `this.trelloTeamBoards` trên singleton `ChatService`; hỗ trợ ánh xạ `boardId` qua `$ref` của `listId`; xoá fallback đọc JSON không mã hoá trong `AdapterFactory.trelloAdapter`; kiểm tra `ctx.boardId` trong sandbox wrapper.
- `apps/chat-web/src/pages/Responses/ResponseMoment.tsx`, `apps/chat-web/src/pages/Settings/TrelloConnection.tsx`, `apps/chat-web/src/pages/Settings/SettingsPage.tsx`, `apps/chat-web/tests/trello-connection.test.tsx`, `apps/chat-web/tests/browser/trello-oauth.spec.ts`: Cho phép kết nối Trello và gửi lại yêu cầu từ thẻ từ chối trong chat ngay cả khi các cờ Google tắt (`connectFromChat={false}`); mở nút `#trello-edit-scope` ("Đổi bảng") cho Admin cả khi ở trạng thái `needs_membership`; tuân thủ The One Signal Rule trong `#trello-scope`; hiển thị `trelloConnectionNotice` trên trang Cài đặt.

## Kiểm thử
- `npm --workspace=@wap/tool-schemas test`: 12 files, 116 passed (exit code 0).
- `npx --workspace=@wap/tool-adapters vitest run tests/trello-oauth-scope.test.ts tests/trello-base.test.ts tests/trello-read.test.ts tests/trello-write.test.ts`: 4 files, 24 passed (exit code 0).
- `npx --workspace=@wap/chat-api vitest run tests/config/trello-env.test.ts tests/db/trello-oauth-migration.test.ts tests/db/trello-team-repo.test.ts tests/services/trello-oauth-client.test.ts tests/services/trello-token-manager.test.ts tests/routes/trello-connections.test.ts tests/routes/trello-scope.test.ts tests/routes/trello-shared-credentials.test.ts tests/services/trello-planning.test.ts tests/sandbox/trello-sandbox.test.ts`: 10 files, 86 passed (exit code 0).
- `npx --workspace=@wap/chat-web vitest run tests/trello-connection.test.tsx tests/components/settings.test.tsx`: 2 files, 18 passed (exit code 0).
- `npm run typecheck:v3`: exit code 0.

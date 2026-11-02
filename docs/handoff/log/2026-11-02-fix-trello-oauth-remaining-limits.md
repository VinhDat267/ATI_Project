# 2026-11-02 · antigravity · Sửa dứt điểm 3 giới hạn tồn đọng sau merge Trello OAuth (#224/#228)

- **Đã làm:**
  - **(1) Chuẩn hóa trạng thái OAuth cá nhân trong `GET /api/services` (`apps/chat-api/src/routes/services-routes.ts`):** Với 3 dịch vụ OAuth cá nhân thuộc catalog gốc (`trello`, `github`, `telegram`), `GET /api/services` trả về `connection: 'personal'`, `personalStatus: 'connected' | 'reconnect_required' | 'not_connected'`, `configured: personalStatus === 'connected'`, `connected: personalStatus === 'connected'`, và `connectionStatus: personalStatus === 'connected' ? 'healthy' : 'unconfigured'` (vẫn giữ nguyên `SERVICE_REGISTRY` tĩnh trong `@wap/tool-schemas`).
  - **(2) Đồng bộ số đếm dịch vụ trên trang Cài đặt (`apps/chat-web/src/pages/Settings/SettingsPage.tsx`):** Thay mẫu số cứng `/ 8 dịch vụ` ở `#summary-connected-count` và dòng trống ở `#list-unconnected-services` bằng `${list.length}` để khớp với số dịch vụ dùng khoá chung hiển thị bên dưới (5 dịch vụ ở chế độ Nhóm, 3 ở chế độ Cá nhân).
  - **(3) Hoàn thiện `CredentialRepo` (`encryptionKey` & in-memory fallback) trong `apps/chat-api/src/server.ts`:** Bổ sung đầy đủ các phương thức personal credential vào fallback `credRepo` in-memory và thêm test bảo vệ `new CredentialRepo(pool, customKey).rotatePersonalSecret(...)` trong `apps/chat-api/tests/routes/trello-shared-credentials.test.ts`.

- **Kiểm tra đã chạy (lệnh và kết quả):**
  - `npm run typecheck:v3` — exit code 0.
  - `npx --workspace=@wap/tool-schemas vitest run` — 17 test files passed, 341 tests passed (exit code 0).
  - `npx --workspace=@wap/chat-api vitest run tests/routes/trello-shared-credentials.test.ts tests/routes/github-shared-credentials.test.ts tests/routes/telegram-shared-credentials.test.ts tests/routes/gmail-services.test.ts tests/routes/mycalendar-services.test.ts tests/routes/mysheets-services.test.ts tests/routes/workspace-isolation.test.ts tests/routes/trello-connections.test.ts tests/routes/trello-scope.test.ts` — 9 test files passed, 96 tests passed trên PostgreSQL 16 thật (exit code 0).
  - `npx --workspace=@wap/chat-web vitest run tests/fe-07-settings.test.tsx tests/workflow-flow-canvas.test.tsx tests/trello-connection.test.tsx tests/components/settings.test.tsx` — 4 test files passed, 64 tests passed (exit code 0).

# 2026-11-02 · longnguyen005 · JIRA-07 · Sửa lỗi CI Jira test và hoàn thiện grounding siteId/workspace

- **Đã làm:**
  - **(1) Khắc phục lỗi CI Jira test cấu trúc quan sát (`packages/planner/src/search.ts`):**
    - Sửa `compact()` trong `search.ts`: không đưa trường `status` vào đối tượng quan sát nếu `fields` không yêu cầu, đảm bảo cấu trúc entity quan sát tương thích ngược với các test Jira hiện có (`apps/chat-api/tests/integration/jira-extension.test.ts:70`).
    - Lọc bỏ các thực thể bị thu hồi (`isEntityRevoked`: `revoked === true || masked === true || status === 'revoked' || status === 'disabled'`) ngay tại bước `compact()`, trả về `undefined` thay vì giữ trường `status` trong dữ liệu quan sát.
  - **(2) Siết chặt thẩm định `siteId` đã xác minh (`packages/planner/src/validator.ts`):**
    - Sửa `findUngrounded()`: tài nguyên `jira_site` bắt buộc phải thuộc danh mục site đã xác minh trong working memory (`grounding.memory.jira_site`), không chấp nhận `siteId` người dùng tự gõ nếu không nằm trong danh mục verified sites.
    - Cập nhật thứ tự thẩm định trong `validatePlan()`: chạy `findUngrounded` trước `findAmbiguousSites` để các `siteId` không hợp lệ/chưa xác minh bị bắt ở lỗi ungrounded resource trước khi xét tính mơ hồ.
  - **(3) Bổ sung ngữ cảnh workspace và cloud cho định danh thực thể quan sát (`packages/planner/src/search.ts`):**
    - Mở rộng `entityIdentity()` kết hợp đầy đủ `workspaceId`, `cloudId`, `siteId` và `id` (dạng `ws:<ws>/cloud:<cloud>/site:<site>:<id>`), đảm bảo thực thể trùng key/id ở các workspace hoặc Atlassian cloud khác nhau không bị va chạm hay ghi đè lẫn nhau.
    - Bổ sung `workspaceId` vào `KEPT_FIELDS`.
  - **(4) Bổ sung kiểm thử TDD (`packages/planner/tests/`):**
    - `packages/planner/tests/myjira-security-source.test.ts`: bổ sung test kiểm tra `recordObserved` không làm rò rỉ trường `status` vào observed entity.
    - `packages/planner/tests/myjira-grounding.test.ts`: bổ sung test giữ nguyên các thực thể có cùng `siteId` và `id` khi `workspaceId` hoặc `cloudId` khác nhau (3 entities phân biệt).
    - `packages/planner/tests/myjira-grounding.test.ts`: bổ sung test từ chối `siteId` người dùng tự gõ khi không có trong danh mục verified sites.

- **PR / commit:**
  - Nhánh `longnguyen005/jira-07-planner`.
  - Không sửa `CURRENT-STATE.md` hay `ROADMAP.md`.

- **Kiểm tra đã chạy (lệnh và kết quả):**
  - `npm run test -w @wap/planner`: 31 files passed, 434 tests passed (exit code 0).
  - `npx vitest run evaluations/generic-plumbing/static-guard.test.ts evaluations/golden-v2/run-myjira.test.ts`: 2 files passed, 8 tests passed (exit code 0).
  - `npx vitest run evaluations/golden-v2/`: 17 files passed, 289 tests passed (exit code 0).
  - `npx vitest run evaluations/golden-independent/`: 1 file passed, 46 tests passed (exit code 0).
  - `npm test -w @wap/tool-schemas`: 18 files passed, 347 tests passed (exit code 0).
  - `npm run typecheck:v3`: exit code 0 (`chat-api` và `chat-web` 0 lỗi TypeScript).

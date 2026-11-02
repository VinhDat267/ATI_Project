# 2026-11-02 · longnguyen005 · JIRA-07 · Triệt tiêu rò rỉ kết quả Jira thu hồi, hoàn thiện grounding workspace/cloud và nhận diện short site name

- **Đã làm:**
  - **(1) Triệt tiêu rò rỉ kết quả Jira bị thu hồi vào prompt của model (`packages/planner/src/planner.ts:462`, `packages/planner/src/search.ts`):**
    - Sửa `lookup()` trong `planner.ts`: lọc sạch (`sanitizeEntities(list)`) ngay khi nhận kết quả từ `gatherSearch`, ngăn các thực thể có `revoked: true`, `masked: true`, `status: 'revoked'`, hoặc `status: 'disabled'` (hỗ trợ case-insensitive) đi vào `result`, `onGatherEvent` và `SearchOutcome`.
    - Sửa `formatSearchResults()` trong `search.ts`: chủ động vệ sinh `result` bằng `sanitizeEntities()` trước khi chuyển qua `boundedOutcome()`, đảm bảo vòng lặp lập kế hoạch tại `planner.ts:462-464` không bao giờ đưa kết quả đã bị thu hồi vào prompt thông qua thẻ `<search_results>` trong `conversationHistory`.
  - **(2) Hoàn thiện bảo toàn ngữ cảnh workspace và cloud cho Grounding (`packages/planner/src/search.ts`, `packages/planner/src/planner.ts`, `packages/planner/src/validator.ts`):**
    - Sửa `compact()` trong `search.ts`: luôn giữ lại các trường phạm vi bắt buộc (`SCOPING_FIELDS: ['siteId', 'cloudId', 'workspaceId']`) ngay cả khi `fields` (từ `tool.observedFields`) không khai báo chúng, giúp các thực thể quan sát không bị mất `workspaceId`/`cloudId` khi ghi vào `__observed` và `groundingMemory`.
    - Cập nhật `lookup()` trong `planner.ts`: làm giàu `stamp` với `cloudId` và `workspaceId` từ `input.actor` và metadata `jira_site` đã lưu trong memory.
    - Cập nhật `findUngrounded()` trong `validator.ts`: kiểm tra đối sánh chặt chẽ `cloudId` và `workspaceId` giữa thực thể được quan sát và site đích trong `grounding.memory.jira_site`.
    - Cập nhật `validatePlan()` trong `validator.ts`: phát hiện và từ chối tham chiếu chéo giữa các bước có cùng alias `siteId` nhưng khác `cloudId` hoặc `workspaceId`.
  - **(3) Khắc phục lỗi báo mơ hồ khi người dùng viết tên site ngắn như "Acme" (`packages/planner/src/validator.ts`):**
    - Thiết kế lại `findAmbiguousSites()`: trích xuất các token/alias định danh đặc trưng của từng site trong `availableSites` (tên site đầy đủ, các từ trong tên site, subdomain từ URL như `acme` từ `https://acme.atlassian.net`, hostname, ID).
    - Tính toán tần suất token giữa các site: chỉ những token không trùng với site khác và không nằm trong tập stop words chung mới được coi là token định danh đặc trưng của site đó.
    - Nhờ đó, các câu lệnh viết tên ngắn ("Acme", "acme") hoặc subdomain URL được nhận diện chính xác mà không bị báo mơ hồ, trong khi câu lệnh không nêu rõ hoặc dùng từ generic ("Jira") vẫn được yêu cầu làm rõ đúng quy định.
  - **(4) Bổ sung kiểm thử TDD (`packages/planner/tests/`):**
    - `packages/planner/tests/myjira-security-source.test.ts`: test `formatSearchResults` loại bỏ thực thể bị thu hồi; test `AIPlanner` không đưa kết quả thu hồi vào `conversationHistory` tại line 462.
    - `packages/planner/tests/myjira-grounding.test.ts`: test chấp nhận tên site ngắn như "Acme"; test chấp nhận subdomain URL; test bảo toàn `workspaceId` và `cloudId` qua `compact()` với `observedFields` tùy biến.

- **PR / commit:**
  - Nhánh `longnguyen005/jira-07-planner`.
  - Không sửa `CURRENT-STATE.md` hay `ROADMAP.md`.

- **Kiểm tra đã chạy (lệnh và kết quả):**
  - `npm run test -w @wap/planner`: 31 files passed, 439 tests passed (exit code 0).
  - `npx vitest run evaluations/generic-plumbing/static-guard.test.ts evaluations/golden-v2/run-myjira.test.ts`: 2 files passed, 8 tests passed (exit code 0).
  - `npx vitest run evaluations/golden-v2/`: 17 files passed, 289 tests passed (exit code 0).
  - `npx vitest run evaluations/golden-independent/`: 1 file passed, 46 tests passed (exit code 0).
  - `npm test -w @wap/tool-schemas`: 18 files passed, 347 tests passed (exit code 0).
  - `npm run typecheck:v3`: exit code 0 (`chat-api` và `chat-web` 0 lỗi TypeScript).

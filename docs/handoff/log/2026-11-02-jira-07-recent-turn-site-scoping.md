# 2026-11-02 · longnguyen005 · JIRA-07 · Xác định site theo yêu cầu hiện tại và sửa khớp định danh có gạch nối

- **Đã làm:**
  - **(1) Xác định site grounding theo yêu cầu hiện tại hoặc lượt làm rõ liên quan (`packages/planner/src/planner.ts`, `packages/planner/src/validator.ts`):**
    - Sửa `planner.ts`: xây dựng `relevantGroundingUserTexts(history, currentMessage)` để chỉ đưa yêu cầu hiện tại và các lượt làm rõ chưa kết thúc (assistant clarification questions) vào `grounding.userTexts`. Dừng duyệt ngược ngay khi gặp tin nhắn trợ lý kết thúc quy trình trước đó (kế hoạch `plan`, câu trả lời `answer`, từ chối `refusal` hoặc `schedule_proposal`).
    - Truyền `relevantGroundingUserTexts` vào `validatePlan` ở cả chế độ `planWithSearch` (line ~498) và chế độ trực tiếp `processMessage` (line ~611), ngăn chặn triệt để việc các tin nhắn cũ từ yêu cầu đã xong rò rỉ vào danh sách văn bản thẩm định grounding.
    - Sửa `findAmbiguousSites()` trong `validator.ts`: duyệt `grounding.userTexts` từ lượt mới nhất đến cũ nhất (`for (let i = userTexts.length - 1; i >= 0; i--)`). Lượt đầu tiên (mới nhất) chỉ định một hoặc nhiều site hợp lệ sẽ xác định tập `targetSites` duy nhất và dừng (`break`), không cho phép tên site nhắc ở lượt cũ hơn kích hoạt hoặc làm loãng lựa chọn site của yêu cầu hiện tại.
    - Nhờ đó, giải quyết triệt để ca tái hiện: kế hoạch ghi vào site Acme bị từ chối với lỗi ambiguous site khi yêu cầu hiện tại nói Beta dù tin nhắn cũ từng nhắc Acme; đồng thời chấp nhận kế hoạch ghi vào Beta.
  - **(2) Sửa lỗi khớp định danh có dấu gạch nối (`site-a` khớp nhầm `site-a-evil`) (`packages/planner/src/validator.ts`):**
    - Bổ sung ký tự dấu gạch nối `-` và các ký tự định danh vào tập ranh giới của hàm `matchesWordExact`:
      `(?<![\p{L}\p{N}_-]|(?:[\p{L}\p{N}]\.))${escaped}(?![\p{L}\p{N}_-]|(?:\.[\p{L}\p{N}]))`
    - Đảm bảo các định danh chứa dấu gạch nối như `site-a` không còn bị xem dấu `-` kế tiếp là word boundary, loại trừ triệt để việc khớp nhầm các chuỗi mở rộng như `site-a-evil`, `evil-site-a` hay `site-a.evil.com`, trong khi vẫn chấp nhận chính xác `site-a` đứng độc lập hoặc kết thúc câu (`site-a.`).
  - **(3) Bổ sung kiểm thử TDD (`packages/planner/tests/`):**
    - `packages/planner/tests/myjira-grounding.test.ts`:
      - Test từ chối kế hoạch ghi vào site Acme khi yêu cầu hiện tại nói Beta dù tin nhắn cũ nhắc Acme;
      - Test chấp nhận kế hoạch ghi vào site Beta khi yêu cầu hiện tại nói Beta;
      - Test không cho phép `site-a` khớp `site-a-evil`, `evil-site-a` hoặc `site-a.evil.com`;
      - Test đa lượt `AIPlanner`: Turn 1 Acme + Turn 2 Beta Jira, model trả plan Acme bị planner từ chối và yêu cầu làm rõ, model trả plan Beta được chấp nhận.
    - `packages/planner/tests/planner.test.ts`:
      - Test suite cho `relevantGroundingUserTexts`: chỉ lấy tin nhắn hiện tại khi history rỗng; loại trừ tin nhắn của lượt đã kết thúc bằng plan/answer/refusal; giữ lại toàn bộ chuỗi lượt làm rõ đang diễn ra.

- **PR / commit:**
  - Nhánh `longnguyen005/jira-07-planner`.
  - Không sửa `CURRENT-STATE.md` hay `ROADMAP.md`.

- **Kiểm tra đã chạy (lệnh và kết quả):**
  - `npm run test -w @wap/planner`: 31 files passed, 451 tests passed (exit code 0).
  - `npx vitest run evaluations/generic-plumbing/static-guard.test.ts evaluations/golden-v2/run-myjira.test.ts`: 2 files passed, 8 tests passed (exit code 0).
  - `npx vitest run evaluations/golden-v2/`: 17 files passed, 289 tests passed (exit code 0).
  - `npm test -w @wap/tool-schemas`: 18 files passed, 347 tests passed (exit code 0).
  - `npm run typecheck:v3`: exit code 0 (`chat-api` và `chat-web` 0 lỗi TypeScript).

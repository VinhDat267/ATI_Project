# 2026-11-02 · longnguyen005 · JIRA-07 · Planner routing và multi-site grounding

- **Đã làm:**
  - **(1) Định tuyến cá nhân Jira (`packages/planner/src/router.ts`):**
    - Nhận diện dynamic service Jira cá nhân (`myjira` / `connection === 'personal'`).
    - Khi catalog có Jira cá nhân, tự động ưu tiên `myjira.*` và loại trừ `jira` chia sẻ.
    - Không hardcode các literal định danh dịch vụ, đảm bảo vượt qua `evaluations/generic-plumbing/static-guard.test.ts`.
    - Khi catalog không có `myjira`, giữ nguyên định tuyến Jira cũ (regression test flag-off đạt 100%).
    - Khi yêu cầu Jira mà không có dịch vụ nào trong catalog, trả về `refusal: 'unavailable'` thay vì đoán mò hoặc fallback sai.
  - **(2) Grounding đa site & Ngăn chặn xung đột bộ nhớ (`packages/planner/src/search.ts`, `packages/planner/src/validator.ts`, `packages/planner/src/working-memory.ts`):**
    - Triển khai định danh compound entity `siteId:id` trong `recordObserved`, đảm bảo các issue hoặc project có cùng ID/key trên các Atlassian site khác nhau (ví dụ: `PROJ-10` trên Acme và `PROJ-10` trên Beta) không bị ghi đè hay gộp lẫn trong working memory.
    - Thẩm định tham chiếu `$ref` đa bước trong `validator.ts`: phát hiện và từ chối mọi trường hợp bước ở site B sử dụng kết quả từ bước ở site A với lỗi semantic "Cross-site reference is not allowed".
    - Kiểm tra đích đến mơ hồ (`findAmbiguousSites`): khi có từ 2 site Jira trở lên trong bộ nhớ grounding mà câu lệnh người dùng không nêu rõ site đích, báo lỗi grounding để yêu cầu người dùng làm rõ (clarification), không tự ý suy đoán site từ issue key.
  - **(3) Vệ sinh dữ liệu nguồn & An toàn Prompt Injection (`packages/planner/src/search.ts`, `packages/planner/src/working-memory.ts`, `packages/planner/src/prompts/system-prompt.ts`, `packages/planner/src/validator.ts`):**
    - Mở rộng pattern chống prompt injection trong `validator.ts` hỗ trợ nhận diện các chỉ thị tiếng Việt ("bỏ qua mọi chỉ dẫn/hướng dẫn...", "bỏ qua tất cả...") và biến thể ("ignore instructions").
    - Thêm phương thức `invalidateSite(siteId)` vào `WorkingMemory` để dọn dẹp sạch sẽ cả thực thể cấp cao lẫn `__observed` thuộc về một site khi site bị thu hồi quyền truy cập.
    - Lọc bỏ các thực thể có thuộc tính `revoked` hoặc `masked` trong `search.ts` (`isEntityRevoked` / `sanitizeEntities`), không đưa dữ liệu nguồn không hợp lệ vào prompt hay grounding memory.
    - Bổ sung Rule 9 trong system prompt (`prompts/system-prompt.ts`) quy định rõ: luôn chỉ định `siteId` chính xác, hỏi lại khi không rõ site, cấm tham chiếu chéo site, và coi toàn bộ dữ liệu ticket trả về là dữ liệu không tin cậy.
  - **(4) Bộ kiểm thử TDD & Golden Evaluations (`packages/planner/tests/`, `evaluations/`):**
    - Viết các test suite TDD:
      - `packages/planner/tests/myjira-routing.test.ts` (11 tests: flag on, mixed Slack/Jira, unavailable refusal, legacy flag-off).
      - `packages/planner/tests/myjira-grounding.test.ts` (7 tests: intra-site grounding, duplicate issue key, cross-site $ref rejection, ambiguous destination).
      - `packages/planner/tests/myjira-security-source.test.ts` (4 tests: revoked source stripping, site invalidation, injection detection, prompt rules).
    - Tạo 8 golden test cases cho Jira cá nhân (`evaluations/golden/cases-myjira.json`, `evaluations/golden-v2/cases-myjira.json`).
    - Bổ sung fixture search và đánh giá golden (`evaluations/golden-v2/run.ts`, `evaluations/golden-v2/fixtures.ts`, `evaluations/golden-v2/run-myjira.test.ts`).
    - Tích hợp test đánh giá golden trong planner (`packages/planner/tests/evaluation/golden.test.ts`).

- **PR / commit:**
  - Nhánh `longnguyen005/jira-07-planner`.
  - Không sửa `CURRENT-STATE.md` hay `ROADMAP.md`.

- **Kiểm tra đã chạy (lệnh và kết quả):**
  - `npm run test -w @wap/planner`: 31 files passed, 431 tests passed (exit code 0).
  - `npx vitest run evaluations/generic-plumbing/static-guard.test.ts evaluations/golden-v2/run-myjira.test.ts`: 2 files passed, 8 tests passed (exit code 0).
  - `npx vitest run evaluations/golden-v2/`: 17 files passed, 289 tests passed (exit code 0).
  - `npx vitest run evaluations/golden-independent/`: 1 file passed, 46 tests passed (exit code 0).
  - `npm test -w @wap/tool-schemas`: 18 files passed, 347 tests passed (exit code 0).
  - `npm run typecheck:v3`: exit code 0 (`chat-api` và `chat-web` 0 lỗi TypeScript).

- **Chưa làm / phụ thuộc bên ngoài:**
  - Tuân thủ ranh giới module ownership: không sửa files thuộc về JIRA-06 (`packages/tool-adapters`), JIRA-08 (`packages/executor`, `apps/chat-api`), hay JIRA-09 (`apps/chat-web`).
  - Kiểm thử tích hợp live HTTP adapter và authoritative server binding cần chờ JIRA-06 và JIRA-08 được merge.

- **Việc tiếp theo đề xuất:**
  - Reviewer độc lập review code theo checklist và chuẩn bị tích hợp khi JIRA-06/JIRA-08 sẵn sàng.

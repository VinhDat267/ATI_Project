# JIRA-07 · Planner routing và multi-site grounding

**Nguồn chuẩn:** [thiết kế Jira §7–11](../../superpowers/specs/2026-10-30-jira-personal-workspaces-design.md), [kế hoạch](../../superpowers/plans/2026-11-02-jira-07-planner.md).

**Nhánh:** `longnguyen005/jira-07-planner`. **Phụ thuộc:** JIRA-02 schema, JIRA-05 policy/capability directory đã merge #254, JIRA-06 adapter HTTP. Không sửa module của JIRA-06/08/09.

## Mục tiêu

- Khi `MYJIRA_ENABLED` bật, định tuyến yêu cầu Jira sang `myjira.*`, không dùng `jira.*` cũ. Khi tắt, giữ catalog/routing cũ.
- Hỏi lại nếu nhiều site hoặc project khớp; chỉ dùng site duy nhất nếu context đã xác minh. Không đoán site từ issue key.
- Grounding theo `workspaceId + cloudId + resourceType + providerId`; reference và memory không trộn hai site có cùng issue key.
- Memory/prompt không kế thừa dữ liệu nguồn Jira đã mất quyền; dữ liệu Jira trong output không trở thành chỉ thị model.
- Đăng ký label eval trước lần gọi model; JIRA-10 chạy model chuẩn ×3.

## Phạm vi

`packages/planner/`, `prompts/`, `evaluations/` và tài liệu task/plan/log của chính task. JIRA-06 sở hữu HTTP adapter; JIRA-08 sở hữu server/executor binding/source revalidation; JIRA-09 sở hữu web UI.

## Nghiệm thu

1. Test route flag off/on, lỗi thiếu dịch vụ, và hồi quy đa dịch vụ.
2. Test site trùng issue/project key, ambiguous destination, cross-site `$ref`, memory bị thu hồi và prompt injection.
3. `npm run test -w @wap/planner`, `npm run check`; browser/integration khi JIRA-06/08/09 sẵn sàng.
4. PR ghi file đổi, output thật, commit hash và giới hạn live/model.

## Kết quả

Hoàn thành triển khai và kiểm thử các chức năng của JIRA-07 trong module `@wap/planner` và `evaluations`:
1. **Định tuyến cá nhân Jira (`router.ts`):**
   - Khi catalog có `myjira` (cá nhân), tự động ưu tiên `myjira.*` và loại bỏ dịch vụ `jira` chia sẻ.
   - Khi catalog không có `myjira`, giữ nguyên định tuyến Jira cũ (regression test flag-off đạt 100%).
   - Khi yêu cầu Jira mà không có dịch vụ nào, trả về `refusal: 'unavailable'` thay vì fallback sai.
   - Tuân thủ kiểm tra `evaluations/generic-plumbing/static-guard.test.ts` (không hardcode service ID literals).
2. **Grounding đa site và chống đè memory (`working-memory.ts`, `search.ts`, `validator.ts`):**
   - Định danh bộ nhớ compound theo `siteId:id` cho tài nguyên Jira, đảm bảo các ticket trùng key giữa hai Atlassian site khác nhau (ví dụ: `PROJ-10` trên Acme và `PROJ-10` trên Beta) không bị ghi đè.
   - Thẩm định tham chiếu `$ref` đa bước chặn việc truyền output giữa 2 bước thuộc 2 site khác nhau (lỗi semantic validation: "Cross-site reference is not allowed").
   - Nhận diện ambiguous site khi có nhiều site trong memory mà prompt không chỉ định rõ site đích, báo lỗi grounding để yêu cầu clarification.
3. **Vệ sinh dữ liệu nguồn & An toàn Prompt Injection (`validator.ts`, `working-memory.ts`, `system-prompt.ts`):**
   - Mở rộng pattern chống injection phát hiện các chỉ thị tiếng Việt ("bỏ qua mọi chỉ dẫn/hướng dẫn...") và biến thể ("ignore instructions").
   - Hàm `invalidateSite(siteId)` trong `WorkingMemory` xóa toàn bộ thực thể và quan sát của site khi bị thu hồi quyền.
   - Lọc bỏ thực thể bị revoked/masked khỏi grounding memory và prompt của model.
   - Bổ sung Rule 9 trong system prompt hướng dẫn model về grounding `siteId`, clarification khi ambiguous, và coi nội dung ticket là dữ liệu không tin cậy.
4. **Bộ kiểm thử & Đánh giá (`evaluations/`):**
   - Tạo bộ 8 golden cases cho Jira cá nhân (`evaluations/golden/cases-myjira.json`, `evaluations/golden-v2/cases-myjira.json`).
   - Tích hợp runner và fixtures đánh giá (`evaluations/golden-v2/run.ts`, `evaluations/golden-v2/fixtures.ts`, `evaluations/golden-v2/run-myjira.test.ts`).
   - Bổ sung test suite đánh giá golden (`packages/planner/tests/evaluation/golden.test.ts`).

### Bằng chứng kiểm thử thực tế

- `npm run test -w @wap/planner`:
  - 31 test files, 431 tests PASS (exit 0)
- `npx vitest run evaluations/generic-plumbing/static-guard.test.ts evaluations/golden-v2/run-myjira.test.ts`:
  - 2 test files, 8 tests PASS (exit 0)
- `npx vitest run evaluations/golden-v2/`:
  - 17 test files, 289 tests PASS (exit 0)
- `npx vitest run evaluations/golden-independent/`:
  - 1 test file, 46 tests PASS (exit 0)
- `npm run typecheck:v3`:
  - Exit 0 (0 lỗi TypeScript trên cả chat-api và chat-web)

### Trạng thái phụ thuộc JIRA-06 & JIRA-08

- Logic planner, memory, grounding và golden evals của JIRA-07 đã hoàn thiện độc lập dựa trên contract schema của JIRA-02.
- Kiểm thử end-to-end với adapter live HTTP và authoritative binding cần chờ PR của JIRA-06 (`packages/tool-adapters`) và JIRA-08 (`packages/executor` & `apps/chat-api`) hoàn tất merge.

